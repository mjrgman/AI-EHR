'use strict';

/**
 * FHIR R4 Condition Mapper
 * Translates internal problems table → FHIR Condition resource
 * Spec: https://hl7.org/fhir/R4/condition.html
 */

const { codeableConcept, reference } = require('../utils/fhir-response');

// Internal status → FHIR Condition clinicalStatus
const CLINICAL_STATUS_MAP = {
  'active': 'active',
  'chronic': 'active',    // chronic is clinically active with category 'chronic'
  'resolved': 'resolved'
};

/**
 * Map internal problem record to FHIR R4 Condition resource
 * @param {Object} prob - Internal problem row from database
 * @returns {Object} FHIR Condition resource
 */
function toFhirCondition(prob) {
  const clinicalStatus = CLINICAL_STATUS_MAP[prob.status] || 'active';

  const resource = {
    resourceType: 'Condition',
    id: String(prob.id),
    meta: {
      lastUpdated: prob.created_at
    },
    clinicalStatus: codeableConcept(
      'http://terminology.hl7.org/CodeSystem/condition-clinical',
      clinicalStatus,
      clinicalStatus
    ),
    // verificationStatus intentionally omitted: the problems table carries no
    // clinical-certainty column, so hardcoding 'confirmed' would assert a
    // certainty the source data does not support. Per FHIR R4, verificationStatus
    // is optional; omitting is more truthful than fabricating 'confirmed'.
    // (fhir-condition-recordeddate-12)
    category: [codeableConcept(
      'http://terminology.hl7.org/CodeSystem/condition-category',
      'encounter-diagnosis',
      'Encounter Diagnosis'
    )],
    subject: reference('Patient', prob.patient_id)
  };

  // recordedDate — the dateTime the condition was first recorded in the system.
  // The problems table's created_at is the record-insertion timestamp, which is
  // the correct FHIR semantic for recordedDate (distinct from onsetDateTime).
  if (prob.created_at) {
    resource.recordedDate = prob.created_at;
  }

  // ICD-10-CM code
  if (prob.icd10_code) {
    resource.code = codeableConcept(
      'http://hl7.org/fhir/sid/icd-10-cm',
      prob.icd10_code,
      prob.problem_name
    );
  } else {
    resource.code = { text: prob.problem_name };
  }

  // Onset
  if (prob.onset_date) {
    resource.onsetDateTime = prob.onset_date;
  }

  // Abatement (resolved date)
  if (prob.resolved_date) {
    resource.abatementDateTime = prob.resolved_date;
  }

  // Notes
  if (prob.notes) {
    resource.note = [{ text: prob.notes }];
  }

  return resource;
}

module.exports = { toFhirCondition };
