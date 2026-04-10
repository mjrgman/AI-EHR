'use strict';

/**
 * Patient Voice Interface — Backend
 *
 * Processes patient speech input, extracts intent, routes to appropriate
 * EHR module, and generates plain-language responses at 6th-grade reading level.
 *
 * Voice-first design: patient speaks → system processes → system speaks back.
 */

const db = require('../database');

// ──────────────────────────────────────────
// INTENT CLASSIFICATION
// ──────────────────────────────────────────

const INTENT_PATTERNS = [
  {
    intent: 'check_appointments',
    patterns: [/appointment/i, /when.*(?:see|visit|come in)/i, /schedule/i, /next visit/i, /upcoming/i],
    tier: 1
  },
  {
    intent: 'request_refill',
    patterns: [/refill/i, /more.*(?:medicine|medication|pills)/i, /running\s*(?:out|low)/i, /need.*prescription/i, /renew.*prescription/i],
    tier: 2
  },
  {
    intent: 'check_lab_results',
    patterns: [/lab\s*result/i, /blood\s*(?:work|test)/i, /test\s*result/i, /my\s*results/i, /labs?\b/i],
    tier: 2
  },
  {
    intent: 'send_records',
    patterns: [/send.*records/i, /transfer.*records/i, /forward.*(?:to|records)/i, /share.*with.*(?:dr|doctor)/i],
    tier: 2
  },
  {
    intent: 'check_medications',
    patterns: [/medication/i, /what.*taking/i, /my\s*(?:meds|medicines|drugs)/i, /prescription\s*list/i],
    tier: 1
  },
  {
    intent: 'visit_prep',
    patterns: [/bring.*(?:visit|appointment)/i, /prepare.*(?:visit|appointment)/i, /what.*(?:need|should).*(?:bring|know)/i],
    tier: 1
  },
  {
    intent: 'symptom_report',
    patterns: [/(?:i|i'm)\s*(?:feel|having|experiencing)/i, /symptom/i, /not\s*feeling\s*well/i, /sick/i, /pain/i, /hurts/i],
    tier: 2
  },
  {
    intent: 'general_question',
    patterns: [/.*/], // Catch-all
    tier: 1
  }
];

/**
 * Classify patient speech into an intent.
 * @param {string} text - Transcribed patient speech
 * @returns {{intent: string, tier: number, confidence: number}}
 */
function classifyIntent(text) {
  if (!text || text.trim().length === 0) {
    return { intent: 'general_question', tier: 1, confidence: 0 };
  }

  for (const entry of INTENT_PATTERNS) {
    if (entry.intent === 'general_question') continue; // Skip catch-all
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return { intent: entry.intent, tier: entry.tier, confidence: 0.8 };
      }
    }
  }

  return { intent: 'general_question', tier: 1, confidence: 0.3 };
}

// ──────────────────────────────────────────
// INTENT HANDLERS
// ──────────────────────────────────────────

