'use strict';

const crypto = require('crypto');
const db = require('../database');

const COOKIE_NAME = 'portal_session';
const DEFAULT_TTL_HOURS = parseInt(process.env.PATIENT_PORTAL_SESSION_TTL_HOURS || '8', 10);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Parse a Cookie header into a null-prototype object.
 *
 * The accumulator is `Object.create(null)`, not `{}`, and that is the whole
 * point. A cookie name is attacker-controlled, so writing it as a property key
 * on a normal object means `Cookie: __proto__=...` writes through to
 * Object.prototype, and a lookup for a cookie named `constructor` or
 * `toString` returns an inherited function rather than undefined.
 *
 * The second matters here concretely: the caller does
 * `cookies[COOKIE_NAME] || req.headers['x-portal-session']`. Had COOKIE_NAME
 * ever collided with an inherited member, that truthy function would have been
 * treated as a session token. A null-prototype object has nothing to inherit.
 *
 * Flagged by CodeQL as js/remote-property-injection.
 */
function parseCookies(header) {
  if (!header) return Object.create(null);
  return header.split(';').reduce((cookies, rawPart) => {
    const [name, ...rest] = rawPart.trim().split('=');
    if (!name) return cookies;
    // Belt and braces: even with a null prototype, refuse the two names whose
    // presence in parsed input is never legitimate.
    if (name === '__proto__' || name === 'constructor') return cookies;
    cookies[name] = decodeURIComponent(rest.join('='));
    return cookies;
  }, Object.create(null));
}

function serializeCookie(name, value, overrides = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${overrides.path || '/'}`,
    'HttpOnly',
    `SameSite=${overrides.sameSite || 'Lax'}`,
  ];

  if (overrides.maxAge !== undefined) {
    parts.push(`Max-Age=${overrides.maxAge}`);
  }
  if (overrides.expires) {
    parts.push(`Expires=${new Date(overrides.expires).toUTCString()}`);
  }
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

async function createSession(patientId, req) {
  const token = crypto.randomBytes(48).toString('hex');
  const sessionHash = hashToken(token);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await db.dbRun(
    `INSERT INTO patient_portal_sessions (session_hash, patient_id, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionHash, patientId, expiresAt, req.ip || null, req.headers['user-agent'] || null]
  );

  return {
    token,
    expiresAt,
    cookie: serializeCookie(COOKIE_NAME, token, { expires: expiresAt }),
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
  return serializeCookie(COOKIE_NAME, '', {
    maxAge: 0,
    expires: new Date(0).toISOString(),
  });
}

function attachSessionCookie(res, cookie) {
  res.setHeader('Set-Cookie', cookie);
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
  attachSessionCookie,
  clearSessionCookie,
  createSession,
  getSession,
  parseCookies,
  requirePortalSession,
  revokeSession,
  serializeCookie,
};
