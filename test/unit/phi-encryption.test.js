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
  test('production configuration fails closed without key or independent pepper', () => {
    const phi = require('../../server/security/phi-encryption');
    assert.throws(
      () => phi.assertProductionEncryptionConfig({ NODE_ENV: 'production' }),
      /PHI_ENCRYPTION_KEY/
    );
    assert.throws(
      () => phi.assertProductionEncryptionConfig({ NODE_ENV: 'production', PHI_ENCRYPTION_KEY: TEST_KEY_A }),
      /PHI_PEPPER/
    );
    assert.throws(
      () => phi.assertProductionEncryptionConfig({
        NODE_ENV: 'production', PHI_ENCRYPTION_KEY: TEST_KEY_A, PHI_PEPPER: TEST_KEY_A,
      }),
      /independent/
    );
  });

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

describe('phi-encryption: GCM IV length (sec-gcm-iv-length-09)', () => {
  test('new ciphertext uses a 12-byte IV', () => {
    const phi = require('../../server/security/phi-encryption');
    const obj = JSON.parse(phi.encrypt('Test Patient One'));
    // IV is hex-encoded: 12 bytes => 24 hex chars.
    assert.equal(obj.iv.length, 24, 'IV must be 12 bytes (24 hex chars) per NIST SP 800-38D');
    assert.equal(Buffer.from(obj.iv, 'hex').length, 12);
  });

  test('BACKWARD-COMPAT: legacy 16-byte-IV records still decrypt', () => {
    const phi = require('../../server/security/phi-encryption');
    const crypto = require('crypto');
    // Reconstruct a legacy-format record exactly as the old encrypt() produced:
    // random 16-byte salt, random 16-byte IV, aes-256-gcm. deriveKey is exported
    // so we derive the same key the legacy path would have.
    const plaintext = 'Legacy Patient — DOB 1980-02-29';
    const salt = crypto.randomBytes(16);
    const key = phi.deriveKey(null, salt);
    const iv = crypto.randomBytes(16); // legacy 128-bit IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ct = cipher.update(plaintext, 'utf8', 'hex');
    ct += cipher.final('hex');
    const legacyRecord = JSON.stringify({
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext: ct,
      authTag: cipher.getAuthTag().toString('hex'),
      algorithm: 'aes-256-gcm',
    });
    // The current decrypt() must read the 16-byte IV from the record and succeed.
    assert.equal(phi.decrypt(legacyRecord), plaintext);
  });

  test('BACKWARD-COMPAT: legacy deterministic-salt (no salt field) records still decrypt', () => {
    const phi = require('../../server/security/phi-encryption');
    const crypto = require('crypto');
    // Oldest format: no salt field => deterministic-salt derivation, 16-byte IV.
    const plaintext = 'Oldest Format Patient';
    const key = phi.deriveKey(); // deterministic-salt key path
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ct = cipher.update(plaintext, 'utf8', 'hex');
    ct += cipher.final('hex');
    const oldestRecord = JSON.stringify({
      iv: iv.toString('hex'),
      ciphertext: ct,
      authTag: cipher.getAuthTag().toString('hex'),
      algorithm: 'aes-256-gcm',
    });
    assert.equal(phi.decrypt(oldestRecord), plaintext);
  });
});

describe('phi-encryption: independent pepper (sec-gcm-iv-length-09)', () => {
  test('uses PHI_PEPPER when set, independent of the encryption key', () => {
    const phi = require('../../server/security/phi-encryption');
    const prevPepper = process.env.PHI_PEPPER;
    try {
      process.env.PHI_PEPPER = 'independent-test-pepper-not-derived-from-key';
      const withPepper = phi.hashPHI('TEST-MRN-1');
      delete process.env.PHI_PEPPER;
      const withFallback = phi.hashPHI('TEST-MRN-1');
      assert.notEqual(withPepper, withFallback,
        'an explicit independent pepper must change the hash vs the key-derived fallback');
    } finally {
      if (prevPepper === undefined) delete process.env.PHI_PEPPER;
      else process.env.PHI_PEPPER = prevPepper;
    }
  });

  test('BACKWARD-COMPAT: non-production fallback pepper derivation is unchanged', () => {
    const phi = require('../../server/security/phi-encryption');
    const crypto = require('crypto');
    const prevPepper = process.env.PHI_PEPPER;
    try {
      delete process.env.PHI_PEPPER; // force fallback (NODE_ENV is not production in tests)
      const expectedPepper = crypto.createHash('sha256')
        .update(process.env.PHI_ENCRYPTION_KEY + 'pepper')
        .digest();
      const expected = crypto.createHmac('sha256', expectedPepper).update('TEST-MRN-1').digest('hex');
      assert.equal(phi.hashPHI('TEST-MRN-1'), expected,
        'fallback hash must match the original derivation so existing hash_* lookups keep working');
    } finally {
      if (prevPepper === undefined) delete process.env.PHI_PEPPER;
      else process.env.PHI_PEPPER = prevPepper;
    }
  });

  test('getPepper fails closed in production when PHI_PEPPER is unset', () => {
    const phi = require('../../server/security/phi-encryption');
    const prevPepper = process.env.PHI_PEPPER;
    const prevEnv = process.env.NODE_ENV;
    try {
      delete process.env.PHI_PEPPER;
      process.env.NODE_ENV = 'production';
      assert.throws(() => phi.hashPHI('TEST-MRN-1'), /PHI_PEPPER environment variable is required in production/);
    } finally {
      if (prevPepper === undefined) delete process.env.PHI_PEPPER;
      else process.env.PHI_PEPPER = prevPepper;
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
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
