/**
 * Agentic EHR PatientLink Agent
 * Patient communication module — drafts messages, after-visit summaries,
 * care gap outreach, and manages the patient message lifecycle.
 *
 * Capabilities:
 *   - Draft patient messages (after-visit summary, lab results, appointment reminders, etc.)
 *   - Generate plain-language after-visit summaries from encounter data
 *   - Create care gap outreach messages
 *   - Track message status through draft → physician_review → approved → sent → read
 *   - Template-based plain-language conversion (6th-grade reading level)
 *
 * CATC Three-Tier Autonomy:
 *   Tier 2 (Supervised) — messages drafted autonomously, physician reviews before send.
 *   After-visit summaries are Tier 3 (physician-in-the-loop) and require explicit approval.
 */

const { BaseAgent, AUTONOMY_TIER } = require('./base-agent');
const { dbRun, dbGet, dbAll, getPatientById, getEncounterById,
        getPatientMedications, getPatientProblems, getPatientLabs } = require('../database');
const { isClaudeEnabled } = require('../ai-client');

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

const INIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS patient_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  encounter_id INTEGER,
  message_type TEXT NOT NULL,
  subject TEXT,
  content TEXT NOT NULL,
  plain_language_content TEXT,
  status TEXT CHECK(status IN ('draft','physician_review','approved','sent','read')) DEFAULT 'draft',
  tier INTEGER DEFAULT 2,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  sent_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
)`;

// Create table on module load
dbRun(INIT_TABLE_SQL).catch(err => {
  console.error('[PatientLink] Failed to initialize patient_messages table:', err.message);
});

// ==========================================
// VALID MESSAGE TYPES
// ==========================================

const MESSAGE_TYPES = [
  'after_visit_summary',
  'lab_result',
  'appointment_reminder',
  'care_gap_outreach',
  'refill_notification',
  'general'
];

const MESSAGE_STATUSES = ['draft', 'physician_review', 'approved', 'sent', 'read'];

// ==========================================
// PLAIN-LANGUAGE CONVERSION
// ==========================================

/**
 * Medical terminology → plain-language mapping.
 * Target: 6th-grade reading level.
 */
const MEDICAL_TERM_MAP = {
  'hypertension': 'high blood pressure',
  'hyperlipidemia': 'high cholesterol',
  'diabetes mellitus': 'diabetes (high blood sugar)',
  'type 2 diabetes mellitus': 'type 2 diabetes (high blood sugar)',
  'hypothyroidism': 'underactive thyroid',
  'hyperthyroidism': 'overactive thyroid',
  'gastroesophageal reflux': 'acid reflux (heartburn)',
  'GERD': 'acid reflux (heartburn)',
  'osteoarthritis': 'arthritis (joint wear and tear)',
  'chronic kidney disease': 'kidney problems',
  'congestive heart failure': 'heart not pumping well enough',
  'atrial fibrillation': 'irregular heartbeat',
  'COPD': 'lung disease that makes breathing hard',
  'chronic obstructive pulmonary disease': 'lung disease that makes breathing hard',
  'pneumonia': 'lung infection',
  'urinary tract infection': 'bladder infection',
  'UTI': 'bladder infection',
  'benign prostatic hyperplasia': 'enlarged prostate',
  'BPH': 'enlarged prostate',
  'anemia': 'low red blood cells (can cause tiredness)',
  'dyslipidemia': 'unhealthy cholesterol levels',
  'peripheral neuropathy': 'nerve damage in hands or feet (tingling or numbness)',
  'edema': 'swelling',
  'tachycardia': 'fast heart rate',
  'bradycardia': 'slow heart rate',
  'hemoglobin A1C': 'average blood sugar over 3 months (A1C test)',
  'A1C': 'average blood sugar test',
  'lipid panel': 'cholesterol test',
  'CBC': 'blood count test',
  'complete blood count': 'blood count test',
  'CMP': 'basic body chemistry test',
  'comprehensive metabolic panel': 'basic body chemistry test',
  'TSH': 'thyroid test',
  'creatinine': 'kidney function test',
  'eGFR': 'kidney function number',
  'BUN': 'kidney waste test',
  'prognosis': 'what to expect going forward',
  'contraindicated': 'should not be used',
  'prophylaxis': 'prevention',
  'etiology': 'cause',
  'PRN': 'as needed',
  'BID': 'twice a day',
  'TID': 'three times a day',
  'QID': 'four times a day',
  'QD': 'once a day',
  'PO': 'by mouth',
  'sublingual': 'under the tongue',
  'subcutaneous': 'injected under the skin',
  'intramuscular': 'injected into the muscle'
};

/**
 * Convert clinical text to plain language at approximately 6th-grade reading level.
 * Uses term replacement, sentence simplification, and jargon removal.
 *
 * @param {string} text - Clinical text to convert
 * @returns {string} Plain-language version
 */
function toPlainLanguage(text) {
  if (!text) return '';

  let plain = text;

  // Replace medical terms (case-insensitive, longest match first)
  const sortedTerms = Object.entries(MEDICAL_TERM_MAP)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [medical, simple] of sortedTerms) {
    const escaped = medical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    plain = plain.replace(regex, simple);
  }

  // Strip common clinical abbreviations that weren't caught
  plain = plain.replace(/\b(?:hx|dx|tx|rx|sx|fx)\b/gi, (match) => {
    const map = { hx: 'history', dx: 'diagnosis', tx: 'treatment', rx: 'prescription', sx: 'symptoms', fx: 'fracture' };
    return map[match.toLowerCase()] || match;
  });

  // Simplify sentence starters
  plain = plain.replace(/\bthe patient\b/gi, 'you');
  plain = plain.replace(/\bpatient\b/gi, 'you');
  plain = plain.replace(/\bphysician recommends\b/gi, 'your doctor recommends');
  plain = plain.replace(/\bprovider\b/gi, 'your doctor');

  return plain;
}

// ==========================================
// TEMPLATE GENERATORS
// ==========================================

/**
 * Generate subject line based on message type.
 */
function generateSubject(messageType, context = {}) {
  const subjects = {
    after_visit_summary: `Your Visit Summary — ${context.visitDate || 'Recent Visit'}`,
    lab_result: `Your Lab Results Are Ready — ${context.testName || 'Recent Test'}`,
    appointment_reminder: `Appointment Reminder — ${context.appointmentDate || 'Upcoming'}`,
    care_gap_outreach: 'Important Health Reminder From Your Doctor',
    refill_notification: `Medication Refill Update — ${context.medicationName || 'Your Medication'}`,
    general: context.subject || 'A Message From Your Doctor\'s Office'
  };
  return subjects[messageType] || subjects.general;
}

/**
 * Generate after-visit summary from encounter data using templates.
 * Plain language, 6th-grade reading level.
 */
function buildAfterVisitSummary(encounter, patient, medications, problems, labs) {
  const patientName = patient ? `${patient.first_name}` : 'there';
  const visitDate = encounter?.encounter_date
    ? new Date(encounter.encounter_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'your recent visit';
  const visitType = encounter?.encounter_type || 'office visit';
  const chiefComplaint = encounter?.chief_complaint || '';

  const sections = [];

  // Header
  sections.push(`Hi ${patientName},`);
  sections.push('');
  sections.push(`Here is a summary of your ${visitType} on ${visitDate}.`);

  // Reason for visit
  if (chiefComplaint) {
    sections.push('');
    sections.push(`WHY YOU CAME IN: ${toPlainLanguage(chiefComplaint)}`);
  }

  // Active problems discussed
  const activeProblems = (problems || []).filter(p => p.status === 'active');
  if (activeProblems.length > 0) {
    sections.push('');
    sections.push('WHAT WE TALKED ABOUT:');
    for (const prob of activeProblems) {
      sections.push(`  - ${toPlainLanguage(prob.problem_name)}`);
    }
  }

  // Current medications
  const activeMeds = (medications || []).filter(m => m.status === 'active');
  if (activeMeds.length > 0) {
    sections.push('');
    sections.push('YOUR CURRENT MEDICATIONS:');
    for (const med of activeMeds) {
      const dose = med.dose ? ` ${med.dose}` : '';
      const freq = med.frequency ? ` — ${toPlainLanguage(med.frequency)}` : '';
      sections.push(`  - ${med.medication_name}${dose}${freq}`);
    }
  }

  // Recent lab results
  const recentLabs = (labs || []).slice(0, 5);
  if (recentLabs.length > 0) {
    sections.push('');
    sections.push('YOUR RECENT TEST RESULTS:');
    for (const lab of recentLabs) {
      const flag = lab.abnormal_flag ? ' (your doctor will discuss this with you)' : ' (normal)';
      sections.push(`  - ${toPlainLanguage(lab.test_name)}: ${lab.result_value} ${lab.units || ''}${flag}`);
    }
  }

  // Closing
  sections.push('');
  sections.push('WHAT TO DO NEXT:');
  sections.push('  - Take your medications as directed.');
  sections.push('  - Follow up with your doctor if you have questions or if anything gets worse.');
  sections.push('  - Call the office if you need to schedule a follow-up visit.');
  sections.push('');
  sections.push('If you have any questions, please call our office. We are here to help.');

  return sections.join('\n');
}

/**
 * Generate a care gap outreach message for a patient.
 */
function buildCareGapMessage(patientName, gaps) {
  const sections = [];

  sections.push(`Hi ${patientName},`);
  sections.push('');
  sections.push('We are reaching out because our records show you may be due for some important health care:');
  sections.push('');

  for (const gap of gaps) {
    const dueInfo = gap.due_date ? ` (due by ${new Date(gap.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})` : '';
    sections.push(`  - ${toPlainLanguage(gap.description)}${dueInfo}`);
  }

  sections.push('');
  sections.push('Staying on top of these items helps keep you healthy. Please call our office to schedule an appointment or ask any questions.');
  sections.push('');
  sections.push('We look forward to hearing from you.');

  return sections.join('\n');
}

// ==========================================
// PATIENTLINK AGENT CLASS
// ==========================================

class PatientLinkAgent extends BaseAgent {
  constructor(options = {}) {
    super('patient_link', {
      description: 'Patient communication — messages, after-visit summaries, care gap outreach',
      dependsOn: ['scribe', 'cds', 'quality'],
      priority: 55,
      autonomyTier: AUTONOMY_TIER.TIER_2,
      ...options
    });
  }

  /**
   * Process encounter context and generate any pending patient communications.
   * Called by the orchestrator as part of the agent pipeline.
   *
   * @param {PatientContext} context
   * @param {Object} agentResults - Results from upstream agents
   * @returns {Promise<Object>} PatientLink result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;
    const encounterId = context.encounter?.id;

    if (!patientId) {
      return { messages: [], summary: null, error: 'No patient in context' };
    }

    const result = {
      messages: [],
      summary: null,
      pendingReview: 0,
      careGapOutreach: null
    };

    // Auto-generate after-visit summary if encounter is finishing
    const encounterStatus = context.encounter?.status;
    if (encounterId && (encounterStatus === 'completed' || encounterStatus === 'signed')) {
      try {
        const summary = await this.generateAfterVisitSummary(encounterId);
        result.summary = summary;
        this.audit('recommendation', {
          action: 'after_visit_summary_generated',
          encounterId,
          messageId: summary.id
        }, context);
      } catch (err) {
        result.summaryError = err.message;
      }
    }

    // Check for care gaps from quality agent and generate outreach
    const qualityResult = agentResults.quality?.result;
    if (qualityResult?.gaps?.length > 0) {
      const gaps = qualityResult.gaps.map(g => ({
        type: g.measureId || 'quality',
        description: g.suggestedAction || g.message,
        due_date: null
      }));
      try {
        const outreach = await this.sendCareGapOutreach(patientId, gaps);
        result.careGapOutreach = outreach;
      } catch (err) {
        result.careGapOutreachError = err.message;
      }
    }

    // Get pending messages for this patient
    const pending = await this.getPatientMessages(patientId);
    result.messages = pending;
    result.pendingReview = pending.filter(m => m.status === 'physician_review').length;

    return result;
  }
}

// ==========================================
// EXPORTED FUNCTIONS
// ==========================================

/**
 * Draft a patient message.
 *
 * @param {number} patientId - Patient ID
 * @param {string} messageType - One of MESSAGE_TYPES
 * @param {string} content - Message content (clinical language OK — will be converted)
 * @returns {Promise<Object>} {id, status, content, plain_language_content}
 */
async function draftMessage(patientId, messageType, content) {
  if (!patientId) throw new Error('patientId is required');
  if (!content) throw new Error('content is required');
  if (!MESSAGE_TYPES.includes(messageType)) {
    throw new Error(`Invalid messageType "${messageType}". Valid types: ${MESSAGE_TYPES.join(', ')}`);
  }

  const patient = await getPatientById(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);

  const plainContent = toPlainLanguage(content);
  const subject = generateSubject(messageType, {
    subject: content.substring(0, 60)
  });

  // After-visit summaries require physician review (Tier 3)
  const tier = messageType === 'after_visit_summary' ? 3 : 2;
  const status = tier === 3 ? 'physician_review' : 'draft';

  const result = await dbRun(
    `INSERT INTO patient_messages (patient_id, message_type, subject, content, plain_language_content, status, tier)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [patientId, messageType, subject, content, plainContent, status, tier]
  );

  return {
    id: result.lastID,
    status,
    content,
    plain_language_content: plainContent
  };
}

