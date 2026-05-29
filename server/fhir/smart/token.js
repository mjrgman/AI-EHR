'use strict';

/**
 * SMART-on-FHIR Token Endpoint
 * POST /smart/token
 *
 * Supported grant types:
 *   client_credentials  — system-to-system; client authenticates with
 *                         Basic auth (username:password) or JSON body.
 *   password            — resource owner password; for integration testing.
 *                         Not recommended for production SMART apps.
 *   authorization_code  — standard SMART-on-FHIR authorization code flow.
 *   refresh_token       — exchange a refresh token for new access + refresh tokens.
 *
 * Additional endpoints:
 *   POST /smart/revoke    — revoke a refresh token
 *   POST /smart/register  — dynamic client registration
 *
 * All grants validate credentials and issue a JWT carrying SMART scope
 * claims derived from the user's role.
 *
 * Audit trail: every token issuance is logged to audit_log.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const auth = require('../../security/auth');
const db = require('../../database');
const { ROLE_SCOPES, ALL_SCOPES, scopeSatisfies } = require('./smart-config');

// ──────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────

const AUTH_CODE_BYTES = 32;           // 32-byte hex auth codes
const REFRESH_TOKEN_BYTES = 48;       // 48-byte hex refresh tokens
const AUTH_CODE_TTL_SEC = 60;         // auth codes expire after 60s per spec
const REFRESH_TOKEN_TTL_DAYS = 30;    // refresh tokens last 30 days
const CLIENT_ID_BYTES = 16;           // 16-byte hex client IDs
const CLIENT_SECRET_BYTES = 32;       // 32-byte hex client secrets
const BCRYPT_ROUNDS = 12;

const SUPPORTED_GRANT_TYPES = [
  'client_credentials',
  'password',
  'authorization_code',
  'refresh_token',
];

// ──────────────────────────────────────────
// TABLE INITIALIZATION
// ──────────────────────────────────────────

/**
 * Create SMART-on-FHIR tables if they don't exist.
 * Called on module load — errors are logged but do not crash the process.
 */
