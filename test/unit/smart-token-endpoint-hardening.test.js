/**
 * SMART token-endpoint hardening.
 *
 * Three prototype-grade behaviors are removed here, each asserted below:
 *
 *   1. The resource-owner password grant. It requires the client to handle the
 *      user's password directly and OAuth 2.1 drops it. It was present "for
 *      integration testing", which is not a property of the deployed endpoint.
 *   2. Unauthenticated introspection. Anyone holding a captured token could
 *      learn its subject, role, scopes and launch patient.
 *   3. Introspection over GET. A token in a query string lands in server
 *      logs, proxy logs and browser history.
 *
 * Revocation additionally required client auth and is now scoped to the
 * calling client, so one client cannot revoke another's tokens.
 *
 * SMART remains disabled in this build regardless -- see
 * docs/SYNTHETIC_ONLY_BASELINE.md. These tests assert the endpoint contract,
 * not that the feature is on.
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-production';
process.env.PHI_ENCRYPTION_KEY = process.env.PHI_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const tokenModule = require('../../server/fhir/smart/token');
const smartConfig = require('../../server/fhir/smart/smart-config');

let server;
let port;

before(async () => {
  const app = express();
  app.use(express.json());
  app.post('/smart/token', tokenModule.tokenHandler);
  app.get('/smart/introspect', tokenModule.introspectHandler);
  app.post('/smart/introspect', tokenModule.introspectHandler);
  app.post('/smart/revoke', tokenModule.revokeHandler);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('password grant is removed', () => {
  test('grant_type=password is rejected with a specific explanation', async () => {
    const r = await request('POST', '/smart/token', {
      body: { grant_type: 'password', username: 'anyone', password: 'anything' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'unsupported_grant_type');
    assert.match(r.body.error_description, /password grant was removed/i,
      'the error must say what happened, not just "unsupported"');
  });

  test('grant_type=implicit is rejected', async () => {
    const r = await request('POST', '/smart/token', { body: { grant_type: 'implicit' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'unsupported_grant_type');
  });

  test('a valid username and password cannot obtain a token by any grant', async () => {
    // Even with correct credentials there must be no password-for-token path.
    const r = await request('POST', '/smart/token', {
      body: { grant_type: 'password', username: 'dr.renner', password: 'whatever' },
    });
    assert.equal(r.status, 400);
    assert.ok(!r.body.access_token, 'no token may be issued for a password grant');
  });

  test('discovery does not advertise the password grant', () => {
    const cfg = smartConfig.buildSmartConfiguration
      ? smartConfig.buildSmartConfiguration('http://localhost:3000')
      : null;
    if (cfg && cfg.grant_types_supported) {
      assert.ok(!cfg.grant_types_supported.includes('password'));
    }
  });
});

describe('introspection requires client authentication', () => {
  test('POST without credentials is 401 and challenges', async () => {
    const r = await request('POST', '/smart/introspect', { body: { token: 'anything' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'invalid_client');
    assert.match(String(r.headers['www-authenticate'] || ''), /Basic/);
  });

  test('POST with bad credentials is 401 and leaks nothing about the token', async () => {
    const r = await request('POST', '/smart/introspect', {
      body: { token: 'anything', client_id: 'no-such-client', client_secret: 'wrong' },
    });
    assert.equal(r.status, 401);
    assert.equal(r.body.active, undefined, 'must not disclose token state to an unauthenticated caller');
    assert.equal(r.body.sub, undefined);
    assert.equal(r.body.patient, undefined);
  });

  test('GET is refused outright', async () => {
    const r = await request('GET', '/smart/introspect?token=leaked-in-the-query-string');
    assert.equal(r.status, 405);
    assert.match(String(r.headers.allow || ''), /POST/);
    assert.equal(r.body.active, undefined, 'a GET must never return token metadata');
  });

  test('GET is refused even with valid-looking client credentials in the query', async () => {
    const r = await request('GET', '/smart/introspect?token=x&client_id=y&client_secret=z');
    assert.equal(r.status, 405);
  });
});

describe('revocation requires client authentication', () => {
  test('POST without credentials is 401', async () => {
    const r = await request('POST', '/smart/revoke', { body: { token: 'some-refresh-token' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'invalid_client');
    assert.notEqual(r.body.revoked, true, 'an unauthenticated caller must not revoke anything');
  });

  test('POST with bad credentials is 401', async () => {
    const r = await request('POST', '/smart/revoke', {
      body: { token: 'some-refresh-token', client_id: 'no-such-client', client_secret: 'wrong' },
    });
    assert.equal(r.status, 401);
    assert.notEqual(r.body.revoked, true);
  });
});

describe('supported grant list', () => {
  test('an unknown grant type still gets the generic error', async () => {
    const r = await request('POST', '/smart/token', { body: { grant_type: 'device_code' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'unsupported_grant_type');
    assert.ok(!/removed/i.test(r.body.error_description),
      'a never-supported grant should not claim it was removed');
  });
});
