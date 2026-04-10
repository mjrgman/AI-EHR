'use strict';

/**
 * MediVault Red Flag Agent
 * Threshold-triggered clinical alerts for critical lab values, medication
 * interactions, and care gaps detected from vault data.
 *
 * Capabilities:
 *   - Critical laboratory value thresholds (potassium, glucose, hemoglobin, etc.)
 *   - Medication interaction checks (via drug-safety-service when available)
 *   - Care gap detection from vault_timeline gaps
 *   - Severity classification: critical / serious / moderate
 *   - All alerts route to physician review queue
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   Every red flag alert requires physician acknowledgment before any clinical
 *   action. False negatives are more dangerous than false positives here.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// Attempt to load drug safety service (optional dependency)
let drugSafetyService = null;
try {
  drugSafetyService = require('../../pharma/drug-safety-service');
} catch {
  // Drug safety service not available — medication interaction checks will be skipped
}

// ==========================================
// CRITICAL VALUE THRESHOLDS
// ==========================================

/**
 * Laboratory critical value thresholds.
 * Each entry defines the test name patterns, critical ranges, and severity.
 * Based on common clinical laboratory critical value policies.
 */
const CRITICAL_LAB_THRESHOLDS = [
  {
    testPatterns: [/\bpotassium\b/i, /\bK\+?\b/],
    criticalHigh: 6.0,
    criticalLow: 2.5,
    seriousHigh: 5.5,
    seriousLow: 3.0,
    unit: 'mEq/L',
    label: 'Potassium'
  },
  {
    testPatterns: [/\bglucose\b/i, /\bblood\s*sugar\b/i],
    criticalHigh: 500,
    criticalLow: 50,
    seriousHigh: 400,
    seriousLow: 60,
    unit: 'mg/dL',
    label: 'Glucose'
  },
  {
    testPatterns: [/\bsodium\b/i, /\bNa\+?\b/],
    criticalHigh: 160,
    criticalLow: 120,
    seriousHigh: 150,
    seriousLow: 125,
    unit: 'mEq/L',
    label: 'Sodium'
  },
  {
    testPatterns: [/\bhemoglobin\b/i, /\bHgb\b/i, /\bHb\b/i],
    criticalHigh: 20.0,
    criticalLow: 7.0,
    seriousHigh: 18.0,
    seriousLow: 8.0,
    unit: 'g/dL',
    label: 'Hemoglobin'
  },
  {
    testPatterns: [/\bplatelet/i, /\bPlt\b/i],
    criticalHigh: 1000,
    criticalLow: 20,
    seriousHigh: 600,
    seriousLow: 50,
    unit: 'K/uL',
    label: 'Platelets'
  },
  {
    testPatterns: [/\bcreatinine\b/i, /\bCr\b/],
    criticalHigh: 10.0,
    criticalLow: null,
    seriousHigh: 5.0,
    seriousLow: null,
    unit: 'mg/dL',
    label: 'Creatinine'
  },
  {
    testPatterns: [/\bINR\b/i, /\bprothrombin\b/i],
    criticalHigh: 5.0,
    criticalLow: null,
    seriousHigh: 4.0,
    seriousLow: null,
    unit: '',
    label: 'INR'
  },
  {
    testPatterns: [/\btroponin\b/i],
    criticalHigh: 0.4,
    criticalLow: null,
    seriousHigh: 0.04,
    seriousLow: null,
    unit: 'ng/mL',
    label: 'Troponin'
  },
  {
    testPatterns: [/\bWBC\b/i, /\bwhite\s*blood\s*cell/i, /\bleukocyte/i],
    criticalHigh: 30.0,
    criticalLow: 2.0,
    seriousHigh: 20.0,
    seriousLow: 3.0,
    unit: 'K/uL',
    label: 'WBC'
  },
  {
    testPatterns: [/\bcalcium\b/i, /\bCa\b/],
    criticalHigh: 13.0,
    criticalLow: 6.5,
    seriousHigh: 12.0,
    seriousLow: 7.5,
    unit: 'mg/dL',
    label: 'Calcium'
  }
];