async function initSmartTables() {
  try {
    await db.dbRun(`
      CREATE TABLE IF NOT EXISTS smart_clients (
        client_id       TEXT PRIMARY KEY,
        client_secret_hash TEXT NOT NULL,
        client_name     TEXT NOT NULL,
        redirect_uris   TEXT NOT NULL DEFAULT '[]',
        grant_types     TEXT NOT NULL DEFAULT '[]',
        scopes          TEXT NOT NULL DEFAULT '[]',
        is_active       BOOLEAN NOT NULL DEFAULT 1,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('[SMART] Failed to create smart_clients table:', err.message);
  }

  try {
    await db.dbRun(`
      CREATE TABLE IF NOT EXISTS smart_auth_codes (
        code          TEXT PRIMARY KEY,
        client_id     TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        scopes        TEXT NOT NULL DEFAULT '',
        redirect_uri  TEXT NOT NULL,
        launch_context TEXT NOT NULL DEFAULT '{}',
        expires_at    DATETIME NOT NULL,
        used          BOOLEAN NOT NULL DEFAULT 0,
        code_challenge        TEXT,
        code_challenge_method TEXT
      )
    `);
  } catch (err) {
    console.error('[SMART] Failed to create smart_auth_codes table:', err.message);
  }

  // Backward-compat: add PKCE columns to pre-existing smart_auth_codes tables
  // (sec-smart-authorize-auto-approve-11). ALTER fails harmlessly if the column
  // already exists — swallow the "duplicate column" error so existing DBs
  // (data/mjr-ehr.db) upgrade in place without losing rows.
  for (const col of ['code_challenge TEXT', 'code_challenge_method TEXT']) {
    try {
      await db.dbRun(`ALTER TABLE smart_auth_codes ADD COLUMN ${col}`);
    } catch (_) { /* column already present — expected on upgrade */ }
  }

  try {
    await db.dbRun(`
      CREATE TABLE IF NOT EXISTS smart_refresh_tokens (
        token       TEXT PRIMARY KEY,
        client_id   TEXT NOT NULL,
        user_id     INTEGER NOT NULL,
        scopes      TEXT NOT NULL DEFAULT '',
        expires_at  DATETIME NOT NULL,
        revoked     BOOLEAN NOT NULL DEFAULT 0
      )
    `);
  } catch (err) {
    console.error('[SMART] Failed to create smart_refresh_tokens table:', err.message);
  }
}

// Fire table init on module load (non-blocking)
initSmartTables();

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────

/**
 * Parse Basic auth header → { username, password } or null.
 */
function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

/**
 * Intersect requested scopes with what the role is allowed.
 * If no scope requested, return full role defaults.
 */
function resolveScopes(requestedScope, role) {
  const defaults = ROLE_SCOPES[role] || ['openid'];
  if (!requestedScope) return defaults;

  const requested = requestedScope.split(' ').filter(Boolean);
  // Only grant scopes that are in ALL_SCOPES AND satisfiable by role defaults
  return requested.filter(r =>
    ALL_SCOPES.includes(r) && defaults.some(d => scopeSatisfies([d], r))
  );
}

/**
 * Authenticate user and return user row, or throw with { status, error }.
 */
async function authenticate(username, password) {
  if (!username || !password) {
    throw Object.assign(new Error('Missing credentials'), { status: 400, error: 'invalid_request' });
  }
  const user = await db.dbGet(
    'SELECT * FROM users WHERE username = ? AND is_active = 1',
    [username]
  );
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, error: 'invalid_client' });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401, error: 'invalid_client' });
  }
  return user;
}

/**
 * Validate a registered SMART client by client_id and optional secret.
 * Returns the client row or throws with { status, error }.
 */
async function authenticateClient(clientId, clientSecret) {
  if (!clientId) {
    throw Object.assign(new Error('Missing client_id'), { status: 400, error: 'invalid_request' });
  }
  const client = await db.dbGet(
    'SELECT * FROM smart_clients WHERE client_id = ? AND is_active = 1',
    [clientId]
  );
  if (!client) {
    throw Object.assign(new Error('Unknown or inactive client'), { status: 401, error: 'invalid_client' });
  }
  if (clientSecret) {
    const valid = await bcrypt.compare(clientSecret, client.client_secret_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid client credentials'), { status: 401, error: 'invalid_client' });
    }
  }
  return client;
}

/**
 * Generate a cryptographically random hex string.
 */
function generateRandomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Base64url-encode a Buffer (RFC 7636 / RFC 4648 §5 — no padding, URL-safe).
 */
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify a PKCE code_verifier against a stored code_challenge (sec-smart-
 * authorize-auto-approve-11). Only the S256 method is supported (the only
 * method this server advertises in code_challenge_methods_supported).
 *
 * @param {string} verifier  the client's code_verifier
 * @param {string} challenge the code_challenge stored at /authorize time
 * @param {string} method    'S256' (anything else is rejected)
 * @returns {boolean} true only when the verifier validly proves the challenge
 */
function verifyPkce(verifier, challenge, method) {
  if (!verifier || !challenge) return false;
  // RFC 7636 §4.1: verifier is 43–128 chars of the unreserved set.
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  if (method !== 'S256') return false; // 'plain' is not accepted; fail closed.
  const computed = base64url(crypto.createHash('sha256').update(verifier).digest());
  // Constant-time compare on equal-length buffers.
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Issue a refresh token, store it in the DB, and return the raw token string.
 */
async function issueRefreshToken(clientId, userId, scopes) {
  const token = generateRandomHex(REFRESH_TOKEN_BYTES);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.dbRun(`
    INSERT INTO smart_refresh_tokens (token, client_id, user_id, scopes, expires_at, revoked)
    VALUES (?, ?, ?, ?, ?, 0)
  `, [token, clientId, userId, scopes, expiresAt]);
  return { token, expiresAt };
}

/**
 * Log token issuance to audit_log (fire-and-forget).
 */
async function logTokenIssued(user, grantType, scopes, ip) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, ?, 'smart_token_issued', 'Token', ?, 'POST', '/smart/token', 200, 0)
    `, [
      user.username,
      user.role,
      `grant_type=${grantType} scopes=[${scopes.join(' ')}]`,
    ]);
  } catch (_) { /* audit failure must not block token response */ }
}

