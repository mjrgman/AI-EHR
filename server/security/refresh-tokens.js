/**
 * Refresh Token Module for Agentic EHR
 *
 * Provides secure refresh token generation, storage, validation,
 * and rotation. Refresh tokens are stored in the database (not in-memory)
 * so they survive server restarts.
 *
 * Usage:
 *   const refreshTokens = require('./security/refresh-tokens');
 *   await refreshTokens.init(db);
 *   const { refreshToken } = await refreshTokens.create(userId);
 *   const userId = await refreshTokens.validate(token);
 *   await refreshTokens.revoke(token);
 */

const crypto = require('crypto');

const REFRESH_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10);
const REFRESH_EXPIRY_MS = REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

let db = null;

// ==========================================
// INITIALIZATION
// ==========================================

async function init(dbInstance) {
  if (!dbInstance) throw new Error('Database instance required for refresh-tokens module');
  db = dbInstance;

  await db.dbRun(`CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    family TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Index for fast lookups
  await db.dbRun(`CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash)`);
  await db.dbRun(`CREATE INDEX IF NOT EXISTS idx_refresh_token_family ON refresh_tokens(family)`);

  // Prune expired tokens on startup
  await pruneExpired();

  console.log('[REFRESH] Refresh token module initialized');
}

// ==========================================
// TOKEN OPERATIONS
// ==========================================

/**
 * Create a new refresh token for a user.
 * Returns the raw token (send to client) and the family ID.
 */
async function create(userId, family = null) {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(token);
  const tokenFamily = family || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_MS).toISOString();

  await db.dbRun(
    `INSERT INTO refresh_tokens (token_hash, user_id, family, expires_at) VALUES (?, ?, ?, ?)`,
    [tokenHash, userId, tokenFamily, expiresAt]
  );

  return { refreshToken: token, family: tokenFamily, expiresAt };
}

/**
 * Validate a refresh token and return the associated user ID.
 * Returns null if invalid, expired, or revoked.
 */
async function validate(token) {
  const tokenHash = hashToken(token);

  const row = await db.dbGet(
    `SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0`,
    [tokenHash]
  );

  if (!row) return null;

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    await db.dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`, [row.id]);
    return null;
  }

  return { userId: row.user_id, family: row.family, tokenId: row.id };
}

/**
 * Rotate: validate the old token, revoke it, issue a new one.
 * If the old token was already revoked (replay attack), revoke the entire family.
 */
async function rotate(oldToken) {
  const tokenHash = hashToken(oldToken);

  const row = await db.dbGet(
    `SELECT * FROM refresh_tokens WHERE token_hash = ?`,
    [tokenHash]
  );

  if (!row) return null;

  // Replay detection: if token was already revoked, someone stole it.
  // Revoke the entire family to protect the user.
  if (row.revoked) {
    await db.dbRun(
      `UPDATE refresh_tokens SET revoked = 1 WHERE family = ?`,
      [row.family]
    );
    console.warn(`[REFRESH] REPLAY DETECTED — revoked entire token family ${row.family} for user ${row.user_id}`);
    return null;
  }

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    await db.dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`, [row.id]);
    return null;
  }

  // Revoke old token
  await db.dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`, [row.id]);

  // Issue new token in the same family
  return create(row.user_id, row.family);
}

/**
 * Revoke a single refresh token
 */
async function revoke(token) {
  const tokenHash = hashToken(token);
  await db.dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`, [tokenHash]);
}

/**
 * Revoke all refresh tokens for a user (e.g., password change, logout-all)
 */
async function revokeAllForUser(userId) {
  await db.dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`, [userId]);
}

/**
 * Prune expired tokens from the database
 */
async function pruneExpired() {
  const result = await db.dbRun(
    `DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1 AND created_at < datetime('now', '-1 day')`
  );
  if (result.changes > 0) {
    console.log(`[REFRESH] Pruned ${result.changes} expired/revoked tokens`);
  }
}

// ==========================================
// HELPERS
// ==========================================

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  init,
  create,
  validate,
  rotate,
  revoke,
  revokeAllForUser,
  pruneExpired,
};
