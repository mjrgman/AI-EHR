/**
 * Login lockout must not be a denial-of-service tool.
 *
 * The lockout was keyed on username alone. Anyone who knew a clinician's
 * username could lock that clinician out with five wrong passwords, from
 * anywhere, and repeat it indefinitely. In a clinic that is locking a
 * physician out of charts mid-shift — the control meant to stop an attacker
 * hands them a better weapon.
 *
 * CodeQL surfaced the guard as js/user-controlled-bypass. The brief for this
 * work named the same thing: abuse controls must key across account AND
 * network signals "without enabling trivial account-lockout denial of
 * service".
 *
 * Lockout is now keyed on (username, client IP).
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-production';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../../server/security/auth');

const ATTACKER = '198.51.100.7';
const VICTIM = '203.0.113.42';
const MAX = 5;

function fail(username, ip, times = 1) {
  let last = { locked: false };
  for (let i = 0; i < times; i++) last = auth.recordFailedLogin(username, ip);
  return last;
}

beforeEach(() => {
  if (typeof auth._resetLoginAttempts === 'function') auth._resetLoginAttempts();
});

describe('lockout is keyed on account AND origin', () => {
  test('an attacker exhausting attempts locks only their own origin', () => {
    const user = `victim-${Math.random().toString(36).slice(2)}`;

    const attackerResult = fail(user, ATTACKER, MAX);
    assert.equal(attackerResult.locked, true, 'the attacking origin must be locked');

    // The legitimate user, on a different connection, must be unaffected.
    const victimResult = fail(user, VICTIM, 1);
    assert.equal(victimResult.locked, false,
      'the real user must not be locked out by someone else failing their password');
  });

  test('two users from the same origin do not share a counter', () => {
    const a = `a-${Math.random().toString(36).slice(2)}`;
    const b = `b-${Math.random().toString(36).slice(2)}`;

    assert.equal(fail(a, ATTACKER, MAX).locked, true);
    assert.equal(fail(b, ATTACKER, 1).locked, false,
      'failing one account must not immediately lock another from the same origin');
  });

  test('the same pair still locks after the threshold', () => {
    const user = `u-${Math.random().toString(36).slice(2)}`;
    for (let i = 1; i < MAX; i++) {
      assert.equal(fail(user, ATTACKER).locked, false, `attempt ${i} should not lock yet`);
    }
    assert.equal(fail(user, ATTACKER).locked, true, `attempt ${MAX} must lock the pair`);
  });

  test('a success from one origin does not clear another origin\'s lock', () => {
    const user = `u-${Math.random().toString(36).slice(2)}`;
    fail(user, ATTACKER, MAX);
    auth.clearFailedLogins(user, VICTIM); // legitimate user signs in elsewhere

    // The attacker's origin must still be locked.
    const still = auth.recordFailedLogin(user, ATTACKER);
    assert.equal(still.locked, true, 'clearing one origin must not unlock another');
  });

  test('clearing an origin releases that origin', () => {
    const user = `u-${Math.random().toString(36).slice(2)}`;
    fail(user, VICTIM, MAX - 1);
    auth.clearFailedLogins(user, VICTIM);
    assert.equal(fail(user, VICTIM, 1).locked, false, 'the counter must restart after a success');
  });
});

describe('distributed attempts are detected, not converted into an outage', () => {
  test('failures from many origins do not lock the account globally', () => {
    const user = `spread-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 6; i++) fail(user, `192.0.2.${i}`, 1);

    // Each origin is well under the threshold, so nothing is locked...
    const fresh = auth.recordFailedLogin(user, '192.0.2.200');
    assert.equal(fresh.locked, false,
      'a distributed attempt must not let an attacker lock the account by spraying');

    // ...but the spread is observable.
    if (typeof auth._distinctIpsFor === 'function') {
      assert.ok(auth._distinctIpsFor(user) >= 6, 'the spread must be countable for detection');
    }
  });
});

describe('key construction', () => {
  test('a username cannot straddle the separator to impersonate another pair', () => {
    // If the separator could appear in a username, "alice\n1.2.3.4" as a
    // username would collide with alice from 1.2.3.4.
    const a = `zz-${Math.random().toString(36).slice(2)}`;
    fail(a, '10.0.0.1', MAX);
    assert.equal(auth.recordFailedLogin(`${a}\n10.0.0.1`, 'other').locked, false,
      'a crafted username must not inherit another pair\'s lock state');
  });
});
