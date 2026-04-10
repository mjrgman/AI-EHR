'use strict';

/**
 * MediVault Deduplication Agent
 * Scans the vault_timeline for duplicate entries and marks them while
 * preserving provenance links to source documents.
 *
 * Capabilities:
 *   - Find duplicate timeline entries (same event_type + similar date + similar description)
 *   - Mark duplicates with canonical_id reference to the primary entry
 *   - Preserve source_document_id links on deduplicated entries
 *
 * CATC Autonomy: Tier 3 (Physician-in-the-Loop)
 *   Deduplication decisions are flagged for physician review before finalization
 *   to prevent accidental merging of legitimately distinct clinical events.
 */

const { BaseAgent, AUTONOMY_TIER } = require('../../agents/base-agent');
const { dbRun, dbGet, dbAll } = require('../../database');

// ==========================================
// DEDUP CONFIGURATION
// ==========================================

/**
 * Maximum number of days between two events to consider them potential duplicates.
 */
const DATE_PROXIMITY_DAYS = 1;

/**
 * Minimum word overlap ratio to consider descriptions similar.
 * Two descriptions are "similar" if their shared word ratio exceeds this threshold.
 */
const DESCRIPTION_SIMILARITY_THRESHOLD = 0.5;

// ==========================================
// SIMILARITY HELPERS
// ==========================================

/**
 * Calculate word overlap ratio between two strings.
 * Returns a value between 0 (no overlap) and 1 (identical words).
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Overlap ratio
 */
function wordOverlapRatio(a, b) {
  if (!a || !b) return 0;

  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const smaller = Math.min(wordsA.size, wordsB.size);
  return overlap / smaller;
}

/**
 * Check if two date strings are within a given number of days of each other.
 *
 * @param {string} dateA - First date string
 * @param {string} dateB - Second date string
 * @param {number} maxDays - Maximum days apart
 * @returns {boolean} True if dates are within maxDays of each other
 */
function datesWithinRange(dateA, dateB, maxDays) {
  try {
    const a = new Date(dateA);
    const b = new Date(dateB);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
    const diffMs = Math.abs(a.getTime() - b.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= maxDays;
  } catch {
    return false;
  }
}

// ==========================================
// DEDUP AGENT CLASS
// ==========================================

class DedupAgent extends BaseAgent {
  constructor(options = {}) {
    super('medivault_dedup', {
      description: 'Timeline deduplication — finds and marks duplicate vault entries while preserving provenance',
      dependsOn: ['medivault_ingestion'],
      priority: 20,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });
  }

  /**
   * Process: scan for duplicates in the patient's vault timeline.
   *
   * @param {Object} context - Patient context
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>} Deduplication result
   */
  async process(context, agentResults = {}) {
    const patientId = context.patient?.id;

    if (!patientId) {
      return { scanned: false, error: 'No patient in context' };
    }

    const duplicates = await this.findDuplicates(patientId);

    if (duplicates.length > 0) {
      this.audit('recommendation', {
        action: 'duplicates_detected',
        patientId,
        duplicateCount: duplicates.length,
        duplicatePairs: duplicates.map(d => ({
          duplicateId: d.duplicateId,
          canonicalId: d.canonicalId,
          similarity: d.similarity
        }))
      }, context);
    }

    return {
      scanned: true,
      patientId,
      duplicatesFound: duplicates.length,
      duplicates
    };
  }

  /**
   * Find duplicate entries in vault_timeline for a given patient.
   * A duplicate is defined as two entries with:
   *   - Same event_type
   *   - Event dates within DATE_PROXIMITY_DAYS of each other
   *   - Description word overlap above DESCRIPTION_SIMILARITY_THRESHOLD
   *
   * Only scans non-deduplicated entries (deduplicated = 0).
   *
   * @param {number} patientId - Patient ID
   * @returns {Promise<Array>} Array of duplicate pairs { duplicateId, canonicalId, similarity, reason }
   */
  async findDuplicates(patientId) {
    if (!patientId) throw new Error('patientId is required');

    const entries = await dbAll(
      `SELECT * FROM vault_timeline
       WHERE patient_id = ? AND deduplicated = 0
       ORDER BY event_date ASC, id ASC`,
      [patientId]
    );

    if (entries.length < 2) return [];

    const duplicates = [];

    // Compare each pair — the earlier entry (lower id) is canonical
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];

        // Must be same event type
        if (a.event_type !== b.event_type) continue;

        // Dates must be within proximity
        if (!datesWithinRange(a.event_date, b.event_date, DATE_PROXIMITY_DAYS)) continue;

        // Descriptions must be similar
        const similarity = wordOverlapRatio(a.description, b.description);
        if (similarity < DESCRIPTION_SIMILARITY_THRESHOLD) continue;

        // b is the duplicate (later id), a is canonical (earlier id)
        duplicates.push({
          duplicateId: b.id,
          canonicalId: a.id,
          similarity: Math.round(similarity * 100) / 100,
          reason: `Same event_type "${a.event_type}", dates within ${DATE_PROXIMITY_DAYS} day(s), description similarity ${Math.round(similarity * 100)}%`,
          duplicateEntry: {
            id: b.id,
            eventType: b.event_type,
            eventDate: b.event_date,
            description: b.description,
            sourceDocumentId: b.source_document_id
          },
          canonicalEntry: {
            id: a.id,
            eventType: a.event_type,
            eventDate: a.event_date,
            description: a.description,
            sourceDocumentId: a.source_document_id
          }
        });
      }
    }

    return duplicates;
  }

  /**
   * Mark a timeline entry as a duplicate of a canonical entry.
   * Sets deduplicated = 1 and canonical_id to the primary entry.
   * The source_document_id link is preserved — provenance is never destroyed.
   *
   * @param {number} timelineId - The duplicate entry's ID
   * @param {number} canonicalId - The canonical (primary) entry's ID
   * @returns {Promise<Object>} { marked: boolean, timelineId, canonicalId }
   */
  async markDuplicate(timelineId, canonicalId) {
    if (!timelineId) throw new Error('timelineId is required');
    if (!canonicalId) throw new Error('canonicalId is required');

    // Verify both entries exist
    const duplicate = await dbGet('SELECT * FROM vault_timeline WHERE id = ?', [timelineId]);
    if (!duplicate) throw new Error(`Timeline entry ${timelineId} not found`);

    const canonical = await dbGet('SELECT * FROM vault_timeline WHERE id = ?', [canonicalId]);
    if (!canonical) throw new Error(`Canonical entry ${canonicalId} not found`);

    // Mark the duplicate — source_document_id is intentionally preserved
    await dbRun(
      `UPDATE vault_timeline SET deduplicated = 1, canonical_id = ? WHERE id = ?`,
      [canonicalId, timelineId]
    );

    return {
      marked: true,
      timelineId,
      canonicalId,
      preservedSourceDocumentId: duplicate.source_document_id
    };
  }
}

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  DedupAgent,
  wordOverlapRatio,
  datesWithinRange,
  DATE_PROXIMITY_DAYS,
  DESCRIPTION_SIMILARITY_THRESHOLD
};
