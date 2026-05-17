/**
 * HIPAA-Compliant Express Middleware
 * 
 * Handles PHI access logging, session management, request sanitization,
 * rate limiting, security headers, and PHI field detection.
 * 
 * Usage:
 *   const hipaa = require('./security/hipaa-middleware');
 *   await hipaa.init(db);
 *   app.use(hipaa.sessionTracker);
 *   app.use(hipaa.auditLogger);
 *   app.use('/api/patients', hipaa.phiAccessLogger);
 */

const crypto = require('crypto');

// ==========================================
// STATE & CONFIGURATION
// ==========================================

let db = null;
const SESSION_TIMEOUT_MINUTES = 15;
const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000;

// S-C4 hardening: identity must come from authenticated context.
// Header-based identity (x-user-id / x-user-role) is honored ONLY when
// NODE_ENV=development AND ENABLE_DEV_AUTH_BYPASS=true (matching auth.js).
function resolveIdentityForAudit(req) {
  if (req.user?.role) {
    return {
      userId: req.user.username || req.user.sub || 'authenticated',
      userRole: req.user.role,
    };
  }
  if (req.session?.userRole) {
    return {
      userId: req.session.userId || 'session',
      userRole: req.session.userRole,
    };
  }
  const devBypass =
    process.env.NODE_ENV === 'development' &&
    process.env.ENABLE_DEV_AUTH_BYPASS === 'true';
  if (devBypass && req.headers['x-user-role']) {
    return {
      userId: req.headers['x-user-id'] || 'dev-bypass',
      userRole: req.headers['x-user-role'],
    };
  }
  return { userId: 'anonymous', userRole: 'guest' };
}

// Rate limit tracking: userKey -> { count, resetTime }
const rateLimitStore = new Map();

// Prune expired rate limit entries every 60 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetTime) rateLimitStore.delete(key);
  }
}, 60000).unref(); // .unref() so the timer doesn't prevent process exit

// Session tracking: sessionId -> { userId, role, lastActivity, startTime }
const sessionStore = new Map();

// PHI field patterns for detection
const PHI_FIELDS = {
  // Patient demographics
  first_name: { label: 'First Name', pii: true },
  middle_name: { label: 'Middle Name', pii: true },
  last_name: { label: 'Last Name', pii: true },
  full_name: { label: 'Full Name', pii: true },
  name: { label: 'Name', pii: true },
  
  // Identifiers
  mrn: { label: 'MRN', pii: true },
  ssn: { label: 'SSN', pii: true },
  dob: { label: 'Date of Birth', pii: true },
  date_of_birth: { label: 'Date of Birth', pii: true },
  
  // Contact information
  phone: { label: 'Phone', pii: true },
  email: { label: 'Email', pii: true },
  address_line1: { label: 'Address', pii: true },
  address_line2: { label: 'Address', pii: true },
  city: { label: 'City', pii: true },
  state: { label: 'State', pii: true },
  zip: { label: 'ZIP', pii: true },
  
  // Insurance
  insurance_carrier: { label: 'Insurance Carrier', pii: true },
  insurance_id: { label: 'Insurance ID', pii: true },
  
  // Clinical PHI
  diagnosis: { label: 'Diagnosis', pii: true },
  icd10_code: { label: 'ICD-10 Code', pii: true },
  assessment: { label: 'Assessment', pii: true },
  plan: { label: 'Treatment Plan', pii: true },
  medications: { label: 'Medications', pii: true },
  allergies: { label: 'Allergies', pii: true },
  vital_signs: { label: 'Vital Signs', pii: true },
  labs: { label: 'Lab Results', pii: true },
};

// Security headers configuration
// Note: CSP uses nonce-based script policy instead of 'unsafe-inline'.
// The nonce is generated per request in securityHeaders middleware below.
const BASE_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',  // L1: Deprecated header; set to 0 per OWASP recommendation
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// ==========================================
// INITIALIZATION
// ==========================================

