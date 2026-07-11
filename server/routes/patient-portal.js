'use strict';

const express = require('express');
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
const REQUIRE_MRN_IN_PRODUCTION =
  process.env.PATIENT_PORTAL_REQUIRE_MRN === 'true'
  || (process.env.NODE_ENV === 'production' && process.env.PATIENT_PORTAL_REQUIRE_MRN !== 'false');

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
    const { first_name, last_name, dob, mrn } = req.body || {};

    if (!first_name || !last_name || !dob) {
      return res.status(400).json({ error: 'first_name, last_name, and dob are required' });
    }
    if (REQUIRE_MRN_IN_PRODUCTION && !mrn) {
      return res.status(400).json({ error: 'mrn is required for patient portal verification in production' });
    }

    const patient = await verifyPatient(first_name, last_name, dob, mrn);
    if (!patient) {
      return res.status(401).json({
        error: 'Could not verify your identity. Please check your information and try again.',
        new_patient: {
          message: "New to the practice, or don't have a portal account yet? We can still help you get seen.",
          next_steps: [
            'Double-check that your name and date of birth match what the office has on file.',
            'If you are a new patient, submit a new-patient request and our front desk will call you to get you scheduled.',
          ],
          new_patient_request_endpoint: 'POST /api/patient-portal/new-patient-request',
        },
      });
    }

    const session = await createSession(patient.id, req);
    attachSessionCookie(res, session.cookie);

    return res.json({
      verified: true,
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

// Public new-patient intake request — for prospective patients who have no chart
// yet. Deliberately does NOT create a chart or grant portal access; it only queues
// a callback for front desk. Registered BEFORE requirePortalSession so an
// unauthenticated prospect can actually reach it (closing the new-patient dead end).
router.post('/new-patient-request', async (req, res) => {
  try {
    const { first_name, last_name, dob, phone, email, reason } = req.body || {};
    if (!first_name || !last_name || !(phone || email)) {
      return res.status(400).json({ error: 'first_name, last_name, and at least one of phone or email are required.' });
    }
    const created = await repository.createNewPatientRequest({
      first_name: String(first_name).slice(0, 100),
      last_name: String(last_name).slice(0, 100),
      dob: dob || null,
      phone: phone ? String(phone).slice(0, 20) : null,
      email: email ? String(email).slice(0, 200) : null,
      reason: reason ? String(reason).slice(0, 1000) : null,
    });
    return res.status(201).json({
      request_id: created.id,
      status: 'submitted',
      message: 'Thank you. Our front desk will call you within one business day to verify your information and schedule your first visit. If this is a medical emergency, call 911.',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Could not submit your request. Please call the office directly.' });
  }
});

router.use(requirePortalSession);

router.get('/session', async (req, res) => {
  const patient = await repository.getPatientSessionProfile(req.portalPatient.id);
  return res.json({
    authenticated: true,
    patient,
    expiresAt: req.portalSession.expires_at,
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
// CSRF: these endpoints inherit the existing portal-wide CSRF gap
// (HttpOnly + SameSite=Lax cookies only — no CSRF token validation). The
// gap predates this change and is tracked separately for follow-up.
// ------------------------------------------------------------------

function getFrontDeskAgent() {
  // Per-request instantiation. In SCHEDULER_MODE=db all state lives in the
  // appointments table, so no shared instance is needed. In mock mode each
  // request gets a fresh in-memory list — acceptable for dev because mock
  // mode is for scenario testing, not multi-user portal traffic.
  return new FrontDeskAgent();
}

router.post('/appointments/find-slots', async (req, res) => {
  try {
    const { appointmentType, appointment_type, dateRangeStart, dateRangeEnd } = req.body || {};
    const agent = getFrontDeskAgent();
    const slotsResult = await agent.process(
      {
        patient: { id: req.portalPatient.id },
        requestInfo: {
          action: 'find_slots',
          appointmentType: appointmentType || appointment_type || 'follow_up',
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
    const { slotId, reason, chief_complaint } = req.body || {};
    // Accept camelCase or snake_case, and default to the same type find-slots
    // defaults to, so a patient who just echoes a slotId isn't blocked.
    const appointmentType = req.body.appointmentType || req.body.appointment_type || 'follow_up';
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
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

    return res.status(201).json({
      appointment_id: result.appointment?.persistedId ?? result.appointmentId,
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
      status: 'submitted',
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
    const { medication_id, notes } = req.body || {};
    let { medication_name } = req.body || {};
    // Accept medication_id (the identifier the medications list actually returns)
    // and resolve it to the drug name, so patients aren't forced to retype names.
    if (!medication_name && medication_id != null) {
      const meds = await repository.getActiveMedications(req.portalPatient.id);
      const found = meds.find((m) => String(m.id) === String(medication_id));
      if (found) medication_name = found.medication_name;
    }
    if (!medication_name) {
      return res.status(400).json({ error: 'Provide medication_id (from your medications list) or medication_name.' });
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

    // Give the patient explicit next steps, not just a routing label — an "urgent"
    // result that only returns a status is a dead end for someone who feels unwell.
    const guidance = urgency === 'stat'
      ? {
          headline: 'Your symptoms may need prompt attention.',
          instructions: [
            'If this is a medical emergency — chest pain, trouble breathing, one-sided weakness, severe bleeding — call 911 now.',
            'Otherwise, please call the office right away; our triage nurse will speak with you today.',
          ],
        }
      : urgency === 'urgent'
        ? {
            headline: 'We want to check on you today.',
            instructions: [
              'Please call the office today so our triage nurse can follow up with you.',
              'If your symptoms suddenly get worse, call 911.',
            ],
          }
        : {
            headline: 'Your report has been sent to your care team.',
            instructions: [
              'Our team will review it and follow up, usually within one to two business days.',
              'Please call the office if your symptoms get worse in the meantime.',
            ],
          };
    return res.status(201).json({
      triage_id: created.id,
      severity: severityNum,
      routed_to: routeTo,
      urgency,
      status: 'submitted',
      guidance,
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
