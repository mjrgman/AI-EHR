'use strict';

const express = require('express');
const crypto = require('crypto');
const repository = require('../repositories/patient-portal-repository');
const { processVoiceIntent, verifyPatient } = require('../integrations/patient-voice');
const { FrontDeskAgent } = require('../agents/front-desk-agent');
const {
  attachSessionCookie,
  clearSessionCookie,
  createSession,
  requirePortalSession,
  revokeSession,
} = require('../services/portal-session-service');

let toPlainLanguage;
try {
  const patientLink = require('../agents/patientlink-agent');
  toPlainLanguage = patientLink.toPlainLanguage;
} catch {
  toPlainLanguage = (text) => text || '';
}

const router = express.Router();
// P1-2 (sec-portal-weak-verify-05): MRN is a MANDATORY non-public second factor
// in ALL environments. Name + DOB (both semi-public) can never establish a
// session on their own. There is no longer an env flag to relax this — the
// requirement is enforced unconditionally and a missing/wrong MRN yields the
// same generic failure as any other verification miss (see verifyPatient).

// ------------------------------------------------------------------
// Verify rate-limiting / temporary lockout (sec-portal-weak-verify-05)
//
// /verify is a public, unauthenticated endpoint that matches on low-secrecy
// data (name + DOB, MRN optional outside production). Without throttling it is
// an identity-enumeration / account-takeover surface. We mirror the clinician
// auth lockout pattern (security/auth.js S-M7): track failed attempts per
// client IP, lock out for a fixed window after a threshold, and clear the
// counter on a successful verify. Fail closed — a locked client gets 429
// regardless of whether the supplied identity exists.
// ------------------------------------------------------------------
const verifyAttempts = new Map(); // ip -> { attempts, firstAttempt, lockedUntil }
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
const VERIFY_LOCKOUT_MS = 15 * 60 * 1000;  // 15 minutes

// Periodically prune stale entries so the map stays bounded. unref() so this
// timer never holds the process (or a test runner) open.
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of verifyAttempts) {
    if (data.lockedUntil && now >= data.lockedUntil) {
      verifyAttempts.delete(ip);
    } else if (!data.lockedUntil && now - data.firstAttempt > VERIFY_WINDOW_MS) {
      verifyAttempts.delete(ip);
    }
  }
}, VERIFY_WINDOW_MS).unref();

// ------------------------------------------------------------------
// CSRF protection for the cookie-backed portal session (sec-portal-csrf-07)
//
// The portal authenticates with an HttpOnly + SameSite=Lax cookie. SameSite=Lax
// does NOT cover cross-site state-changing requests in every browser/scenario
// (top-level navigations, certain method/redirect chains), so a synchronizer
// CSRF token is layered on top. This lives entirely in the route module — the
// shared portal-session-service is consumed read-only and is NOT modified.
//
// Model (synchronizer token):
//   - On a successful /verify, mint a random CSRF token, store it server-side
//     keyed by the session's hash (the same sha256(token) the session service
//     uses), and return it in the JSON body as `csrfToken`.
//   - State-changing portal requests (POST/PUT/PATCH/DELETE under the session
//     guard) must echo that token in the `x-portal-csrf` header. The header is
//     not a cookie, so a cross-site attacker riding the ambient session cookie
//     cannot read or set it (it requires script access to the JSON response,
//     which the same-origin policy denies cross-site).
//   - Fail closed: missing OR mismatched token -> 403. Tokens are bound to the
//     specific session, so a token from session A cannot authorize a write on
//     session B.
//
// This does NOT touch the Wave-1 verify rate-limit/lockout or the Wave-2
// mandatory-MRN verify logic — it is strictly additive.
// ------------------------------------------------------------------
const CSRF_HEADER = 'x-portal-csrf';
const csrfTokens = new Map(); // sessionHash -> { token, expiresAt }

