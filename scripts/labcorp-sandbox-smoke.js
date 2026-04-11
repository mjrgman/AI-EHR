#!/usr/bin/env node
'use strict';

/**
 * LabCorp Sandbox Smoke Test — Phase 2c
 *
 * Manual smoke script. Intentionally NOT wired into `npm test` or CI.
 *
 * Purpose:
 *   Prove that LabCorp sandbox connectivity works end-to-end from this host,
 *   before you flip `LABCORP_MODE=api` in a real deployment. Exercises DNS,
 *   TLS, HTTP, and OAuth2 error semantics without needing a live OAuth2 grant.
 *
 * What it does (in order):
 *
 *   1. Validates env vars. Refuses to run without LABCORP_SANDBOX_URL + creds.
 *   2. Hard production guard — aborts if any configured URL looks like prod.
 *   3. Stage A: HTTPS reachability check to the sandbox base URL.
 *   4. Stage B: HTTPS reachability check to the token endpoint.
 *   5. Stage C: OAuth2 token endpoint semantics check — POST with a deliberately
 *      invalid code. A compliant server returns 400 with an `error` field
 *      (typically `invalid_grant`). Anything else is suspicious.
 *
 * What it does NOT do:
 *
 *   - No full authorization-code grant — that requires a browser redirect.
 *   - No result fetching — requires valid tokens stored via /oauth/callback.
 *   - No DB writes. No production calls. No PHI touched.
 *
 * Usage:
 *
 *   # 1. Fill .env with sandbox credentials (or export vars inline)
 *   node scripts/labcorp-sandbox-smoke.js
 *
 *   # Short flags
 *   node scripts/labcorp-sandbox-smoke.js --help
 *   node scripts/labcorp-sandbox-smoke.js --verbose
 *
 * Exit codes:
 *   0   — all stages passed
 *   1   — config error (missing env vars, prod guard, etc.)
 *   2   — connectivity failure (DNS, TCP, TLS, HTTP transport)
 *   3   — OAuth2 semantics check failed (endpoint reachable but wrong shape)
 *
 * Safety rails:
 *   - Hard-aborts if a URL contains "prod" or "production".
 *   - Loads .env via dotenv if present; never logs secret values.
 *   - Uses a 10s per-stage timeout so a hung endpoint doesn't block forever.
 */

const https = require('https');
const { URL } = require('url');
const path = require('path');

// Load .env if present — best-effort, never hard-fails.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_err) {
  // dotenv is optional — env may be set in the shell already.
}

const STAGE_TIMEOUT_MS = 10000;
const RESULTS = []; // { stage, ok, detail }

// --------------------------------------------
// CLI
// --------------------------------------------
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    '\nLabCorp Sandbox Smoke Test\n\n' +
    '  Usage:\n' +
    '    node scripts/labcorp-sandbox-smoke.js [--verbose]\n\n' +
    '  Required env vars:\n' +
    '    LABCORP_SANDBOX_URL   — https URL of the sandbox base\n' +
    '    LABCORP_TOKEN_URL     — https URL of the OAuth2 token endpoint\n' +
    '    LABCORP_CLIENT_ID     — developer portal client id\n' +
    '    LABCORP_CLIENT_SECRET — developer portal client secret\n\n' +
    '  Exit codes: 0=ok, 1=config, 2=connectivity, 3=oauth semantics\n\n'
  );
  process.exit(0);
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function log(line) {
  process.stdout.write(`${line}\n`);
}

function banner(text) {
  const bar = '='.repeat(62);
  log(`\n${bar}\n  ${text}\n${bar}`);
}

function record(stage, ok, detail) {
  RESULTS.push({ stage, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  log(`  [${tag}] ${stage}${detail ? ' — ' + detail : ''}`);
}

// Redact anything that could be a secret before logging.
function redact(str) {
  if (!str) return str;
  return String(str)
    .replace(/(client_secret=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/(authorization:\s*basic\s*)\S+/gi, '$1<redacted>')
    .replace(/(bearer\s+)\S+/gi, '$1<redacted>');
}

/**
 * HTTPS request with a hard timeout. Resolves with a normalized response
 * object. Rejects only on transport-layer failure (DNS, TCP, TLS).
 *
 * Note: we intentionally DON'T follow redirects — a 3xx is a successful
 * connectivity check for our purposes.
 */
function httpsRequest({ method, urlStr, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(new Error(`invalid URL: ${urlStr} (${err.message})`));
    }

    if (parsed.protocol !== 'https:') {
      return reject(new Error(`refusing non-HTTPS URL: ${urlStr}`));
    }

    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: Object.assign({}, headers),
      timeout: STAGE_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`stage timeout after ${STAGE_TIMEOUT_MS}ms`));
    });
    req.on('error', (err) => reject(err));

    if (body) req.write(body);
    req.end();
  });
}

// --------------------------------------------
// Stage 0: env + production guard
// --------------------------------------------
function validateConfig() {
  banner('Stage 0 — configuration + production guard');

  const required = [
    'LABCORP_SANDBOX_URL',
    'LABCORP_TOKEN_URL',
    'LABCORP_CLIENT_ID',
    'LABCORP_CLIENT_SECRET',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    record('config.required_env', false, `missing: ${missing.join(', ')}`);
    return false;
  }
  record('config.required_env', true, 'all required vars present');

  // Production guard — refuse if any URL smells like prod.
  // LABCORP_PROD_URL is commented out in .env.example so this mostly catches
  // operator mistakes (copy/paste a prod URL into SANDBOX_URL).
  const urlsToCheck = {
    LABCORP_SANDBOX_URL: process.env.LABCORP_SANDBOX_URL,
    LABCORP_TOKEN_URL: process.env.LABCORP_TOKEN_URL,
    LABCORP_AUTH_URL: process.env.LABCORP_AUTH_URL,
    LABCORP_REDIRECT_URI: process.env.LABCORP_REDIRECT_URI,
  };
  const prodHits = [];
  for (const [name, val] of Object.entries(urlsToCheck)) {
    if (val && /\bprod(uction)?\b/i.test(val)) {
      prodHits.push(`${name}=${val}`);
    }
  }
  if (prodHits.length > 0) {
    record('config.prod_guard', false, `aborting — URLs look like production:\n     ${prodHits.join('\n     ')}`);
    return false;
  }
  record('config.prod_guard', true, 'no production URLs detected');
  return true;
}

