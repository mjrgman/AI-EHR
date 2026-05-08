'use strict';

const crypto = require('crypto');
const db = require('../database');

const COOKIE_NAME = '__Host-portal_session';
const CSRF_COOKIE_NAME = '__Host-portal_csrf';
const DEFAULT_TTL_HOURS = parseInt(process.env.PATIENT_PORTAL_SESSION_TTL_HOURS || '8', 10);
const PORTAL_COOKIE_PATH = '/api/patient-portal';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((cookies, rawPart) => {
    const [name, ...rest] = rawPart.trim().split('=');
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join('='));
    return cookies;
  }, {});
}

function serializeCookie(name, value, overrides = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${overrides.path || PORTAL_COOKIE_PATH}`,
    `SameSite=${overrides.sameSite || 'Strict'}`,
  ];

  if (overrides.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (overrides.maxAge !== undefined) {
    parts.push(`Max-Age=${overrides.maxAge}`);
  }
  if (overrides.expires) {
    parts.push(`Expires=${new Date(overrides.expires).toUTCString()}`);
  }
  if (overrides.secure !== false) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function serializeCsrfCookie(token, overrides = {}) {
  return serializeCookie(CSRF_COOKIE_NAME, token, {
    ...overrides,
    httpOnly: false,
  });
}

async function createSession(patientId, req) {
  const token = crypto.randomBytes(48).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashToken(token);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await db.dbRun(
    `INSERT INTO patient_portal_sessions (session_hash, patient_id, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionHash, patientId, expiresAt, req.ip || null, req.headers['user-agent'] || null]
  );

  return {
    token,
    csrfToken,
    expiresAt,
    cookie: serializeCookie(COOKIE_NAME, token, { expires: expiresAt }),
    csrfCookie: serializeCsrfCookie(csrfToken, { expires: expiresAt }),
  };
}

async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME] || req.headers['x-portal-session'];
  if (!token) return null;

  const row = await db.dbGet(
    `SELECT * FROM patient_portal_sessions
     WHERE session_hash = ? AND revoked = 0`,
    [hashToken(token)]
  );
  if (!row) return null;

  if (new Date(row.expires_at) <= new Date()) {
    await db.dbRun('UPDATE patient_portal_sessions SET revoked = 1 WHERE id = ?', [row.id]);
    return null;
  }

  await db.dbRun(
    'UPDATE patient_portal_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
    [row.id]
  );

  return row;
}

async function revokeSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME] || req.headers['x-portal-session'];
  if (!token) return;

  await db.dbRun(
    'UPDATE patient_portal_sessions SET revoked = 1 WHERE session_hash = ?',
    [hashToken(token)]
  );
}

function clearSessionCookie() {
  return [
    serializeCookie(COOKIE_NAME, '', {
      maxAge: 0,
      expires: new Date(0).toISOString(),
    }),
    serializeCsrfCookie('', {
      maxAge: 0,
      expires: new Date(0).toISOString(),
    }),
  ];
}

function safeCompare(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requirePortalCsrf(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const csrfCookie = cookies[CSRF_COOKIE_NAME];
  const csrfHeader = req.headers['x-csrf-token'];
  if (safeCompare(csrfHeader, csrfCookie)) {
    return next();
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        return next();
      }
    } catch {
      // Fall through to explicit CSRF failure.
    }
  }

  return res.status(403).json({ error: 'Patient portal CSRF token required' });
}

function clearSessionCookieLegacy() {
  return serializeCookie(COOKIE_NAME, '', {
    maxAge: 0,
    expires: new Date(0).toISOString(),
  });
}

function attachSessionCookie(res, cookie, csrfCookie = null) {
  const cookies = Array.isArray(cookie) ? cookie : [cookie];
  if (csrfCookie) cookies.push(csrfCookie);
  res.setHeader('Set-Cookie', cookies);
}

async function requirePortalSession(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Patient portal session required' });
    }

    const patient = await db.getPatientById(session.patient_id);
    if (!patient) {
      return res.status(401).json({ error: 'Patient portal session is no longer valid' });
    }

    req.portalSession = session;
    req.portalPatient = patient;
    req.user = {
      sub: patient.id,
      username: `patient:${patient.id}`,
      role: 'patient',
      fullName: `${patient.first_name} ${patient.last_name}`.trim(),
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  COOKIE_NAME,
  CSRF_COOKIE_NAME,
  attachSessionCookie,
  clearSessionCookie,
  clearSessionCookieLegacy,
  createSession,
  getSession,
  parseCookies,
  requirePortalCsrf,
  requirePortalSession,
  revokeSession,
  serializeCookie,
};
