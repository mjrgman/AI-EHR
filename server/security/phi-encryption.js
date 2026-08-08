/**
 * PHI Encryption Module for Agentic EHR
 *
 * Handles encryption/decryption of Protected Health Information (PHI) at rest.
 * Uses AES-256-GCM with PBKDF2 key derivation and per-record 12-byte IVs.
 * No external dependencies - uses Node.js built-in crypto module only.
 *
 * Reference: HIPAA Security Rule 45 CFR §164.312(a)(2)(ii)
 */

const crypto = require('crypto');

// ==========================================
// CONFIGURATION & VALIDATION
// ==========================================

// sec-gcm-iv-length-09: NIST SP 800-38D recommends a 12-byte (96-bit) IV for
// AES-GCM — it is the value GCM's internal counter is optimized for and avoids
// the GHASH-based re-derivation that other lengths trigger. New records are
// written with a 12-byte random IV. The DECRYPT path reads the IV length from
// the stored record, so legacy 16-byte-IV records in data/mjr-ehr.db continue
// to decrypt unchanged (no migration required for reads).
const GCM_IV_BYTES = 12;

// L2: Module-scoped key cache — avoids running PBKDF2 (100k iterations) on every call.
// Invalidated on key rotation or when key material changes.
let cachedKey = null;
let cachedKeyMaterial = null;

/** Refuse to start a production process without both independent secrets. */
function assertProductionEncryptionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  if (!env.PHI_ENCRYPTION_KEY || env.PHI_ENCRYPTION_KEY.length < 32) {
    throw new Error('[PHI] FATAL: production requires PHI_ENCRYPTION_KEY with at least 32 characters.');
  }
  if (!env.PHI_PEPPER || env.PHI_PEPPER.length < 32) {
    throw new Error('[PHI] FATAL: production requires an independent PHI_PEPPER with at least 32 characters.');
  }
  if (env.PHI_PEPPER === env.PHI_ENCRYPTION_KEY) {
    throw new Error('[PHI] FATAL: PHI_PEPPER must be independent of PHI_ENCRYPTION_KEY.');
  }
  return true;
}

assertProductionEncryptionConfig();

/**
 * Derive encryption key from key material using PBKDF2.
 * S-H3: Accepts optional keyMaterial parameter instead of always reading from env.
 * L2: Caches the derived key for the current key material.
 *
 * @param {string} [keyMaterial] - Key material to derive from (defaults to process.env.PHI_ENCRYPTION_KEY)
 * @param {Buffer} [salt] - Optional salt (used for new-format decryption); if omitted, uses deterministic salt for backward compat
 * @returns {Buffer} 256-bit derived key
 */