// ==========================================
// CARE GAP DEFINITIONS
// ==========================================

/**
 * Screening intervals for care gap detection.
 * If no vault_timeline event of the specified type exists within the interval,
 * a care gap alert is generated.
 */
const CARE_GAP_DEFINITIONS = [
  {
    name: 'Annual Lab Work',
    eventTypes: ['lab_report'],
    maxIntervalMonths: 14,  // 12 months + 2 month grace
    severity: 'moderate',
    description: 'No lab work documented in the past 14 months'
  },
  {
    name: 'Follow-up After Discharge',
    eventTypes: ['discharge_summary'],
    maxIntervalMonths: 1,
    severity: 'serious',
    description: 'Hospital discharge documented but no follow-up visit within 30 days',
    requiresFollowUp: true
  },
  {
    name: 'Imaging Follow-up',
    eventTypes: ['imaging'],
    maxIntervalMonths: 18,
    severity: 'moderate',
    description: 'Imaging study recommended follow-up not found within expected interval'
  }
];

// ==========================================
// RED FLAG AGENT CLASS
// ==========================================

class RedFlagAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_redflag', {
      description: 'Critical clinical alerts — lab thresholds, medication interactions, care gaps',
      dependsOn: ['medivault_ingestion', 'medivault_reconciliation'],
      priority: 15,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process: scan for all red flags for the patient.
   *
   * @param {Object} context - Patient context
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Red flag scan result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;

    if (!patientId) {
      return { scanned: false, error: 'No patient in context' };
    }

    const alerts = await this.scanForRedFlags(patientId);

    if (alerts.length > 0) {
      // Report safety events for critical alerts
      const criticalAlerts = alerts.filter(a => a.severity === 'critical');
      for (const alert of criticalAlerts) {
        this.reportSafetyEvent(1, `Critical red flag: ${alert.description}`, context);
      }

      this.audit('recommendation', {
        action: 'red_flags_detected',
        patientId,
        totalAlerts: alerts.length,
        criticalCount: criticalAlerts.length,
        seriousCount: alerts.filter(a => a.severity === 'serious').length,
        moderateCount: alerts.filter(a => a.severity === 'moderate').length
      }, context);
    }

    return {
      scanned: true,
      patientId,
      alertCount: alerts.length,
      alerts
    };
  }

  /**
   * Scan for all red flags for a patient across lab values, medications, and care gaps.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Array of alert objects { severity, type, description, details }
   */
  async scanForRedFlags(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const [labAlerts, medAlerts, gapAlerts] = await Promise.all([
      this._checkLabValues(patientId),
      this._checkMedications(patientId),
      this._checkCareGaps(patientId)
    ]);

    return [...labAlerts, ...medAlerts, ...gapAlerts];
  }

  /**
   * Check lab values in vault documents against critical thresholds.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Lab value alerts
   * @private
   */
  async _checkLabValues(patientId) {
    const alerts = [];

    // Get lab report documents
    const labDocs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ? AND document_type = 'lab_report'
       ORDER BY created_at DESC`,
      [patientId]
    );

    if (labDocs.length === 0) return alerts;

    // Extract numeric values from lab text and check thresholds
    for (const doc of labDocs) {
      const text = doc.ocr_text || '';

      for (const threshold of CRITICAL_LAB_THRESHOLDS) {
        // Check if this lab test is mentioned in the document
        const testMentioned = threshold.testPatterns.some(p => p.test(text));
        if (!testMentioned) continue;

        // Try to extract a numeric value near the test name
        for (const pattern of threshold.testPatterns) {
          const valueRegex = new RegExp(
            pattern.source + '\\s*[:=]?\\s*([<>]?\\s*\\d+\\.?\\d*)',
            pattern.flags
          );
          const match = valueRegex.exec(text);
          if (!match) continue;

          const valueStr = match[1].replace(/[<>\s]/g, '');
          const value = parseFloat(valueStr);
          if (isNaN(value)) continue;

          // Check critical thresholds
          if (threshold.criticalHigh !== null && value >= threshold.criticalHigh) {
            alerts.push({
              severity: 'critical',
              type: 'lab_critical_high',
              description: `${threshold.label} critically high: ${value} ${threshold.unit} (critical threshold: >= ${threshold.criticalHigh})`,
              details: {
                test: threshold.label,
                value,
                unit: threshold.unit,
                threshold: threshold.criticalHigh,
                direction: 'high',
                documentId: doc.id,
                documentDate: doc.created_at
              }
            });
          } else if (threshold.criticalLow !== null && value <= threshold.criticalLow) {
            alerts.push({
              severity: 'critical',
              type: 'lab_critical_low',
              description: `${threshold.label} critically low: ${value} ${threshold.unit} (critical threshold: <= ${threshold.criticalLow})`,
              details: {
                test: threshold.label,
                value,
                unit: threshold.unit,
                threshold: threshold.criticalLow,
                direction: 'low',
                documentId: doc.id,
                documentDate: doc.created_at
              }
            });
          } else if (threshold.seriousHigh !== null && value >= threshold.seriousHigh) {
            alerts.push({
              severity: 'serious',
              type: 'lab_serious_high',
              description: `${threshold.label} elevated: ${value} ${threshold.unit} (serious threshold: >= ${threshold.seriousHigh})`,
              details: {
                test: threshold.label,
                value,
                unit: threshold.unit,
                threshold: threshold.seriousHigh,
                direction: 'high',
                documentId: doc.id,
                documentDate: doc.created_at
              }
            });
          } else if (threshold.seriousLow !== null && value <= threshold.seriousLow) {
            alerts.push({
              severity: 'serious',
              type: 'lab_serious_low',
              description: `${threshold.label} low: ${value} ${threshold.unit} (serious threshold: <= ${threshold.seriousLow})`,
              details: {
                test: threshold.label,
                value,
                unit: threshold.unit,
                threshold: threshold.seriousLow,
                direction: 'low',
                documentId: doc.id,
                documentDate: doc.created_at
              }
            });
          }

          break; // Use first match per threshold
        }
      }
    }

    return alerts;
  }

  /**
   * Check for medication interactions using the drug-safety-service if available.
   * Falls back to basic duplicate-class detection if the service is not loaded.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Medication alerts
   * @private
   */
  async _checkMedications(patientId) {
    const alerts = [];

    // Get medication list documents
    const medDocs = await dbAll(
      `SELECT * FROM vault_documents
       WHERE patient_id = ? AND document_type = 'medication_list'
       ORDER BY created_at DESC LIMIT 1`,
      [patientId]
    );

    if (medDocs.length === 0) return alerts;

    const text = medDocs[0].ocr_text || '';
    const lines = text.split(/\n/).filter(l => l.trim());

    // Extract medication names
    const medications = [];
    for (const line of lines) {
      const medMatch = line.match(/^\s*[-*]?\s*([A-Za-z][A-Za-z\s\-]+?)(?:\s+\d|\s*$)/);
      if (medMatch) {
        medications.push(medMatch[1].trim());
      }
    }

    if (medications.length < 2) return alerts;

    // Use drug safety service if available
    if (drugSafetyService && typeof drugSafetyService.checkDrugInteractions === 'function') {
      try {
        const interactions = await drugSafetyService.checkDrugInteractions(medications);
        for (const interaction of (interactions || [])) {
          const severity = interaction.severity === 'high' ? 'critical'
            : interaction.severity === 'medium' ? 'serious'
            : 'moderate';

          alerts.push({
            severity,
            type: 'medication_interaction',
            description: `Drug interaction: ${interaction.drug1} + ${interaction.drug2} — ${interaction.description || 'potential interaction detected'}`,
            details: {
              drug1: interaction.drug1,
              drug2: interaction.drug2,
              interactionSeverity: interaction.severity,
              description: interaction.description,
              documentId: medDocs[0].id
            }
          });
        }
      } catch (err) {
        // Drug safety service error — log but don't fail
        console.warn('[RedFlag] Drug safety service error:', err.message);
      }
    }

    // Basic duplicate therapeutic class check (always runs)
    const knownDuplicates = [
      { class: 'ACE Inhibitor', drugs: ['lisinopril', 'enalapril', 'benazepril', 'ramipril', 'captopril'] },
      { class: 'ARB', drugs: ['losartan', 'valsartan', 'irbesartan', 'olmesartan', 'telmisartan'] },
      { class: 'Statin', drugs: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin'] },
      { class: 'PPI', drugs: ['omeprazole', 'pantoprazole', 'esomeprazole', 'lansoprazole', 'rabeprazole'] },
      { class: 'SSRI', drugs: ['sertraline', 'fluoxetine', 'escitalopram', 'citalopram', 'paroxetine'] },
      { class: 'Beta Blocker', drugs: ['metoprolol', 'atenolol', 'carvedilol', 'propranolol', 'bisoprolol'] }
    ];

    const lowerMeds = medications.map(m => m.toLowerCase());

    for (const dupClass of knownDuplicates) {
      const matches = dupClass.drugs.filter(d => lowerMeds.some(m => m.includes(d)));
      if (matches.length >= 2) {
        alerts.push({
          severity: 'serious',
          type: 'duplicate_therapeutic_class',
          description: `Duplicate ${dupClass.class} detected: ${matches.join(', ')}`,
          details: {
            therapeuticClass: dupClass.class,
            duplicateDrugs: matches,
            documentId: medDocs[0].id
          }
        });
      }
    }

    return alerts;
  }

  /**
   * Check for care gaps based on vault_timeline event intervals.
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Care gap alerts
   * @private
   */
  async _checkCareGaps(patientId) {
    const alerts = [];
    const now = new Date();

    for (const gap of CARE_GAP_DEFINITIONS) {
      // Find the most recent non-deduplicated event of the specified types
      const placeholders = gap.eventTypes.map(() => '?').join(', ');
      const latestEvent = await dbGet(
        `SELECT * FROM vault_timeline
         WHERE patient_id = ? AND event_type IN (${placeholders}) AND deduplicated = 0
         ORDER BY event_date DESC LIMIT 1`,
        [patientId, ...gap.eventTypes]
      );

      if (!latestEvent) {
        // No events of this type at all — flag if patient has any vault data
        const anyData = await dbGet(
          'SELECT id FROM vault_documents WHERE patient_id = ? LIMIT 1',
          [patientId]
        );
        if (anyData) {
          alerts.push({
            severity: gap.severity,
            type: 'care_gap',
            description: `${gap.name}: ${gap.description}`,
            details: {
              gapName: gap.name,
              expectedEventTypes: gap.eventTypes,
              lastEventDate: null,
              maxIntervalMonths: gap.maxIntervalMonths
            }
          });
        }
        continue;
      }

      // Check if the interval has been exceeded
      const eventDate = new Date(latestEvent.event_date);
      if (isNaN(eventDate.getTime())) continue;

      const monthsSinceEvent = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

      if (monthsSinceEvent > gap.maxIntervalMonths) {
        // Special handling for discharge follow-up
        if (gap.requiresFollowUp) {
          const followUp = await dbGet(
            `SELECT * FROM vault_timeline
             WHERE patient_id = ? AND event_type IN ('consult_note', 'lab_report')
               AND event_date > ? AND deduplicated = 0
             ORDER BY event_date ASC LIMIT 1`,
            [patientId, latestEvent.event_date]
          );
          if (followUp) continue; // Follow-up exists
        }

        alerts.push({
          severity: gap.severity,
          type: 'care_gap',
          description: `${gap.name}: ${gap.description} (last: ${eventDate.toISOString().split('T')[0]}, ${Math.round(monthsSinceEvent)} months ago)`,
          details: {
            gapName: gap.name,
            expectedEventTypes: gap.eventTypes,
            lastEventDate: latestEvent.event_date,
            monthsSinceEvent: Math.round(monthsSinceEvent),
            maxIntervalMonths: gap.maxIntervalMonths,
            sourceDocumentId: latestEvent.source_document_id
          }
        });
      }
    }

    return alerts;
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  RedFlagAgent,
  CRITICAL_LAB_THRESHOLDS,
  CARE_GAP_DEFINITIONS
};