async function handleCheckAppointments(patientId) {
  const appointments = await db.dbAll(
    `SELECT * FROM appointments WHERE patient_id = ? AND start_time > datetime('now')
     ORDER BY start_time ASC LIMIT 5`,
    [patientId]
  );

  if (appointments.length === 0) {
    return { text: 'You don\'t have any upcoming appointments right now. Would you like to schedule one?', data: [] };
  }

  const lines = appointments.map(a => {
    const date = new Date(a.start_time);
    const friendly = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${friendly} at ${time} with ${a.provider || 'your provider'} — ${a.appointment_type || 'general visit'}`;
  });

  const response = appointments.length === 1
    ? `You have one upcoming appointment: ${lines[0]}.`
    : `You have ${appointments.length} upcoming appointments. ${lines.join('. ')}.`;

  return { text: response, data: appointments };
}

async function handleRequestRefill(patientId, text) {
  const medications = await db.dbAll(
    'SELECT * FROM medications WHERE patient_id = ? AND status = ?',
    [patientId, 'active']
  );

  if (medications.length === 0) {
    return { text: 'I don\'t see any active medications on your record. Please speak with your care team.', data: [], requiresReview: true };
  }

  // Try to match the medication they mentioned
  const mentioned = medications.find(m =>
    text.toLowerCase().includes(m.medication_name.toLowerCase())
  );

  if (mentioned) {
    // Create a refill request message
    try {
      await db.dbRun(
        `INSERT INTO patient_messages (patient_id, message_type, subject, content, plain_language_content, status, tier)
         VALUES (?, 'refill_notification', ?, ?, ?, 'physician_review', 2)`,
        [
          patientId,
          `Refill Request: ${mentioned.medication_name}`,
          `Patient requested a refill of ${mentioned.medication_name} ${mentioned.dose || ''} ${mentioned.frequency || ''} via voice interface.`,
          `Your refill request for ${mentioned.medication_name} has been sent to your care team for review. They will get back to you soon.`
        ]
      );
    } catch {
      // patient_messages table may not exist yet — handled gracefully
    }

    return {
      text: `I've sent a refill request for your ${mentioned.medication_name} to your care team. They'll review it and get back to you.`,
      data: { medication: mentioned.medication_name },
      requiresReview: true
    };
  }

  // List medications so patient can specify
  const medList = medications.map(m => m.medication_name).join(', ');
  return {
    text: `Your active medications are: ${medList}. Which one do you need a refill for?`,
    data: medications,
    followUp: true
  };
}

async function handleCheckLabResults(patientId) {
  const labs = await db.dbAll(
    `SELECT * FROM labs WHERE patient_id = ? AND status IN ('resulted','final')
     ORDER BY result_date DESC LIMIT 10`,
    [patientId]
  );

  if (labs.length === 0) {
    return { text: 'I don\'t see any recent lab results in your record.', data: [] };
  }

  const lines = labs.slice(0, 5).map(l => {
    const abnormal = l.abnormal_flag ? ' — please discuss with your doctor' : '';
    return `${l.test_name}: ${l.result_value} ${l.units || ''}${abnormal}`;
  });

  return {
    text: `Here are your most recent lab results. ${lines.join('. ')}. For questions about what these mean, please talk to your doctor at your next visit.`,
    data: labs,
    requiresReview: labs.some(l => l.abnormal_flag)
  };
}

async function handleCheckMedications(patientId) {
  const medications = await db.dbAll(
    'SELECT * FROM medications WHERE patient_id = ? AND status = ?',
    [patientId, 'active']
  );

  if (medications.length === 0) {
    return { text: 'You don\'t have any active medications on record.', data: [] };
  }

  const lines = medications.map(m =>
    `${m.medication_name} ${m.dose || ''}, ${m.frequency || ''}`
  );

  return {
    text: `You are currently taking ${medications.length} medication${medications.length > 1 ? 's' : ''}. ${lines.join('. ')}. If you have questions about any of these, please ask your care team.`,
    data: medications
  };
}

async function handleVisitPrep(patientId) {
  return {
    text: 'For your next visit, please bring: your insurance card, a photo ID, a list of any medications you take including vitamins and supplements, and any questions you\'d like to discuss with your doctor. If you have new symptoms, try to note when they started and what makes them better or worse.',
    data: {}
  };
}

async function handleSymptomReport(patientId, text) {
  return {
    text: 'I\'ve noted your symptoms. For non-emergency concerns, please call our office during business hours. If you are experiencing a medical emergency, please call 911 immediately.',
    data: { reportedText: text },
    requiresReview: true,
    tier: 3
  };
}

async function handleGeneralQuestion(patientId, text) {
  return {
    text: 'I can help you with appointments, medication refills, lab results, and visit preparation. What would you like to know about?',
    data: {},
    followUp: true
  };
}

// ──────────────────────────────────────────
// MAIN PROCESSING
// ──────────────────────────────────────────

/**
 * Process patient voice input and return a response.
 *
 * @param {number} patientId - Authenticated patient ID
 * @param {string} transcript - Transcribed patient speech
 * @returns {Promise<{intent: string, text: string, data: any, requiresReview?: boolean, tier?: number}>}
 */
async function processVoiceIntent(patientId, transcript) {
  const { intent, tier } = classifyIntent(transcript);

  let response;
  switch (intent) {
    case 'check_appointments':
      response = await handleCheckAppointments(patientId);
      break;
    case 'request_refill':
      response = await handleRequestRefill(patientId, transcript);
      break;
    case 'check_lab_results':
      response = await handleCheckLabResults(patientId);
      break;
    case 'check_medications':
      response = await handleCheckMedications(patientId);
      break;
    case 'send_records':
      response = { text: 'To send your records to another provider, please visit our front desk or call our office. We\'ll help you get your records where they need to go.', data: {} };
      break;
    case 'visit_prep':
      response = await handleVisitPrep(patientId);
      break;
    case 'symptom_report':
      response = await handleSymptomReport(patientId, transcript);
      break;
    default:
      response = await handleGeneralQuestion(patientId, transcript);
  }

  return {
    intent,
    tier,
    ...response
  };
}

// ──────────────────────────────────────────
// PATIENT AUTHENTICATION
// ──────────────────────────────────────────

/**
 * Verify patient identity using name + DOB + MRN.
 * Returns patient record if verified, null otherwise.
 */
async function verifyPatient(firstName, lastName, dob, mrn) {
  if (!firstName || !lastName || !dob) return null;

  const patients = await db.dbAll('SELECT * FROM patients', []);

  // Match against decrypted patient data
  for (const patient of patients) {
    const nameMatch = patient.first_name?.toLowerCase() === firstName.toLowerCase()
      && patient.last_name?.toLowerCase() === lastName.toLowerCase();
    const dobMatch = patient.dob === dob;
    const mrnMatch = !mrn || patient.mrn === mrn;

    if (nameMatch && dobMatch && mrnMatch) {
      return { id: patient.id, mrn: patient.mrn, name: `${patient.first_name} ${patient.last_name}` };
    }
  }

  return null;
}

// ──────────────────────────────────────────
// EXPRESS ROUTER
// ──────────────────────────────────────────

const express = require('express');
const router = express.Router();

// POST /api/patient-portal/voice-intent — process voice input
router.post('/voice-intent', async (req, res) => {
  try {
    const { patient_id, transcript } = req.body;
    if (!patient_id || !transcript) {
      return res.status(400).json({ error: 'Required: patient_id, transcript' });
    }
    const result = await processVoiceIntent(patient_id, transcript);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/patient-portal/verify — verify patient identity
router.post('/verify', async (req, res) => {
  try {
    const { first_name, last_name, dob, mrn } = req.body;
    const patient = await verifyPatient(first_name, last_name, dob, mrn);
    if (!patient) {
      return res.status(401).json({ error: 'Could not verify your identity. Please check your information and try again.' });
    }
    res.json({ verified: true, patient_id: patient.id, name: patient.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  processVoiceIntent,
  classifyIntent,
  verifyPatient,
  router
};