/**
 * Initialize HIPAA middleware with database connection
 */
async function init(dbInstance) {
  if (!dbInstance) {
    throw new Error('Database instance required for HIPAA middleware initialization');
  }
  db = dbInstance;
  
  // Clean up expired sessions every 5 minutes
  // L5: .unref() so the timer doesn't prevent process exit
  setInterval(cleanupExpiredSessions, 5 * 60 * 1000).unref();
  
  console.log('[HIPAA] Middleware initialized with session management enabled');
}

// ==========================================
// SESSION MANAGEMENT
// ==========================================

/**
 * Generate cryptographically secure session token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create new session in database
 */
async function createSession(userId, userRole, ipAddress, userAgent) {
  const sessionId = generateSessionToken();
  const now = new Date().toISOString();
  
  try {
    await db.dbRun(
      `INSERT INTO audit_sessions (id, user_identity, user_role, ip_address, user_agent, started_at, last_activity, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [sessionId, userId, userRole, ipAddress, userAgent]
    );
    
    // Also track in memory for quick access
    sessionStore.set(sessionId, {
      userId,
      userRole,
      ipAddress,
      userAgent,
      startTime: Date.now(),
      lastActivity: Date.now(),
    });
    
  } catch (err) {
    console.error('[HIPAA] Session creation error:', err.message);
  }
  
  return sessionId;
}

/**
 * Validate and refresh session
 */
async function validateSession(sessionId) {
  if (!sessionId) return null;
  
  // Check memory cache first
  const cached = sessionStore.get(sessionId);
  if (cached) {
    const timeSinceLastActivity = Date.now() - cached.lastActivity;
    if (timeSinceLastActivity > SESSION_TIMEOUT_MS) {
      sessionStore.delete(sessionId);
      return null;
    }
    cached.lastActivity = Date.now();
    return cached;
  }
  
  // Check database
  try {
    const session = await db.dbGet(
      `SELECT * FROM audit_sessions WHERE id = ? AND is_active = 1`,
      [sessionId]
    );
    
    if (!session) return null;
    
    const lastActivity = new Date(session.last_activity).getTime();
    const timeSinceLastActivity = Date.now() - lastActivity;
    
    if (timeSinceLastActivity > SESSION_TIMEOUT_MS) {
      // Session expired, mark inactive
      await db.dbRun(
        `UPDATE audit_sessions SET is_active = 0 WHERE id = ?`,
        [sessionId]
      );
      return null;
    }
    
    // Refresh last_activity
    await db.dbRun(
      `UPDATE audit_sessions SET last_activity = CURRENT_TIMESTAMP, request_count = request_count + 1 WHERE id = ?`,
      [sessionId]
    );
    
    return {
      userId: session.user_identity,
      userRole: session.user_role,
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      startTime: new Date(session.started_at).getTime(),
      lastActivity: Date.now(),
    };
  } catch (err) {
    console.error('[HIPAA] Session validation error:', err.message);
    return null;
  }
}

/**
 * Invalidate session (logout)
 */
async function invalidateSession(sessionId) {
  sessionStore.delete(sessionId);
  try {
    await db.dbRun(
      `UPDATE audit_sessions SET is_active = 0 WHERE id = ?`,
      [sessionId]
    );
  } catch (err) {
    console.error('[HIPAA] Session invalidation error:', err.message);
  }
}

/**
 * Clean up expired sessions from database
 */
async function cleanupExpiredSessions() {
  try {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
    await db.dbRun(
      `UPDATE audit_sessions SET is_active = 0
       WHERE is_active = 1 AND last_activity < ?`,
      [cutoffTime]
    );

    // Prune orphaned entries from in-memory sessionStore
    const cutoffMs = Date.now() - SESSION_TIMEOUT_MS;
    for (const [id, session] of sessionStore) {
      if (session.lastActivity < cutoffMs) {
        sessionStore.delete(id);
      }
    }
  } catch (err) {
    console.error('[HIPAA] Session cleanup error:', err.message);
  }
}

// ==========================================
// RATE LIMITING
// ==========================================

/**
 * Check rate limit for user (100 req/min normal, 500 for system agents)
 */
function checkRateLimit(userId, userRole) {
  const isSystemAgent = userRole === 'system';
  const isProvider = userRole === 'physician' || userRole === 'nurse_practitioner' || userRole === 'admin';
  const limit = isSystemAgent ? 1000 : isProvider ? 500 : 150;
  const window = 60 * 1000; // 1 minute
  
  const key = userId;
  const now = Date.now();
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + window });
    return { allowed: true, remaining: limit - 1 };
  }
  
  const data = rateLimitStore.get(key);
  
  // Reset window if expired
  if (now >= data.resetTime) {
    data.count = 1;
    data.resetTime = now + window;
    return { allowed: true, remaining: limit - 1 };
  }
  
  data.count++;
  if (data.count > limit) {
    return { allowed: false, remaining: 0, resetIn: data.resetTime - now };
  }
  
  return { allowed: true, remaining: limit - data.count };
}

// ==========================================
// REQUEST SANITIZATION
// ==========================================

/**
 * Sanitize error response - strip PHI and sensitive info
 */
// M5: Whitelist of known safe error messages (instead of blacklisting dangerous patterns)
const SAFE_ERROR_MESSAGES = new Set([
  'Invalid credentials',
  'Username and password are required',
  'Authentication required',
  'Invalid or expired token',
  'Token has been revoked',
  'Session expired',
  'Session expired. Please log in again.',
  'Insufficient permissions',
  'Not authenticated',
  'Rate limit exceeded',
  'Resource not found',
  'Validation failed',
  'Missing required fields',
  'Invalid request format',
  'Patient not found',
  'Encounter not found',
  'Audit system unavailable — request cannot be processed.',
]);

function sanitizeErrorResponse(err, isDevelopment = false) {
  if (isDevelopment) {
    return { error: err.message, stack: err.stack };
  }

  // M5: In production, only return whitelisted messages.
  // Any unrecognized error gets a generic message to prevent info leakage.
  const message = err.message || '';

  if (SAFE_ERROR_MESSAGES.has(message)) {
    return { error: message };
  }

  return { error: 'An error occurred processing your request' };
}

// SQL injection prevention: handled by parameterized queries in database.js.
// Keyword filtering was removed because it corrupts clinical text — a SOAP note
// containing "SELECT the appropriate antibiotic" would have "SELECT" stripped,
// silently destroying clinical data. Parameterized queries are the correct defense.

// ==========================================
// PHI DETECTION & LOGGING
// ==========================================

/**
 * Detect PHI fields in response data
 */
function detectPHIFields(data, depth = 0, maxDepth = 5) {
  const detected = [];
  
  if (depth > maxDepth) return detected;
  if (!data || typeof data !== 'object') return detected;
  
  const isArray = Array.isArray(data);
  const items = isArray ? data : Object.entries(data);
  
  if (isArray) {
    items.forEach(item => {
      detected.push(...detectPHIFields(item, depth + 1, maxDepth));
    });
  } else {
    items.forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      
      // Check if this key matches any PHI field
      for (const [phiKey, phiMeta] of Object.entries(PHI_FIELDS)) {
        // L4: Exact match only — bidirectional includes() caused false positives
        if (lowerKey === phiKey) {
          detected.push(phiMeta.label);
          break;
        }
      }
      
      // Recurse into nested objects/arrays
      if (typeof value === 'object' && value !== null) {
        detected.push(...detectPHIFields(value, depth + 1, maxDepth));
      }
    });
  }
  
  return [...new Set(detected)]; // Remove duplicates
}

/**
 * Log PHI access to audit_log table
 */
async function logPHIAccess(auditData) {
  try {
    const {
      sessionId,
      userId,
      userRole,
      action,
      resourceType,
      resourceId,
      patientId,
      ipAddress,
      userAgent,
      phiFields,
      requestMethod,
      requestPath,
      requestBodySummary,
      responseStatus,
      durationMs,
    } = auditData;
    
    const phiFieldsStr = phiFields && phiFields.length > 0 
      ? phiFields.join(', ') 
      : null;
    
    await db.dbRun(
      `INSERT INTO audit_log 
       (session_id, user_identity, user_role, action, resource_type, resource_id, 
        patient_id, phi_accessed, phi_fields_accessed, ip_address, user_agent, 
        request_method, request_path, request_body_summary, response_status, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        userRole,
        action,
        resourceType,
        resourceId || null,
        patientId || null,
        phiFieldsStr ? 1 : 0,
        phiFieldsStr,
        ipAddress,
        userAgent,
        requestMethod,
        requestPath,
        requestBodySummary,
        responseStatus,
        durationMs,
      ]
    );
  } catch (err) {
    // S-M8: Audit log failure must block PHI access — rethrow so callers can handle
    console.error('[HIPAA] PHI audit logging error:', err.message);
    throw err;
  }
}