/**
 * Log token denial to audit_log (fire-and-forget).
 */
async function logTokenDenied(username, reason, ip) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, 'smart_token_denied', 'Token', ?, 'POST', '/smart/token', 401, 0)
    `, [username || 'unknown', reason]);
  } catch (_) {}
}

// ──────────────────────────────────────────
// ROUTE HANDLER
// ──────────────────────────────────────────

/**
 * POST /smart/token
 *
 * Request (application/x-www-form-urlencoded or JSON):
 *   grant_type   required  'client_credentials' | 'password' | 'authorization_code' | 'refresh_token'
 *   scope        optional  space-separated SMART scopes
 *   username     required for password/client_credentials grants (or via Basic auth)
 *   password     required for password/client_credentials grants (or via Basic auth)
 *   code         required for authorization_code grant
 *   redirect_uri required for authorization_code grant
 *   client_id    required for authorization_code grant
 *   refresh_token required for refresh_token grant
 *
 * Response:
 *   { access_token, token_type, expires_in, scope [, refresh_token] }
 */
async function tokenHandler(req, res) {
  const body = req.body || {};
  const grantType = body.grant_type;
  const ip = req.ip;

  if (!SUPPORTED_GRANT_TYPES.includes(grantType)) {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Supported grant types: ${SUPPORTED_GRANT_TYPES.join(', ')}`,
    });
  }

  // ── authorization_code grant ───────────────
  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(req, res, body, ip);
  }

  // ── refresh_token grant ────────────────────
  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(req, res, body, ip);
  }

  // ── client_credentials / password grants (existing logic) ──
  let username, password;

  // Prefer Basic auth header; fall back to body fields
  const basic = parseBasicAuth(req.headers['authorization']);
  if (basic) {
    username = basic.username;
    password = basic.password;
  } else {
    username = body.username;
    password = body.password;
  }

  let user;
  try {
    user = await authenticate(username, password);
  } catch (err) {
    await logTokenDenied(username, err.message, ip);
    return res.status(err.status || 401).json({
      error: err.error || 'invalid_client',
      error_description: err.message,
    });
  }

  const grantedScopes = resolveScopes(body.scope, user.role);
  const scopeString = grantedScopes.join(' ');

  // Issue JWT with scope claim embedded (uses auth.signToken wrapper — JWT_SECRET is not exported)
  const expiresIn = 3600; // 1 hour
  const token = auth.signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    scope: scopeString,
  }, { expiresIn });

  // Update last_login
  await db.dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  await logTokenIssued(user, grantType, grantedScopes, ip);

  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopeString,
  });
}

/**
 * Handle authorization_code grant: exchange auth code for access + refresh tokens.
 */
