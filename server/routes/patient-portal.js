'use strict';

/**
 * Patient Portal API Routes
 *
 * Patient-facing endpoints for self-service: registration, appointments,
 * medications, lab results, messaging, symptom triage, and refill requests.
 *
 * CATC Three-Tier Autonomy:
 *   Tier 1 (Full Autonomy)  — read-only lookups, check-in, registration
 *   Tier 2 (Supervised)     — refill requests, lab explanations, symptom triage, messaging
 */

const express = require('express');
const router = express.Router();
const { dbRun, dbGet, dbAll, generateMRN } = require('../database');

// Try to load toPlainLanguage from PatientLink agent for lab explanations
let toPlainLanguage;
try {
  const patientLink = require('../agents/patientlink-agent');
  toPlainLanguage = patientLink.toPlainLanguage;
} catch (err) {
  // Fallback: return text as-is if PatientLink agent is unavailable
  toPlainLanguage = (text) => text || '';
}

// ==========================================
// POST /register — Patient self-registration
// Tier 1 (Full Autonomy)
// ==========================================

router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, dob, email, phone, insurance_provider, insurance_id } = req.body;

    if (!first_name || !last_name || !dob) {
      return res.status(400).json({ error: 'first_name, last_name, and dob are required' });
    }

    // Check for existing patient by name + DOB match (prevents duplicates)
    const existing = await dbGet(
      `SELECT id, mrn FROM patients
       WHERE first_name = ? AND last_name = ? AND dob = ?`,
      [first_name, last_name, dob]
    );

    if (existing) {
      return res.json({
        patient_id: existing.id,
        mrn: existing.mrn,
        status: 'already_registered'
      });
    }

    // Generate MRN and create patient record
    const mrn = generateMRN();
    const result = await dbRun(
      `INSERT INTO patients (mrn, first_name, last_name, dob, email, phone, insurance_carrier, insurance_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mrn, first_name, last_name, dob, email || null, phone || null,
       insurance_provider || null, insurance_id || null]
    );

    res.status(201).json({
      patient_id: result.lastID,
      mrn,
      status: 'registered'
    });
  } catch (err) {
    console.error('[PatientPortal] Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==========================================
// GET /appointments/:patientId — Upcoming appointments
// Tier 1 (Full Autonomy)
// ==========================================

router.get('/appointments/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;

    const appointments = await dbAll(
      `SELECT a.id, a.provider_name, a.appointment_date, a.appointment_time,
              a.duration_minutes, a.appointment_type, a.status, a.chief_complaint, a.notes
       FROM appointments a
       WHERE a.patient_id = ?
         AND a.appointment_date >= date('now')
         AND a.status NOT IN ('cancelled', 'no-show')
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
      [patientId]
    );

    res.json({ appointments });
  } catch (err) {
    console.error('[PatientPortal] Appointments fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load appointments' });
  }
});

// ==========================================
// POST /appointments/:patientId/checkin — Self check-in
// Tier 1 (Full Autonomy)
// ==========================================

