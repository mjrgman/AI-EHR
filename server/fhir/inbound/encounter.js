'use strict';

/**
 * FHIR R4 Inbound Encounter Translator
 * Translates a FHIR Encounter resource → internal encounters table row.
 *
 * Requires a resolved patient_id — caller must resolve Patient reference
 * via fhir_id_map before calling this translator.
 *
 * Returns { data, errors } where:
 *   data   — object ready for db.createEncounter() if errors is empty
 *   errors — array of { field, message } describing validation failures
 */

// Reverse of the outbound STATUS_MAP in mappers/encounter.js
// FHIR EncounterStatus → internal status
const FHIR_STATUS_MAP = {
  'in-progress': 'in-progress',
  'finished': 'completed',
  'unknown': 'in-progress',
  'cancelled': 'completed',     // no cancelled status internally; treat as completed
  'planned': 'in-progress',
  'arrived': 'in-progress',
  'triaged': 'in-progress',
  'onleave': 'in-progress',
  'entered-in-error': 'completed',
};

// Reverse of the outbound CLASS_MAP — FHIR class code → internal encounter_type
const FHIR_CLASS_MAP = {
  'AMB': 'office_visit',
  'VR': 'telehealth',
};

/**
 * Resolve a Patient reference string like "Patient/42" → 42.
 * Returns null if the format is unexpected.
 */
function _resolvePatientRef(ref) {
  if (!ref) return null;
  const match = String(ref).match(/^Patient\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Main translator.
 * @param {Object} resource       - FHIR Encounter resource
 * @param {number} resolvedPatientId - internal patient ID (pre-resolved by caller)
 * @returns {{ data: Object|null, errors: Array }}
 */
function fromFhirEncounter(resource, resolvedPatientId) {
  const errors = [];

  if (!resource || resource.resourceType !== 'Encounter') {
    errors.push({ field: 'resourceType', message: 'Expected resourceType Encounter' });
    return { data: null, errors };
  }

  if (!resolvedPatientId) {
    errors.push({ field: 'subject', message: 'Encounter subject (patient) could not be resolved to an internal ID' });
    return { data: null, errors };
  }

  // Encounter date from period.start, or today
  let encounterDate = null;
  if (resource.period?.start) {
    encounterDate = resource.period.start.split('T')[0];
  } else {
    encounterDate = new Date().toISOString().split('T')[0];
  }

  // Status
  const internalStatus = FHIR_STATUS_MAP[resource.status] || 'in-progress';

  // Class → encounter_type
  let encounterType = 'office_visit';
  if (resource.class?.code) {
    encounterType = FHIR_CLASS_MAP[resource.class.code] || 'office_visit';
  }

  // Chief complaint from reasonCode[0].text
  let chiefComplaint = null;
  if (Array.isArray(resource.reasonCode) && resource.reasonCode.length > 0) {
    chiefComplaint = resource.reasonCode[0].text || null;
  }

  // Provider from participant[0].individual.display
  let provider = null;
  if (Array.isArray(resource.participant) && resource.participant.length > 0) {
    provider = resource.participant[0].individual?.display || null;
  }

  const data = {
    patient_id: resolvedPatientId,
    encounter_date: encounterDate,
    encounter_type: encounterType,
    chief_complaint: chiefComplaint,
    provider,
    status: internalStatus,
  };

  return { data, errors: [] };
}

module.exports = { fromFhirEncounter };
