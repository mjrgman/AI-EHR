'use strict';

// Unit tests for server/security/phi-encryption.js.
// Covers AES-256-GCM round-trip, key rotation via reencryptWithNewKey,
// missing/short key validation, hashPHI determinism, and per-record IV.
//
// Test data is synthetic — no real PHI ever appears in fixtures.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

// PHI_ENCRYPTION_KEY must be set BEFORE the module is required, since the
// module's first call to deriveKey() reads it. The integration runner sets a
// suite-wide test key; if running this file standalone, set our own.
const TEST_KEY_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEY_B = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888';

let originalKey;
let originalPepper;

before(() => {
  originalKey = process.env.PHI_ENCRYPTION_KEY;
  originalPepper = process.env.PHI_PEPPER;
  process.env.PHI_ENCRYPTION_KEY = TEST_KEY_A;
});

after(() => {
  if (originalKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
  else process.env.PHI_ENCRYPTION_KEY = originalKey;
  if (originalPepper === undefined) delete process.env.PHI_PEPPER;
  else process.env.PHI_PEPPER = originalPepper;
});

describe('phi-encryption: round-trip', () => {
  test('encrypts and decrypts a simple string back to the original', () => {
    const phi = require('../../server/security/phi-encryption');
    const plaintext = 'Test Patient One';
    const ciphertext = phi.encrypt(plaintext);
    assert.notEqual(ciphertext, plaintext, 'ciphertext must differ from plaintext');
    assert.equal(phi.decrypt(ciphertext), plaintext);
  });

  test('encrypts unicode and special characters losslessly', () => {
    const phi = require('../../server/security/phi-encryption');
    const plaintext = 'José M. O\'Brien — DOB 1990-01-01 — “quoted” \u2603';
    assert.equal(phi.decrypt(phi.encrypt(plaintext)), plaintext);
  });

  test('returns null for null/undefined input', () => {
    const phi = require('../../server/security/phi-encryption');
    assert.equal(phi.encrypt(null), null);
    assert.equal(phi.encrypt(undefined), null);
    assert.equal(phi.decrypt(null), null);
  });

  test('encrypts empty string deterministically (returns valid ciphertext)', () => {
    const phi = require('../../server/security/phi-encryption');
    const ct = phi.encrypt('');
    assert.notEqual(ct, null, 'empty string should still encrypt');
    assert.equal(phi.decrypt(ct), '');
  });
});

describe('phi-encryption: per-record IV', () => {
  test('encrypting the same plaintext twice yields different ciphertexts (random IV + salt)', () => {
    const phi = require('../../server/security/phi-encryption');
    const plaintext = 'TEST-MRN-1';
    const a = phi.encrypt(plaintext);
    const b = phi.encrypt(plaintext);
    assert.notEqual(a, b, 'two encryptions of the same value must differ — random IV + salt is the safety property');
    // But both must decrypt back to the same plaintext.
    assert.equal(phi.decrypt(a), plaintext);
    assert.equal(phi.decrypt(b), plaintext);
  });
});

describe('phi-encryption: tamper detection', () => {
  test('throws when the ciphertext authTag has been altered', () => {
    const phi = require('../../server/security/phi-encryption');
    const ciphertext = phi.encrypt('Test Patient One');
    const obj = JSON.parse(ciphertext);
    // Flip a hex digit in the auth tag — GCM must reject.
    obj.authTag = obj.authTag.slice(0, -1) + (obj.authTag.endsWith('0') ? '1' : '0');
    const tampered = JSON.stringify(obj);
    assert.throws(() => phi.decrypt(tampered), /PHI decryption failed/);
  });

  test('throws when ciphertext JSON is malformed', () => {
    const phi = require('../../server/security/phi-encryption');
    assert.throws(() => phi.decrypt('not-json-at-all'), /PHI decryption failed/);
  });
});

describe('phi-encryption: key rotation', () => {
  test('reencryptWithNewKey decrypts under the old key and re-encrypts under the new one', () => {
    const phi = require('../../server/security/phi-encryption');
    const plaintext = 'Test Patient One';

    // Encrypt with key A (current).
    const oldCiphertext = phi.encrypt(plaintext);
    assert.equal(phi.decrypt(oldCiphertext), plaintext);

    // Rotate: switch process.env to key B, then call reencrypt with key A as the OLD key.
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY_B;
    const newCiphertext = phi.reencryptWithNewKey(oldCiphertext, TEST_KEY_A);

    // The new ciphertext must decrypt under the new key (current env).
    assert.equal(phi.decrypt(newCiphertext), plaintext);

    // Restore key A for subsequent tests in this file.
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY_A;
  });

  test('reencryptWithNewKey throws on bad old-key material', () => {
    const phi = require('../../server/security/phi-encryption');
    const ciphertext = phi.encrypt('Test Patient One');
    const wrongKey = 'wrong0000wrong0000wrong0000wrong0000wrong0000wrong0000wrong0000';
    assert.throws(() => phi.reencryptWithNewKey(ciphertext, wrongKey), /Key rotation failed/);
  });
});

describe('phi-encryption: key validation', () => {
  test('encrypt throws when PHI_ENCRYPTION_KEY is missing', () => {
    const phi = require('../../server/security/phi-encryption');
    delete process.env.PHI_ENCRYPTION_KEY;
    try {
      assert.throws(() => phi.encrypt('Test Patient One'), /PHI_ENCRYPTION_KEY/);
    } finally {
      process.env.PHI_ENCRYPTION_KEY = TEST_KEY_A;
    }
  });

  test('encrypt throws when key material is too short', () => {
    const phi = require('../../server/security/phi-encryption');
    const previous = process.env.PHI_ENCRYPTION_KEY;
    process.env.PHI_ENCRYPTION_KEY = 'short';
    try {
      assert.throws(() => phi.encrypt('Test Patient One'), /at least 32 characters/);
    } finally {
      process.env.PHI_ENCRYPTION_KEY = previous;
    }
  });
});

describe('phi-encryption: hashPHI', () => {
  test('hashPHI is deterministic for the same plaintext + same pepper', () => {
    const phi = require('../../server/security/phi-encryption');
    const a = phi.hashPHI('TEST-MRN-1');
    const b = phi.hashPHI('TEST-MRN-1');
    assert.equal(a, b, 'same plaintext must produce the same hash for indexed lookups');
  });

  test('hashPHI produces different hashes for different inputs', () => {
    const phi = require('../../server/security/phi-encryption');
    assert.notEqual(phi.hashPHI('TEST-MRN-1'), phi.hashPHI('TEST-MRN-2'));
  });

  test('hashPHI returns null on null input', () => {
    const phi = require('../../server/security/phi-encryption');
    assert.equal(phi.hashPHI(null), null);
    assert.equal(phi.hashPHI(undefined), null);
  });
});

describe('phi-encryption: field-level helpers', () => {
  test('encryptFields then decryptFields round-trips a patient record (synthetic)', () => {
    const phi = require('../../server/security/phi-encryption');
    const patient = {
      id: 999999,
      mrn: 'TEST-MRN-1',
      first_name: 'Test',
      last_name: 'Patient',
      dob: '1990-01-01',
      phone: '555-0100',
      email: 'test.patient@example.invalid',
      // Non-PHI field stays untouched.
      sex: 'F',
    };

    const encrypted = phi.encryptFields(patient);
    assert.notEqual(encrypted.first_name, patient.first_name, 'first_name must be encrypted');
    assert.equal(encrypted.sex, patient.sex, 'non-PHI field must pass through');

    const decrypted = phi.decryptFields(encrypted);
    assert.equal(decrypted.first_name, patient.first_name);
    assert.equal(decrypted.email, patient.email);
    assert.equal(decrypted.dob, patient.dob);
  });
});