async function handleAuthorizationCodeGrant(req, res, body, ip) {
  const { code, redirect_uri, client_id } = body;

  if (!code || !redirect_uri || !client_id) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code, redirect_uri, and client_id are required for authorization_code grant',
    });
  }

  // Authenticate client (secret via Basic auth or body)
  let clientSecret = body.client_secret;
  const basic = parseBasicAuth(req.headers['authorization']);
  if (basic) {
    // For authorization_code, Basic auth carries client_id:client_secret
    clientSecret = basic.password;
  }

  try {
    await authenticateClient(client_id, clientSecret);
  } catch (err) {
    await logTokenDenied(client_id, err.message, ip);
    return res.status(err.status || 401).json({
      error: err.error || 'invalid_client',
      error_description: err.message,
    });
  }

  // Look up the auth code
  const authCode = await db.dbGet(
    'SELECT * FROM smart_auth_codes WHERE code = ?',
    [code]
  );

  if (!authCode) {
    await logTokenDenied(client_id, 'Invalid authorization code', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid authorization code',
    });
  }

  // Validate code is not used
  if (authCode.used) {
    await logTokenDenied(client_id, 'Authorization code already used', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has already been used',
    });
  }

  // Validate code is not expired
  if (new Date(authCode.expires_at) < new Date()) {
    await logTokenDenied(client_id, 'Authorization code expired', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });
  }

  // Validate client_id matches
  if (authCode.client_id !== client_id) {
    await logTokenDenied(client_id, 'client_id mismatch on auth code', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'client_id does not match the authorization code',
    });
  }

  // Validate redirect_uri matches
  if (authCode.redirect_uri !== redirect_uri) {
    await logTokenDenied(client_id, 'redirect_uri mismatch on auth code', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri does not match the authorization code',
    });
  }

  // ── PKCE verification (sec-smart-authorize-auto-approve-11) ─────────────
  // Every code minted by /smart/authorize is bound to a code_challenge. The
  // token exchange MUST present a matching code_verifier. Fail closed: a code
  // with a stored challenge but no/invalid verifier is rejected. (Codes with no
  // stored challenge cannot occur post-fix; if a legacy/null-challenge code is
  // somehow presented, it is also rejected — PKCE is mandatory.)
  if (!verifyPkce(body.code_verifier, authCode.code_challenge, authCode.code_challenge_method || 'S256')) {
    await logTokenDenied(client_id, 'PKCE verification failed', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'PKCE verification failed (missing or invalid code_verifier)',
    });
  }

  // Mark code as used (one-time use)
  await db.dbRun('UPDATE smart_auth_codes SET used = 1 WHERE code = ?', [code]);

  // Look up user for token claims
  const user = await db.dbGet('SELECT * FROM users WHERE id = ? AND is_active = 1', [authCode.user_id]);
  if (!user) {
    await logTokenDenied(client_id, 'User associated with auth code no longer active', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'User account is no longer active',
    });
  }

  const scopeString = authCode.scopes;
  const grantedScopes = scopeString.split(' ').filter(Boolean);

  // Issue access token
  const expiresIn = 3600;
  const accessToken = auth.signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    scope: scopeString,
  }, { expiresIn });

  // Issue refresh token
  const refreshResult = await issueRefreshToken(client_id, user.id, scopeString);

  // Update last_login
  await db.dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  await logTokenIssued(user, 'authorization_code', grantedScopes, ip);

  // Build response, include launch context if present
  const response = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopeString,
    refresh_token: refreshResult.token,
  };

  // Attach launch context (patient, encounter, etc.) if stored with the code
  try {
    const launchContext = JSON.parse(authCode.launch_context || '{}');
    if (launchContext.patient) response.patient = launchContext.patient;
    if (launchContext.encounter) response.encounter = launchContext.encounter;
    if (launchContext.intent) response.intent = launchContext.intent;
  } catch (_) { /* malformed JSON — skip */ }

  res.json(response);
}

/**
 * Handle refresh_token grant: exchange refresh token for new access + refresh tokens.
 */