router.post('/appointments/:patientId/checkin', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { appointment_id } = req.body;

    if (!appointment_id) {
      return res.status(400).json({ error: 'appointment_id is required' });
    }

    // Verify appointment belongs to this patient and is today
    const appt = await dbGet(
      `SELECT id, status, appointment_date FROM appointments
       WHERE id = ? AND patient_id = ?`,
      [appointment_id, patientId]
    );

    if (!appt) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appt.status === 'checked-in') {
      return res.json({ status: 'already_checked_in', appointment_id });
    }

    if (appt.status !== 'scheduled' && appt.status !== 'confirmed') {
      return res.status(400).json({
        error: `Cannot check in — appointment status is '${appt.status}'`
      });
    }

    await dbRun(
      `UPDATE appointments SET status = 'checked-in', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [appointment_id]
    );

    // Also update workflow_state if an encounter exists
    await dbRun(
      `UPDATE workflow_state SET current_state = 'checked-in', check_in_time = CURRENT_TIMESTAMP
       WHERE encounter_id = (SELECT encounter_id FROM appointments WHERE id = ?)`,
      [appointment_id]
    ).catch(() => {}); // Silently skip if no workflow_state row

    res.json({ status: 'checked_in', appointment_id });
  } catch (err) {
    console.error('[PatientPortal] Check-in error:', err.message);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// ==========================================
// POST /refill-request — Request medication refill
// Tier 2 (Supervised — physician review required)
// ==========================================

router.post('/refill-request', async (req, res) => {
  try {
    const { patient_id, medication_id, medication_name, notes } = req.body;

    if (!patient_id || !medication_name) {
      return res.status(400).json({ error: 'patient_id and medication_name are required' });
    }

    // Verify patient exists
    const patient = await dbGet('SELECT id, first_name, last_name FROM patients WHERE id = ?', [patient_id]);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const subject = `Refill Request: ${medication_name}`;
    const content = `Patient ${patient.first_name} ${patient.last_name} is requesting a refill for ${medication_name}.${
      medication_id ? ` (Medication ID: ${medication_id})` : ''
    }${notes ? `\n\nPatient notes: ${notes}` : ''}`;

    const result = await dbRun(
      `INSERT INTO patient_messages (patient_id, message_type, subject, content, status, tier)
       VALUES (?, 'refill_notification', ?, ?, 'physician_review', 2)`,
      [patient_id, subject, content]
    );

    res.status(201).json({
      request_id: result.lastID,
      status: 'submitted'
    });
  } catch (err) {
    console.error('[PatientPortal] Refill request error:', err.message);
    res.status(500).json({ error: 'Refill request failed' });
  }
});

// ==========================================
// GET /labs/:patientId — Lab results with plain-language explanations
// Tier 2 (Supervised)
// ==========================================

router.get('/labs/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;

    const labs = await dbAll(
      `SELECT id, test_name, result_value, reference_range, units, result_date,
              status, abnormal_flag, notes
       FROM labs
       WHERE patient_id = ?
       ORDER BY result_date DESC`,
      [patientId]
    );

    // Enhance each result with plain-language explanation and abnormal flag
    const enriched = labs.map(lab => {
      const plainName = toPlainLanguage(lab.test_name);
      let explanation = '';
      let flagLevel = 'normal'; // normal | borderline | abnormal

      if (lab.abnormal_flag) {
        const flag = lab.abnormal_flag.toUpperCase();
        if (flag === 'H' || flag === 'HIGH') {
          flagLevel = 'abnormal';
          explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is higher than the normal range (${lab.reference_range || 'N/A'}). Your doctor will review this with you.`;
        } else if (flag === 'L' || flag === 'LOW') {
          flagLevel = 'abnormal';
          explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is lower than the normal range (${lab.reference_range || 'N/A'}). Your doctor will review this with you.`;
        } else if (flag === 'A' || flag === 'ABNORMAL') {
          flagLevel = 'abnormal';
          explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is outside the normal range (${lab.reference_range || 'N/A'}). Your doctor will review this with you.`;
        } else {
          flagLevel = 'borderline';
          explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is slightly outside the expected range (${lab.reference_range || 'N/A'}).`;
        }
      } else {
        explanation = `Your ${plainName} result (${lab.result_value} ${lab.units || ''}) is within the normal range${lab.reference_range ? ` (${lab.reference_range})` : ''}.`;
      }

      return {
        ...lab,
        plain_name: plainName,
        explanation,
        flag_level: flagLevel
      };
    });

    res.json({ labs: enriched });
  } catch (err) {
    console.error('[PatientPortal] Labs fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load lab results' });
  }
});

// ==========================================
// GET /medications/:patientId — Active medications
// Tier 1 (Full Autonomy)
// ==========================================

router.get('/medications/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;

    const medications = await dbAll(
      `SELECT m.id, m.medication_name, m.generic_name, m.dose, m.route, m.frequency,
              m.start_date, m.end_date, m.status, m.prescriber
       FROM medications m
       WHERE m.patient_id = ? AND m.status = 'active'
       ORDER BY m.medication_name ASC`,
      [patientId]
    );

    // Check for recent refill requests per medication
    const enriched = await Promise.all(medications.map(async (med) => {
      const lastRefill = await dbGet(
        `SELECT created_at, status FROM patient_messages
         WHERE patient_id = ? AND message_type = 'refill_notification'
           AND content LIKE ?
         ORDER BY created_at DESC LIMIT 1`,
        [patientId, `%${med.medication_name}%`]
      );

      return {
        ...med,
        last_refill_request: lastRefill ? lastRefill.created_at : null,
        refill_status: lastRefill ? lastRefill.status : null
      };
    }));

    res.json({ medications: enriched });
  } catch (err) {
    console.error('[PatientPortal] Medications fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load medications' });
  }
});

// ==========================================
// POST /symptom-triage — Submit symptoms for triage
// Tier 2 (Supervised — routes to appropriate module)
// ==========================================

router.post('/symptom-triage', async (req, res) => {
  try {
    const { patient_id, symptoms, severity, onset, notes } = req.body;

    if (!patient_id || !symptoms) {
      return res.status(400).json({ error: 'patient_id and symptoms are required' });
    }

    const severityNum = parseInt(severity, 10) || 5;
    if (severityNum < 1 || severityNum > 10) {
      return res.status(400).json({ error: 'severity must be between 1 and 10' });
    }

    // Verify patient exists
    const patient = await dbGet('SELECT id, first_name, last_name FROM patients WHERE id = ?', [patient_id]);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Determine routing based on severity
    // 1-3: low — MA can handle (vitals recheck, patient education)
    // 4-6: moderate — phone triage by nurse/MA
    // 7-10: high — urgent phone triage, may need same-day visit
    let routeTo, urgency;
    if (severityNum <= 3) {
      routeTo = 'ma';
      urgency = 'routine';
    } else if (severityNum <= 6) {
      routeTo = 'phone_triage';
      urgency = 'urgent';
    } else {
      routeTo = 'phone_triage';
      urgency = 'stat';
    }

    const subject = `Symptom Report (Severity ${severityNum}/10) — ${patient.first_name} ${patient.last_name}`;
    const content = [
      `Symptoms: ${symptoms}`,
      `Severity: ${severityNum}/10`,
      onset ? `Onset: ${onset}` : null,
      notes ? `Patient notes: ${notes}` : null,
      `\nRouted to: ${routeTo} (${urgency})`
    ].filter(Boolean).join('\n');

    const result = await dbRun(
      `INSERT INTO patient_messages (patient_id, message_type, subject, content, status, tier)
       VALUES (?, 'general', ?, ?, 'physician_review', 2)`,
      [patient_id, subject, content]
    );

    res.status(201).json({
      triage_id: result.lastID,
      severity: severityNum,
      routed_to: routeTo,
      urgency,
      status: 'submitted'
    });
  } catch (err) {
    console.error('[PatientPortal] Symptom triage error:', err.message);
    res.status(500).json({ error: 'Symptom submission failed' });
  }
});

// ==========================================
// POST /message — Send secure message to care team
// Tier 2 (Supervised)
// ==========================================

router.post('/message', async (req, res) => {
  try {
    const { patient_id, subject, message } = req.body;

    if (!patient_id || !message) {
      return res.status(400).json({ error: 'patient_id and message are required' });
    }

    // Verify patient exists
    const patient = await dbGet('SELECT id FROM patients WHERE id = ?', [patient_id]);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const result = await dbRun(
      `INSERT INTO patient_messages (patient_id, message_type, subject, content, status, tier)
       VALUES (?, 'general', ?, ?, 'draft', 2)`,
      [patient_id, subject || 'Message from Patient Portal', message]
    );

    res.status(201).json({
      message_id: result.lastID,
      status: 'sent'
    });
  } catch (err) {
    console.error('[PatientPortal] Message send error:', err.message);
    res.status(500).json({ error: 'Message send failed' });
  }
});

// ==========================================
// GET /messages/:patientId — Get patient messages (for portal display)
// Tier 1
// ==========================================

router.get('/messages/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;

    const messages = await dbAll(
      `SELECT id, message_type, subject, content, plain_language_content,
              status, tier, created_at, sent_at
       FROM patient_messages
       WHERE patient_id = ?
       ORDER BY created_at DESC`,
      [patientId]
    );

    res.json({ messages });
  } catch (err) {
    console.error('[PatientPortal] Messages fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

module.exports = router;
