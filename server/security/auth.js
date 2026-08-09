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

// sec-jwt-no-alg-pin-06: FAIL TO BOOT in production if JWT_SECRET is unset.
// Dev/test continue to work: scripts/dev-server.js bakes a dev secret and
// test/run-tests.js sets a test secret, both BEFORE this module loads. Only a
// genuine production process (NODE_ENV==='production') with no secret aborts.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error(
    '[AUTH] FATAL: JWT_SECRET must be set in production. Refusing to boot with an ' +
    'ephemeral key (would silently invalidate all sessions on restart and weaken token integrity). ' +
    'Set JWT_SECRET in the environment / secret manager.'
  );
}

// sec-dev-bypass-header-12: the x-user-id / x-user-role header-trust bypass is
// gated on NODE_ENV==='development' && ENABLE_DEV_AUTH_BYPASS==='true' (see
// requireAuth below, plus mirrored gates in rbac.js and hipaa-middleware.js).
// Those gates already make the bypass INERT in production (the NODE_ENV check
// fails closed). This boot-time assertion is defense-in-depth against the
// single-misconfig failure mode: if a production process is ever started with
// the bypass flag set, refuse to boot rather than risk full header-trust
// impersonation. Production must NEVER carry this flag.
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true') {
  throw new Error(
    '[AUTH] FATAL: ENABLE_DEV_AUTH_BYPASS must NOT be set in production. The ' +
    'x-user-id/x-user-role header-trust bypass is a development-only convenience and would ' +
    'permit unauthenticated impersonation of any role. Unset ENABLE_DEV_AUTH_BYPASS in the ' +
    'production environment.'
  );
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const BCRYPT_ROUNDS = 12;

// sec-jwt-no-alg-pin-06: Pin algorithm + issuer/audience to defeat
// alg-confusion / "none" attacks and cross-service token replay. HS256 is the
// only algorithm we sign with, so it is the only one we accept on verify.
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = process.env.JWT_ISSUER || 'agentic-ehr';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'agentic-ehr-api';

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
const { logSafe } = require('./log-safe');

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Clean up stale lockout entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts) {
    if (data.lockedUntil && now >= data.lockedUntil) {
      loginAttempts.delete(key);
    } else if (!data.lockedUntil && now - data.firstAttempt > LOCKOUT_WINDOW_MS) {
      loginAttempts.delete(key);
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
  // sec-jwt-no-alg-pin-06: stamp algorithm + issuer/audience at sign time so
  // verify can enforce them. jsonwebtoken sets `iss`/`aud` claims from options.
  return jwt.sign(
    tokenPayload,
    JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: options.expiresIn || JWT_EXPIRY,
    }
  );
}

function verifyToken(token) {
  try {
    // sec-jwt-no-alg-pin-06: pin the algorithm allow-list (HS256 only) and
    // validate issuer/audience. This rejects alg-confusion ("none"/RS256-as-HS)
    // and tokens minted for a different service. These are short-lived session
    // tokens (not persisted in mjr-ehr.db), so strict validation has no
    // stored-record backward-compat concern.
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
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

    // S-M7: lockout is per (username, origin) — see recordFailedLogin.
    const clientIp = loginClientIp(req);
    const lockoutData = loginAttempts.get(lockoutKey(username, clientIp));
    if (lockoutData && lockoutData.lockedUntil) {
      if (Date.now() < lockoutData.lockedUntil) {
        const retryAfterSec = Math.ceil((lockoutData.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed login attempts. Try again later.',
          retryAfter: retryAfterSec,
        });
      }
      // Lockout expired, clear it
      clearFailedLogins(username, clientIp);
    }

    const user = await db.dbGet(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (!user) {
      // S-M7: Track failed attempt even for unknown users (prevent user enumeration timing)
      recordFailedLogin(username, clientIp);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      // S-M7: Track failed attempt
      const lockResult = recordFailedLogin(username, clientIp);
      if (lockResult.locked) {
        return res.status(429).json({
          error: 'Account temporarily locked due to too many failed login attempts. Try again later.',
          retryAfter: Math.ceil(LOCKOUT_DURATION_MS / 1000),
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // S-M7: Reset this origin's failed attempts on successful login
    clearFailedLogins(username, clientIp);

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
      // eslint-disable-next-line global-require -- optional module; refresh tokens are opt-in
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
/**
 * Client IP for lockout keying. Mirrors the portal's resolution so both
 * surfaces agree on what "the same client" means.
 */
function loginClientIp(req) {
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown';
}

/**
 * Composite key: a lockout applies to a credential-and-origin pair.
 *
 * The separator is a newline, which cannot appear in either component: a
 * username is validated on the way in, and an IP never contains one. Using a
 * character that could appear in a username would let one pair impersonate
 * another by straddling the separator.
 */
function lockoutKey(username, ip) {
  return `${username}\n${ip}`;
}

/**
 * Record a failed login.
 *
 * Keyed on (username, client IP), NOT on username alone.
 *
 * Username-only keying is a trivial denial-of-service: anyone who knows a
 * clinician's username can lock that clinician out of the system with five
 * wrong passwords from anywhere, and repeat it indefinitely. In a clinical
 * setting that is locking a physician out of charts during a shift. CodeQL
 * flagged the guard as js/user-controlled-bypass; the deeper problem is that
 * the attacker chooses whose account is affected.
 *
 * With composite keying an attacker locks only their own origin against that
 * username. The legitimate user, on a different connection, is unaffected.
 *
 * A distributed attempt on one account is still detected -- distinctIpsFor()
 * counts how many origins have failed against a username -- but it is
 * surfaced as a warning rather than converted into the lockout an attacker
 * wanted. Detection without a self-inflicted outage.
 */
function recordFailedLogin(username, ip = 'unknown') {
  const now = Date.now();
  const key = lockoutKey(username, ip);
  let data = loginAttempts.get(key);

  if (!data || (now - data.firstAttempt > LOCKOUT_WINDOW_MS)) {
    data = { attempts: 1, firstAttempt: now, lockedUntil: null, username, ip };
    loginAttempts.set(key, data);
    return { locked: false };
  }

  data.attempts++;

  if (data.attempts >= MAX_LOGIN_ATTEMPTS) {
    data.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(
      `[AUTH] Locked ${logSafe(username)} from origin ${logSafe(ip)} after ${data.attempts} failed attempts`
    );
    return { locked: true };
  }

  const origins = distinctIpsFor(username);
  if (origins > 2) {
    // Worth an operator's attention; deliberately NOT a lockout.
    console.warn(
      `[AUTH] ${logSafe(username)} has failed logins from ${origins} distinct origins — possible distributed attempt`
    );
  }

  return { locked: false };
}

/** How many distinct origins currently hold failed attempts for a username. */
function distinctIpsFor(username) {
  const ips = new Set();
  for (const data of loginAttempts.values()) {
    if (data.username === username) ips.add(data.ip);
  }
  return ips.size;
}

/** Clear a user's failures from ONE origin, on that origin's success. */
function clearFailedLogins(username, ip = 'unknown') {
  loginAttempts.delete(lockoutKey(username, ip));
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Exported for the lockout-keying tests: the composite key is the whole
  // point of the control, so it needs to be assertable directly.
  recordFailedLogin,
  clearFailedLogins,
  _distinctIpsFor: distinctIpsFor,
  _resetLoginAttempts: () => loginAttempts.clear(),
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
