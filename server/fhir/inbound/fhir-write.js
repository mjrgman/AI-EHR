'use strict';

/**
 * FHIR R4 Write Endpoints (POST/PUT)
 * Mounted under /fhir/R4 alongside the read-only router.
 *
 * Provides create/update operations for:
 *   - Patient (POST + PUT)
 *   - Observation (POST — labs and vitals)
 *   - Condition (POST)
 *   - AllergyIntolerance (POST)
 *
 * Each write is validated, persisted via the shared database layer,
 * and logged to audit_log for HIPAA traceability.
 */

const express = require('express');
const router = express.Router();

const db = require('../../database');

// Existing mappers — used to return conformant FHIR after write
const { toFhirPatient } = require('../mappers/patient');
const { toFhirCondition } = require('../mappers/condition');
const { toFhirAllergyIntolerance } = require('../mappers/allergy-intolerance');
const { toFhirLabObservation } = require('../mappers/observation-labs');
const { toFhirVitalObservations } = require('../mappers/observation-vitals');

// Response helpers
const { sendFhir, sendError } = require('../utils/fhir-response');

// Inbound patient translator (already exists)
const { fromFhirPatient } = require('./patient');

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────

/**
 * Build a FHIR OperationOutcome resource.
 * @param {string} severity - fatal | error | warning | information
 * @param {string} code     - IssueType code (required, invalid, etc.)
 * @param {string} diagnostics - Human-readable description
 */
function operationOutcome(severity, code, diagnostics) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity, code, diagnostics }]
  };
}

/**
 * Extract a numeric patient_id from a FHIR reference string.
 * "Patient/123" → 123, "Patient/abc" → NaN
 */
function parseReference(ref) {
  if (!ref) return NaN;
  const str = typeof ref === 'object' ? ref.reference : ref;
  if (!str) return NaN;
  const parts = str.split('/');
  return parseInt(parts[parts.length - 1], 10);
}

/**
 * Write a row to audit_log.
 * Fire-and-forget — never blocks the response.
 */