async function handleRefreshTokenGrant(req, res, body, ip) {
  const refreshToken = body.refresh_token;
  if (!refreshToken) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'refresh_token is required',
    });
  }

  // Look up the refresh token
  const storedToken = await db.dbGet(
    'SELECT * FROM smart_refresh_tokens WHERE token = ?',
    [refreshToken]
  );

  if (!storedToken) {
    await logTokenDenied('unknown', 'Invalid refresh token', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid refresh token',
    });
  }

  if (storedToken.revoked) {
    await logTokenDenied(storedToken.client_id, 'Refresh token has been revoked', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token has been revoked',
    });
  }

  if (new Date(storedToken.expires_at) < new Date()) {
    await logTokenDenied(storedToken.client_id, 'Refresh token expired', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token has expired',
    });
  }

  // Look up user
  const user = await db.dbGet('SELECT * FROM users WHERE id = ? AND is_active = 1', [storedToken.user_id]);
  if (!user) {
    await logTokenDenied(storedToken.client_id, 'User no longer active', ip);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'User account is no longer active',
    });
  }

  // Revoke the old refresh token (rotation)
  await db.dbRun('UPDATE smart_refresh_tokens SET revoked = 1 WHERE token = ?', [refreshToken]);

  const scopeString = storedToken.scopes;
  const grantedScopes = scopeString.split(' ').filter(Boolean);

  // Issue new access token
  const expiresIn = 3600;
  const accessToken = auth.signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    scope: scopeString,
  }, { expiresIn });

  // Issue new refresh token
  const newRefresh = await issueRefreshToken(storedToken.client_id, user.id, scopeString);

  await logTokenIssued(user, 'refresh_token', grantedScopes, ip);

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopeString,
    refresh_token: newRefresh.token,
  });
}

/**
 * GET /smart/introspect (stub — returns token metadata)
 * POST /smart/introspect
 */
async function introspectHandler(req, res) {
  const body = req.body || {};
  const token = body.token || req.query.token;
  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'token required' });
  }
  const decoded = auth.verifyToken(token);
  if (!decoded) {
    return res.json({ active: false });
  }
  res.json({
    active: true,
    sub: decoded.sub,
    username: decoded.username,
    role: decoded.role,
    scope: decoded.scope || '',
    exp: decoded.exp,
    iat: decoded.iat,
  });
}

/**
 * GET /smart/authorize — SMART authorization endpoint
 *
 * Required query params:
 *   response_type  must be 'code'
 *   client_id      registered client ID
 *   redirect_uri   must match a registered redirect URI
 *   scope          space-separated SMART scopes
 *   state          opaque state value (returned to client)
 *
 * Required (PKCE — sec-smart-authorize-auto-approve-11):
 *   code_challenge          PKCE challenge (base64url SHA-256 of the verifier)
 *   code_challenge_method   must be 'S256' (the only method advertised)
 *
 * Optional:
 *   launch         EHR launch context token
 *   patient        launch patient id (validated to exist; mismatch denied)
 *   encounter      launch encounter id
 *   aud            FHIR server base URL
 *   consent        must equal 'true' to approve; absent → consent required
 *
 * DENY BY DEFAULT. This endpoint no longer auto-approves. An authorization
 * code is issued ONLY when ALL of the following hold:
 *   1. the user is authenticated (req.user set by upstream middleware),
 *   2. the client + redirect_uri are registered,
 *   3. a valid S256 PKCE code_challenge is present,
 *   4. any supplied launch patient context resolves to a real patient,
 *   5. the user has explicitly granted consent (consent=true).
 * Any failure returns an error / consent-required response — never a code.
 */
