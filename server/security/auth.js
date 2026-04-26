/**
 * Authentication Module for Agentic EHR
 *
 * JWT-based authentication with bcrypt password hashing.
 * Replaces the previous header-trust model (x-user-id / x-user-role).
 *
 * Usage:
 *   const auth = require('./security/auth');
 *   await auth.init(db);
 *   app.use(auth.requireAuth);                // protect all routes
 *   app.post('/api/auth/login', auth.login);  // login endpoint
 *   app.post('/api/auth/logout', auth.logout);
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createUsersTable } = require('../database-migrations');

// ==========================================
// CONFIGURATION
// ==========================================

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const BCRYPT_ROUNDS = 12;

// Password complexity requirements (S-M6)
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REGEX_UPPER = /[A-Z]/;
const PASSWORD_REGEX_LOWER = /[a-z]/;
const PASSWORD_REGEX_DIGIT = /[0-9]/;
const PASSWORD_REGEX_SPECIAL = /[^A-Za-z0-9]/;

// Warn if using a generated secret (won't survive restarts)
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] WARNING: JWT_SECRET not set — using ephemeral key. Sessions will not survive server restarts.');
  console.warn('[AUTH] Set JWT_SECRET in your environment for persistent authentication.');
}

// JWT blacklist for revoked tokens (S-H1)
// Maps JTI -> expiry timestamp (ms). Entries are cleaned up after expiry.
const tokenBlacklist = new Map();

// Clean up expired blacklist entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of tokenBlacklist) {
    if (now >= expiresAt) tokenBlacklist.delete(jti);
  }
}, 10 * 60 * 1000).unref();

// Account lockout tracking (S-M7)
// Maps username -> { attempts: number, firstAttempt: number, lockedUntil: number }
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Clean up stale lockout entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of loginAttempts) {
    if (data.lockedUntil && now >= data.lockedUntil) {
      loginAttempts.delete(username);
    } else if (!data.lockedUntil && now - data.firstAttempt > LOCKOUT_WINDOW_MS) {
      loginAttempts.delete(username);
    }
  }
}, 15 * 60 * 1000).unref();

let db = null;

// ==========================================
// INITIALIZATION
// ==========================================

async function init(dbInstance) {
  if (!dbInstance) throw new Error('Database instance required for auth module');
  db = dbInstance;

  // Create or upgrade users table — must match database-migrations.js schema exactly
  await createUsersTable(db);

  // Check if users table is empty and advise on user creation
  const count = await db.dbGet('SELECT COUNT(*) as c FROM users');
  if (count.c === 0) {
    console.log('[AUTH] No users found. Create users via auth.createUser() or a setup script.');
    console.log('[AUTH] Example: auth.createUser("dr.renner", "securePassword", "Dr. Michael Renner", "physician", "dr.renner@clinic.com")');
  }

  console.log('[AUTH] Authentication module initialized');
}

// ==========================================
// JWT HELPERS
// ==========================================

function signToken(payload, options = {}) {
  // Accept either a user object (legacy) or a raw payload (SMART tokens)
  const tokenPayload = payload.sub !== undefined ? { ...payload } : {
    sub: payload.id,
    username: payload.username,
    role: payload.role,
    fullName: payload.full_name,
  };
  if (!tokenPayload.jti) tokenPayload.jti = crypto.randomUUID();
  return jwt.sign(
    tokenPayload,
    JWT_SECRET,
    { expiresIn: options.expiresIn || JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ==========================================
// ROUTE HANDLERS
// ==========================================

/**
 * POST /api/auth/login
 * Accepts: { username, password }
 * Returns: { token, user: { id, username, role, displayName } }
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // S-M7: Check account lockout
    const lockoutData = loginAttempts.get(username);
    if (lockoutData && lockoutData.lockedUntil) {
      if (Date.now() < lockoutData.lockedUntil) {
        const retryAfterSec = Math.ceil((lockoutData.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed login attempts. Try again later.',
          retryAfter: retryAfterSec,
        });
      }
      // Lockout expired, clear it
      loginAttempts.delete(username);
    }

    const user = await db.dbGet(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (!user) {
      // S-M7: Track failed attempt even for unknown users (prevent user enumeration timing)
      recordFailedLogin(username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      // S-M7: Track failed attempt
      const lockResult = recordFailedLogin(username);
      if (lockResult.locked) {
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed login attempts. Try again later.',
          retryAfter: Math.ceil(LOCKOUT_DURATION_MS / 1000),
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // S-M7: Reset failed attempts on successful login
    loginAttempts.delete(username);

    // Update last login
    await db.dbRun(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    const token = signToken(user);

    // Issue refresh token if the module is initialized
    let refreshToken = null;
    let refreshExpiresAt = null;
    try {
      const refreshMod = require('./refresh-tokens');
      const rt = await refreshMod.create(user.id);
      refreshToken = rt.refreshToken;
      refreshExpiresAt = rt.expiresAt;
    } catch {
      // Refresh tokens not initialized yet — skip
    }

    res.json({
      token,
      refreshToken,
      refreshExpiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
      }
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /api/auth/logout
 * Invalidates the session (client should discard the token)
 */
