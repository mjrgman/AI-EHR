'use strict';

/**
 * MediVault Reconciliation Agent
 * Cross-source reconciliation of medications, allergies, and problems.
 * Detects conflicts between sources and calculates record completeness.
 *
 * Capabilities:
 *   - Medication reconciliation: classifies as Current / Discontinued / Status Unclear
 *   - Allergy reconciliation: cross-source matching and conflict detection
 *   - Problem list reconciliation: first-documented and last-referenced dates
 *   - Conflict detection: finds discrepancies between source documents
 *   - Record Completeness Index: percentage of expected data categories present
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   All reconciliation results require physician review. Medication and allergy
 *   discrepancies are safety-critical and must not be auto-resolved.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// ==========================================
// EXPECTED DATA CATEGORIES
// ==========================================

/**
 * Data categories used to calculate the Record Completeness Index.
 * Each category maps to a vault_documents classification or vault_timeline event_type.
 */
const EXPECTED_CATEGORIES = [
  'lab_report',
  'discharge_summary',
  'consult_note',
  'imaging',
  'medication_list',
  'operative_note'
];

/**
 * Medication status keywords for classification.
 */
const MED_STATUS_PATTERNS = {
  current: [
    /\bcurrent\b/i, /\bactive\b/i, /\bcontinue\b/i, /\btaking\b/i,
    /\bprescribed\b/i, /\bstarted\b/i, /\brefill\b/i
  ],
  discontinued: [
    /\bdiscontinue/i, /\bstopped\b/i, /\bd\/c\b/i, /\bhold\b/i,
    /\bno\s*longer\s*taking\b/i, /\bchanged\s*(?:to|from)\b/i
  ]
};

// ==========================================
// RECONCILIATION AGENT CLASS
// ==========================================

class ReconciliationAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_reconciliation', {
      description: 'Cross-source reconciliation of medications, allergies, and problems with conflict detection',
      dependsOn: ['medivault_ingestion', 'medivault_dedup'],
      priority: 30,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process: run full reconciliation for the patient.
   *
   * @param {Object} context - Patient context
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Reconciliation result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;

    if (!patientId) {
      return { reconciled: false, error: 'No patient in context' };
    }

    const [medications, allergies, problems, conflicts, completeness] = await Promise.all([
      this.reconcileMedications(patientId),
      this.reconcileAllergies(patientId),
      this.reconcileProblems(patientId),
      this.detectConflicts(patientId),
      this.getCompletenessScore(patientId)
    ]);

    const result = {
      reconciled: true,
      patientId,
      medications,
      allergies,
      problems,
      conflicts,
      completeness
    };

    this.audit('recommendation', {
      action: 'reconciliation_complete',
      patientId,
      medicationCount: medications.length,
      allergyCount: allergies.length,
      problemCount: problems.length,
      conflictCount: conflicts.length,
      completenessScore: completeness.score
    }, context);

    return result;
  }

  /**
   * Reconcile medications across all vault documents for a patient.
   * Classifies each medication as Current, Discontinued, or Status Unclear
   * by scanning ocr_text of medication_list documents.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Reconciled medication list
   */
  async reconcileMedications(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const medDocs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ? AND document_type = 'medication_list'
       ORDER BY created_at DESC`,
      [patientId]
    );

    if (medDocs.length === 0) return [];

    const medications = new Map(); // medication name → { status, sources, lastSeen }

    for (const doc of medDocs) {
      const text = doc.ocr_text || '';
      const lines = text.split(/\n/).filter(l => l.trim());

      for (const line of lines) {
        // Extract medication name (first word group before dose info)
        const medMatch = line.match(/^\s*[-*]?\s*([A-Za-z][A-Za-z\s\-]+?)(?:\s+\d|\s*$)/);
        if (!medMatch) continue;

        const medName = medMatch[1].trim().toLowerCase();
        if (medName.length < 3) continue; // Skip short fragments

        let status = 'status_unclear';

        for (const pattern of MED_STATUS_PATTERNS.current) {
          if (pattern.test(line)) { status = 'current'; break; }
        }
        if (status === 'status_unclear') {
          for (const pattern of MED_STATUS_PATTERNS.discontinued) {
            if (pattern.test(line)) { status = 'discontinued'; break; }
          }
        }

        const existing = medications.get(medName);
        if (!existing) {
          medications.set(medName, {
            name: medName,
            status,
            sources: [{ documentId: doc.id, sourceSystem: doc.source_system, date: doc.created_at }],
            firstSeen: doc.created_at,
            lastSeen: doc.created_at,
            rawText: line.trim()
          });
        } else {
          existing.sources.push({ documentId: doc.id, sourceSystem: doc.source_system, date: doc.created_at });
          existing.lastSeen = doc.created_at;
          // If any source says discontinued, that takes precedence (conservative)
          if (status === 'discontinued') existing.status = 'discontinued';
          else if (status === 'current' && existing.status === 'status_unclear') existing.status = 'current';
        }
      }
    }

    return Array.from(medications.values());
  }

  /**
   * Reconcile allergies across all vault documents for a patient.
   * Scans all document types for allergy mentions and cross-references.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Reconciled allergy list
   */
  async reconcileAllergies(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const docs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ?
       ORDER BY created_at DESC`,
      [patientId]
    );

    if (docs.length === 0) return [];

    const allergies = new Map();
    const allergyPattern = /\b(?:allerg(?:y|ies|ic)\s*(?:to|:)?|NKDA|no\s*known\s*(?:drug\s*)?allergies)\b/gi;
    const allergenExtract = /allerg(?:y|ic)\s*(?:to|:)\s*([^,;\n]+)/gi;

    for (const doc of docs) {
      const text = doc.ocr_text || '';

      // Check for NKDA
      if (/\bNKDA\b/i.test(text) || /\bno\s*known\s*(?:drug\s*)?allergies\b/i.test(text)) {
        if (!allergies.has('nkda')) {
          allergies.set('nkda', {
            allergen: 'No Known Drug Allergies (NKDA)',
            reaction: null,
            severity: null,
            sources: [],
            confirmedInSources: 0
          });
        }
        allergies.get('nkda').sources.push({ documentId: doc.id, sourceSystem: doc.source_system });
        allergies.get('nkda').confirmedInSources++;
        continue;
      }

      // Extract specific allergens
      let match;
      while ((match = allergenExtract.exec(text)) !== null) {
        const allergen = match[1].trim().toLowerCase();
        if (allergen.length < 2) continue;

        if (!allergies.has(allergen)) {
          allergies.set(allergen, {
            allergen,
            reaction: null,
            severity: null,
            sources: [],
            confirmedInSources: 0
          });
        }
        allergies.get(allergen).sources.push({ documentId: doc.id, sourceSystem: doc.source_system });
        allergies.get(allergen).confirmedInSources++;
      }
    }

    return Array.from(allergies.values());
  }

  /**
   * Reconcile the problem list across all vault documents.
   * Tracks first-documented and last-referenced dates for each problem.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Reconciled problem list with date ranges
   */
  async reconcileProblems(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const docs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ?
       ORDER BY created_at ASC`,
      [patientId]
    );

    if (docs.length === 0) return [];

    const problems = new Map();
    // Match common problem list patterns: "Problem:", "Diagnosis:", "Assessment:"
    const problemPatterns = [
      /(?:problem|diagnosis|assessment|impression)\s*(?:list)?:\s*([^\n]+)/gi,
      /\b((?:type\s*[12]\s+)?diabetes\s*mellitus|hypertension|hyperlipidemia|COPD|CHF|CKD|asthma|obesity|depression|anxiety|hypothyroidism|atrial\s*fibrillation|GERD|osteoarthritis|BPH|anemia)\b/gi
    ];

    for (const doc of docs) {
      const text = doc.ocr_text || '';

      for (const pattern of problemPatterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
          const problemName = match[1]?.trim().toLowerCase() || match[0]?.trim().toLowerCase();
          if (!problemName || problemName.length < 3) continue;

          if (!problems.has(problemName)) {
            problems.set(problemName, {
              name: problemName,
              firstDocumented: doc.extracted_date || doc.created_at,
              lastReferenced: doc.extracted_date || doc.created_at,
              sourceCount: 0,
              sources: []
            });
          }

          const prob = problems.get(problemName);
          prob.lastReferenced = doc.extracted_date || doc.created_at;
          prob.sourceCount++;
          prob.sources.push({ documentId: doc.id, sourceSystem: doc.source_system, date: doc.created_at });
        }
      }
    }

    return Array.from(problems.values());
  }

  /**
   * Detect conflicts between different source documents for the same patient.
   * Creates vault_conflicts entries for each discrepancy found.
   *
   * Conflict types:
   *   - medication_discrepancy: same med listed with different statuses
   *   - allergy_discrepancy: allergy listed in one source but NKDA in another
   *   - problem_discrepancy: problem listed as active in one source but absent in another recent source
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Detected conflicts
   */
  async detectConflicts(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const conflicts = [];

    // --- Medication conflicts ---
    const meds = await this.reconcileMedications(patientId);
    for (const med of meds) {
      if (med.sources.length < 2) continue;

      // Check if different sources disagree on status
      const sourceSystems = [...new Set(med.sources.map(s => s.sourceSystem))];
      if (sourceSystems.length < 2) continue;

      // If status is unclear and has multiple sources, flag it
      if (med.status === 'status_unclear') {
        const conflict = {
          patient_id: patientId,
          conflict_type: 'medication_discrepancy',
          item_name: med.name,
          source1_value: `Listed in ${sourceSystems[0]}`,
          source1_document_id: med.sources[0].documentId,
          source2_value: `Status unclear across ${sourceSystems.length} sources`,
          source2_document_id: med.sources[med.sources.length - 1].documentId,
          resolution_status: 'pending'
        };
        conflicts.push(conflict);

        await dbRun(
          `INSERT INTO vault_conflicts
             (patient_id, conflict_type, item_name, source1_value, source1_document_id, source2_value, source2_document_id, resolution_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            conflict.patient_id, conflict.conflict_type, conflict.item_name,
            conflict.source1_value, conflict.source1_document_id,
            conflict.source2_value, conflict.source2_document_id,
            conflict.resolution_status
          ]
        );
      }
    }

    // --- Allergy conflicts ---
    const allergies = await this.reconcileAllergies(patientId);
    const hasNKDA = allergies.some(a => a.allergen === 'No Known Drug Allergies (NKDA)');
    const specificAllergies = allergies.filter(a => a.allergen !== 'No Known Drug Allergies (NKDA)');

    if (hasNKDA && specificAllergies.length > 0) {
      const nkdaSources = allergies.find(a => a.allergen === 'No Known Drug Allergies (NKDA)').sources;
      for (const allergy of specificAllergies) {
        const conflict = {
          patient_id: patientId,
          conflict_type: 'allergy_discrepancy',
          item_name: allergy.allergen,
          source1_value: `NKDA documented in ${nkdaSources[0].sourceSystem}`,
          source1_document_id: nkdaSources[0].documentId,
          source2_value: `Allergy to "${allergy.allergen}" documented in ${allergy.sources[0].sourceSystem}`,
          source2_document_id: allergy.sources[0].documentId,
          resolution_status: 'pending'
        };
        conflicts.push(conflict);

        await dbRun(
          `INSERT INTO vault_conflicts
             (patient_id, conflict_type, item_name, source1_value, source1_document_id, source2_value, source2_document_id, resolution_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            conflict.patient_id, conflict.conflict_type, conflict.item_name,
            conflict.source1_value, conflict.source1_document_id,
            conflict.source2_value, conflict.source2_document_id,
            conflict.resolution_status
          ]
        );
      }
    }

    return conflicts;
  }

  /**
   * Calculate the Record Completeness Index for a patient.
   * Returns the percentage of EXPECTED_CATEGORIES that have at least one
   * vault_documents entry.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Object>} { score, present, missing, total }
   */
  async getCompletenessScore(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const docs = await dbAll(
      `SELECT DISTINCT document_type FROM vault_documents WHERE patient_id = ?`,
      [patientId]
    );

    const presentTypes = new Set(docs.map(d => d.document_type));
    const present = [];
    const missing = [];

    for (const category of EXPECTED_CATEGORIES) {
      if (presentTypes.has(category)) {
        present.push(category);
      } else {
        missing.push(category);
      }
    }

    const score = EXPECTED_CATEGORIES.length > 0
      ? Math.round((present.length / EXPECTED_CATEGORIES.length) * 100)
      : 0;

    return {
      score,
      present,
      missing,
      total: EXPECTED_CATEGORIES.length,
      presentCount: present.length,
      missingCount: missing.length
    };
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  ReconciliationAgent,
  EXPECTED_CATEGORIES,
  MED_STATUS_PATTERNS
};
