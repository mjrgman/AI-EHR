/**
 * PHI Encryption Module for Agentic EHR
 *
 * Handles encryption/decryption of Protected Health Information (PHI) at rest.
 * Uses AES-256-GCM with PBKDF2 key derivation and per-record IVs.
 * No external dependencies - uses Node.js built-in crypto module only.
 *
 * Reference: HIPAA Security Rule 45 CFR §164.312(a)(2)(ii)
 */

const crypto = require('crypto');

// ==========================================
// CONFIGURATION & VALIDATION
// ==========================================

// Derive encryption key from environment variable using PBKDF2
function deriveKey() {
  const keyMaterial = process.env.PHI_ENCRYPTION_KEY;

  if (!keyMaterial) {
    throw new Error(
      'PHI_ENCRYPTION_KEY environment variable is required for encryption. ' +
      'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (keyMaterial.length < 32) {
    throw new Error('PHI_ENCRYPTION_KEY must be at least 32 characters (16 bytes hex)');
  }

  // PBKDF2: 100k iterations, SHA-256
  // Salt is derived from the key material itself (deterministic per deployment).
  // This ensures the same PHI_ENCRYPTION_KEY always produces the same derived key
  // while avoiding a hardcoded salt that would be shared across all deployments.
  const salt = crypto.createHash('sha256').update(keyMaterial + ':agentic-ehr-phi-salt').digest();

  return crypto.pbkdf2Sync(
    keyMaterial,
    salt,
    100000, // iterations
    32,     // 256-bit key
    'sha256'
  );
}

// Pepper for hashPHI function (should be set via environment or derived from key)
function getPepper() {
  return process.env.PHI_PEPPER ||
    crypto.createHash('sha256').update(process.env.PHI_ENCRYPTION_KEY + 'pepper').digest();
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

  const key = deriveKey();
  const iv = crypto.randomBytes(16); // 128-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
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
function decrypt(encryptedJson) {
  if (!encryptedJson) {
    return null;
  }

  try {
    const encrypted = JSON.parse(encryptedJson);
    const key = deriveKey();

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
 * Re-encrypt data with new key material
 * Used during key rotation scenarios
 *
 * @param {string} oldEncrypted - Data encrypted with old key
 * @param {string} oldKeyMaterial - Previous PHI_ENCRYPTION_KEY value
 * @returns {string} Data encrypted with current key
 */
// Lock to prevent concurrent key rotation (avoids race condition on process.env)
let rotationInProgress = false;

function reencryptWithNewKey(oldEncrypted, oldKeyMaterial) {
  if (rotationInProgress) {
    throw new Error('Key rotation already in progress — concurrent rotation not allowed');
  }

  rotationInProgress = true;
  const currentKey = process.env.PHI_ENCRYPTION_KEY;

  try {
    // Decrypt with old key
    process.env.PHI_ENCRYPTION_KEY = oldKeyMaterial;
    const plaintext = decrypt(oldEncrypted);

    // Re-encrypt with current key
    process.env.PHI_ENCRYPTION_KEY = currentKey;
    const result = encrypt(plaintext);

    rotationInProgress = false;
    return result;
  } catch (err) {
    process.env.PHI_ENCRYPTION_KEY = currentKey;
    rotationInProgress = false;
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
  getPepper
};
