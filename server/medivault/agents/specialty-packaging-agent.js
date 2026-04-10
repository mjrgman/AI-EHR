'use strict';

/**
 * MediVault Specialty Packaging Agent
 * Builds specialty-tailored clinical packets from vault data, prioritizing
 * the information most relevant to each specialty's workflow.
 *
 * Capabilities:
 *   - Generate specialty-specific clinical packets (primary_care, cardiology, orthopedics, general_surgery)
 *   - Prioritize, include, or deprioritize data categories per specialty
 *   - Store generated packets in specialty_packets table for review
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   All generated packets require physician review before release. Clinical data
 *   curation decisions must be validated by the referring provider.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// ==========================================
// SPECIALTY CONFIGURATIONS
// ==========================================

/**
 * Configuration for each supported specialty.
 * - prioritized_data: shown first, highlighted as most relevant
 * - included_data: included in full, standard priority
 * - deprioritized_data: included but collapsed/summarized
 */
const SPECIALTY_CONFIGS = {
  primary_care: {
    displayName: 'Primary Care',
    prioritized_data: [
      'problem_list',
      'medication_list',
      'allergies',
      'preventive_care',
      'lab_report'
    ],
    included_data: [
      'vitals_trend',
      'imaging',
      'consult_note',
      'discharge_summary',
      'social_history'
    ],
    deprioritized_data: [
      'operative_note'
    ]
  },

  cardiology: {
    displayName: 'Cardiology',
    prioritized_data: [
      'cardiac_history',
      'echocardiogram',
      'ekg',
      'lipid_panel',
      'cardiac_medications',
      'bp_trends'
    ],
    included_data: [
      'lab_report',
      'medication_list',
      'problem_list',
      'chest_imaging',
      'discharge_summary'
    ],
    deprioritized_data: [
      'preventive_care',
      'social_history',
      'operative_note'
    ]
  },

  orthopedics: {
    displayName: 'Orthopedics',
    prioritized_data: [
      'musculoskeletal_imaging',
      'operative_note',
      'physical_exam',
      'pain_medications',
      'injury_history'
    ],
    included_data: [
      'medication_list',
      'allergies',
      'lab_report',
      'problem_list'
    ],
    deprioritized_data: [
      'preventive_care',
      'cardiac_history',
      'lipid_panel',
      'discharge_summary'
    ]
  },

  general_surgery: {
    displayName: 'General Surgery',
    prioritized_data: [
      'operative_note',
      'imaging',
      'lab_report',
      'medication_list',
      'allergies',
      'anesthesia_history'
    ],
    included_data: [
      'problem_list',
      'discharge_summary',
      'consult_note',
      'vitals_trend'
    ],
    deprioritized_data: [
      'preventive_care',
      'social_history'
    ]
  }
};

// ==========================================
// DATA EXTRACTION HELPERS
// ==========================================

/**
 * Category-to-document-type mapping for vault queries.
 */
const CATEGORY_DOCUMENT_MAP = {
  lab_report: 'lab_report',
  discharge_summary: 'discharge_summary',
  consult_note: 'consult_note',
  imaging: 'imaging',
  medication_list: 'medication_list',
  operative_note: 'operative_note',
  // Derived categories (searched within document text)
  cardiac_history: 'consult_note',
  echocardiogram: 'imaging',
  ekg: 'imaging',
  lipid_panel: 'lab_report',
  cardiac_medications: 'medication_list',
  bp_trends: 'lab_report',
  chest_imaging: 'imaging',
  musculoskeletal_imaging: 'imaging',
  physical_exam: 'consult_note',
  pain_medications: 'medication_list',
  injury_history: 'consult_note',
  anesthesia_history: 'operative_note'
};

/**
 * Keyword filters for derived categories — used to refine document matches.
 */
const CATEGORY_KEYWORDS = {
  cardiac_history: ['cardiac', 'heart', 'coronary', 'myocardial', 'chest pain', 'angina'],
  echocardiogram: ['echo', 'echocardiogram', 'ejection fraction', 'LV function'],
  ekg: ['ekg', 'ecg', 'electrocardiogram', 'sinus rhythm', 'QRS'],
  lipid_panel: ['lipid', 'cholesterol', 'LDL', 'HDL', 'triglyceride'],
  cardiac_medications: ['metoprolol', 'lisinopril', 'amlodipine', 'atorvastatin', 'aspirin', 'carvedilol', 'losartan', 'warfarin', 'eliquis', 'xarelto'],
  bp_trends: ['blood pressure', 'systolic', 'diastolic', 'BP ', 'mmHg'],
  chest_imaging: ['chest', 'CXR', 'chest x-ray', 'thorax', 'lung'],
  musculoskeletal_imaging: ['MRI knee', 'MRI shoulder', 'x-ray', 'fracture', 'joint', 'bone', 'spine', 'lumbar', 'cervical'],
  physical_exam: ['physical exam', 'range of motion', 'ROM', 'strength', 'gait', 'musculoskeletal exam'],
  pain_medications: ['ibuprofen', 'naproxen', 'acetaminophen', 'gabapentin', 'meloxicam', 'tramadol', 'cyclobenzaprine'],
  injury_history: ['injury', 'fracture', 'sprain', 'strain', 'fall', 'trauma', 'accident'],
  anesthesia_history: ['anesthesia', 'intubation', 'sedation', 'general anesthesia', 'spinal block', 'epidural']
};

