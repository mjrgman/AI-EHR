#!/usr/bin/env node
/**
 * Coverage gate.
 *
 * Runs the unit suite under Node's built-in coverage, writes LCOV, and enforces
 * a global floor plus per-file minimums for the modules where a coverage
 * regression would matter most.
 *
 *   node scripts/check-coverage.js            # enforce
 *   node scripts/check-coverage.js --report   # print the table, exit 0
 *
 * Why Node's built-in coverage and not c8: this repository pins
 * `minimatch: ">=3.1.4 <9"` in overrides for a security advisory, and current
 * c8 depends on test-exclude@8 which requires minimatch 9's API. Rather than
 * widen a security override to satisfy a coverage tool, this uses what the
 * runtime already provides. No new dependency.
 *
 * WHAT THESE NUMBERS DO AND DO NOT MEAN
 *
 * This measures the `node --test` unit suite ONLY. The custom runner
 * (`npm test`) drives the HTTP surface in a separate process, so route modules
 * such as patient-portal.js and medivault-routes.js read far lower here than
 * they are actually exercised. Do not read a low number for a route file as
 * "untested" -- read it as "not covered BY THE UNIT SUITE".
 *
 * The thresholds are a RATCHET, not a target. They sit at or just below
 * measured values so a regression fails the build. Raising them is good;
 * lowering one to make a build pass is the failure mode this exists to prevent.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'coverage');
const LCOV = path.join(COVERAGE_DIR, 'lcov.info');

// Global floors. Measured 2026-08-08 at lines 58.28 / branches 70.09 /
// functions 42.72 over server/**.
const GLOBAL = { lines: 55, branches: 65, functions: 40 };

// Per-file line minimums for modules where a regression is expensive: the
// things that decide who may see what, and whether it was recorded. Each sits
// a few points below its measured value.
const PER_FILE = {
  'server/security/log-safe.js': 95,
  'server/security/endpoint-throttle.js': 85,
  'server/fhir/smart/scope-check.js': 85,
  'server/security/phi-encryption.js': 85,
  'server/audit-logger.js': 80,
  'server/security/rbac.js': 80,
  'server/database.js': 75,
};

function run() {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });

  const testFiles = fs.readdirSync(path.join(ROOT, 'test', 'unit'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join('test', 'unit', f));

  const args = [
    '--test',
    '--experimental-test-coverage',
    '--test-concurrency=1',
    '--test-reporter=lcov',
    `--test-reporter-destination=${LCOV}`,
    '--test-coverage-exclude=test/**',
    '--test-coverage-exclude=src/**',
    '--test-coverage-exclude=scripts/**',
    ...testFiles,
  ];

  execFileSync(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET || 'ci-test-secret-not-for-production',
      PHI_ENCRYPTION_KEY: process.env.PHI_ENCRYPTION_KEY
        || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  });
}

/** Minimal LCOV parser: enough for LF/LH, BRF/BRH, FNF/FNH per SF record. */
function parseLcov(text) {
  const files = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const p = line.slice(3).replace(/\\/g, '/');
      const rel = p.includes('/Clinical/EHR/') ? p.split('/Clinical/EHR/')[1] : p;
      cur = files[rel] = files[rel] || { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };
    } else if (cur) {
      const [key, val] = line.split(':');
      const n = Number(val);
      if (key === 'LF') cur.lf += n;
      else if (key === 'LH') cur.lh += n;
      else if (key === 'BRF') cur.brf += n;
      else if (key === 'BRH') cur.brh += n;
      else if (key === 'FNF') cur.fnf += n;
      else if (key === 'FNH') cur.fnh += n;
      else if (key === 'end_of_record') cur = null;
    }
  }
  return files;
}

const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);
const fmt = (n) => `${n.toFixed(2)}%`;

function main() {
  const reportOnly = process.argv.includes('--report');

  run();

  if (!fs.existsSync(LCOV)) {
    console.error('[coverage] no lcov.info was produced');
    process.exit(1);
  }

  const files = parseLcov(fs.readFileSync(LCOV, 'utf8'));
  const serverFiles = Object.entries(files).filter(([f]) => f.startsWith('server/'));

  if (!serverFiles.length) {
    console.error('[coverage] lcov contained no server/ files — the include/exclude filters are wrong');
    process.exit(1);
  }

  const totals = serverFiles.reduce((acc, [, m]) => ({
    lf: acc.lf + m.lf, lh: acc.lh + m.lh,
    brf: acc.brf + m.brf, brh: acc.brh + m.brh,
    fnf: acc.fnf + m.fnf, fnh: acc.fnh + m.fnh,
  }), { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 });

  const global = {
    lines: pct(totals.lh, totals.lf),
    branches: pct(totals.brh, totals.brf),
    functions: pct(totals.fnh, totals.fnf),
  };

  console.log('\nCoverage — node --test unit suite over server/**');
  console.log(`  files measured : ${serverFiles.length}`);
  console.log(`  lines          : ${fmt(global.lines)}  (floor ${GLOBAL.lines}%)`);
  console.log(`  branches       : ${fmt(global.branches)}  (floor ${GLOBAL.branches}%)`);
  console.log(`  functions      : ${fmt(global.functions)}  (floor ${GLOBAL.functions}%)`);

  const failures = [];
  for (const [metric, floor] of Object.entries(GLOBAL)) {
    if (global[metric] < floor) {
      failures.push(`global ${metric} ${fmt(global[metric])} is below the ${floor}% floor`);
    }
  }

  console.log('\nPer-file minimums (line coverage):');
  for (const [rel, floor] of Object.entries(PER_FILE)) {
    const m = files[rel];
    if (!m) {
      failures.push(`${rel} is in the per-file list but absent from coverage — was it moved or renamed?`);
      console.log(`  MISSING  ${rel}`);
      continue;
    }
    const actual = pct(m.lh, m.lf);
    const ok = actual >= floor;
    if (!ok) failures.push(`${rel} line coverage ${fmt(actual)} is below its ${floor}% minimum`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}     ${rel.padEnd(42)} ${fmt(actual).padStart(7)}  (min ${floor}%)`);
  }

  console.log(`\nLCOV: ${path.relative(ROOT, LCOV)}`);

  if (reportOnly) return;

  if (failures.length) {
    console.error('\nCoverage gate FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nRaise coverage. Do not lower a threshold to make this pass —');
    console.error('that is the failure mode this gate exists to prevent.');
    process.exit(1);
  }
  console.log('\nCoverage gate passed.');
}

main();