async function authorizeHandler(req, res) {
  const {
    response_type,
    client_id,
    redirect_uri,
    scope,
    state,
    launch,
    patient,
    encounter,
    code_challenge,
    code_challenge_method,
    consent,
  } = req.query;

  // Validate response_type
  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported',
    });
  }

  // Validate client
  let client;
  try {
    client = await authenticateClient(client_id, null); // no secret required at authorize endpoint
  } catch (err) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: err.message,
    });
  }

  // Validate redirect_uri is registered for this client
  let registeredUris;
  try {
    registeredUris = JSON.parse(client.redirect_uris || '[]');
  } catch (_) {
    registeredUris = [];
  }
  if (!registeredUris.includes(redirect_uri)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'redirect_uri is not registered for this client',
    });
  }

  // ── PKCE is mandatory (deny by default) ────────────────────────────────
  // We advertise S256 and accept nothing else. A request with no challenge,
  // or a non-S256 method, is rejected here — before any code is minted.
  if (!code_challenge) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge is required (PKCE, S256)',
    });
  }
  // RFC 7636 §4.2: S256 challenge is 43 base64url chars.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(code_challenge)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Malformed code_challenge',
    });
  }
  const challengeMethod = code_challenge_method || 'S256';
  if (challengeMethod !== 'S256') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Only code_challenge_method=S256 is supported',
    });
  }

  // User must be authenticated (set by upstream middleware)
  if (!req.user || !req.user.sub) {
    // Redirect to login with SMART params preserved so user can authenticate first
    const params = new URLSearchParams(req.query).toString();
    return res.redirect(302, `/?smart_launch=1&${params}`);
  }

  // Resolve scopes against user's role
  const userId = req.user.sub;
  const user = await db.dbGet('SELECT * FROM users WHERE id = ? AND is_active = 1', [userId]);
  if (!user) {
    return res.status(403).json({
      error: 'access_denied',
      error_description: 'User account is not active',
    });
  }

  // ── Validate launch patient context (sec-smart-authorize-auto-approve-11) ──
  // Previously the launch `patient` was trusted verbatim and written into the
  // auth code / audit. Validate it resolves to a real patient before binding it
  // to the authorization. An unresolvable launch patient denies the request
  // rather than minting a code with a forged/garbage patient context.
  const launchContext = {};
  if (launch) launchContext.launch = launch;
  if (encounter) launchContext.encounter = String(encounter);
  if (patient !== undefined && patient !== null && patient !== '') {
    const patientId = parseInt(patient, 10);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid launch patient context',
      });
    }
    const patientRow = await db.dbGet('SELECT id FROM patients WHERE id = ?', [patientId]);
    if (!patientRow) {
      try {
        await db.dbRun(`
          INSERT INTO audit_log (
            user_identity, user_role, action, resource_type,
            description, request_method, request_path, response_status, phi_accessed
          ) VALUES (?, ?, 'smart_authorize_denied', 'AuthCode', ?, 'GET', '/smart/authorize', 403, 0)
        `, [user.username, user.role, `unresolved launch patient=${patient}`]);
      } catch (_) {}
      return res.status(403).json({
        error: 'access_denied',
        error_description: 'Launch patient context does not resolve to a known patient',
      });
    }
    launchContext.patient = patientId;
  }

  const grantedScopes = resolveScopes(scope, user.role);
  const scopeString = grantedScopes.join(' ');

  // ── Consent is mandatory (deny by default) ─────────────────────────────
  // No auto-approval. Until the user explicitly grants consent (consent=true),
  // return a consent-required response describing what would be authorized.
  // A real consent UI re-invokes this endpoint with consent=true after the
  // authenticated user approves. We never mint a code without it.
  if (consent !== 'true') {
    try {
      await db.dbRun(`
        INSERT INTO audit_log (
          user_identity, user_role, action, resource_type,
          description, request_method, request_path, response_status, phi_accessed
        ) VALUES (?, ?, 'smart_authorize_consent_required', 'AuthCode', ?, 'GET', '/smart/authorize', 200, 0)
      `, [user.username, user.role, `client_id=${client_id} scopes=[${scopeString}]`]);
    } catch (_) {}
    return res.status(200).json({
      consent_required: true,
      client_id,
      client_name: client.client_name,
      scopes: grantedScopes,
      patient: launchContext.patient || null,
      message: 'User consent is required to authorize this application. Re-submit with consent=true to approve.',
    });
  }

  // Generate authorization code (consent granted + PKCE bound)
  const code = generateRandomHex(AUTH_CODE_BYTES);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000).toISOString();

  await db.dbRun(`
    INSERT INTO smart_auth_codes (code, client_id, user_id, scopes, redirect_uri, launch_context, expires_at, used, code_challenge, code_challenge_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `, [code, client_id, userId, scopeString, redirect_uri, JSON.stringify(launchContext), expiresAt, code_challenge, challengeMethod]);

  // Audit log
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, ?, 'smart_authorize', 'AuthCode', ?, 'GET', '/smart/authorize', 302, 0)
    `, [user.username, user.role, `client_id=${client_id} scopes=[${scopeString}] patient=${launchContext.patient || 'none'}`]);
  } catch (_) {}

  // Redirect to client with code and state
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  res.redirect(302, redirectUrl.toString());
}

/**
 * GET /smart/launch — EHR-initiated launch context handler
 * Records the launch context (patient, encounter, intent) and returns
 * a launch token for use with the authorization code flow.
 */
async function launchHandler(req, res) {
  const { patient, encounter, intent } = req.query;
  const user = req.user;

  // Log the launch event
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status,
        phi_accessed, patient_id
      ) VALUES (?, ?, 'smart_launch', 'Launch', ?, 'GET', '/smart/launch', 200, ?, ?)
    `, [
      user?.username || 'anonymous',
      user?.role || 'unknown',
      `intent=${intent || 'none'} patient=${patient || 'none'} encounter=${encounter || 'none'}`,
      patient ? 1 : 0,
      patient ? parseInt(patient, 10) : null,
    ]);
  } catch (_) {}

  // Return launch context as JSON (client uses this to start authorize flow)
  res.json({
    launch: {
      patient: patient || null,
      encounter: encounter || null,
      intent: intent || null,
    },
    authorize_url: `${req.protocol}://${req.get('host')}/smart/authorize`,
  });
}