// ==========================================
// SPECIALTY PACKAGING AGENT CLASS
// ==========================================

class SpecialtyPackagingAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_packaging', {
      description: 'Specialty-tailored clinical packet generation from vault data',
      dependsOn: ['medivault_ingestion', 'medivault_dedup', 'medivault_reconciliation'],
      priority: 40,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process: generate a specialty packet if specialty is specified in context.
   *
   * @param {Object} context - Patient context with optional specialty field
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Packaging result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;
    const specialty = context.specialty || context.referralSpecialty || null;

    if (!patientId) {
      return { generated: false, error: 'No patient in context' };
    }

    if (!specialty) {
      return {
        generated: false,
        patientId,
        message: 'No specialty specified — available specialties: ' + Object.keys(SPECIALTY_CONFIGS).join(', ')
      };
    }

    const packet = await this.generatePacket(patientId, specialty);

    this.audit('recommendation', {
      action: 'specialty_packet_generated',
      patientId,
      specialty,
      packetId: packet.packetId,
      sectionCount: packet.sections.length
    }, context);

    return packet;
  }

  /**
   * Generate a specialty-tailored clinical packet from vault data.
   *
   * @param {number} patientId - Patient ID
   * @param {string} specialty - Specialty key (e.g., 'cardiology', 'orthopedics')
   * @returns {Promise<Object>} Generated packet with sections and metadata
   */
  async generatePacket(patientId, specialty) {
    if (!patientId) throw new Error('patientId is required');
    if (!specialty) throw new Error('specialty is required');

    const config = SPECIALTY_CONFIGS[specialty];
    if (!config) {
      throw new Error(`Unsupported specialty "${specialty}". Supported: ${Object.keys(SPECIALTY_CONFIGS).join(', ')}`);
    }

    const sections = [];

    // Build prioritized sections
    for (const category of config.prioritized_data) {
      const data = await this._fetchCategoryData(patientId, category);
      sections.push({
        category,
        priority: 'high',
        label: this._formatCategoryLabel(category),
        documents: data,
        documentCount: data.length
      });
    }

    // Build included sections
    for (const category of config.included_data) {
      const data = await this._fetchCategoryData(patientId, category);
      sections.push({
        category,
        priority: 'standard',
        label: this._formatCategoryLabel(category),
        documents: data,
        documentCount: data.length
      });
    }

    // Build deprioritized sections (summarized)
    for (const category of config.deprioritized_data) {
      const data = await this._fetchCategoryData(patientId, category);
      sections.push({
        category,
        priority: 'low',
        label: this._formatCategoryLabel(category),
        documents: data.map(d => ({
          id: d.id,
          document_type: d.document_type,
          source_system: d.source_system,
          created_at: d.created_at,
          // Truncate text for deprioritized items
          ocr_text: d.ocr_text ? d.ocr_text.substring(0, 200) + (d.ocr_text.length > 200 ? '...' : '') : null
        })),
        documentCount: data.length
      });
    }

    const packetContent = {
      specialty,
      specialtyDisplayName: config.displayName,
      generatedAt: new Date().toISOString(),
      patientId,
      sections
    };

    // Store in specialty_packets table
    const result = await dbRun(
      `INSERT INTO specialty_packets
         (patient_id, specialty, content, generated_by, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [patientId, specialty, JSON.stringify(packetContent), 'medivault_packaging']
    );

    return {
      generated: true,
      packetId: result.lastID,
      specialty,
      specialtyDisplayName: config.displayName,
      sections,
      totalDocuments: sections.reduce((sum, s) => sum + s.documentCount, 0)
    };
  }

  /**
   * Fetch vault documents matching a data category.
   * For derived categories (e.g., "cardiac_history"), applies keyword filtering.
   *
   * @param {number} patientId - Patient ID
   * @param {string} category - Data category key
   * @returns {Promise<Array>} Matching documents
   * @private
   */
  async _fetchCategoryData(patientId, category) {
    const docType = CATEGORY_DOCUMENT_MAP[category];
    if (!docType) return [];

    // Fetch base documents of the mapped type
    const docs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ? AND document_type = ?
       ORDER BY created_at DESC`,
      [patientId, docType]
    );

    // If this is a derived category, filter by keywords
    const keywords = CATEGORY_KEYWORDS[category];
    if (keywords && keywords.length > 0) {
      return docs.filter(doc => {
        const text = (doc.ocr_text || '').toLowerCase();
        return keywords.some(kw => text.includes(kw.toLowerCase()));
      });
    }

    return docs;
  }

  /**
   * Format a category key into a human-readable label.
   *
   * @param {string} category - Category key (e.g., 'lab_report', 'bp_trends')
   * @returns {string} Human-readable label (e.g., 'Lab Report', 'BP Trends')
   * @private
   */
  _formatCategoryLabel(category) {
    return category
      .split('_')
      .map(word => {
        // Keep short clinical abbreviations uppercase
        if (['bp', 'ekg', 'ecg', 'lv'].includes(word.toLowerCase())) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  SpecialtyPackagingAgent,
  SPECIALTY_CONFIGS,
  CATEGORY_DOCUMENT_MAP,
  CATEGORY_KEYWORDS
};
