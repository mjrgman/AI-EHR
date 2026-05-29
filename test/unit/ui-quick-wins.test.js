'use strict';

// Unit tests for the UI QUICK-WINS group (findings ui-badge-danger-01,
// ui-icon-entity-01, ui-schedule-sort-mutate-01, ui-audit-noshape-01 /
// ULTRAPLAN Wave 4d).
//
// All four targets are JSX/ESM (React) source files that cannot be require()'d
// in a node:test CommonJS runner (no JSX transform). Following the established
// pattern in dashboard-queue-config.test.js, these are deliberate source-level
// assertions: they parse the relevant region out of the source text and fail
// loudly if the fix regresses. Browser/Playwright render verification is the
// companion check for the two visible items (icon + badge color).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const badgePath = path.resolve(__dirname, '../../src/components/common/Badge.jsx');
const touchButtonPath = path.resolve(__dirname, '../../src/components/common/TouchButton.jsx');
const maPath = path.resolve(__dirname, '../../src/pages/MAPage.jsx');
const schedulePath = path.resolve(__dirname, '../../src/pages/SchedulePage.jsx');
const auditPath = path.resolve(__dirname, '../../src/pages/AuditPage.jsx');

// Extract a `const NAME = { ... };` object literal's key -> value (string) map.
function extractVariantMap(source, constName) {
  const start = source.indexOf(`const ${constName}`);
  assert.ok(start !== -1, `expected const ${constName}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  assert.ok(open !== -1 && close !== -1, `${constName} object literal not found`);
  const body = source.slice(open + 1, close);
  const map = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

describe('ui-badge-danger-01: Badge has a danger variant aligned with the palette', () => {
  const badgeSrc = fs.readFileSync(badgePath, 'utf8');
  const touchSrc = fs.readFileSync(touchButtonPath, 'utf8');
  const badgeVariants = extractVariantMap(badgeSrc, 'VARIANTS');
  const touchVariants = extractVariantMap(touchSrc, 'VARIANTS');

  test('Badge.VARIANTS defines a danger variant', () => {
    assert.ok('danger' in badgeVariants, 'Badge must define a "danger" variant');
  });

  test('danger variant is red (No-Show state renders red, not uncolored)', () => {
    assert.match(badgeVariants.danger, /bg-red-/, 'danger must use a red background');
    assert.match(badgeVariants.danger, /text-red-/, 'danger must use red text');
  });

  test('TouchButton also defines danger as red (shared palette intent)', () => {
    assert.ok('danger' in touchVariants);
    assert.match(touchVariants.danger, /red/);
  });

  test('SchedulePage no-show status maps to the danger variant', () => {
    const schedSrc = fs.readFileSync(schedulePath, 'utf8');
    // STATUS_LABELS line for 'no-show'
    assert.match(
      schedSrc,
      /'no-show':\s*\{\s*label:\s*'No-Show',\s*variant:\s*'danger'\s*\}/,
      'no-show must use variant: danger, which must now resolve to a styled pill'
    );
  });
});

describe('ui-icon-entity-01: MAPage uses literal Unicode glyphs, not entity strings', () => {
  const maSrc = fs.readFileSync(maPath, 'utf8');

  test('no raw HTML-entity string literal remains for the mic/stop icon', () => {
    assert.ok(!maSrc.includes('&#x1F3A4;'), 'raw mic entity string must be gone');
    assert.ok(!maSrc.includes('&#x23F9;'), 'raw stop entity string must be gone');
  });

  test('literal mic + stop glyphs are present', () => {
    assert.ok(maSrc.includes('🎤'), 'literal microphone glyph expected');
    assert.ok(maSrc.includes('⏹'), 'literal stop glyph expected');
  });
});

describe('ui-schedule-sort-mutate-01: SchedulePage copies before sort', () => {
  const schedSrc = fs.readFileSync(schedulePath, 'utf8');

  test('appointments are spread-copied before .sort() in render', () => {
    assert.match(
      schedSrc,
      /\[\.\.\.appointments\]\s*\.sort\(/,
      'must use [...appointments].sort() to avoid mutating state in render'
    );
  });

  test('the mutating appointments.sort() pattern is gone', () => {
    assert.ok(
      !/\bappointments\s*\n?\s*\.sort\(/.test(schedSrc),
      'direct appointments.sort() (state mutation) must not remain'
    );
  });
});

describe('ui-audit-noshape-01: AuditPage tolerates a malformed/empty response', () => {
  const auditSrc = fs.readFileSync(auditPath, 'utf8');

  test('logs setter guards against a non-array shape', () => {
    assert.match(
      auditSrc,
      /setLogs\(Array\.isArray\(logsResult\?\.logs\)\s*\?\s*logsResult\.logs\s*:\s*\[\]\)/,
      'setLogs must default to [] when logs is missing/not an array'
    );
  });

  test('totalPages / total fall back to safe numbers', () => {
    assert.match(auditSrc, /setTotalPages\(Number\(logsResult\?\.totalPages\)\s*\|\|\s*1\)/);
    assert.match(auditSrc, /setTotal\(Number\(logsResult\?\.total\)\s*\|\|\s*0\)/);
  });

  test('header total.toLocaleString() is guarded against non-numbers', () => {
    assert.match(
      auditSrc,
      /\(Number\(total\)\s*\|\|\s*0\)\.toLocaleString\(\)/,
      'header must coerce total to a number before .toLocaleString()'
    );
  });

  test('unguarded total.toLocaleString() in the header is gone', () => {
    assert.ok(
      !auditSrc.includes('{total.toLocaleString()} entries'),
      'the raw total.toLocaleString() header must be replaced with a guarded form'
    );
  });
});
