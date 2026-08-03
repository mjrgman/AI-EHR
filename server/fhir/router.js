'use strict';

/**
 * FHIR R4 Router
 * Mounts at /fhir/R4 — read-mostly runtime with scoped write ingress via POST /Bundle
 *
 * Read endpoints translate, validate, and route data from the existing EHR store.
 * `POST /Bundle` is a scoped write entrypoint guarded by SMART-on-FHIR and RBAC checks.
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

// RBAC — role-based resource access + PHI filtering (sec-fhir-rbac-idor-01)
const rbac = require('../security/rbac');

// FHIR metrics
const { fhirMetricsMiddleware, statsHandler } = require('./utils/fhir-metrics');

// ──────────────────────────────────────────
// RBAC: FHIR resource type → internal RBAC resource name.
// This is the second authorization layer on the FHIR surface (defense in depth
// alongside SMART scope-check). Maps each FHIR resourceType + request context to
// the rbac.ROLES canAccess/canWrite matrix and enforces it FAIL-CLOSED.
// ──────────────────────────────────────────
const FHIR_TO_RBAC_RESOURCE = {
  Patient: 'patients',
  Encounter: 'encounters',
  Condition: 'problems',
  AllergyIntolerance: 'allergies',
  MedicationRequest: 'medications',
  Appointment: 'encounters',
  // Observation is category-dependent (laboratory vs vital-signs) — resolved below.
  // Practitioner exposes no patient PHI (provider directory) — any authenticated
  // user may read it; not in this map (skipped by the guard).
  // Bundle writes are scope-gated (system/Bundle.write) by smartScopeCheck.
};

/** Resolve the RBAC resource name for a FHIR request, honoring Observation category. */
function rbacResourceFor(resourceType, req) {
  if (resourceType === 'Observation') {
    const category = req.query && req.query.category;
    if (category === 'laboratory') return 'labs';
    if (category === 'vital-signs') return 'vitals';
    // No/other category → the response can contain BOTH labs and vitals.
    // Fail closed: require access to the more-restricted of the two. We return
    // a synthetic marker that the guard expands into an "all-of" check.
    return ['labs', 'vitals'];
  }
  return FHIR_TO_RBAC_RESOURCE[resourceType] || null;
}

/**
 * FHIR RBAC guard — runs AFTER smartScopeCheck. Enforces the role's
 * canAccess (reads) / canWrite (writes) for the targeted resource. Deny-by-default:
 * an unknown role or a role lacking the permission gets 403.
 */
function fhirRbacGuard(req, res, next) {
  const role = req.user && req.user.role;
  const resourceType = req.path.replace(/^\//, '').split('/')[0];

  // Public / non-PHI endpoints: metadata, $stats, Practitioner directory, Bundle
  // (Bundle is scope-gated). These carry no patient PHI to filter.
  if (!resourceType || resourceType === 'metadata' || resourceType === '$stats'
      || resourceType === 'Practitioner' || resourceType === 'Bundle') {
    return next();
  }

  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  const required = rbacResourceFor(resourceType, req);

  // Resource type this router does not serve (e.g. DiagnosticReport) — no PHI
  // data path exists. Let it fall through to the router's catch-all 404
  // (FHIR-correct "not supported"); there is nothing to expose, so this is not
  // a fail-open. Every resource type that DOES carry PHI is in the map above
  // and is enforced below.
  if (!required) {
    return next();
  }

  const resources = Array.isArray(required) ? required : [required];
  const permitted = resources.every(r => isWrite ? rbac.canWrite(role, r) : rbac.canAccess(role, r));

  if (!permitted) {
    return res.status(403).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'forbidden',
        diagnostics: `Role '${role || 'unknown'}' cannot ${isWrite ? 'write' : 'read'} ${resourceType}.`,
      }],
    });
  }

  // PHI minimization on reads: wrap res.json to strip fields outside the role's
  // phiScope (no-op for roles with phiScope ['all'] such as physician/NP/system).
  if (!isWrite) {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      try {
        return originalJson(rbac.filterPHI(role, data));
      } catch (_) {
        return originalJson(data);
      }
    };
  }
  next();
}

// ──────────────────────────────────────────
// MIDDLEWARE: FHIR response headers + metrics + SMART scope enforcement + RBAC
// ──────────────────────────────────────────
router.use((req, res, next) => {
  res.set('X-FHIR-Version', '4.0.1');
  next();
});

router.use(fhirMetricsMiddleware);
router.use(smartScopeCheck);
router.use(fhirRbacGuard);

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

