'use strict';

/**
 * MediVault Translation Agent
 * Converts specialty clinical packets into plain-language summaries at a
 * 6th-grade reading level for patient-directed data governance.
 *
 * Capabilities:
 *   - Convert specialty_packets content to plain language
 *   - Generate actionable summaries ("Here are the three things Dr. X will likely discuss...")
 *   - Store translations in patient_translations table for physician review
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   All translated content requires physician review before delivery to patient.
 *   Medical terminology conversion is safety-critical — oversimplification
 *   can mislead; undersimplification can confuse.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// ==========================================
// MEDICAL TERM MAP (subset for vault translations)
// ==========================================

/**
 * Medical terminology to plain-language mapping.
 * Target: 6th-grade reading level.
 * Mirrors and extends the map from patientlink-agent.js.
 */
const MEDICAL_TERM_MAP = {
  // Conditions
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
  'coronary artery disease': 'narrowed heart arteries',
  'myocardial infarction': 'heart attack',
  'cerebrovascular accident': 'stroke',
  'deep vein thrombosis': 'blood clot in leg',
  'pulmonary embolism': 'blood clot in lung',
  'stenosis': 'narrowing',
  'ischemia': 'reduced blood flow',
  'cardiomyopathy': 'weakened heart muscle',
  'arrhythmia': 'irregular heartbeat',

  // Lab tests
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
  'troponin': 'heart damage test',
  'BNP': 'heart strain test',
  'INR': 'blood clotting test',
  'PT': 'blood clotting time test',

  // Clinical terms
  'prognosis': 'what to expect going forward',
  'contraindicated': 'should not be used',
  'prophylaxis': 'prevention',
  'etiology': 'cause',
  'bilateral': 'on both sides',
  'unilateral': 'on one side',
  'benign': 'not harmful',
  'malignant': 'cancerous',
  'acute': 'sudden / short-term',
  'chronic': 'long-lasting',
  'idiopathic': 'cause unknown',
  'asymptomatic': 'no symptoms',

  // Frequency / route abbreviations
  'PRN': 'as needed',
  'BID': 'twice a day',
  'TID': 'three times a day',
  'QID': 'four times a day',
  'QD': 'once a day',
  'PO': 'by mouth',
  'sublingual': 'under the tongue',
  'subcutaneous': 'injected under the skin',
  'intramuscular': 'injected into the muscle',

  // Imaging
  'echocardiogram': 'heart ultrasound',
  'electrocardiogram': 'heart rhythm test (EKG)',
  'EKG': 'heart rhythm test',
  'ejection fraction': 'how well your heart pumps (percentage)',
  'radiograph': 'X-ray picture',
  'MRI': 'detailed body scan (no radiation)',
  'CT scan': 'detailed X-ray scan',
  'fluoroscopy': 'moving X-ray'
};

// ==========================================
// PLAIN LANGUAGE CONVERTER
// ==========================================

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

  // Strip common clinical abbreviations not in the map
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
// TRANSLATION AGENT CLASS
// ==========================================

class TranslationAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_translation', {
      description: 'Plain-language translation of clinical packets at 6th-grade reading level',
      dependsOn: ['medivault_packaging'],
      priority: 50,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process: translate the most recent un-translated packet for the patient.
   *
   * @param {Object} context - Patient context
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Translation result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;

    if (!patientId) {
      return { translated: false, error: 'No patient in context' };
    }

    // Check for a packet from the packaging agent result
    const packagingResult = agentResults.medivault_packaging?.result;
    const packetId = packagingResult?.packetId || context.packetId || null;

    if (!packetId) {
      return {
        translated: false,
        patientId,
        message: 'No specialty packet to translate — run packaging agent first'
      };
    }

    const translation = await this.translateToPlainLanguage(packetId);

    this.audit('recommendation', {
      action: 'packet_translated',
      patientId,
      packetId,
      translationId: translation.translationId,
      readingLevel: translation.readingLevel
    }, context);

    return translation;
  }

  /**
   * Translate a specialty packet to plain language at 6th-grade reading level.
   * Stores the result in patient_translations with status 'physician_review'.
   *
   * @param {number} packetId - ID of the specialty_packets entry
   * @returns {Promise<Object>} Translation result with translationId
   */
  async translateToPlainLanguage(packetId) {
    if (!packetId) throw new Error('packetId is required');

    const packet = await dbGet('SELECT * FROM specialty_packets WHERE id = ?', [packetId]);
    if (!packet) throw new Error(`Specialty packet ${packetId} not found`);

    let content;
    try {
      content = JSON.parse(packet.content);
    } catch {
      throw new Error(`Failed to parse packet content for packet ${packetId}`);
    }

    // Build plain-language text from packet sections
    const plainSections = [];
    const specialtyName = content.specialtyDisplayName || content.specialty || 'your specialist';

    plainSections.push(`WHAT YOUR DOCTOR IS SENDING TO ${specialtyName.toUpperCase()}`);
    plainSections.push('');
    plainSections.push(`This is a summary of the medical records being shared with your ${specialtyName.toLowerCase()} doctor. We have written it in simple language so you can understand what is being sent.`);
    plainSections.push('');

    for (const section of (content.sections || [])) {
      if (section.documentCount === 0) continue;

      const label = section.label || section.category || 'Medical Records';
      plainSections.push(`--- ${label.toUpperCase()} ---`);

      for (const doc of (section.documents || [])) {
        const text = doc.ocr_text || '';
        if (text) {
          const plainText = toPlainLanguage(text.substring(0, 500));
          plainSections.push(plainText);
          plainSections.push('');
        }
      }
    }

    const plainLanguageText = plainSections.join('\n');

    // Store translation
    const result = await dbRun(
      `INSERT INTO patient_translations
         (patient_id, source_packet_id, plain_language_text, reading_level, status, created_at)
       VALUES (?, ?, ?, '6th-grade', 'physician_review', datetime('now'))`,
      [packet.patient_id, packetId, plainLanguageText]
    );

    return {
      translated: true,
      translationId: result.lastID,
      packetId,
      patientId: packet.patient_id,
      readingLevel: '6th-grade',
      status: 'physician_review',
      plainLanguageText,
      characterCount: plainLanguageText.length
    };
  }

  /**
   * Generate an actionable summary for the patient.
   * Produces a "Here are the three things Dr. X will likely discuss..." style summary
   * from the patient's most recent specialty packet translations.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Object>} Actionable summary
   */
  async generateActionableSummary(patientId) {
    if (!patientId) throw new Error('patientId is required');

    // Get the most recent packet and translation
    const packet = await dbGet(
      `SELECT sp.*, pt.plain_language_text, pt.status as translation_status
       FROM specialty_packets sp
       LEFT JOIN patient_translations pt ON pt.source_packet_id = sp.id
       WHERE sp.patient_id = ?
       ORDER BY sp.created_at DESC LIMIT 1`,
      [patientId]
    );

    if (!packet) {
      return {
        generated: false,
        patientId,
        message: 'No specialty packets found for this patient'
      };
    }

    let content;
    try {
      content = JSON.parse(packet.content);
    } catch {
      return { generated: false, patientId, message: 'Failed to parse packet content' };
    }

    const specialtyName = content.specialtyDisplayName || content.specialty || 'Your specialist';

    // Build discussion points from prioritized sections
    const discussionPoints = [];
    const prioritized = (content.sections || []).filter(s => s.priority === 'high' && s.documentCount > 0);

    for (const section of prioritized.slice(0, 5)) {
      const label = toPlainLanguage(section.label || section.category);
      discussionPoints.push(label);
    }

    // Limit to top 3 for simplicity
    const topThree = discussionPoints.slice(0, 3);

    const summaryLines = [];
    summaryLines.push('WHAT TO EXPECT AT YOUR APPOINTMENT');
    summaryLines.push('');
    summaryLines.push(`Here are the things your ${specialtyName.toLowerCase()} doctor will likely want to discuss:`);
    summaryLines.push('');

    for (let i = 0; i < topThree.length; i++) {
      summaryLines.push(`  ${i + 1}. ${topThree[i]}`);
    }

    summaryLines.push('');
    summaryLines.push('WHAT TO BRING:');
    summaryLines.push('  - A list of all your current medications (including doses)');
    summaryLines.push('  - Any questions you want to ask the doctor');
    summaryLines.push('  - A family member or friend if you would like support');
    summaryLines.push('');
    summaryLines.push('Remember: There are no bad questions. If something is unclear, ask your doctor to explain.');

    const summaryText = summaryLines.join('\n');

    return {
      generated: true,
      patientId,
      specialty: content.specialty,
      specialtyDisplayName: specialtyName,
      discussionTopics: topThree,
      summaryText
    };
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  TranslationAgent,
  toPlainLanguage,
  MEDICAL_TERM_MAP
};