// Replicates portal-session-service's token->hash derivation (sha256 hex) so we
// can key CSRF tokens by session WITHOUT importing/altering the shared service's
// internals. If that derivation ever changes, this must track it.
function sessionHashFor(sessionToken) {
  return crypto.createHash('sha256').update(sessionToken).digest('hex');
}

function issueCsrfToken(sessionToken, expiresAtIso) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = expiresAtIso ? new Date(expiresAtIso).getTime() : (Date.now() + 8 * 60 * 60 * 1000);
  csrfTokens.set(sessionHashFor(sessionToken), { token, expiresAt });
  return token;
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Prune expired CSRF tokens periodically; unref so this never holds the process
// (or a test runner) open.
setInterval(() => {
  const now = Date.now();
  for (const [hash, data] of csrfTokens) {
    if (!data || now >= data.expiresAt) {
      csrfTokens.delete(hash);
    }
  }
}, 15 * 60 * 1000).unref();

// CSRF guard for state-changing methods. Registered AFTER requirePortalSession,
// so req.portalSession.session_hash is always available and identifies the
// session whose CSRF token we must match. Safe methods (GET/HEAD/OPTIONS) pass
// through untouched.
function requireCsrfToken(req, res, next) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const sessionHash = req.portalSession && req.portalSession.session_hash;
  const stored = sessionHash ? csrfTokens.get(sessionHash) : null;
  const supplied = req.headers[CSRF_HEADER];

  // Fail closed on anything missing or expired.
  if (!stored || Date.now() >= stored.expiresAt) {
    return res.status(403).json({ error: 'CSRF token required. Please re-establish your session.' });
  }
  if (!supplied || !timingSafeEqualStr(supplied, stored.token)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  return next();
}

function clientIpFor(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) {
    // First hop is the originating client.
    return String(fwd).split(',')[0].trim();
  }
  return (req.ip)
    || (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || 'unknown';
}

function recordFailedVerify(ip) {
  const now = Date.now();
  let data = verifyAttempts.get(ip);
  if (!data || (now - data.firstAttempt > VERIFY_WINDOW_MS)) {
    data = { attempts: 1, firstAttempt: now, lockedUntil: null };
    verifyAttempts.set(ip, data);
    return { locked: false };
  }
  data.attempts++;
  if (data.attempts >= VERIFY_MAX_ATTEMPTS) {
    data.lockedUntil = now + VERIFY_LOCKOUT_MS;
    console.warn(`[PORTAL] Verify locked out for client ${ip} after ${data.attempts} failed attempts`);
    return { locked: true };
  }
  return { locked: false };
}

