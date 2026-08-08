'use strict';

// ============================================================================
// SMART-on-FHIR HARDENING TESTS
// ============================================================================
//
// Asserts the SECURE target behavior for two confirmed findings from
// ULTRAREVIEW_2026-05-28.md:
//
//   sec-smart-register-public-04 (P2) — POST /smart/register was public and
//       defaulted to ALL_SCOPES. SECURE: unauthenticated (or non-admin)
//       registration is DENIED (403); a registration that omits `scopes` gets
//       an EMPTY scope set (no all-scopes default).
//
//   sec-smart-authorize-auto-approve-11 (P2) — GET /smart/authorize auto-
//       approved (no consent), accepted no PKCE despite advertising S256, and
//       wrote an unvalidated launch patient. SECURE: authorize WITHOUT a PKCE
//       code_challenge is DENIED (400); WITHOUT consent it returns a consent-
//       required response (no code); WITH PKCE+consent it issues a code, and the
//       token exchange requires a matching code_verifier (PKCE bound end-to-end).
//
// Harness mirrors authz-boundary.test.js: the shared database singleton is
// stubbed via require.cache so token.js resolves against deterministic
// SYNTHETIC data (no PHI). We mint REAL JWTs via auth.signToken. The
// /smart/authorize route is mounted behind a tiny middleware that sets req.user
// from the bearer token — mirroring the real upstream auth that must run before
// authorize in production.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'smart-hardening-test-secret-key';
delete process.env.ENABLE_DEV_AUTH_BYPASS;

// ----------------------------------------------------------------------------
// SYNTHETIC fixtures — one registered SMART client, one real patient (id 1),
// one admin + one non-admin user. No real PHI.
// ----------------------------------------------------------------------------
const REGISTERED_CLIENT = {
  client_id: 'test-client-0001',
  client_secret_hash: 'unused-in-authorize-flow',
  client_name: 'Test SMART App',
  redirect_uris: JSON.stringify(['https://app.example.com/callback']),
  grant_types: JSON.stringify(['authorization_code']),
  scopes: JSON.stringify(['patient/Patient.read']),
  is_active: 1,
};
const REDIRECT_URI = 'https://app.example.com/callback';
const USERS = {
  10: { id: 10, username: 'admin-user', role: 'admin', full_name: 'Admin', is_active: 1 },
  20: { id: 20, username: 'doc-user', role: 'physician', full_name: 'Doc', is_active: 1 },
};
const REAL_PATIENT_IDS = new Set([1]);

// Capture rows written to smart_auth_codes + smart_clients so we can inspect them.
let authCodesByCode = {};
let registeredClients = [];

const dbStub = {
  async dbAll() { return []; },
  async dbGet(sql, params) {
    if (/FROM smart_clients/i.test(sql)) {
      const cid = params && params[0];
      return cid === REGISTERED_CLIENT.client_id ? { ...REGISTERED_CLIENT } : null;
    }
    if (/FROM users/i.test(sql)) {
      const uid = params && params[0];
      return USERS[uid] || null;
    }
    if (/FROM patients/i.test(sql)) {
      const pid = params && params[0];
      return REAL_PATIENT_IDS.has(pid) ? { id: pid } : null;
    }
    if (/FROM smart_auth_codes/i.test(sql)) {
      const code = params && params[0];
      return authCodesByCode[code] || null;
    }
    if (/FROM smart_refresh_tokens/i.test(sql)) return null;
    return null;
  },
  async dbRun(sql, params) {
    if (/INSERT INTO smart_auth_codes/i.test(sql)) {
      // VALUES bind order: code, client_id, user_id, scopes, redirect_uri,
      // launch_context, expires_at, code_challenge, code_challenge_method
      // (`used` is the literal 0 in the SQL, NOT a bound param).
      const [code, client_id, user_id, scopes, redirect_uri, launch_context,
        expires_at, code_challenge, code_challenge_method] = params;
      authCodesByCode[code] = {
        code, client_id, user_id, scopes, redirect_uri, launch_context,
        expires_at, used: 0, code_challenge, code_challenge_method,
      };
    }
    if (/INSERT INTO smart_clients/i.test(sql)) {
      registeredClients.push(params);
    }
    if (/UPDATE smart_auth_codes SET used/i.test(sql)) {
      const code = params && params[0];
      if (authCodesByCode[code]) authCodesByCode[code].used = 1;
    }
    return { lastID: 9999, changes: 1 };
  },
};