function deriveKey(keyMaterial = null, salt = null) {
  const material = keyMaterial || process.env.PHI_ENCRYPTION_KEY;

  if (!material) {
    throw new Error(
      'PHI_ENCRYPTION_KEY environment variable is required for encryption. ' +
      'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (material.length < 32) {
    throw new Error('PHI_ENCRYPTION_KEY must be at least 32 characters (16 bytes hex)');
  }

  // If a custom salt is provided (new format), always derive fresh — no caching
  if (salt) {
    return crypto.pbkdf2Sync(material, salt, 100000, 32, 'sha256');
  }

  // L2: Return cached key if material hasn't changed (deterministic-salt path)
  if (cachedKey && cachedKeyMaterial === material) {
    return cachedKey;
  }

  // PBKDF2: 100k iterations, SHA-256
  // Deterministic salt for backward compatibility with old-format data
  const deterministicSalt = crypto.createHash('sha256').update(material + ':agentic-ehr-phi-salt').digest();

  cachedKey = crypto.pbkdf2Sync(material, deterministicSalt, 100000, 32, 'sha256');
  cachedKeyMaterial = material;

  return cachedKey;
}

// Pepper for hashPHI function.
// sec-gcm-iv-length-09: the pepper MUST be independent of the encryption key —
// deriving it from PHI_ENCRYPTION_KEY means a single compromised value defeats
// both confidentiality (decrypt) and the searchable-hash unlinkability at once.
// In production we therefore REQUIRE an independent PHI_PEPPER and fail closed
// if it is missing. Dev/test keep a derived fallback so existing fixtures and
// the dev-server (which only sets PHI_ENCRYPTION_KEY) keep working, but the
// fallback is domain-separated from the encryption-key derivation path.
function getPepper() {
  if (process.env.PHI_PEPPER) {
    return process.env.PHI_PEPPER;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PHI_PEPPER environment variable is required in production and must be ' +
      'independent of PHI_ENCRYPTION_KEY. Generate with: ' +
      'node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (!process.env.PHI_ENCRYPTION_KEY) {
    throw new Error('PHI_ENCRYPTION_KEY is required to derive a fallback pepper outside production.');
  }
  // Non-production fallback: BACKWARD-COMPAT — this derivation string is
  // unchanged from the original implementation so that existing searchable
  // hash_* values in data/mjr-ehr.db still match on lookup. NOT used in
  // production (the guard above fails closed there). Do not alter the suffix
  // without a hash-rebuild migration.
  return crypto.createHash('sha256')
    .update(process.env.PHI_ENCRYPTION_KEY + 'pepper')
    .digest();
}

// ==========================================
// ENCRYPTION FUNCTIONS
// ==========================================

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns JSON object with: { iv, ciphertext, authTag, algorithm }
 *
 * @param {string} plaintext - Data to encrypt
 * @returns {string} JSON stringified encrypted object
 */
function encrypt(plaintext) {
  if (!plaintext && plaintext !== '') {
    return null;
  }

  // S-H2: Use random salt for PBKDF2 (stored alongside encrypted data)
  const salt = crypto.randomBytes(16);
  const key = deriveKey(null, salt);
  // sec-gcm-iv-length-09: 12-byte (96-bit) random IV per NIST SP 800-38D.
  // A fresh random IV per record is the GCM safety invariant. Stored as hex in
  // the record; decrypt() reads IV length from the record, so legacy 16-byte-IV
  // records remain decryptable.
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: encrypted,
    authTag: authTag.toString('hex'),
    algorithm: 'aes-256-gcm'
  });
}

/**
 * Decrypt ciphertext encrypted by encrypt()
 *
 * @param {string} encryptedJson - JSON stringified encrypted object
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails (tampered data)
 */
function decrypt(encryptedJson, keyMaterial = null) {
  if (!encryptedJson) {
    return null;
  }

  try {
    const encrypted = JSON.parse(encryptedJson);

    // S-H2: Backward-compatible decryption — if 'salt' field is present, use random-salt
    // derivation (new format); otherwise fall back to deterministic salt (old format).
    let key;
    if (encrypted.salt) {
      const salt = Buffer.from(encrypted.salt, 'hex');
      key = deriveKey(keyMaterial, salt);
    } else {
      key = deriveKey(keyMaterial);
    }

    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const ciphertext = encrypted.ciphertext;

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error(`PHI decryption failed: ${err.message}. Data may be tampered.`);
  }
}

// ==========================================
// FIELD-LEVEL ENCRYPTION
// ==========================================

/**
 * List of fields that contain PHI and should be encrypted
 */
const PHI_FIELDS = [
  'first_name',
  'last_name',
  'dob',
  'phone',
  'email',
  'address_line1',
  'address_line2',
  'ssn',
  'insurance_id'
];

/**
 * Encrypt specified fields in an object
 *
 * @param {object} obj - Object containing fields to encrypt
 * @param {array} fieldNames - Field names to encrypt (or null to use default PHI_FIELDS)
 * @returns {object} New object with encrypted fields
 */
function encryptFields(obj, fieldNames = null) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const fieldsToEncrypt = fieldNames || PHI_FIELDS;
  const encrypted = { ...obj };

  for (const field of fieldsToEncrypt) {
    if (field in encrypted && encrypted[field] != null) {
      encrypted[field] = encrypt(encrypted[field]);
    }
  }

  return encrypted;
}

/**
 * Decrypt specified fields in an object
 *
 * @param {object} obj - Object containing encrypted fields
 * @param {array} fieldNames - Field names to decrypt (or null to use default PHI_FIELDS)
 * @returns {object} New object with decrypted fields
 */