function buildLabExplanation(lab) {
  const plainName = toPlainLanguage(lab.test_name);
  let explanation = '';
  let flagLevel = 'normal';

  if (lab.abnormal_flag) {
    const flag = String(lab.abnormal_flag).toUpperCase();
    if (flag === 'H' || flag === 'HIGH') {
      flagLevel = 'abnormal';
      explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is higher than the normal range (${lab.reference_range || 'N/A'}). Your doctor will review this with you.`;
    } else if (flag === 'L' || flag === 'LOW') {
      flagLevel = 'abnormal';
      explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is lower than the normal range (${lab.reference_range || 'N/A'}). Your doctor will review this with you.`;
    } else {
      flagLevel = 'borderline';
      explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is outside the expected range (${lab.reference_range || 'N/A'}).`;
    }
  } else {
    explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is within the normal range${lab.reference_range ? ` (${lab.reference_range})` : ''}.`;
  }

  return {
    ...lab,
    plain_name: plainName,
    explanation,
    flag_level: flagLevel,
  };
}

router.post('/verify', async (req, res) => {
  try {
    const ip = clientIpFor(req);

    // sec-portal-weak-verify-05: enforce lockout BEFORE evaluating the
    // identity, so a throttled client can't keep probing. Fail closed.
    const existing = verifyAttempts.get(ip);
    if (existing && existing.lockedUntil && Date.now() < existing.lockedUntil) {
      const retryAfterSec = Math.ceil((existing.lockedUntil - Date.now()) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Too many verification attempts. Please try again later.',
        retryAfter: retryAfterSec,
      });
    }

    const { first_name, last_name, dob, mrn } = req.body || {};

    // A completely malformed request (no identifying fields at all) is a 400.
    // But once ANY identity field is supplied, we do NOT field-validate which
    // factor is missing — a missing/blank MRN is treated exactly like a wrong
    // MRN: a generic verification failure that counts toward lockout. This
    // prevents an attacker from probing "is name+DOB enough?" vs "is the MRN
    // the only thing wrong?" via differing error shapes. (sec-portal-weak-verify-05)
    if (!first_name && !last_name && !dob && !mrn) {
      return res.status(400).json({ error: 'Verification details are required.' });
    }

    // verifyPatient enforces mandatory name + DOB + MRN and applies a constant
    // delay on every path so timing/content never reveals which factor failed.
    const patient = await verifyPatient(first_name, last_name, dob, mrn);
    if (!patient) {
      // Record the failed attempt; lock out + 429 once the threshold is hit.
      const result = recordFailedVerify(ip);
      if (result.locked) {
        const retryAfterSec = Math.ceil(VERIFY_LOCKOUT_MS / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          error: 'Too many verification attempts. Please try again later.',
          retryAfter: retryAfterSec,
        });
      }
      return res.status(401).json({ error: 'Could not verify your identity. Please check your information and try again.' });
    }

    // Successful verify clears any accumulated failure counter for this client.
    verifyAttempts.delete(ip);

    const session = await createSession(patient.id, req);
    attachSessionCookie(res, session.cookie);

    // sec-portal-csrf-07: mint a CSRF token bound to this session and return it
    // in the body. The SPA stores it in memory and echoes it via the
    // x-portal-csrf header on every state-changing request.
    const csrfToken = issueCsrfToken(session.token, session.expiresAt);

    return res.json({
      verified: true,
      csrfToken,
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        name: patient.name,
      },
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await revokeSession(req);
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.json({ message: 'Patient portal session ended' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.use(requirePortalSession);
// sec-portal-csrf-07: every state-changing request past this point must carry a
// valid per-session CSRF token. Safe (GET/HEAD/OPTIONS) requests pass through.
router.use(requireCsrfToken);

router.get('/session', async (req, res) => {
  const patient = await repository.getPatientSessionProfile(req.portalPatient.id);
  // Reseed the client's CSRF token on session restore (page reload, new tab).
  // Without this, a fresh browser context has no portalCsrfToken in sessionStorage
  // and any subsequent POST (find-slots, request, refill) returns 403.
  const sessionHash = req.portalSession.session_hash;
  let entry = csrfTokens.get(sessionHash);
  if (!entry || Date.now() >= entry.expiresAt) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = req.portalSession.expires_at
      ? new Date(req.portalSession.expires_at).getTime()
      : Date.now() + 8 * 60 * 60 * 1000;
    entry = { token, expiresAt };
    csrfTokens.set(sessionHash, entry);
  }
  return res.json({
    authenticated: true,
    patient,
    expiresAt: req.portalSession.expires_at,
    csrfToken: entry.token,
  });
});

router.get('/appointments', async (req, res) => {
  try {
    const appointments = await repository.getUpcomingAppointments(req.portalPatient.id);
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load appointments' });
  }
});

router.post('/appointments/checkin', async (req, res) => {
  try {
    const { appointment_id } = req.body || {};
    if (!appointment_id) {
      return res.status(400).json({ error: 'appointment_id is required' });
    }

    const result = await repository.checkInAppointment(req.portalPatient.id, appointment_id);
    if (!result) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (result.invalidStatus) {
      return res.status(400).json({ error: `Cannot check in - appointment status is '${result.appointment.status}'` });
    }

    return res.json({ status: 'checked_in', appointment_id });
  } catch (error) {
    return res.status(500).json({ error: 'Check-in failed' });
  }
});

// ------------------------------------------------------------------
// Patient self-service appointment booking.
//
// Both endpoints sit behind requirePortalSession (registered at line 99) so
// req.portalPatient.id is always the authenticated patient — never trusted
// from a body field. Status semantics mirror the refill flow: bookings enter
// status='scheduled' (not auto-confirmed). Front-desk staff confirm via the
// existing clinician schedule UI.
//
// CSRF (sec-portal-csrf-07, resolved): these state-changing endpoints sit
// behind requireCsrfToken (registered just after requirePortalSession), so a
// valid per-session x-portal-csrf token is mandatory in addition to the
// HttpOnly + SameSite=Lax session cookie.
// ------------------------------------------------------------------

function getFrontDeskAgent() {
  // Per-request instantiation. Always use the DB-backed scheduling repository
  // for portal requests so that patient appointments persist and appear in the
  // upcoming-appointments list. (B2 fix — mock mode left appointments in memory
  // and they were invisible to getUpcomingAppointments queries.)
  const schedulingRepository = require('../repositories/scheduling-repository');
  return new FrontDeskAgent({ repository: schedulingRepository });
}

router.post('/appointments/find-slots', async (req, res) => {
  try {
    const { appointmentType, dateRangeStart, dateRangeEnd } = req.body || {};
    const agent = getFrontDeskAgent();
    const slotsResult = await agent.process(
      {
        patient: { id: req.portalPatient.id },
        requestInfo: {
          action: 'find_slots',
          appointmentType: appointmentType || 'follow_up',
          dateRangeStart: dateRangeStart ? new Date(dateRangeStart) : undefined,
          dateRangeEnd: dateRangeEnd ? new Date(dateRangeEnd) : undefined,
        },
      },
      {},
    );
    return res.json({
      slots: slotsResult.slots || [],
      slotsFound: slotsResult.slotsFound || 0,
      dateRange: slotsResult.dateRange || null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to find appointment slots' });
  }
});

router.post('/appointments/request', async (req, res) => {
  try {
    const { slotId, appointmentType, reason, chief_complaint } = req.body || {};
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }
    if (!appointmentType) {
      return res.status(400).json({ error: 'appointmentType is required' });
    }

    const agent = getFrontDeskAgent();
    const result = await agent.process(
      {
        patient: {
          id: req.portalPatient.id,
          first_name: req.portalPatient.first_name,
          last_name: req.portalPatient.last_name,
        },
        requestInfo: {
          action: 'schedule',
          slotId,
          appointmentType,
          reason: reason || 'Patient-requested appointment',
          chief_complaint: chief_complaint || null,
        },
      },
      {},
    );

    if (result.status === 'error') {
      return res.status(400).json({ error: result.message });
    }

    const appointmentId = result.appointment?.persistedId ?? result.appointmentId;
    const dateTimeStr = result.appointment?.dateTimeFormatted || result.appointment?.dateTime || 'TBD';

    // Notify staff inbox so front-desk sees the request in the Portal Inbox
    try {
      await repository.createMessage(req.portalPatient.id, {
        message_type: 'appointment_request',
        subject: `Appointment Request — ${appointmentType}`,
        content: `Patient ${req.portalPatient.first_name} ${req.portalPatient.last_name} requested a ${appointmentType} appointment for ${dateTimeStr}.${reason ? ' Reason: ' + reason : ''}`,
        status: 'pending',
        tier: 2,
      });
    } catch (msgErr) {
      // Non-fatal: appointment is booked; log and continue
      console.error('[portal] Failed to create staff inbox message for appointment request:', msgErr.message);
    }

    return res.status(201).json({
      appointment_id: appointmentId,
      status: 'scheduled',
      dateTime: result.appointment?.dateTime,
      dateTimeFormatted: result.appointment?.dateTimeFormatted,
      duration_minutes: result.appointment?.duration,
      confirmationMessage: 'Your appointment request has been submitted. ' +
                           'Our front desk will confirm shortly.',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to request appointment' });
  }
});

router.get('/medications', async (req, res) => {
  try {
    const medications = await repository.getActiveMedications(req.portalPatient.id);
    return res.json({ medications });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load medications' });
  }
});

router.get('/labs', async (req, res) => {
  try {
    const labs = await repository.getLabResults(req.portalPatient.id);
    return res.json({ labs: labs.map(buildLabExplanation) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load lab results' });
  }
});

router.get('/messages', async (req, res) => {
  try {
    const messages = await repository.getMessages(req.portalPatient.id);
    return res.json({ messages });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/message', async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const created = await repository.createMessage(req.portalPatient.id, {
      message_type: 'general',
      subject: subject || 'Message from Patient Portal',
      content: message,
      status: 'physician_review',
      tier: 2,
      sent_at: new Date().toISOString(),
    });

    return res.status(201).json({
      message_id: created.id,
      status: 'sent'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Message send failed' });
  }
});

router.post('/refill-request', async (req, res) => {
  try {
    const { medication_id, medication_name, notes } = req.body || {};
    if (!medication_name) {
      return res.status(400).json({ error: 'medication_name is required' });
    }

    const created = await repository.createMessage(req.portalPatient.id, {
      message_type: 'refill_notification',
      subject: `Refill Request: ${medication_name}`,
      content: `Patient ${req.portalPatient.first_name} ${req.portalPatient.last_name} is requesting a refill for ${medication_name}.${medication_id ? ` (Medication ID: ${medication_id})` : ''}${notes ? `\n\nPatient notes: ${notes}` : ''}`,
      plain_language_content: `Your refill request for ${medication_name} has been sent to your care team for review.`,
      status: 'physician_review',
      tier: 2,
    });

    return res.status(201).json({
      request_id: created.id,
      status: 'submitted'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Refill request failed' });
  }
});

router.post('/symptom-triage', async (req, res) => {
  try {
    const { symptoms, severity, onset, notes } = req.body || {};
    if (!symptoms) {
      return res.status(400).json({ error: 'symptoms are required' });
    }

    const severityNum = parseInt(severity, 10) || 5;
    if (severityNum < 1 || severityNum > 10) {
      return res.status(400).json({ error: 'severity must be between 1 and 10' });
    }

    let routeTo = 'ma';
    let urgency = 'routine';
    if (severityNum >= 7) {
      routeTo = 'phone_triage';
      urgency = 'stat';
    } else if (severityNum >= 4) {
      routeTo = 'phone_triage';
      urgency = 'urgent';
    }

    const created = await repository.createMessage(req.portalPatient.id, {
      message_type: 'triage',
      subject: `Symptom Report (Severity ${severityNum}/10)`,
      content: [
        `Symptoms: ${symptoms}`,
        `Severity: ${severityNum}/10`,
        onset ? `Onset: ${onset}` : null,
        notes ? `Patient notes: ${notes}` : null,
        `Routed to: ${routeTo} (${urgency})`
      ].filter(Boolean).join('\n'),
      plain_language_content: 'Your symptoms have been sent to the care team for review.',
      status: 'physician_review',
      tier: 2,
    });

    return res.status(201).json({
      triage_id: created.id,
      severity: severityNum,
      routed_to: routeTo,
      urgency,
      status: 'submitted'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Symptom submission failed' });
  }
});

router.get('/visit-prep', async (req, res) => {
  return res.json({
    checklist: [
      'Bring your insurance card and a photo ID.',
      'Bring a list of medications, vitamins, and supplements.',
      'Write down your questions or symptoms ahead of time.',
      'Bring any outside records or test results you want reviewed.',
    ]
  });
});

router.post('/voice-intent', async (req, res) => {
  try {
    const { transcript } = req.body || {};
    if (!transcript) {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const result = await processVoiceIntent(req.portalPatient.id, transcript);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