function auditLog(action, resourceType, resourceId, patientId, req) {
  const user = req.user || {};
  db.dbRun(
    `INSERT INTO audit_log
       (user_identity, user_role, action, resource_type, resource_id,
        patient_id, request_method, request_path, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.username || user.sub || 'unknown',
      user.role || null,
      action,
      resourceType,
      resourceId || null,
      patientId || null,
      req.method,
      req.originalUrl,
      req.ip,
      req.get('User-Agent') || null
    ]
  ).catch(err => console.error('[FHIR-WRITE] audit log error:', err.message));
}

/**
 * Determine observation category from the FHIR resource.
 * Returns 'laboratory' | 'vital-signs' | null
 */
function resolveObservationCategory(resource) {
  if (!Array.isArray(resource.category)) return null;
  for (const cat of resource.category) {
    if (!cat.coding) continue;
    for (const c of cat.coding) {
      if (c.code === 'laboratory') return 'laboratory';
      if (c.code === 'vital-signs') return 'vital-signs';
    }
  }
  return null;
}

/**
 * Extract the first code + display from a CodeableConcept.
 * Returns { code, display, system } or nulls.
 */
function firstCoding(codeableConcept) {
  if (!codeableConcept) return { code: null, display: null, system: null };
  if (Array.isArray(codeableConcept.coding) && codeableConcept.coding.length > 0) {
    const c = codeableConcept.coding[0];
    return { code: c.code || null, display: c.display || null, system: c.system || null };
  }
  return { code: null, display: codeableConcept.text || null, system: null };
}

// FHIR gender → internal sex
const GENDER_TO_SEX = { male: 'M', female: 'F', other: 'Other', unknown: 'Other' };

// FHIR AllergyIntolerance criticality → internal severity
const CRITICALITY_MAP = { low: 'mild', high: 'severe', 'unable-to-assess': 'moderate' };

// ──────────────────────────────────────────
// POST /Patient — Create a new patient
// ──────────────────────────────────────────

router.post('/Patient', async (req, res) => {
  try {
    const resource = req.body;

    // Use existing inbound translator for validation + mapping
    const { data, errors } = fromFhirPatient(resource);
    if (errors.length > 0) {
      const msg = errors.map(e => `${e.field}: ${e.message}`).join('; ');
      return sendFhir(res, operationOutcome('error', 'required', msg), 400);
    }

    // Map sex field (fromFhirPatient uses 'M'/'F'/'O'/'U'; DB accepts 'M'/'F'/'Other')
    const sex = data.sex === 'O' || data.sex === 'U' ? 'Other' : data.sex;

    const result = await db.createPatient({
      first_name: data.first_name,
      middle_name: data.middle_name,
      last_name: data.last_name,
      dob: data.dob,
      sex,
      phone: data.phone,
      email: data.email,
      address_line1: data.address_line1,
      address_line2: data.address_line2,
      city: data.city,
      state: data.state,
      zip: data.zip,
      insurance_carrier: data.insurance_carrier,
      insurance_id: data.insurance_id
    });

    auditLog('fhir_create', 'Patient', result.id, result.id, req);

    // Fetch the full row so the mapper can produce a conformant response
    const created = await db.getPatientById(result.id);
    const fhirPatient = toFhirPatient(created);

    res.set('Location', `/fhir/R4/Patient/${result.id}`);
    sendFhir(res, fhirPatient, 201);
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// PUT /Patient/:id — Update existing patient
// ──────────────────────────────────────────

router.put('/Patient/:id', async (req, res) => {
  try {
    const patientId = parseInt(req.params.id, 10);
    if (isNaN(patientId)) {
      return sendFhir(res, operationOutcome('error', 'invalid', 'Patient id must be numeric'), 400);
    }

    const existing = await db.getPatientById(patientId);
    if (!existing) {
      return sendFhir(res, operationOutcome('error', 'not-found', `Patient/${patientId} not found`), 404);
    }

    const resource = req.body;
    const { data, errors } = fromFhirPatient(resource);
    if (errors.length > 0) {
      const msg = errors.map(e => `${e.field}: ${e.message}`).join('; ');
      return sendFhir(res, operationOutcome('error', 'required', msg), 400);
    }

    const sex = data.sex === 'O' || data.sex === 'U' ? 'Other' : data.sex;

    await db.dbRun(
      `UPDATE patients SET
         first_name = ?, middle_name = ?, last_name = ?, dob = ?, sex = ?,
         phone = ?, email = ?,
         address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        data.first_name, data.middle_name, data.last_name, data.dob, sex,
        data.phone, data.email,
        data.address_line1, data.address_line2, data.city, data.state, data.zip,
        patientId
      ]
    );

    auditLog('fhir_update', 'Patient', patientId, patientId, req);

    const updated = await db.getPatientById(patientId);
    sendFhir(res, toFhirPatient(updated), 200);
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// POST /Observation — Create observation (lab or vital)
// ──────────────────────────────────────────