// --------------------------------------------
// Stage A: sandbox base URL reachability
// --------------------------------------------
async function stageA() {
  banner('Stage A — sandbox base URL reachability');
  const url = process.env.LABCORP_SANDBOX_URL;
  try {
    const res = await httpsRequest({ method: 'GET', urlStr: url });
    // Any HTTP response proves DNS + TCP + TLS + HTTP work.
    // 2xx/3xx/4xx all count; only a transport error is a failure here.
    record('sandbox.reachable', true, `HTTP ${res.statusCode}`);
    if (VERBOSE) {
      log(`    headers: ${redact(JSON.stringify(res.headers))}`);
    }
    return true;
  } catch (err) {
    record('sandbox.reachable', false, err.message);
    return false;
  }
}

// --------------------------------------------
// Stage B: token URL reachability
// --------------------------------------------
async function stageB() {
  banner('Stage B — token endpoint reachability');
  const url = process.env.LABCORP_TOKEN_URL;
  try {
    // A GET against a token endpoint typically returns 405 Method Not Allowed,
    // which is a perfectly valid connectivity signal for our purposes.
    const res = await httpsRequest({ method: 'GET', urlStr: url });
    record('token.reachable', true, `HTTP ${res.statusCode}`);
    return true;
  } catch (err) {
    record('token.reachable', false, err.message);
    return false;
  }
}

// --------------------------------------------
// Stage C: OAuth2 semantics (invalid_grant expected)
// --------------------------------------------
async function stageC() {
  banner('Stage C — OAuth2 token endpoint semantics');

  const tokenUrl = process.env.LABCORP_TOKEN_URL;
  const clientId = process.env.LABCORP_CLIENT_ID;
  const clientSecret = process.env.LABCORP_CLIENT_SECRET;
  const redirectUri = process.env.LABCORP_REDIRECT_URI
    || 'http://localhost:3000/api/integrations/labcorp/oauth/callback';

  // Build a form-urlencoded body with a deliberately invalid code. An RFC 6749
  // compliant server MUST return 400 with { error: "invalid_grant" } (or
  // "invalid_request" if the code is malformed). Anything else is a red flag.
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', 'smoke-test-invalid-code-do-not-accept');
  form.set('redirect_uri', redirectUri);
  const body = form.toString();

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await httpsRequest({
      method: 'POST',
      urlStr: tokenUrl,
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Basic ${basic}`,
        'Accept': 'application/json',
      },
    });

    if (VERBOSE) {
      log(`    status: ${res.statusCode}`);
      log(`    body:   ${redact(res.body.slice(0, 300))}`);
    }

    // Parse the response. OAuth2 error responses are JSON.
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch (_e) { /* not JSON */ }

    // Expected: 400 with error: 'invalid_grant' | 'invalid_request' | 'unauthorized_client'
    if (res.statusCode === 400 && parsed && parsed.error) {
      record('token.oauth2_semantics', true, `got RFC-compliant error: ${parsed.error}`);
      return true;
    }

    // 401 with www-authenticate is also acceptable — some servers reject
    // unauthenticated client-credential combos before parsing the grant.
    if (res.statusCode === 401) {
      record('token.oauth2_semantics', true, '401 — client credentials rejected (expected for unpaired test creds)');
      return true;
    }

    // 200 would be catastrophic — means the server accepted our garbage code.
    if (res.statusCode === 200) {
      record('token.oauth2_semantics', false,
        'ALARM: 200 OK returned for a garbage authorization code. Do NOT run against this endpoint until you understand why.');
      return false;
    }

    record('token.oauth2_semantics', false,
      `unexpected HTTP ${res.statusCode} — body excerpt: ${redact(res.body.slice(0, 200))}`);
    return false;
  } catch (err) {
    record('token.oauth2_semantics', false, `transport error: ${err.message}`);
    return false;
  }
}

// --------------------------------------------
// Main
// --------------------------------------------
(async () => {
  banner('LabCorp Sandbox Smoke Test');
  log('  This script makes real HTTPS calls. It does not touch the database.');
  log('  Refuses to run if any configured URL looks like production.');

  if (!validateConfig()) {
    banner('RESULT: config failure');
    process.exit(1);
  }

  const a = await stageA();
  const b = await stageB();
  const c = await stageC();

  banner('RESULT');
  for (const r of RESULTS) {
    log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.stage}`);
  }

  const allOk = a && b && c;
  if (allOk) {
    log('\n  All stages passed. Sandbox is reachable and OAuth2-compliant.\n');
    process.exit(0);
  }
  // Distinguish connectivity failures (stage A/B) from semantics failures (stage C)
  if (!a || !b) {
    log('\n  Connectivity failure — check DNS, firewall, and that the sandbox URLs are correct.\n');
    process.exit(2);
  }
  log('\n  OAuth2 semantics check failed — review the stage C output and confirm the token endpoint is the one from the developer portal.\n');
  process.exit(3);
})().catch((err) => {
  process.stderr.write(`\nsmoke test crashed: ${err.message}\n`);
  process.exit(2);
});