// ==========================================
// MIDDLEWARE FUNCTIONS
// ==========================================

/**
 * Session tracking middleware
 * Validates existing session or creates new one
 */
function sessionTracker(req, res, next) {
  // Extract session from header or cookie
  const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;

  // Extract user info from JWT (set by auth.requireAuth middleware), session, or
  // dev-bypass header — never directly from headers in production.
  const { userId, userRole } = resolveIdentityForAudit(req);

  const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  
  // Validate existing session or create new one
  if (sessionId) {
    validateSession(sessionId).then(sessionData => {
      if (sessionData) {
        // Session valid, attach to request
        req.session = { id: sessionId, ...sessionData };
        res.setHeader('X-Session-Valid', 'true');
        next();
      } else {
        // Session expired or invalid
        res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }).catch(err => {
      console.error('[HIPAA] Session validation error:', err);
      res.status(500).json({ error: 'Session validation failed' });
    });
  } else {
    // S-M2: Only create a persisted session for authenticated requests.
    // For unauthenticated requests, assign a temporary tracking ID without persisting.
    if (req.user) {
      // Authenticated — create a real persisted session
      createSession(userId, userRole, ipAddress, userAgent).then(newSessionId => {
        req.session = {
          id: newSessionId,
          userId,
          userRole,
          ipAddress,
          userAgent,
          startTime: Date.now(),
          lastActivity: Date.now(),
        };
        res.setHeader('X-Session-Id', newSessionId);
        res.setHeader('X-Session-Timeout-Minutes', SESSION_TIMEOUT_MINUTES);
        next();
      }).catch(err => {
        console.error('[HIPAA] Session creation error:', err);
        res.status(500).json({ error: 'Failed to create session' });
      });
    } else {
      // Unauthenticated — temporary tracking ID only, no persisted session row
      const tempId = crypto.randomBytes(16).toString('hex');
      req.session = {
        id: tempId,
        userId,
        userRole,
        ipAddress,
        userAgent,
        startTime: Date.now(),
        lastActivity: Date.now(),
        temporary: true,
      };
      next();
    }
  }
}

/**
 * Security headers middleware
 * Generates a per-request nonce for CSP script-src to replace 'unsafe-inline'
 */
function securityHeaders(req, res, next) {
  // Generate nonce for this request
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  // Set static headers
  Object.entries(BASE_SECURITY_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  // Set CSP with nonce (replaces 'unsafe-inline' for scripts; styles keep 'unsafe-inline'
  // because CSS-in-JS and Tailwind require it — nonce for styles would need build tooling)
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'`
  );

  next();
}

/**
 * Rate limiting middleware
 */
function rateLimiter(req, res, next) {
  const { userId, userRole } = resolveIdentityForAudit(req);

  const rateCheck = checkRateLimit(userId, userRole);
  
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
  
  if (!rateCheck.allowed) {
    console.warn(`[HIPAA] Rate limit exceeded for user: ${userId}`);
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil(rateCheck.resetIn / 1000),
    });
    return;
  }
  
  next();
}