const dbModulePath = path.resolve(__dirname, '../../server/database.js');
const originalDbModule = require.cache[dbModulePath];
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true, exports: dbStub,
};

const auth = require('../../server/security/auth');
const tokenModule = require('../../server/fhir/smart/token');

function tokenFor(role, sub, username) {
  // signToken with an explicit `sub` payload (mirrors SMART/login tokens).
  return auth.signToken({ sub, username: username || `${role}-user`, role, fullName: `${role} user` });
}

function request(port, method, urlPath, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, body: json, raw: text, location: res.headers.location });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// PKCE helpers (client side).
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makePkce() {
  const verifier = base64url(crypto.randomBytes(48)); // ≥43 chars, unreserved set
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Build an app that sets req.user from the bearer token (mirrors upstream auth),
// then exposes the SMART register + authorize + token handlers.
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Upstream auth: populate req.user from a valid bearer token (if present).
  app.use((req, res, next) => {
    const h = req.headers['authorization'];
    if (h && h.startsWith('Bearer ')) {
      const decoded = auth.verifyToken(h.slice(7));
      if (decoded) req.user = decoded;
    }
    next();
  });
  app.post('/smart/register', tokenModule.registerClientHandler);
  app.get('/smart/authorize', tokenModule.authorizeHandler);
  app.post('/smart/token', tokenModule.tokenHandler);
  return app;
}