// ──────────────────────────────────────────
// TOKEN REVOCATION
// ──────────────────────────────────────────

/**
 * POST /smart/revoke — Revoke a refresh token.
 *
 * Request body:
 *   token           required  the refresh token to revoke
 *   token_type_hint optional  'refresh_token' (ignored; only refresh tokens are revocable)
 *
 * Per RFC 7009, this endpoint always returns 200 even if the token is
 * not found or already revoked (to prevent token-existence oracle attacks).
 */
async function revokeHandler(req, res) {
  const body = req.body || {};
  const token = body.token;

  if (!token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'token is required',
    });
  }

  try {
    await db.dbRun(
      'UPDATE smart_refresh_tokens SET revoked = 1 WHERE token = ?',
      [token]
    );
  } catch (_) { /* swallow — return 200 regardless */ }

  // Audit log (best-effort)
  try {
    const storedToken = await db.dbGet('SELECT * FROM smart_refresh_tokens WHERE token = ?', [token]);
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, 'smart_token_revoked', 'Token', ?, 'POST', '/smart/revoke', 200, 0)
    `, [
      storedToken?.client_id || 'unknown',
      `client_id=${storedToken?.client_id || 'unknown'} user_id=${storedToken?.user_id || 'unknown'}`,
    ]);
  } catch (_) {}

  // RFC 7009: always 200
  res.status(200).json({ revoked: true });
}

// ──────────────────────────────────────────
// DYNAMIC CLIENT REGISTRATION
// ──────────────────────────────────────────

/**
 * POST /smart/register — Register a new SMART client.
 *
 * Request body (JSON):
 *   client_name    required  human-readable client name
 *   redirect_uris  required  array of allowed redirect URIs
 *   grant_types    optional  array of grant types (default: ['authorization_code'])
 *   scopes         optional  array of requested scopes (default: NONE — fail closed)
 *
 * Response:
 *   { client_id, client_secret, client_name, redirect_uris, grant_types, scopes }
 *
 * The client_secret is returned in plaintext ONCE. It is stored as a bcrypt hash.
 *
 * SECURITY (sec-smart-register-public-04):
 *   - Dynamic client registration is an ADMIN-ONLY operation. It MUST NOT be
 *     reachable by an unauthenticated caller. We enforce admin authorization
 *     in-handler (fail closed) so the protection holds regardless of how the
 *     route is mounted: an absent/insufficient identity is DENIED here, not
 *     passed through.
 *   - There is NO all-scopes default. A registration that omits `scopes` (or
 *     supplies none that survive the ALL_SCOPES allow-list filter) is created
 *     with an EMPTY scope set — the least privilege. Previously this defaulted
 *     to the entire ALL_SCOPES set, granting a freshly registered public client
 *     every scope the server knows about.
 */
async function registerClientHandler(req, res) {
  // ── Admin authorization (fail closed) ──────────────────────────────────
  // req.user is populated by auth.requireAuth upstream. If it is absent (the
  // endpoint was reached without authentication) or the role is not 'admin',
  // deny. Registration of an OAuth client is a privileged administrative act.
  if (!req.user || req.user.role !== 'admin') {
    try {
      await db.dbRun(`
        INSERT INTO audit_log (
          user_identity, user_role, action, resource_type,
          description, request_method, request_path, response_status, phi_accessed
        ) VALUES (?, ?, 'smart_register_denied', 'Client', ?, 'POST', '/smart/register', 403, 0)
      `, [
        req.user?.username || 'anonymous',
        req.user?.role || 'unknown',
        'Dynamic client registration requires an authenticated admin',
      ]);
    } catch (_) { /* audit failure must not block the response */ }
    return res.status(403).json({
      error: 'access_denied',
      error_description: 'Dynamic client registration requires an authenticated admin.',
    });
  }

  const body = req.body || {};
  const { client_name, redirect_uris, grant_types, scopes } = body;

  // Validate required fields
  if (!client_name || typeof client_name !== 'string' || !client_name.trim()) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'client_name is required',
    });
  }

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'redirect_uris must be a non-empty array',
    });
  }

  // Validate each redirect URI is a valid URL
  for (const uri of redirect_uris) {
    try {
      new URL(uri);
    } catch (_) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: `Invalid redirect_uri: ${uri}`,
      });
    }
  }

  // Default grant types
  const clientGrantTypes = Array.isArray(grant_types) && grant_types.length > 0
    ? grant_types.filter(g => SUPPORTED_GRANT_TYPES.includes(g))
    : ['authorization_code'];

  // Scopes — fail closed to NONE if not specified (sec-smart-register-public-04).
  // Only scopes on the ALL_SCOPES allow-list survive; anything else is dropped.
  // A registration with no valid scopes yields an empty grant (least privilege),
  // NOT the full ALL_SCOPES set.
  const clientScopes = Array.isArray(scopes)
    ? scopes.filter(s => ALL_SCOPES.includes(s))
    : [];

  // Generate client credentials
  const clientId = generateRandomHex(CLIENT_ID_BYTES);
  const clientSecret = generateRandomHex(CLIENT_SECRET_BYTES);
  const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);

  try {
    await db.dbRun(`
      INSERT INTO smart_clients (client_id, client_secret_hash, client_name, redirect_uris, grant_types, scopes, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [
      clientId,
      clientSecretHash,
      client_name.trim(),
      JSON.stringify(redirect_uris),
      JSON.stringify(clientGrantTypes),
      JSON.stringify(clientScopes),
    ]);
  } catch (err) {
    console.error('[SMART] Client registration failed:', err.message);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }

  // Audit log (best-effort)
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, 'smart_client_registered', 'Client', ?, 'POST', '/smart/register', 201, 0)
    `, [
      req.user?.username || 'system',
      `client_id=${clientId} client_name=${client_name.trim()}`,
    ]);
  } catch (_) {}

  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client_name.trim(),
    redirect_uris,
    grant_types: clientGrantTypes,
    scopes: clientScopes,
  });
}

module.exports = {
  tokenHandler,
  introspectHandler,
  authorizeHandler,
  launchHandler,
  revokeHandler,
  registerClientHandler,
};