async function logout(req, res) {
  // S-H1: Add token JTI to blacklist so it can't be reused
  if (req.user?.jti && req.user?.exp) {
    tokenBlacklist.set(req.user.jti, req.user.exp * 1000); // exp is in seconds, convert to ms
  }
  const userId = req.user?.username || 'unknown';
  console.log(`[AUTH] User ${userId} logged out`);
  res.json({ message: 'Logged out successfully' });
}

/**
 * GET /api/auth/me
 * Returns current authenticated user info
 */
async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.user.sub,
    username: req.user.username,
    role: req.user.role,
    fullName: req.user.fullName,
  });
}

// ==========================================
// MIDDLEWARE
// ==========================================

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.headers['x-auth-token'];
}

function attachAuthenticatedUser(req, decoded) {
  req.user = decoded;
  req.session = req.session || {};
  req.session.userId = decoded.username || decoded.sub || 'unknown';
  req.session.userRole = decoded.role || 'guest';
}

function authenticateRequest(req) {
  const token = extractToken(req);
  if (!token) {
    return { authenticated: false, tokenPresent: false, error: null };
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return {
      authenticated: false,
      tokenPresent: true,
      error: 'Invalid or expired token',
    };
  }

  if (decoded.jti && tokenBlacklist.has(decoded.jti)) {
    return {
      authenticated: false,
      tokenPresent: true,
      error: 'Token has been revoked',
    };
  }

  attachAuthenticatedUser(req, decoded);
  return { authenticated: true, tokenPresent: true, user: decoded };
}

/**
 * Authentication middleware — validates JWT from:
 *   1. Authorization: Bearer <token>
 *   2. x-auth-token header
 *
 * In development mode, header-based auth bypass is available only when
 * ENABLE_DEV_AUTH_BYPASS=true is set explicitly. Unauthenticated requests are
 * otherwise rejected with 401 in every environment.
 */
function requireAuth(req, res, next) {
  // Public routes that skip auth
  const publicPaths = new Set(['/api/auth/login', '/auth/login', '/api/health', '/health']);
  if (publicPaths.has(req.path)) {
    return next();
  }

  const authResult = authenticateRequest(req);
  if (authResult.authenticated) {
    return next();
  }
  if (authResult.tokenPresent) {
    return res.status(401).json({ error: authResult.error });
  }

  // No token — development bypass is explicit opt-in and still requires headers.
  const isDevHeaderBypassEnabled =
    process.env.NODE_ENV === 'development' &&
    process.env.ENABLE_DEV_AUTH_BYPASS === 'true';

  if (isDevHeaderBypassEnabled) {
    const headerUser = req.headers['x-user-id'];
    const headerRole = req.headers['x-user-role'];

    if (!headerUser || !headerRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    attachAuthenticatedUser(req, {
      sub: 0,
      username: headerUser,
      role: headerRole,
      fullName: req.headers['x-user-name'] || String(headerUser),
    });
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

// ==========================================
// USER MANAGEMENT
// ==========================================

/**
 * Create a new user (admin only)
 */
async function createUser(username, password, fullName, role, email, phone = null, npiNumber = null) {
  // S-M6: Password complexity validation
  const passwordError = validatePasswordComplexity(password);
  if (passwordError) {
    const err = new Error(passwordError);
    err.statusCode = 400;
    throw err;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await db.dbRun(
    `INSERT INTO users (username, password_hash, full_name, role, email, phone, npi_number) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, hash, fullName, role, email, phone, npiNumber]
  );
  return { id: result.lastID, username, fullName, role, email };
}

/**
 * Change password
 */
async function changePassword(userId, newPassword) {
  // S-M6: Password complexity validation
  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) {
    const err = new Error(passwordError);
    err.statusCode = 400;
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.dbRun(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [hash, userId]
  );
}

// ==========================================
// INTERNAL HELPERS
// ==========================================

/**
 * Validate password complexity (S-M6)
 * Returns error message string if invalid, null if valid.
 */
function validatePasswordComplexity(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (!PASSWORD_REGEX_UPPER.test(password)) {
    return 'Password must contain at least one uppercase letter.';
  }
  if (!PASSWORD_REGEX_LOWER.test(password)) {
    return 'Password must contain at least one lowercase letter.';
  }
  if (!PASSWORD_REGEX_DIGIT.test(password)) {
    return 'Password must contain at least one digit.';
  }
  if (!PASSWORD_REGEX_SPECIAL.test(password)) {
    return 'Password must contain at least one special character.';
  }
  return null;
}

/**
 * Record a failed login attempt and return lockout status (S-M7)
 */
function recordFailedLogin(username) {
  const now = Date.now();
  let data = loginAttempts.get(username);

  if (!data || (now - data.firstAttempt > LOCKOUT_WINDOW_MS)) {
    data = { attempts: 1, firstAttempt: now, lockedUntil: null };
    loginAttempts.set(username, data);
    return { locked: false };
  }

  data.attempts++;

  if (data.attempts >= MAX_LOGIN_ATTEMPTS) {
    data.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`[AUTH] Account locked for user: ${username} after ${data.attempts} failed attempts`);
    return { locked: true };
  }

  return { locked: false };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  init,
  login,
  logout,
  me,
  requireAuth,
  createUser,
  changePassword,
  signToken,
  verifyToken,
  authenticateRequest,
  // S-C3: JWT_SECRET is NOT exported — use signToken/verifyToken wrappers instead.
  // Note: server/fhir/smart/token.js references auth.JWT_SECRET and will need updating.
};
