'use strict';

// Unit tests for sec-dev-bypass-header-12 in server/security/auth.js.
//
// The x-user-id / x-user-role header-trust bypass must be:
//   1. INERT in production at runtime (requireAuth rejects with 401 even if
//      the bypass headers are present), AND
//   2. FAIL-CLOSED at boot — a production process started with
//      ENABLE_DEV_AUTH_BYPASS=true must refuse to start, so the single
//      misconfig that would reinstate impersonation can never reach runtime.
//
// Test data is synthetic — no real credentials or PHI appear in fixtures.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const authPath = path.resolve(__dirname, '../../server/security/auth.js');
const TEST_SECRET = 'dev-bypass-test-secret-not-for-production';

let originalSecret;
let originalNodeEnv;
let originalBypass;

before(() => {
  originalSecret = process.env.JWT_SECRET;
  originalNodeEnv = process.env.NODE_ENV;
  originalBypass = process.env.ENABLE_DEV_AUTH_BYPASS;
  process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_SECRET;
});

after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalBypass === undefined) delete process.env.ENABLE_DEV_AUTH_BYPASS;
  else process.env.ENABLE_DEV_AUTH_BYPASS = originalBypass;
});

describe('dev-bypass: fail-to-boot in production with bypass flag set (sec-dev-bypass-header-12)', () => {
  test('module load throws when NODE_ENV=production and ENABLE_DEV_AUTH_BYPASS=true', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      ENABLE_DEV_AUTH_BYPASS: 'true',
    };
    assert.throws(() => {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
        env,
        stdio: 'pipe',
      });
    }, /ENABLE_DEV_AUTH_BYPASS must NOT be set in production/);
  });

  test('module load succeeds in production WHEN bypass flag is absent', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    };
    delete env.ENABLE_DEV_AUTH_BYPASS;
    // Should not throw.
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
      env,
      stdio: 'pipe',
    });
  });

  test('module load succeeds in production when bypass flag is explicitly false', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      ENABLE_DEV_AUTH_BYPASS: 'false',
    };
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
      env,
      stdio: 'pipe',
    });
  });

  test('module load succeeds in development with the bypass flag set (dev convenience preserved)', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      ENABLE_DEV_AUTH_BYPASS: 'true',
    };
    delete env.JWT_SECRET; // dev tolerates ephemeral key
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
      env,
      stdio: 'pipe',
    });
  });
});

describe('dev-bypass: requireAuth is inert outside development (sec-dev-bypass-header-12)', () => {
  // These run in-process. auth.js was already loaded by the suite with a test
  // secret; NODE_ENV here is the test runner's env (not 'development'), so the
  // bypass branch must NOT fire — header-only requests must be rejected 401.
  const auth = require('../../server/security/auth');

  function mockReqRes(headers) {
    const req = { path: '/api/patients/1', headers };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    return { req, res, next, get statusCode() { return statusCode; }, get jsonBody() { return jsonBody; }, get nextCalled() { return nextCalled; } };
  }

  test('header-only request is rejected 401 when NODE_ENV is not development', () => {
    // Ensure the bypass env is not active in this process.
    const savedEnv = process.env.NODE_ENV;
    const savedFlag = process.env.ENABLE_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_DEV_AUTH_BYPASS;
    try {
      const ctx = mockReqRes({ 'x-user-id': 'attacker', 'x-user-role': 'physician' });
      auth.requireAuth(ctx.req, ctx.res, ctx.next);
      assert.equal(ctx.nextCalled, false, 'bypass must not authenticate the request');
      assert.equal(ctx.statusCode, 401, 'header-only request must be rejected with 401');
    } finally {
      if (savedEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnv;
      if (savedFlag === undefined) delete process.env.ENABLE_DEV_AUTH_BYPASS; else process.env.ENABLE_DEV_AUTH_BYPASS = savedFlag;
    }
  });
});