/**
 * Auto-generate an after-visit summary from encounter data.
 * Pulls encounter, medications, problems, and labs.
 * Generates plain-language summary at 6th-grade reading level.
 * Returns as draft in physician_review status (Tier 3).
 *
 * @param {number} encounterId - Encounter ID
 * @returns {Promise<Object>} Draft message for physician review
 */
async function generateAfterVisitSummary(encounterId) {
  if (!encounterId) throw new Error('encounterId is required');

  const encounter = await getEncounterById(encounterId);
  if (!encounter) throw new Error(`Encounter ${encounterId} not found`);

  const patientId = encounter.patient_id;
  const patient = await getPatientById(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found for encounter ${encounterId}`);

  // Gather clinical data
  const [medications, problems, labs] = await Promise.all([
    getPatientMedications(patientId),
    getPatientProblems(patientId),
    getPatientLabs(patientId)
  ]);

  // Build the plain-language summary
  const plainSummary = buildAfterVisitSummary(encounter, patient, medications, problems, labs);

  // Build the clinical version (for the chart)
  const clinicalSections = [];
  clinicalSections.push(`After-Visit Summary — Encounter #${encounterId}`);
  clinicalSections.push(`Date: ${encounter.encounter_date || 'N/A'}`);
  clinicalSections.push(`Type: ${encounter.encounter_type || 'Office Visit'}`);
  if (encounter.chief_complaint) {
    clinicalSections.push(`Chief Complaint: ${encounter.chief_complaint}`);
  }
  const activeProblems = (problems || []).filter(p => p.status === 'active');
  if (activeProblems.length > 0) {
    clinicalSections.push(`Active Problems: ${activeProblems.map(p => `${p.problem_name} (${p.icd10_code || 'unspecified'})`).join('; ')}`);
  }
  const activeMeds = (medications || []).filter(m => m.status === 'active');
  if (activeMeds.length > 0) {
    clinicalSections.push(`Medications: ${activeMeds.map(m => `${m.medication_name} ${m.dose || ''} ${m.frequency || ''}`).join('; ')}`);
  }
  const clinicalContent = clinicalSections.join('\n');

  const subject = generateSubject('after_visit_summary', {
    visitDate: encounter.encounter_date
      ? new Date(encounter.encounter_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'Recent Visit'
  });

  // Insert as Tier 3 — requires physician review before sending
  const result = await dbRun(
    `INSERT INTO patient_messages (patient_id, encounter_id, message_type, subject, content, plain_language_content, status, tier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, encounterId, 'after_visit_summary', subject, clinicalContent, plainSummary, 'physician_review', 3]
  );

  return {
    id: result.lastID,
    status: 'physician_review',
    content: clinicalContent,
    plain_language_content: plainSummary
  };
}

/**
 * Create outreach messages for care gaps.
 *
 * @param {number} patientId - Patient ID
 * @param {Array} gaps - Array of {type, description, due_date}
 * @returns {Promise<Object>} Draft outreach message
 */
async function sendCareGapOutreach(patientId, gaps) {
  if (!patientId) throw new Error('patientId is required');
  if (!Array.isArray(gaps) || gaps.length === 0) throw new Error('gaps array is required and must not be empty');

  const patient = await getPatientById(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);

  const patientName = patient.first_name || 'there';
  const plainContent = buildCareGapMessage(patientName, gaps);

  // Clinical version for the chart
  const clinicalContent = gaps.map(g => {
    const due = g.due_date ? ` (due: ${g.due_date})` : '';
    return `[${g.type}] ${g.description}${due}`;
  }).join('\n');

  const subject = generateSubject('care_gap_outreach');

  const result = await dbRun(
    `INSERT INTO patient_messages (patient_id, message_type, subject, content, plain_language_content, status, tier)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [patientId, 'care_gap_outreach', subject, clinicalContent, plainContent, 'draft', 2]
  );

  return {
    id: result.lastID,
    status: 'draft',
    content: clinicalContent,
    plain_language_content: plainContent,
    gaps_addressed: gaps.length
  };
}

/**
 * Retrieve all messages for a patient.
 *
 * @param {number} patientId - Patient ID
 * @returns {Promise<Array>} All patient messages, newest first
 */
async function getPatientMessages(patientId) {
  if (!patientId) throw new Error('patientId is required');
  return dbAll(
    'SELECT * FROM patient_messages WHERE patient_id = ? ORDER BY created_at DESC',
    [patientId]
  );
}

/**
 * Update the status of a message.
 *
 * @param {number} messageId - Message ID
 * @param {string} status - New status (draft, physician_review, approved, sent, read)
 * @param {Object} [meta] - Optional metadata {reviewed_by}
 * @returns {Promise<Object>} Updated message
 */
async function updateMessageStatus(messageId, status, meta = {}) {
  if (!messageId) throw new Error('messageId is required');
  if (!MESSAGE_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Valid statuses: ${MESSAGE_STATUSES.join(', ')}`);
  }

  const existing = await dbGet('SELECT * FROM patient_messages WHERE id = ?', [messageId]);
  if (!existing) throw new Error(`Message ${messageId} not found`);

  const updates = ['status = ?'];
  const params = [status];

  if (status === 'approved' || status === 'physician_review') {
    updates.push('reviewed_by = ?');
    params.push(meta.reviewed_by || null);
    updates.push('reviewed_at = CURRENT_TIMESTAMP');
  }

  if (status === 'sent') {
    updates.push('sent_at = CURRENT_TIMESTAMP');
  }

  params.push(messageId);

  await dbRun(
    `UPDATE patient_messages SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  return dbGet('SELECT * FROM patient_messages WHERE id = ?', [messageId]);
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  PatientLinkAgent,
  draftMessage,
  generateAfterVisitSummary,
  sendCareGapOutreach,
  getPatientMessages,
  updateMessageStatus,
  // Expose for testing
  toPlainLanguage,
  MESSAGE_TYPES,
  MESSAGE_STATUSES
};
