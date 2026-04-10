'use strict';

/**
 * MediVault Ingestion Agent
 * Handles document intake, classification, date extraction, and timeline creation
 * for patient-directed data governance.
 *
 * Capabilities:
 *   - Classify incoming clinical documents (lab report, discharge summary, etc.)
 *   - Extract dates from clinical text via regex
 *   - Ingest documents into vault_documents and create vault_timeline entries
 *   - Tag source system provenance
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   All ingested documents require physician review before becoming part of the
 *   canonical patient record.
 *
 * OCR: Stubbed for future Tesseract.js integration. Current implementation
 *   accepts pre-extracted text.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// ==========================================
// DOCUMENT TYPE CLASSIFICATION
// ==========================================

/**
 * Supported clinical document types with their classification patterns.
 */
const DOCUMENT_TYPES = [
  {
    type: 'lab_report',
    patterns: [
      /\blab\s*(report|result)/i,
      /\bcbc\b/i,
      /\bcmp\b/i,
      /\blipid\s*panel\b/i,
      /\bhemoglobin\s*a1c\b/i,
      /\btsh\b/i,
      /\bcreatinine\b/i,
      /\begfr\b/i,
      /\burinalysis\b/i,
      /\bculture\b/i,
      /\bspecimen\b/i,
      /\breference\s*range\b/i,
      /\bcollect(?:ed|ion)\s*date\b/i
    ]
  },
  {
    type: 'discharge_summary',
    patterns: [
      /\bdischarge\s*summar/i,
      /\bdischarged?\s*(?:to|from|on)\b/i,
      /\bhospital\s*course\b/i,
      /\badmission\s*(?:date|diagnos)/i,
      /\blength\s*of\s*stay\b/i,
      /\bdischarge\s*(?:diagnosis|instructions|medications)\b/i
    ]
  },
  {
    type: 'consult_note',
    patterns: [
      /\bconsult(?:ation)?\s*(?:note|report)\b/i,
      /\breason\s*for\s*(?:consult|referral)\b/i,
      /\breferring\s*(?:physician|provider)\b/i,
      /\bthank\s*you\s*for\s*(?:this|the)\s*(?:consult|referral)\b/i,
      /\bimpression\s*(?:and|&)\s*(?:plan|recommendation)\b/i
    ]
  },
  {
    type: 'imaging',
    patterns: [
      /\b(?:x-?ray|xray|radiograph)\b/i,
      /\b(?:ct|cat)\s*scan\b/i,
      /\bmri\b/i,
      /\bultrasound\b/i,
      /\becho(?:cardiogram)?\b/i,
      /\bfluoroscopy\b/i,
      /\bmammogra(?:m|phy)\b/i,
      /\bfindings?\s*:/i,
      /\bimpression\s*:/i,
      /\bradiolog/i
    ]
  },
  {
    type: 'medication_list',
    patterns: [
      /\bmedication\s*(?:list|reconciliation|review)\b/i,
      /\bcurrent\s*medications?\b/i,
      /\bactive\s*medications?\b/i,
      /\bprescription\s*(?:list|history)\b/i,
      /\bmed\s*(?:list|rec)\b/i
    ]
  },
  {
    type: 'operative_note',
    patterns: [
      /\boperati(?:ve|on)\s*(?:note|report)\b/i,
      /\bsurg(?:ery|ical)\s*(?:note|report)\b/i,
      /\bprocedure\s*(?:note|report|performed)\b/i,
      /\bpreoperative\s*diagnos/i,
      /\bpostoperative\s*diagnos/i,
      /\banesthes(?:ia|iology)\b/i,
      /\bestimated\s*blood\s*loss\b/i
    ]
  }
];

// ==========================================
// DATE EXTRACTION PATTERNS
// ==========================================

/**
 * Regex patterns for extracting dates from clinical text.
 * Handles common US clinical date formats.
 */
const DATE_PATTERNS = [
  // MM/DD/YYYY or MM-DD-YYYY
  /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g,
  // YYYY-MM-DD (ISO format)
  /\b(19|20)\d{2}[\/\-](0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])\b/g,
  // Month DD, YYYY (e.g., January 15, 2024)
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+(19|20)\d{2}\b/gi,
  // DD Mon YYYY (e.g., 15 Jan 2024)
  /\b(0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(19|20)\d{2}\b/gi
];

// ==========================================
// INGESTION AGENT CLASS
// ==========================================

class IngestionAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_ingestion', {
      description: 'Document ingestion — classification, date extraction, and vault storage for patient-directed data governance',
      dependsOn: [],
      priority: 10,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process incoming document data from the encounter context.
   * Classifies the document, extracts dates, and stores in the vault.
   *
   * @param {Object} context - Patient context with document data
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Ingestion result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;

    if (!patientId) {
      return { ingested: false, error: 'No patient in context' };
    }

    const documentData = context.documentData || context.document || null;

    if (!documentData) {
      return {
        ingested: false,
        patientId,
        message: 'No document data in context — nothing to ingest'
      };
    }

    const result = await this.ingestDocument(patientId, documentData);

    this.audit('recommendation', {
      action: 'document_ingested',
      patientId,
      documentId: result.documentId,
      documentType: result.classification,
      datesFound: result.extractedDates.length
    }, context);

    return result;
  }

  /**
   * Classify a clinical document based on its text content.
   * Uses regex pattern matching against known document type signatures.
   *
   * @param {string} text - Document text content
   * @returns {Object} { type: string, confidence: 'high'|'medium'|'low' }
   */
  classifyDocument(text) {
    if (!text || typeof text !== 'string') {
      return { type: 'unknown', confidence: 'low' };
    }

    const scores = {};

    for (const docType of DOCUMENT_TYPES) {
      let matchCount = 0;
      for (const pattern of docType.patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        scores[docType.type] = matchCount;
      }
    }

    // Find the type with the most pattern matches
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      return { type: 'unknown', confidence: 'low' };
    }

    const topScore = sorted[0][1];
    const confidence = topScore >= 3 ? 'high' : topScore >= 2 ? 'medium' : 'low';

    return {
      type: sorted[0][0],
      confidence,
      matchCount: topScore
    };
  }

  /**
   * Extract dates from clinical text using multiple regex patterns.
   *
   * @param {string} text - Clinical text to scan for dates
   * @returns {string[]} Array of date strings found in the text
   */
  extractDates(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const dates = new Set();

    for (const pattern of DATE_PATTERNS) {
      // Clone the pattern to reset lastIndex
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        dates.add(match[0]);
      }
    }

    return Array.from(dates);
  }

  /**
   * Ingest a document into the vault system.
   * Stores the document in vault_documents and creates corresponding
   * vault_timeline entries for each extracted date.
   *
   * @param {number} patientId - Patient ID
   * @param {Object} documentData - Document payload
   * @param {string} documentData.text - Document text content
   * @param {string} [documentData.filename] - Original filename
   * @param {string} [documentData.sourceSystem] - Source system identifier
   * @param {number} [documentData.ocrConfidence] - OCR confidence score (0-1)
   * @returns {Promise<Object>} Ingestion result with documentId, classification, timeline entries
   */
  async ingestDocument(patientId, documentData) {
    if (!patientId) throw new Error('patientId is required');
    if (!documentData || !documentData.text) throw new Error('documentData.text is required');

    const text = documentData.text;
    const classification = this.classifyDocument(text);
    const extractedDates = this.extractDates(text);

    // Store the document
    const docResult = await dbRun(
      `INSERT INTO vault_documents
         (patient_id, document_type, source_system, original_filename, ocr_text, ocr_confidence, classification, extracted_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        patientId,
        classification.type,
        documentData.sourceSystem || 'manual_upload',
        documentData.filename || null,
        text,
        documentData.ocrConfidence || null,
        JSON.stringify(classification),
        extractedDates.length > 0 ? extractedDates[0] : null
      ]
    );

    const documentId = docResult.lastID;

    // Create timeline entries for each extracted date
    const timelineEntries = [];
    for (const dateStr of extractedDates) {
      const timelineResult = await dbRun(
        `INSERT INTO vault_timeline
           (patient_id, event_type, event_date, description, source_document_id, deduplicated, created_at)
         VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
        [
          patientId,
          classification.type,
          dateStr,
          `${classification.type} from ${documentData.sourceSystem || 'manual upload'}`,
          documentId
        ]
      );
      timelineEntries.push({
        id: timelineResult.lastID,
        eventDate: dateStr,
        eventType: classification.type
      });
    }

    // If no dates found, still create one timeline entry with current date
    if (timelineEntries.length === 0) {
      const timelineResult = await dbRun(
        `INSERT INTO vault_timeline
           (patient_id, event_type, event_date, description, source_document_id, deduplicated, created_at)
         VALUES (?, ?, datetime('now'), ?, ?, 0, datetime('now'))`,
        [
          patientId,
          classification.type,
          `${classification.type} ingested (no date extracted)`,
          documentId
        ]
      );
      timelineEntries.push({
        id: timelineResult.lastID,
        eventDate: new Date().toISOString(),
        eventType: classification.type
      });
    }

    return {
      ingested: true,
      documentId,
      classification: classification.type,
      classificationConfidence: classification.confidence,
      extractedDates,
      timelineEntriesCreated: timelineEntries.length,
      timelineEntries
    };
  }

  // Future: OCR integration
  // async ocrDocument(imageBuffer) {
  //   // TODO: Integrate Tesseract.js for on-device OCR
  //   // const Tesseract = require('tesseract.js');
  //   // const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, 'eng');
  //   // return { text, confidence: confidence / 100 };
  //   throw new Error('OCR not yet implemented — use pre-extracted text');
  // }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  IngestionAgent,
  DOCUMENT_TYPES,
  DATE_PATTERNS
};