/**
 * Request sanitization middleware
 * Detects SQL injection, strips sensitive data from errors
 */
function requestSanitizer(req, res, next) {
  // Wrap res.json to sanitize error responses (strip stack traces, DB paths in production)
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    if (data && data.error && data.error instanceof Error) {
      const isDev = process.env.NODE_ENV !== 'production';
      data = sanitizeErrorResponse(data.error, isDev);
    }
    return originalJson(data);
  };

  next();
}

/**
 * PHI access logging middleware
 * Detects and logs any PHI accessed in responses
 */
function phiAccessLogger(req, res, next) {
  const startTime = Date.now();
  const userId = req.session?.userId || 'anonymous';
  const userRole = req.session?.userRole || 'guest';
  const sessionId = req.session?.id || null;
  const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  
  // Extract patient ID from URL if present
  const patientIdMatch = req.path.match(/\/patients\/(\d+)/);
  const patientId = patientIdMatch ? parseInt(patientIdMatch[1], 10) : null;
  
  // Summarize request body (don't log full body for privacy)
  const requestBodySummary = req.body 
    ? Object.keys(req.body).slice(0, 5).join(', ')
    : null;
  
  // Wrap res.json to capture response data
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const durationMs = Date.now() - startTime;
    
    // Detect PHI fields in response
    const phiFields = detectPHIFields(data);
    const hasPhiAccess = phiFields.length > 0;
    
    // Determine action based on method
    const actionMap = {
      'GET': 'READ',
      'POST': 'CREATE',
      'PUT': 'UPDATE',
      'PATCH': 'UPDATE',
      'DELETE': 'DELETE',
    };
    const action = actionMap[req.method] || req.method;
    
    // Determine resource type from path
    const pathParts = req.path.split('/');
    const resourceType = pathParts[2] || 'unknown';
    
    // Log to audit trail
    // S-M8: If audit logging fails, block the PHI response (return 503)
    if (hasPhiAccess || ['READ', 'UPDATE', 'DELETE'].includes(action)) {
      logPHIAccess({
        sessionId,
        userId,
        userRole,
        action,
        resourceType,
        resourceId: null,
        patientId,
        ipAddress,
        userAgent,
        phiFields: hasPhiAccess ? phiFields : [],
        requestMethod: req.method,
        requestPath: req.path,
        requestBodySummary,
        responseStatus: res.statusCode,
        durationMs,
      }).then(() => {
        return originalJson(data);
      }).catch(err => {
        console.error('[HIPAA] Failed to log PHI access — blocking response:', err.message);
        res.status(503);
        return originalJson({ error: 'Audit system unavailable — request cannot be processed.' });
      });
      return; // Response will be sent by the promise chain above
    }

    return originalJson(data);
  };
  
  next();
}

/**
 * Auto-logout on session expiry
 */
function autoLogout(req, res, next) {
  if (req.session && req.session.id) {
    // If session was invalidated, return 401
    if (!sessionStore.has(req.session.id) && !req.path.includes('/logout')) {
      return res.status(401).json({ error: 'Session expired' });
    }
  }
  next();
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Initialization
  init,
  
  // Middleware
  sessionTracker,
  securityHeaders,
  rateLimiter,
  requestSanitizer,
  phiAccessLogger,
  autoLogout,
  
  // Session management (public API)
  createSession,
  validateSession,
  invalidateSession,
  
  // Utilities (for testing/debugging)
  checkRateLimit,
  detectPHIFields,
  sanitizeErrorResponse,
  
  // Constants
  SESSION_TIMEOUT_MS,
  SESSION_TIMEOUT_MINUTES,
};