function decryptFields(obj, fieldNames = null) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const fieldsToDecrypt = fieldNames || PHI_FIELDS;
  const decrypted = { ...obj };

  for (const field of fieldsToDecrypt) {
    if (field in decrypted && decrypted[field] != null) {
      try {
        decrypted[field] = decrypt(decrypted[field]);
      } catch (err) {
        console.error(`Failed to decrypt ${field}:`, err.message);
        // Leave field as-is if decryption fails (may already be plaintext)
      }
    }
  }

  return decrypted;
}

// ==========================================
// SEARCHABLE HASHING (DETERMINISTIC)
// ==========================================

/**
 * Create a deterministic hash of PHI for searchable, indexed lookups
 *
 * Same plaintext always produces same hash (unlike encryption).
 * Enables queries like: WHERE hashed_ssn = ? without exposing plaintext.
 * Uses HMAC-SHA256 with pepper for additional security.
 *
 * SECURITY NOTE: Hash alone is not sufficient for HIPAA compliance.
 * Hashes should only be stored for search purposes.
 * Always encrypt the actual PHI field.
 *
 * @param {string} plaintext - PHI value to hash
 * @returns {string} Hex-encoded HMAC-SHA256 hash
 */
function hashPHI(plaintext) {
  if (!plaintext) {
    return null;
  }

  const pepper = getPepper();
  const hmac = crypto.createHmac('sha256', pepper);
  hmac.update(String(plaintext));

  return hmac.digest('hex');
}

/**
 * Create hashes for a list of fields (typically for indexing)
 *
 * @param {object} obj - Object containing fields to hash
 * @param {array} fieldNames - Field names to hash
 * @returns {object} Object with hash_[fieldName] entries
 */
function hashFields(obj, fieldNames = ['ssn', 'email', 'phone']) {
  if (!obj || typeof obj !== 'object') {
    return {};
  }

  const hashes = {};

  for (const field of fieldNames) {
    if (field in obj && obj[field] != null) {
      hashes[`hash_${field}`] = hashPHI(obj[field]);
    }
  }

  return hashes;
}

// ==========================================
// BATCH OPERATIONS
// ==========================================

/**
 * Encrypt multiple records (e.g., from database query)
 *
 * @param {array} records - Array of objects
 * @param {array} fieldNames - Fields to encrypt
 * @returns {array} Array with encrypted fields
 */
function encryptRecords(records, fieldNames = null) {
  if (!Array.isArray(records)) {
    return records;
  }

  return records.map(record => encryptFields(record, fieldNames));
}

/**
 * Decrypt multiple records
 *
 * @param {array} records - Array of objects with encrypted fields
 * @param {array} fieldNames - Fields to decrypt
 * @returns {array} Array with decrypted fields
 */
function decryptRecords(records, fieldNames = null) {
  if (!Array.isArray(records)) {
    return records;
  }

  return records.map(record => decryptFields(record, fieldNames));
}

// ==========================================
// KEY ROTATION SUPPORT
// ==========================================

/**
 * Re-encrypt data with new key material.
 * S-H3: Passes old key directly to decrypt via parameter -- no process.env swapping,
 * eliminating the race condition entirely.
 *
 * @param {string} oldEncrypted - Data encrypted with old key
 * @param {string} oldKeyMaterial - Previous PHI_ENCRYPTION_KEY value
 * @returns {string} Data encrypted with current key
 */
function reencryptWithNewKey(oldEncrypted, oldKeyMaterial) {
  try {
    // Decrypt with old key (passed directly, no env mutation)
    const plaintext = decrypt(oldEncrypted, oldKeyMaterial);

    // L2: Invalidate cached key since we're rotating
    cachedKey = null;
    cachedKeyMaterial = null;

    // Re-encrypt with current key (reads from process.env.PHI_ENCRYPTION_KEY)
    return encrypt(plaintext);
  } catch (err) {
    throw new Error(`Key rotation failed: ${err.message}`);
  }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  hashPHI,
  hashFields,
  encryptRecords,
  decryptRecords,
  reencryptWithNewKey,
  PHI_FIELDS,
  deriveKey,
  getPepper,
  assertProductionEncryptionConfig
};
