'use strict';

/**
 * Patient Voice Interface backend helpers.
 *
 * This module classifies patient requests and produces plain-language
 * responses for the portal voice assistant. Route handling lives in
 * server/routes/patient-portal.js so portal session enforcement is
 * centralized in one place.
 */

const db = require('../database');

const INTENT_PATTERNS = [
  {
    // request_appointment must come BEFORE check_appointments — both match on
    // /appointment/i and /schedule/i, but the verb-based patterns here are
    // narrower (book/request/make/new) so we route them before the broader
    // upcoming-visits check.
    intent: 'request_appointment',
    patterns: [
      /(?:book|schedule|make|set\s*up|need|request|want).*?(?:appointment|visit)/i,
      /(?:appointment|visit).*?(?:please|can you|i need|i want)/i,
      /new\s+appointment/i,
      /come\s+in\s+(?:for|to)/i,
    ],
    tier: 1
  },
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
    patterns: [/.*/],
    tier: 1
  }
];

function classifyIntent(text) {
  if (!text || text.trim().length === 0) {
    return { intent: 'general_question', tier: 1, confidence: 0 };
  }

  for (const entry of INTENT_PATTERNS) {
    if (entry.intent === 'general_question') continue;
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return { intent: entry.intent, tier: entry.tier, confidence: 0.8 };
      }
    }
  }

  return { intent: 'general_question', tier: 1, confidence: 0.3 };
}

async function handleRequestAppointment() {
  // The voice path returns guidance only — actual booking happens via the
  // POST /api/patient-portal/appointments/request endpoint, which carries
  // the slotId selection from the UI. Booking via voice without a UI slot
  // picker would require parsing dates/times from natural language, which
  // is a separate effort.
  return {
    text: 'I can help you schedule an appointment. Please use the Appointments tab in your portal ' +
          'to pick a time that works — I will route the request to our front desk for confirmation.',
    data: {
      next_action: 'open_appointments_tab',
      endpoint: '/api/patient-portal/appointments/find-slots',
    },
    followUp: true,
  };
}

async function handleCheckAppointments(patientId) {
  const appointments = await db.dbAll(
    `SELECT id, provider_name, appointment_date, appointment_time, appointment_type, status
     FROM appointments
     WHERE patient_id = ?
       AND appointment_date >= date('now')
       AND status NOT IN ('cancelled', 'no-show')
     ORDER BY appointment_date ASC, appointment_time ASC
     LIMIT 5`,
    [patientId]
  );

  if (appointments.length === 0) {
    return { text: 'You do not have any upcoming appointments right now. Would you like to schedule one?', data: [] };
  }

  const lines = appointments.map((appointment) => {
    const friendly = new Date(`${appointment.appointment_date}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const time = new Date(`1970-01-01T${appointment.appointment_time}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${friendly} at ${time} with ${appointment.provider_name || 'your provider'} - ${appointment.appointment_type || 'general visit'}`;
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
    return {
      text: 'I do not see any active medications on your record. Please speak with your care team.',
      data: [],
      requiresReview: true
    };
  }

  const mentioned = medications.find((medication) =>
    text.toLowerCase().includes(medication.medication_name.toLowerCase())
  );

  if (mentioned) {
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

    return {
      text: `I have sent a refill request for your ${mentioned.medication_name} to your care team. They will review it and get back to you.`,
      data: { medication: mentioned.medication_name },
      requiresReview: true
    };
  }

  const medicationList = medications.map((medication) => medication.medication_name).join(', ');
  return {
    text: `Your active medications are: ${medicationList}. Which one do you need a refill for?`,
    data: medications,
    followUp: true
  };
}

async function handleCheckLabResults(patientId) {
  const labs = await db.dbAll(
    `SELECT * FROM labs
     WHERE patient_id = ? AND status IN ('resulted','final')
     ORDER BY result_date DESC
     LIMIT 10`,
    [patientId]
  );

  if (labs.length === 0) {
    return { text: 'I do not see any recent lab results in your record.', data: [] };
  }

  const lines = labs.slice(0, 5).map((lab) => {
    const abnormal = lab.abnormal_flag ? ' - please discuss with your doctor' : '';
    return `${lab.test_name}: ${lab.result_value} ${lab.units || ''}${abnormal}`;
  });

  return {
    text: `Here are your most recent lab results. ${lines.join('. ')}. For questions about what these mean, please talk to your doctor at your next visit.`,
    data: labs,
    requiresReview: labs.some((lab) => lab.abnormal_flag)
  };
}

async function handleCheckMedications(patientId) {
  const medications = await db.dbAll(
    'SELECT * FROM medications WHERE patient_id = ? AND status = ?',
    [patientId, 'active']
  );

  if (medications.length === 0) {
    return { text: 'You do not have any active medications on record.', data: [] };
  }

  const lines = medications.map((medication) =>
    `${medication.medication_name} ${medication.dose || ''}, ${medication.frequency || ''}`
  );

  return {
    text: `You are currently taking ${medications.length} medication${medications.length > 1 ? 's' : ''}. ${lines.join('. ')}. If you have questions about any of these, please ask your care team.`,
    data: medications
  };
}

async function handleVisitPrep() {
  return {
    text: 'For your next visit, please bring your insurance card, a photo ID, a list of all medications and supplements, and any questions you would like to discuss with your doctor.',
    data: {}
  };
}

async function handleSymptomReport(patientId, text) {
  await db.dbRun(
    `INSERT INTO patient_messages (patient_id, message_type, subject, content, plain_language_content, status, tier)
     VALUES (?, 'triage', ?, ?, ?, 'physician_review', 2)`,
    [
      patientId,
      'Voice Symptom Report',
      text,
      'Your symptoms have been sent to the care team for review.'
    ]
  );

  return {
    text: 'I have noted your symptoms. For non-emergency concerns, your care team will review this and follow up. If you are having a medical emergency, call 911 right away.',
    data: { reportedText: text },
    requiresReview: true,
    tier: 3
  };
}

async function handleGeneralQuestion() {
  return {
    text: 'I can help you with appointments, medication refills, lab results, and visit preparation. What would you like to know about?',
    data: {},
    followUp: true
  };
}

async function processVoiceIntent(patientId, transcript) {
  const { intent, tier } = classifyIntent(transcript);

  let response;
  switch (intent) {
    case 'request_appointment':
      response = await handleRequestAppointment();
      break;
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
      response = {
        text: 'To send your records to another provider, please contact our office and we will help route them securely.',
        data: {}
      };
      break;
    case 'visit_prep':
      response = await handleVisitPrep(patientId);
      break;
    case 'symptom_report':
      response = await handleSymptomReport(patientId, transcript);
      break;
    default:
      response = await handleGeneralQuestion(patientId, transcript);
      break;
  }

  return {
    intent,
    tier,
    ...response
  };
}

async function verifyPatient(firstName, lastName, dob, mrn) {
  if (!firstName || !lastName || !dob) return null;

  const patients = await db.getAllPatients();
  for (const patient of patients) {
    const nameMatch = patient.first_name?.toLowerCase() === firstName.toLowerCase()
      && patient.last_name?.toLowerCase() === lastName.toLowerCase();
    const dobMatch = patient.dob === dob;
    const mrnMatch = !mrn || patient.mrn === mrn;

    if (nameMatch && dobMatch && mrnMatch) {
      return {
        id: patient.id,
        mrn: patient.mrn,
        name: `${patient.first_name} ${patient.last_name}`.trim()
      };
    }
  }

  return null;
}

module.exports = {
  classifyIntent,
  processVoiceIntent,
  verifyPatient
};