// ============================================================================
// SUITE 1 — sec-smart-register-public-04
// ============================================================================
describe('smart-hardening: /smart/register admin-only + no all-scopes default', () => {
  let server, port;
  before(async () => {
    const app = buildApp();
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    port = server.address().port;
  });
  after(() => server && server.close());

  test('unauthenticated register is denied (403)', async () => {
    const r = await request(port, 'POST', '/smart/register', {
      body: { client_name: 'Rogue App', redirect_uris: ['https://rogue.example.com/cb'] },
    });
    assert.equal(r.status, 403, `unauthenticated registration must be denied; got ${r.status}`);
  });

  test('non-admin (physician) register is denied (403)', async () => {
    const r = await request(port, 'POST', '/smart/register', {
      token: tokenFor('physician', 20),
      body: { client_name: 'Doc App', redirect_uris: ['https://doc.example.com/cb'] },
    });
    assert.equal(r.status, 403, `non-admin registration must be denied; got ${r.status}`);
  });

  test('admin register with no scopes yields an EMPTY scope set (no all-scopes default)', async () => {
    const r = await request(port, 'POST', '/smart/register', {
      token: tokenFor('admin', 10),
      body: { client_name: 'Legit App', redirect_uris: ['https://legit.example.com/cb'] },
    });
    assert.equal(r.status, 201, `admin registration must succeed; got ${r.status}`);
    assert.deepEqual(r.body.scopes, [], 'omitted scopes must fail closed to [] (not ALL_SCOPES)');
  });

  test('admin register filters to allow-listed scopes only', async () => {
    const r = await request(port, 'POST', '/smart/register', {
      token: tokenFor('admin', 10),
      body: {
        client_name: 'Scoped App',
        redirect_uris: ['https://scoped.example.com/cb'],
        scopes: ['patient/Patient.read', 'patient/EVERYTHING.write', 'not-a-scope'],
      },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.scopes, ['patient/Patient.read'],
      'only allow-listed scopes survive; invalid ones are dropped');
  });
});

// ============================================================================
// SUITE 2 — sec-smart-authorize-auto-approve-11
// ============================================================================
describe('smart-hardening: /smart/authorize PKCE + consent + launch validation', () => {
  let server, port;
  before(async () => {
    authCodesByCode = {};
    const app = buildApp();
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    port = server.address().port;
  });
  after(() => server && server.close());

  function authorizeUrl(params) {
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: REGISTERED_CLIENT.client_id,
      redirect_uri: REDIRECT_URI,
      scope: 'patient/Patient.read',
      state: 'xyz',
      ...params,
    }).toString();
    return `/smart/authorize?${qs}`;
  }

  test('authorize WITHOUT PKCE code_challenge is denied (400, no code)', async () => {
    const r = await request(port, 'GET', authorizeUrl({ consent: 'true' }), {
      token: tokenFor('physician', 20),
    });
    assert.equal(r.status, 400, `missing PKCE must be rejected; got ${r.status}`);
    assert.equal(Object.keys(authCodesByCode).length, 0, 'no auth code may be minted without PKCE');
  });

  test('authorize with non-S256 method is denied (400)', async () => {
    const { challenge } = makePkce();
    const r = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, code_challenge_method: 'plain', consent: 'true' }),
      { token: tokenFor('physician', 20) });
    assert.equal(r.status, 400, `non-S256 PKCE must be rejected; got ${r.status}`);
  });

  test('authorize with PKCE but WITHOUT consent returns consent-required (no code)', async () => {
    const { challenge } = makePkce();
    const before = Object.keys(authCodesByCode).length;
    const r = await request(port, 'GET', authorizeUrl({ code_challenge: challenge }), {
      token: tokenFor('physician', 20),
    });
    assert.equal(r.status, 200, `consent-required path returns 200 JSON; got ${r.status}`);
    assert.equal(r.body && r.body.consent_required, true, 'must signal consent_required');
    assert.equal(Object.keys(authCodesByCode).length, before, 'no auth code may be minted without consent');
  });

  test('authorize with an unresolvable launch patient is denied (403)', async () => {
    const { challenge } = makePkce();
    const r = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, consent: 'true', patient: '999999' }),
      { token: tokenFor('physician', 20) });
    assert.equal(r.status, 403, `bad launch patient must be denied; got ${r.status}`);
  });

  test('authorize with PKCE + consent + valid patient issues a code (302 redirect)', async () => {
    const { challenge } = makePkce();
    const r = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, consent: 'true', patient: '1' }),
      { token: tokenFor('physician', 20) });
    assert.equal(r.status, 302, `approved authorize must redirect with a code; got ${r.status}`);
    assert.ok(r.location && r.location.includes('code='), 'redirect must carry an authorization code');
    const url = new URL(r.location);
    const code = url.searchParams.get('code');
    assert.ok(authCodesByCode[code], 'a code row must be persisted');
    assert.equal(authCodesByCode[code].code_challenge, challenge, 'code is bound to the PKCE challenge');
  });

  // --- PKCE bound end-to-end at the token endpoint ---
  test('token exchange WITHOUT a code_verifier is denied (PKCE fail closed)', async () => {
    const { challenge } = makePkce();
    const ra = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, consent: 'true', patient: '1' }),
      { token: tokenFor('physician', 20) });
    const code = new URL(ra.location).searchParams.get('code');

    const rt = await request(port, 'POST', '/smart/token', {
      body: {
        grant_type: 'authorization_code',
        code, redirect_uri: REDIRECT_URI, client_id: REGISTERED_CLIENT.client_id,
        // no code_verifier
      },
    });
    assert.equal(rt.status, 400, `token exchange without code_verifier must fail; got ${rt.status}`);
    assert.ok(rt.body && /pkce/i.test(rt.body.error_description || ''), 'error names PKCE');
  });

  test('token exchange with a WRONG code_verifier is denied', async () => {
    const { challenge } = makePkce();
    const ra = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, consent: 'true', patient: '1' }),
      { token: tokenFor('physician', 20) });
    const code = new URL(ra.location).searchParams.get('code');

    const wrong = makePkce().verifier; // a verifier that does NOT match `challenge`
    const rt = await request(port, 'POST', '/smart/token', {
      body: {
        grant_type: 'authorization_code',
        code, redirect_uri: REDIRECT_URI, client_id: REGISTERED_CLIENT.client_id,
        code_verifier: wrong,
      },
    });
    assert.equal(rt.status, 400, `mismatched code_verifier must fail; got ${rt.status}`);
  });

  test('authorization-code token binds patient scopes to the launch patient claim', async () => {
    const { verifier, challenge } = makePkce();
    const ra = await request(port, 'GET',
      authorizeUrl({ code_challenge: challenge, consent: 'true', patient: '1' }),
      { token: tokenFor('physician', 20) });
    const code = new URL(ra.location).searchParams.get('code');
    const rt = await request(port, 'POST', '/smart/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: REGISTERED_CLIENT.client_id,
        code_verifier: verifier,
      },
    });
    assert.equal(rt.status, 200);
    assert.equal(rt.body.patient, 1);
    assert.equal(auth.verifyToken(rt.body.access_token).patient, 1);
  });
});

// ----------------------------------------------------------------------------
// Restore the real database module on teardown.
// ----------------------------------------------------------------------------
after(() => {
  if (originalDbModule) require.cache[dbModulePath] = originalDbModule;
  else delete require.cache[dbModulePath];
});
