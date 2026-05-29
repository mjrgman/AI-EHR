'use strict';

// Unit tests for gaps-03 in src/api/medivault.js.
//
// The MediVault export route is RBAC-gated server-side
// (rbac.requireRole('physician','nurse_practitioner','system') in
// server/routes/medivault-routes.js). The browser export wrapper uses raw
// fetch() instead of the shared client.js request() helper, so it must attach
// the Bearer token itself — otherwise the request arrives unauthenticated and
// the server resolves the caller as 'guest' (403 in production).
//
// medivault.js is an ESM browser module (uses `export`) and cannot be
// require()'d in this CommonJS node:test runner without a transform. Following
// the established pattern (ui-quick-wins.test.js, dashboard-queue-config.test.js)
// these are source-level assertions: they parse the relevant region out of the
// source text and fail loudly if the fix regresses. The companion runtime check
// is exercised via the app + server integration path.
//
// Test data is synthetic — no real tokens or PHI appear in fixtures.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const medivaultPath = path.resolve(__dirname, '../../src/api/medivault.js');
const clientPath = path.resolve(__dirname, '../../src/api/client.js');

const src = fs.readFileSync(medivaultPath, 'utf8');

describe('medivault export: attaches Bearer token (gaps-03)', () => {
  test('source reads the canonical auth session storage key', () => {
    assert.ok(
      src.includes("'ehr_auth_session_v1'"),
      'medivault.js must reference the same AUTH_STORAGE_KEY client.js uses'
    );
  });

  test('storage key matches client.js exactly (single source of truth)', () => {
    const clientSrc = fs.readFileSync(clientPath, 'utf8');
    const m = clientSrc.match(/AUTH_STORAGE_KEY\s*=\s*'([^']+)'/);
    assert.ok(m, 'could not locate AUTH_STORAGE_KEY in client.js');
    const clientKey = m[1];
    assert.ok(
      src.includes(`'${clientKey}'`),
      `medivault.js must use the same storage key as client.js ('${clientKey}')`
    );
  });

  test('source sets an Authorization: Bearer header from the token', () => {
    // Authorization header is assigned from a bearer token value.
    assert.match(
      src,
      /headers\.Authorization\s*=\s*`Bearer \$\{token\}`/,
      'export must set headers.Authorization = `Bearer ${token}`'
    );
  });

  test('token attachment is conditional (no header when token is absent — fail closed server-side)', () => {
    assert.match(
      src,
      /if\s*\(\s*token\s*\)\s*headers\.Authorization/,
      'Authorization header must only be set when a token is present'
    );
  });

  test('getAuthToken reads token field and tolerates malformed JSON', () => {
    // The helper must JSON.parse the session and return session.token, with a
    // try/catch so a corrupt storage value does not throw.
    assert.match(src, /function getAuthToken\s*\(/, 'getAuthToken helper must exist');
    assert.ok(src.includes('JSON.parse'), 'getAuthToken must parse the stored session JSON');
    assert.ok(
      /session\.token/.test(src),
      'getAuthToken must read the .token field from the session object'
    );
    assert.ok(
      /catch\s*\{/.test(src) || /catch\s*\(/.test(src),
      'getAuthToken must guard JSON.parse with a catch (malformed storage tolerated)'
    );
  });
});
