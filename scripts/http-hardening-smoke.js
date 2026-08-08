#!/usr/bin/env node

const BASE_URL = (process.env.EHR_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function header(response, name) {
  return response.headers.get(name) || '';
}

async function run() {
  console.log(`[http-hardening] Target: ${BASE_URL}`);

  await check('root serves the EHR shell', async () => {
    const { response, text } = await request('/');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(header(response, 'content-type').includes('text/html'), 'root should be HTML');
    assert(text.includes('<!DOCTYPE html>'), 'root should be an HTML document');
    assert(text.includes('/assets/'), 'root should reference built assets');
  });

  await check('helmet security headers are present', async () => {
    const { response } = await request('/');
    const csp = header(response, 'content-security-policy');
    assert(csp.includes("default-src 'self'"), 'missing default-src self CSP');
    assert(csp.includes("object-src 'none'"), 'missing object-src none CSP');
    assert(csp.includes("frame-ancestors 'none'"), 'missing frame-ancestors none CSP');
    assert(header(response, 'x-content-type-options').toLowerCase() === 'nosniff', 'missing nosniff');
    assert(!response.headers.has('x-powered-by'), 'x-powered-by should not be exposed');
  });

  await check('health endpoint is public and connected', async () => {
    const { response, json, text } = await request('/api/health');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(json?.status === 'ok', `health status should be ok: ${text}`);
    assert(json?.database === 'connected', 'database should be connected');
    assert(!/secret|token|password|api[_-]?key/i.test(text), 'health response leaked sensitive wording');
  });

  await check('SMART discovery remains public', async () => {
    const { response, json } = await request('/.well-known/smart-configuration');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(json?.token_endpoint?.includes('/smart/token'), 'missing token endpoint');
    assert(Array.isArray(json?.capabilities), 'capabilities should be an array');
  });

  await check('JWKS endpoint does not publish symmetric keys', async () => {
    const { response, json } = await request('/.well-known/jwks.json');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(Array.isArray(json?.keys), 'keys should be an array');
    assert(json.keys.length === 0, 'HS256 symmetric keys should not be published');
  });

  await check('FHIR metadata is protected without auth', async () => {
    const { response, json } = await request('/fhir/R4/metadata');
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error, '401 should return an error body');
  });

  await check('clinician API rejects unauthenticated access', async () => {
    const { response, json } = await request('/api/patients');
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error === 'Authentication required', 'expected auth-required body');
  });

  await check('care management routes reject unauthenticated access', async () => {
    const { response, json } = await request('/api/care-management/codes');
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error === 'Authentication required', 'expected auth-required body');
  });

  await check('HEDIS routes reject unauthenticated access', async () => {
    const { response, json } = await request('/api/quality/hedis/measures');
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error === 'Authentication required', 'expected auth-required body');
  });

  await check('CDS hooks are protected without auth', async () => {
    const { response } = await request('/cds-services');
    assert(response.status === 401, `expected 401, got ${response.status}`);
  });

  await check('development header bypass is disabled by default', async () => {
    const { response } = await request('/api/patients', {
      headers: {
        'x-user-id': 'hardening-user',
        'x-user-role': 'physician',
      },
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
  });

  await check('invalid bearer token is rejected', async () => {
    const { response, json } = await request('/api/patients', {
      headers: { authorization: 'Bearer definitely.invalid.token' },
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error === 'Invalid or expired token', 'expected invalid-token body');
  });

  await check('login rejects missing credentials cleanly', async () => {
    const { response, json, text } = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody' }),
    });
    assert(response.status === 400, `expected 400, got ${response.status}`);
    assert(json?.error === 'Username and password are required', `unexpected body: ${text}`);
  });

  await check('login rejects invalid credentials without enumeration', async () => {
    const username = `hardening-${Date.now()}-invalid`;
    const { response, json } = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'WrongPassword!12345' }),
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    assert(json?.error === 'Invalid credentials', 'expected generic invalid credentials');
  });

  await check('login lockout triggers after repeated failures', async () => {
    const username = `hardening-${Date.now()}-lockout`;
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'WrongPassword!12345' }),
      });
    }
    assert(last.response.status === 429, `expected 429, got ${last.response.status}`);
    assert(Number.isFinite(last.json?.retryAfter), 'lockout should include retryAfter');
  });

  await check('malformed JSON returns controlled client error', async () => {
    const { response, text } = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":',
    });
    assert(response.status >= 400 && response.status < 500, `expected 4xx, got ${response.status}`);
    assert(!/stack|SyntaxError|at\s+/.test(text), 'malformed JSON response should not expose stack details');
  });

  await check('CORS preflight succeeds in dev mode', async () => {
    const { response } = await request('/api/patients', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5174',
        'access-control-request-method': 'GET',
      },
    });
    assert([200, 204].includes(response.status), `expected 200/204, got ${response.status}`);
    assert(header(response, 'access-control-allow-origin') === 'http://127.0.0.1:5174', 'origin should be echoed in dev mode');
  });

  await check('SMART introspection returns inactive for invalid token', async () => {
    const { response, json } = await request('/smart/introspect?token=bad-token');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(json?.active === false, 'invalid token should be inactive');
  });

  await check('SMART token rejects unsupported grant type', async () => {
    const { response, text } = await request('/smart/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'unsupported_grant' }),
    });
    assert(response.status >= 400 && response.status < 500, `expected 4xx, got ${response.status}`);
    assert(!/stack|at\s+/.test(text), 'token error should not expose stack details');
  });

  await check('static traversal does not expose server source', async () => {
    const { response, text } = await request('/%2e%2e/server/server.js');
    assert(response.status !== 500, `expected non-500, got ${response.status}`);
    assert(!text.includes("const express = require('express')"), 'server source should not be exposed');
    assert(!text.includes('JWT_SECRET'), 'secret-related source should not be exposed');
  });

  await check('unknown frontend path falls back to the app shell', async () => {
    const { response, text } = await request('/hardening/unknown-client-route');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(text.includes('<!DOCTYPE html>'), 'unknown client route should serve app shell');
  });

  const failed = results.filter(result => !result.ok);
  console.log(`[http-hardening] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(`[http-hardening] Fatal: ${error.message}`);
  process.exit(1);
});