router.post('/Observation', async (req, res) => {
  try {
    const resource = req.body;

    if (!resource || resource.resourceType !== 'Observation') {
      return sendFhir(res, operationOutcome('error', 'invalid', 'Expected resourceType Observation'), 400);
    }

    // Determine category
    const category = resolveObservationCategory(resource);
    if (!category) {
      return sendFhir(res, operationOutcome('error', 'required',
        'Observation.category is required with coding "laboratory" or "vital-signs"'), 400);
    }

    // Patient reference — required
    const patientId = parseReference(resource.subject);
    if (isNaN(patientId)) {
      return sendFhir(res, operationOutcome('error', 'required',
        'Observation.subject must reference a Patient (e.g. "Patient/123")'), 400);
    }

    // Verify patient exists
    const patient = await db.getPatientById(patientId);
    if (!patient) {
      return sendFhir(res, operationOutcome('error', 'not-found', `Patient/${patientId} not found`), 404);
    }

    // ── Laboratory ──
    if (category === 'laboratory') {
      const { display: testName, code: loincCode } = firstCoding(resource.code);
      if (!testName && !loincCode) {
        return sendFhir(res, operationOutcome('error', 'required',
          'Observation.code is required for laboratory observations'), 400);
      }

      // Extract value
      let resultValue = null;
      let units = null;
      if (resource.valueQuantity) {
        resultValue = String(resource.valueQuantity.value);
        units = resource.valueQuantity.unit || resource.valueQuantity.code || null;
      } else if (resource.valueString != null) {
        resultValue = resource.valueString;
      }

      // Interpretation → abnormal_flag
      let abnormalFlag = null;
      if (Array.isArray(resource.interpretation) && resource.interpretation.length > 0) {
        const interpCoding = firstCoding(resource.interpretation[0]);
        abnormalFlag = interpCoding.code || null;
      }

      // Status mapping (FHIR → internal)
      const STATUS_REVERSE = {
        registered: 'pending', preliminary: 'resulted', final: 'final',
        amended: 'final', corrected: 'final'
      };
      const status = STATUS_REVERSE[resource.status] || 'final';

      const result = await db.addLab({
        patient_id: patientId,
        test_name: testName || loincCode,
        result_value: resultValue,
        reference_range: null,
        units,
        result_date: resource.effectiveDateTime || new Date().toISOString().split('T')[0],
        status,
        abnormal_flag: abnormalFlag,
        notes: null
      });

      auditLog('fhir_create', 'Observation', result.id, patientId, req);

      // Fetch and return as FHIR
      const labRow = await db.dbGet('SELECT * FROM labs WHERE id = ?', [result.id]);
      labRow.patient_id = patientId; // ensure mapper has it
      const fhirObs = toFhirLabObservation(labRow);
      res.set('Location', `/fhir/R4/Observation/${fhirObs.id}`);
      sendFhir(res, fhirObs, 201);
      return;
    }

    // ── Vital Signs ──
    if (category === 'vital-signs') {
      // Encounter reference (optional)
      const encounterId = resource.encounter ? parseReference(resource.encounter) : null;

      // Extract component values for a vitals row
      const vitalsData = {
        patient_id: patientId,
        encounter_id: isNaN(encounterId) ? null : encounterId,
        systolic_bp: null,
        diastolic_bp: null,
        heart_rate: null,
        respiratory_rate: null,
        temperature: null,
        weight: null,
        height: null,
        spo2: null,
        recorded_by: (req.user && (req.user.username || req.user.sub)) || null
      };

      // LOINC code → vitals field mapping
      const LOINC_TO_FIELD = {
        '8480-6':  'systolic_bp',
        '8462-4':  'diastolic_bp',
        '8867-4':  'heart_rate',
        '9279-1':  'respiratory_rate',
        '8310-5':  'temperature',
        '29463-7': 'weight',
        '8302-2':  'height',
        '2708-6':  'spo2'
      };

      // Check for a top-level valueQuantity (single vital)
      const topCoding = firstCoding(resource.code);
      if (topCoding.code && LOINC_TO_FIELD[topCoding.code] && resource.valueQuantity) {
        vitalsData[LOINC_TO_FIELD[topCoding.code]] = resource.valueQuantity.value;
      }

      // Check component array (blood pressure panel or multi-vital)
      if (Array.isArray(resource.component)) {
        for (const comp of resource.component) {
          const compCoding = firstCoding(comp.code);
          if (compCoding.code && LOINC_TO_FIELD[compCoding.code] && comp.valueQuantity) {
            vitalsData[LOINC_TO_FIELD[compCoding.code]] = comp.valueQuantity.value;
          }
        }
      }

      // At least one vital sign value required
      const hasValue = ['systolic_bp', 'diastolic_bp', 'heart_rate', 'respiratory_rate',
        'temperature', 'weight', 'height', 'spo2']
        .some(f => vitalsData[f] != null);

      if (!hasValue) {
        return sendFhir(res, operationOutcome('error', 'required',
          'At least one vital sign value is required (via valueQuantity or component)'), 400);
      }

      const result = await db.addVitals(vitalsData);

      auditLog('fhir_create', 'Observation', result.id, patientId, req);

      // Fetch and return — vitals mapper produces an array, return the first entry
      const vitalsRow = await db.dbGet('SELECT * FROM vitals WHERE id = ?', [result.id]);
      const fhirObsList = toFhirVitalObservations(vitalsRow);
      const fhirObs = fhirObsList.length > 0 ? fhirObsList[0] : { resourceType: 'Observation', id: String(result.id) };
      res.set('Location', `/fhir/R4/Observation/${fhirObs.id}`);
      sendFhir(res, fhirObs, 201);
      return;
    }
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// POST /Condition — Create condition/problem
// ──────────────────────────────────────────

router.post('/Condition', async (req, res) => {
  try {
    const resource = req.body;

    if (!resource || resource.resourceType !== 'Condition') {
      return sendFhir(res, operationOutcome('error', 'invalid', 'Expected resourceType Condition'), 400);
    }

    // Patient reference — required
    const patientId = parseReference(resource.subject);
    if (isNaN(patientId)) {
      return sendFhir(res, operationOutcome('error', 'required',
        'Condition.subject must reference a Patient (e.g. "Patient/123")'), 400);
    }

    const patient = await db.getPatientById(patientId);
    if (!patient) {
      return sendFhir(res, operationOutcome('error', 'not-found', `Patient/${patientId} not found`), 404);
    }

    // Code — required (problem name)
    const { code: icd10Code, display: problemName } = firstCoding(resource.code);
    const problemText = problemName || (resource.code && resource.code.text) || null;
    if (!problemText && !icd10Code) {
      return sendFhir(res, operationOutcome('error', 'required',
        'Condition.code is required (provide coding or text)'), 400);
    }

    // Clinical status → internal status
    let status = 'active';
    if (resource.clinicalStatus) {
      const statusCoding = firstCoding(resource.clinicalStatus);
      if (statusCoding.code === 'resolved') status = 'resolved';
      else if (statusCoding.code === 'active') status = 'active';
      // 'recurrence', 'relapse', 'inactive' all map to active for simplicity
    }

    const result = await db.addProblem({
      patient_id: patientId,
      problem_name: problemText || icd10Code,
      icd10_code: icd10Code || null,
      onset_date: resource.onsetDateTime || null,
      status,
      notes: resource.note && resource.note[0] ? resource.note[0].text : null
    });

    auditLog('fhir_create', 'Condition', result.id, patientId, req);

    // Fetch and return as FHIR
    const row = await db.dbGet('SELECT * FROM problems WHERE id = ?', [result.id]);
    const fhirCondition = toFhirCondition(row);
    res.set('Location', `/fhir/R4/Condition/${result.id}`);
    sendFhir(res, fhirCondition, 201);
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// POST /AllergyIntolerance — Create allergy
// ──────────────────────────────────────────

router.post('/AllergyIntolerance', async (req, res) => {
  try {
    const resource = req.body;

    if (!resource || resource.resourceType !== 'AllergyIntolerance') {
      return sendFhir(res, operationOutcome('error', 'invalid', 'Expected resourceType AllergyIntolerance'), 400);
    }

    // Patient reference — required
    const patientId = parseReference(resource.patient);
    if (isNaN(patientId)) {
      return sendFhir(res, operationOutcome('error', 'required',
        'AllergyIntolerance.patient must reference a Patient (e.g. "Patient/123")'), 400);
    }

    const patient = await db.getPatientById(patientId);
    if (!patient) {
      return sendFhir(res, operationOutcome('error', 'not-found', `Patient/${patientId} not found`), 404);
    }

    // Allergen — required (code.text or code.coding)
    const allergenCoding = firstCoding(resource.code);
    const allergen = allergenCoding.display || (resource.code && resource.code.text) || null;
    if (!allergen) {
      return sendFhir(res, operationOutcome('error', 'required',
        'AllergyIntolerance.code is required (allergen name in coding.display or text)'), 400);
    }

    // Reaction manifestation
    let reaction = null;
    if (Array.isArray(resource.reaction) && resource.reaction.length > 0) {
      const r = resource.reaction[0];
      if (Array.isArray(r.manifestation) && r.manifestation.length > 0) {
        const m = r.manifestation[0];
        reaction = (m.text) || (m.coding && m.coding[0] && m.coding[0].display) || null;
      }
    }

    // Criticality → severity
    const severity = CRITICALITY_MAP[resource.criticality] || 'moderate';

    // Clinical status → verified flag
    let verified = 1;
    if (resource.verificationStatus) {
      const vsCoding = firstCoding(resource.verificationStatus);
      if (vsCoding.code === 'unconfirmed' || vsCoding.code === 'entered-in-error') {
        verified = 0;
      }
    }

    const result = await db.addAllergy({
      patient_id: patientId,
      allergen,
      reaction,
      severity,
      onset_date: resource.onsetDateTime || null,
      verified,
      notes: resource.note && resource.note[0] ? resource.note[0].text : null
    });

    auditLog('fhir_create', 'AllergyIntolerance', result.id, patientId, req);

    // Fetch and return as FHIR
    const row = await db.dbGet('SELECT * FROM allergies WHERE id = ?', [result.id]);
    const fhirAllergy = toFhirAllergyIntolerance(row);
    res.set('Location', `/fhir/R4/AllergyIntolerance/${result.id}`);
    sendFhir(res, fhirAllergy, 201);
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

module.exports = router;
