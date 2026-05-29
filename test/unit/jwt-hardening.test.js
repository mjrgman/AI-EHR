'use strict';

// Unit tests for sec-jwt-no-alg-pin-06 in server/security/auth.js.
// Covers: algorithm allow-list pinning (HS256 only), issuer/audience
// validation, sign/verify round-trip with the hardened claims, and the
// fail-to-boot-in-production-without-JWT_SECRET guard.
//
// Test data is synthetic — no real credentials or PHI appear in fixtures.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'jwt-hardening-test-secret-not-for-production';
let originalSecret;

before(() => {
  originalSecret = process.env.JWT_SECRET;
  // auth.js reads JWT_SECRET at module load — set it before requiring.
  process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_SECRET;
});

after(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('jwt hardening: sign/verify round-trip (sec-jwt-no-alg-pin-06)', () => {
  test('signToken then verifyToken round-trips a user payload', () => {
    const auth = require('../../server/security/auth');
    const token = auth.signToken({ id: 7, username: 'dr.test', role: 'physician', full_name: 'Dr Test' });
    const decoded = auth.verifyToken(token);
    assert.ok(decoded, 'token should verify');
    assert.equal(decoded.sub, 7);
    assert.equal(decoded.role, 'physician');
    assert.equal(decoded.iss, 'agentic-ehr', 'issuer claim must be stamped at sign time');
    assert.equal(decoded.aud, 'agentic-ehr-api', 'audience claim must be stamped at sign time');
  });

  test('signed token uses HS256', () => {
    const auth = require('../../server/security/auth');
    const token = auth.signToken({ id: 1, username: 'a', role: 'physician', full_name: 'A' });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(header.alg, 'HS256');
  });
});

describe('jwt hardening: algorithm allow-list pinning', () => {
  test('rejects an alg=none token (alg-confusion defense)', () => {
    const auth = require('../../server/security/auth');
    // Forge an unsigned "none" token with otherwise-valid claims.
    const noneToken = jwt.sign(
      { sub: 1, role: 'admin', iss: 'agentic-ehr', aud: 'agentic-ehr-api' },
      null,
      { algorithm: 'none' }
    );
    assert.equal(auth.verifyToken(noneToken), null, 'alg=none must be rejected');
  });

  test('rejects a token signed with a different algorithm family (HS512)', () => {
    const auth = require('../../server/security/auth');
    const hs512 = jwt.sign(
      { sub: 1, role: 'admin' },
      process.env.JWT_SECRET,
      { algorithm: 'HS512', issuer: 'agentic-ehr', audience: 'agentic-ehr-api' }
    );
    assert.equal(auth.verifyToken(hs512), null, 'only HS256 is in the allow-list');
  });
});

describe('jwt hardening: issuer / audience validation', () => {
  test('rejects a token with the wrong issuer', () => {
    const auth = require('../../server/security/auth');
    const wrongIss = jwt.sign(
      { sub: 1, role: 'physician' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'evil-issuer', audience: 'agentic-ehr-api' }
    );
    assert.equal(auth.verifyToken(wrongIss), null);
  });

  test('rejects a token with the wrong audience', () => {
    const auth = require('../../server/security/auth');
    const wrongAud = jwt.sign(
      { sub: 1, role: 'physician' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'agentic-ehr', audience: 'some-other-api' }
    );
    assert.equal(auth.verifyToken(wrongAud), null);
  });

  test('rejects a token missing iss/aud entirely', () => {
    const auth = require('../../server/security/auth');
    const bare = jwt.sign({ sub: 1, role: 'physician' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    assert.equal(auth.verifyToken(bare), null, 'iss/aud are required by verify');
  });
});

describe('jwt hardening: fail-to-boot in production without JWT_SECRET', () => {
  test('module load throws when NODE_ENV=production and JWT_SECRET unset', () => {
    const authPath = path.resolve(__dirname, '../../server/security/auth.js');
    // Run in a child process so the module-load guard is exercised cleanly.
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.JWT_SECRET;
    assert.throws(() => {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
        env,
        stdio: 'pipe',
      });
    }, /JWT_SECRET must be set in production/);
  });

  test('module load succeeds in production WHEN JWT_SECRET is set', () => {
    const authPath = path.resolve(__dirname, '../../server/security/auth.js');
    const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(32).toString('hex') };
    // Should not throw.
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
      env,
      stdio: 'pipe',
    });
  });

  test('module load succeeds in development without JWT_SECRET (ephemeral key)', () => {
    const authPath = path.resolve(__dirname, '../../server/security/auth.js');
    const env = { ...process.env, NODE_ENV: 'development' };
    delete env.JWT_SECRET;
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
      env,
      stdio: 'pipe',
    });
  });
});
