'use strict';

/**
 * FHIR R4 Router
 * Mounts at /fhir/R4 — read-only translation layer over the Agentic EHR
 *
 * All persistence stays in the existing SQLite schema.
 * This layer is translation, validation, and routing only.
 */

const express = require('express');
const router = express.Router();

// Database (existing query functions)
const db = require('../database');

// FHIR utilities
const { sendFhir, sendError, searchBundle } = require('./utils/fhir-response');
const {
  parsePatientParam,
  parseIdentifierParam,
  buildSelfUrl,
  parsePagingParams,
  buildPageUrl,
  parseIncludeParam
} = require('./utils/search-params');

// Mappers
const { toFhirPatient } = require('./mappers/patient');
const { toFhirEncounter } = require('./mappers/encounter');
const { toFhirCondition } = require('./mappers/condition');
const { toFhirVitalObservations } = require('./mappers/observation-vitals');
const { toFhirLabObservation } = require('./mappers/observation-labs');
const { toFhirAllergyIntolerance } = require('./mappers/allergy-intolerance');
const { toFhirMedicationRequest } = require('./mappers/medication-request');
const { toFhirAppointment } = require('./mappers/appointment');
const { toFhirPractitioner } = require('./mappers/practitioner');

// CapabilityStatement
const { buildCapabilityStatement } = require('./capability-statement');

// Inbound ingestion
const { ingestBundle } = require('./inbound/bundle-ingest');

// SMART scope enforcement
const { smartScopeCheck } = require('./smart/scope-check');

// FHIR metrics
const { fhirMetricsMiddleware, statsHandler } = require('./utils/fhir-metrics');

// ──────────────────────────────────────────
// MIDDLEWARE: FHIR response headers + metrics + SMART scope enforcement
// ──────────────────────────────────────────
router.use((req, res, next) => {
  res.set('X-FHIR-Version', '4.0.1');
  next();
});

router.use(fhirMetricsMiddleware);
router.use(smartScopeCheck);

// ──────────────────────────────────────────
// METADATA (CapabilityStatement)
// ──────────────────────────────────────────

router.get('/metadata', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  sendFhir(res, buildCapabilityStatement(baseUrl));
});

// GET /fhir/R4/$stats — route telemetry (admin/monitoring)
router.get('/\\$stats', statsHandler);

// ──────────────────────────────────────────
// PATIENT
// ──────────────────────────────────────────

