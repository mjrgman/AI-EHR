'use strict';

const crypto = require('crypto');
const db = require('../database');

const COOKIE_NAME = 'portal_session';
const DEFAULT_TTL_HOURS = parseInt(process.env.PATIENT_PORTAL_SESSION_TTL_HOURS || '8', 10);

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