// GET /fhir/R4/Patient/:id
router.get('/Patient/:id', async (req, res) => {
  try {
    const patient = await db.getPatientById(parseInt(req.params.id, 10));
    if (!patient) {
      return sendError(res, 404, 'not-found', `Patient/${req.params.id} not found`);
    }
    sendFhir(res, toFhirPatient(patient));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// GET /fhir/R4/Patient?identifier=MRN&_count=20&_offset=0
router.get('/Patient', async (req, res) => {
  try {
    const patients = await db.getAllPatients();
    let results = patients;

    // Filter by identifier (MRN)
    if (req.query.identifier) {
      const ident = parseIdentifierParam(req.query.identifier);
      if (ident) {
        results = patients.filter(p => p.mrn === ident.value);
      }
    }

    // Filter by _id
    if (req.query._id) {
      const id = parseInt(req.query._id, 10);
      results = results.filter(p => p.id === id);
    }

    const allFhir = results.map(toFhirPatient);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    sendFhir(res, searchBundle('Patient', page, buildSelfUrl(req), { total, nextUrl, prevUrl }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// ENCOUNTER
// ──────────────────────────────────────────

// GET /fhir/R4/Encounter/:id
router.get('/Encounter/:id', async (req, res) => {
  try {
    const encounter = await db.getEncounterById(parseInt(req.params.id, 10));
    if (!encounter) {
      return sendError(res, 404, 'not-found', `Encounter/${req.params.id} not found`);
    }
    sendFhir(res, toFhirEncounter(encounter));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// GET /fhir/R4/Encounter?patient=:id&_count=20&_offset=0&_include=Encounter:patient
router.get('/Encounter', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }
    const encounters = await db.dbAll(
      'SELECT * FROM encounters WHERE patient_id = ? ORDER BY encounter_date DESC',
      [patientId]
    );

    const allFhir = encounters.map(toFhirEncounter);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    // _include=Encounter:patient → attach the referenced Patient resource
    const includes = parseIncludeParam(req.query._include);
    const includeResources = [];
    if (includes.has('Encounter:patient')) {
      const patient = await db.getPatientById(patientId);
      if (patient) includeResources.push(toFhirPatient(patient));
    }

    sendFhir(res, searchBundle('Encounter', page, buildSelfUrl(req),
      { total, nextUrl, prevUrl, includeResources }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// CONDITION
// ──────────────────────────────────────────

// GET /fhir/R4/Condition?patient=:id&_count=20&_offset=0
router.get('/Condition', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }
    const problems = await db.getPatientProblems(patientId);
    const allFhir = problems.map(toFhirCondition);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    sendFhir(res, searchBundle('Condition', page, buildSelfUrl(req), { total, nextUrl, prevUrl }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// OBSERVATION (vitals + labs, dispatched by category)
// ──────────────────────────────────────────

// GET /fhir/R4/Observation?patient=:id&category=vital-signs|laboratory&_count=20&_offset=0&_include=Observation:patient
router.get('/Observation', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }

    const category = req.query.category;
    let allFhir = [];

    if (!category || category === 'vital-signs') {
      const vitals = await db.getPatientVitals(patientId);
      for (const v of vitals) {
        allFhir.push(...toFhirVitalObservations(v));
      }
    }

    if (!category || category === 'laboratory') {
      const labs = await db.getPatientLabs(patientId);
      allFhir.push(...labs.map(toFhirLabObservation));
    }

    if (category && category !== 'vital-signs' && category !== 'laboratory') {
      return sendError(res, 400, 'invalid', `Unsupported category: ${category}. Use vital-signs or laboratory.`);
    }

    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    // _include=Observation:patient → attach the referenced Patient resource
    const includes = parseIncludeParam(req.query._include);
    const includeResources = [];
    if (includes.has('Observation:patient')) {
      const patient = await db.getPatientById(patientId);
      if (patient) includeResources.push(toFhirPatient(patient));
    }

    sendFhir(res, searchBundle('Observation', page, buildSelfUrl(req),
      { total, nextUrl, prevUrl, includeResources }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// ALLERGY INTOLERANCE
// ──────────────────────────────────────────

// GET /fhir/R4/AllergyIntolerance?patient=:id&_count=20&_offset=0
router.get('/AllergyIntolerance', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }
    const allergies = await db.getPatientAllergies(patientId);
    const allFhir = allergies.map(toFhirAllergyIntolerance);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    sendFhir(res, searchBundle('AllergyIntolerance', page, buildSelfUrl(req), { total, nextUrl, prevUrl }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// MEDICATION REQUEST
// ──────────────────────────────────────────

// GET /fhir/R4/MedicationRequest?patient=:id&_count=20&_offset=0
router.get('/MedicationRequest', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }
    const prescriptions = await db.dbAll(
      'SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_date DESC',
      [patientId]
    );
    const allFhir = prescriptions.map(toFhirMedicationRequest);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    sendFhir(res, searchBundle('MedicationRequest', page, buildSelfUrl(req), { total, nextUrl, prevUrl }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// APPOINTMENT
// ──────────────────────────────────────────

// GET /fhir/R4/Appointment?patient=:id&_count=20&_offset=0
router.get('/Appointment', async (req, res) => {
  try {
    const patientId = parsePatientParam(req.query.patient);
    if (!patientId) {
      return sendError(res, 400, 'invalid', 'Required search parameter: patient');
    }
    const appointments = await db.getAppointmentsByPatient(patientId);
    const allFhir = appointments.map(toFhirAppointment);
    const { count, offset } = parsePagingParams(req.query);
    const total = allFhir.length;
    const page  = allFhir.slice(offset, offset + count);
    const nextUrl = offset + count < total ? buildPageUrl(req, offset + count) : null;
    const prevUrl = offset > 0 ? buildPageUrl(req, Math.max(0, offset - count)) : null;

    sendFhir(res, searchBundle('Appointment', page, buildSelfUrl(req), { total, nextUrl, prevUrl }));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// PRACTITIONER
// ──────────────────────────────────────────

// GET /fhir/R4/Practitioner/:id
router.get('/Practitioner/:id', async (req, res) => {
  try {
    const user = await db.dbGet('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id, 10)]);
    if (!user) {
      return sendError(res, 404, 'not-found', `Practitioner/${req.params.id} not found`);
    }
    sendFhir(res, toFhirPractitioner(user));
  } catch (err) {
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// BUNDLE INGESTION (inbound)
// ──────────────────────────────────────────

// POST /fhir/R4/Bundle — ingest a transaction/batch Bundle
router.post('/Bundle', async (req, res) => {
  try {
    const bundle = req.body;
    if (!bundle || bundle.resourceType !== 'Bundle') {
      return sendError(res, 400, 'invalid', 'Request body must be a FHIR Bundle resource');
    }

    const result = await ingestBundle(bundle, {
      submittedBy: req.user?.username || null,
      source: req.headers['x-fhir-source'] || null,
    });

    // Build FHIR transaction-response Bundle
    const responseBundle = {
      resourceType: 'Bundle',
      type: 'transaction-response',
      id: result.jobId,
      entry: result.results.map(r => {
        const entry = {
          response: {
            status: r.status === 'success' ? '201 Created'
              : r.status === 'skipped' ? '200 OK'
              : '422 Unprocessable Entity',
          }
        };
        if (r.internalId) {
          entry.response.location = `${r.resourceType}/${r.internalId}`;
        }
        if (r.status === 'failed') {
          entry.response.outcome = {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: r.error || 'exception', diagnostics: r.message }]
          };
        }
        if (r.note) {
          entry.response.etag = r.note;
        }
        return entry;
      })
    };

    // 207 Multi-Status when mixed results; 200 on clean success; 422 on total failure
    const httpStatus = result.failureCount > 0 && result.successCount > 0 ? 207
      : result.failureCount > 0 && result.successCount === 0 ? 422
      : 200;

    res.status(httpStatus);
    sendFhir(res, responseBundle);
  } catch (err) {
    if (err.code === 'invalid-bundle') {
      return sendError(res, 400, 'invalid', err.message);
    }
    sendError(res, 500, 'exception', err.message);
  }
});

// ──────────────────────────────────────────
// FHIR WRITE ENDPOINTS (POST/PUT)
// ──────────────────────────────────────────
const fhirWrite = require('./inbound/fhir-write');
router.use(fhirWrite);

// ──────────────────────────────────────────
// CATCH-ALL: unsupported resource types
// ──────────────────────────────────────────

router.use((req, res) => {
  sendError(res, 404, 'not-supported',
    `Resource type not supported. See /fhir/R4/metadata for available resources.`);
});

module.exports = router;
