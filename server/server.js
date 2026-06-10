const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const db = require('./database');
const aiClient = require('./ai-client');
const workflow = require('./workflow-engine');
const cds = require('./cds-engine');
const drugSafety = require('./pharma/drug-safety-service');
const providerLearning = require('./provider-learning');
const audit = require('./audit-logger');
const logger = require('./utils/logger');
const { validate, schemas } = require('./utils/validate');
const auth = require('./security/auth');
const rbac = require('./security/rbac');
const refreshTokens = require('./security/refresh-tokens');
const { runMigrations } = require('./database-migrations');
const triage = require('./triage-service');
const { seedDecisionQueue } = require('./decision-queue-seed');
const billing = require('./billing-engine');
const fhirRouter = require('./fhir/router');
const { buildSmartConfiguration } = require('./fhir/smart/smart-config');
const { tokenHandler, introspectHandler, authorizeHandler, launchHandler, revokeHandler, registerClientHandler } = require('./fhir/smart/token');
const cdsHooksRouter = require('./integrations/cds-hooks');
const eventBusRouter = require('./integrations/event-bus').router;
const { buildAuthRouter } = require('./routes/auth-routes');
const patientPortalRouter = require('./routes/patient-portal');
const { mountLabCorpRoutes } = require('./routes/labcorp-routes');
const { mountMediVaultRoutes } = require('./routes/medivault-routes');
const { mountCareManagementRoutes } = require('./routes/care-management-routes');
const { mountHedisRoutes } = require('./routes/hedis-routes');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_START_TIME = Date.now();

// ==========================================
// PROCESS-LEVEL ERROR HANDLERS (must be first)
// ==========================================

process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit — log and continue. The request-level handler will catch individual failures.
});

process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught Exception — shutting down', {
    error: error.message,
    stack: error.stack,
  });
  // Give logs time to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

// ==========================================
// MIDDLEWARE
// ==========================================

// Helmet with nonce-based CSP (replaces contentSecurityPolicy: false)
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — locked to configured origins in production
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());
const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (isDevelopment) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  exposedHeaders: ['X-Audit-Session-Id', 'X-RateLimit-Remaining'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));
app.use(audit.auditMiddleware({
  excludePaths: ['/api/health', '/api/ai/status'],
}));

// ==========================================
// VALIDATION HELPERS
// ==========================================

function validateId(id) {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  return null;
}

function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return str;
  return str.trim().slice(0, maxLength);
}

function getRequestRole(req) {
  return req.user?.role || req.session?.userRole || 'guest';
}

function filterEncounterForRole(req, encounter) {
  if (!encounter || typeof encounter !== 'object') return encounter;

  const role = getRequestRole(req);
  if (rbac.canAccess(role, 'notes')) return encounter;

  const filtered = { ...encounter };
  delete filtered.transcript;
  delete filtered.soap_note;
  return filtered;
}

function filterPatientBundleForRole(req, payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const role = getRequestRole(req);
  const filtered = { ...payload };

  if (!rbac.canAccess(role, 'problems')) delete filtered.problems;
  if (!rbac.canAccess(role, 'medications')) delete filtered.medications;
  if (!rbac.canAccess(role, 'allergies')) delete filtered.allergies;
  if (!rbac.canAccess(role, 'labs')) delete filtered.labs;
  if (!rbac.canAccess(role, 'vitals')) {
    delete filtered.vitals;
    delete filtered.vitals_history;
  }

  return filtered;
}

function requireAnyResourceAccess(...resourceTypes) {
  return (req, res, next) => {
    const role = getRequestRole(req);
    if (resourceTypes.some((resourceType) => rbac.canAccess(role, resourceType))) {
      return next();
    }

    return res.status(403).json({
      error: 'Insufficient permissions',
      userRole: role,
      requiredAnyOf: resourceTypes,
    });
  };
}

function filterEncounterOrdersForRole(req, payload) {
  const role = getRequestRole(req);
  const filtered = { encounter_id: payload.encounter_id };

  if (rbac.canAccess(role, 'lab_orders')) filtered.lab_orders = payload.lab_orders;
  if (rbac.canAccess(role, 'imaging_orders')) filtered.imaging_orders = payload.imaging_orders;
  if (rbac.canAccess(role, 'referrals')) filtered.referrals = payload.referrals;
  if (rbac.canAccess(role, 'prescriptions')) filtered.prescriptions = payload.prescriptions;

  filtered.total_orders = [
    filtered.lab_orders?.length || 0,
    filtered.imaging_orders?.length || 0,
    filtered.referrals?.length || 0,
    filtered.prescriptions?.length || 0,
  ].reduce((sum, count) => sum + count, 0);

  return filtered;
}

// ==========================================
// SMART-on-FHIR DISCOVERY (unauthenticated — must precede auth middleware)
// ==========================================

app.get('/.well-known/smart-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'application/json');
  res.json(buildSmartConfiguration(baseUrl));
});

app.get('/.well-known/jwks.json', (req, res) => {
  // HMAC (HS256) keys are symmetric and not published in JWKS.
  // This endpoint acknowledges the spec while documenting the key algorithm.
  res.json({
    keys: [],
    _note: 'This server uses HS256 (symmetric). Token verification requires the shared secret.',
  });
});

// ==========================================
// SMART-on-FHIR ENDPOINTS
// ==========================================

app.post('/smart/token', tokenHandler);
app.get('/smart/introspect', introspectHandler);
app.post('/smart/introspect', introspectHandler);
app.get('/smart/authorize', authorizeHandler);
app.get('/smart/launch', auth.requireAuth, launchHandler);
app.post('/smart/revoke', revokeHandler);
app.post('/smart/register', registerClientHandler);

// ==========================================
// FHIR R4 TRANSLATION LAYER
// ==========================================
app.use('/fhir/R4', auth.requireAuth, fhirRouter);

// ==========================================
// CDS HOOKS (HL7 spec — vendor CDS integration)
// ==========================================
app.use('/cds-services', auth.requireAuth, cdsHooksRouter);

// ==========================================
// PUBLIC API ROUTES (must precede the global /api auth wall)
// ==========================================

app.use('/api/auth', buildAuthRouter({ auth, db, logger, refreshTokens }));
app.use('/api/patient-portal', patientPortalRouter);

// MediVault exports accept either a clinician JWT or a matching patient
// portal session, so the route performs its own auth check before the
// global /api auth wall.
mountMediVaultRoutes(app, { db });

// ==========================================
// AUTHENTICATION & RBAC FOR ALL OTHER API ROUTES
// ==========================================

// Require authentication on all API routes
app.use('/api', auth.requireAuth);

// RBAC: resource-level access control per route group
app.use('/api/patients', rbac.requireResourceAccess('patients'));
app.use('/api/encounters', rbac.requireResourceAccess('encounters'));
app.use('/api/prescriptions', rbac.requireResourceAccess('medications'));
app.use('/api/medications', rbac.requireResourceAccess('medications'));
app.use('/api/audit', rbac.requireRole('admin'));
app.use('/api/billing', rbac.requireResourceAccess('billing'));
app.use('/api/charges', rbac.requireResourceAccess('billing'));
app.use('/api/appointments', rbac.requireResourceAccess('encounters'));
app.use('/api/scheduling', rbac.requireResourceAccess('encounters'));
app.use('/api/lab-orders', rbac.requireResourceAccess('lab_orders'));
app.use('/api/imaging-orders', rbac.requireResourceAccess('imaging_orders'));
app.use('/api/referrals', rbac.requireResourceAccess('referrals'));
app.use('/api/vitals', rbac.requireResourceAccess('vitals'));
app.use('/api/webhooks', rbac.requireRole('admin'), eventBusRouter);

// LabCorp integration routes (Phase 2b — Chunk 5).
// mountLabCorpRoutes registers:
//   GET  /api/integrations/labcorp/status
//   POST /api/integrations/labcorp/oauth/start
//   GET  /api/integrations/labcorp/oauth/callback
//   POST /api/orders/:id/submit-to-labcorp
// All land under /api/* so auth.requireAuth above wraps them. The callback
// endpoint tolerates a missing req.user because OAuth2 redirects don't
// carry the app's JWT — it derives userId from the pending-state record.
mountLabCorpRoutes(app, { db });

// MediVault export routes are mounted above the global /api auth wall so they
// can accept either a clinician JWT or a matching patient-portal session.
//   GET /api/medivault/export/:patientId  → FHIR R4 Bundle (collection)
// audit-logger PHI_ROUTES still captures each export as a vault_export READ.

// Care Management engine routes (Phase 2 of primary-care deepening).
// mountCareManagementRoutes registers:
//   GET  /api/care-management/codes              → CPT/HCPCS catalog
//   POST /api/care-management/eligibility        → per-program eligibility
//   POST /api/care-management/billable           → monthly billable code computation
//   POST /api/care-management/conflict-check     → stacking conflict pre-flight
// Inherits /api/* auth pipeline. PHI inputs come from request body so the
// caller is responsible for validating they have access to the patient first.
mountCareManagementRoutes(app, { db });

// HEDIS quality-measure adapter routes (Phase 6 of primary-care deepening).
// mountHedisRoutes registers:
//   GET  /api/quality/hedis/measures             → measure-ID list
//   POST /api/quality/hedis/evaluate/:measureId  → single-measure eval for a patient
//   POST /api/quality/hedis/all                  → all-measure eval for a patient
// Inherits /api/* auth pipeline. PHI inputs come via request body — clinician
// must already have access to the patient before calling.
mountHedisRoutes(app, { db });

// ==========================================
// PATIENT ENDPOINTS
// ==========================================

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await db.getAllPatients();
    const role = getRequestRole(req);
    res.json(patients.map((patient) => rbac.filterPHI(role, patient)));
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get patient by ID with full details
app.get('/api/patients/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    const patient = await db.getPatientById(id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const role = getRequestRole(req);
    const visiblePatient = rbac.filterPHI(role, patient);

    const [problems, medications, allergies, labs, vitals] = await Promise.all([
      db.getPatientProblems(id),
      db.getPatientMedications(id),
      db.getPatientAllergies(id),
      db.getPatientLabs(id),
      db.getPatientVitals(id)
    ]);

    res.json(filterPatientBundleForRole(req, {
      ...visiblePatient,
      age: db.calculateAge(patient.dob),
      problems,
      medications,
      allergies,
      labs,
      vitals: vitals.length > 0 ? vitals[0] : null,
      vitals_history: vitals
    }));
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Create new patient
app.post('/api/patients', validate(schemas.createPatient), async (req, res) => {
  try {
    const patientData = {
      first_name: sanitizeString(req.body.first_name, 100),
      middle_name: sanitizeString(req.body.middle_name, 100),
      last_name: sanitizeString(req.body.last_name, 100),
      dob: req.body.dob,
      sex: req.body.sex,
      phone: sanitizeString(req.body.phone, 20),
      email: sanitizeString(req.body.email, 200),
      address_line1: sanitizeString(req.body.address_line1, 200),
      address_line2: sanitizeString(req.body.address_line2, 200),
      city: sanitizeString(req.body.city, 100),
      state: sanitizeString(req.body.state, 2),
      zip: sanitizeString(req.body.zip, 10),
      insurance_carrier: sanitizeString(req.body.insurance_carrier, 200),
      insurance_id: sanitizeString(req.body.insurance_id, 50)
    };

    const result = await db.createPatient(patientData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// Extract patient data from speech transcript
app.post('/api/patients/extract-from-speech', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required and must be a string' });
    }

    const trimmed = sanitizeString(transcript, 10000);

    // Use AI to extract patient demographics
    const _extracted = await aiClient.extractClinicalData(trimmed, {});

    // Pattern matching for demographics
    const nameMatch = trimmed.match(/(?:name is|patient|called)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
    const dobMatch = trimmed.match(/(?:date of birth|DOB|born)\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
    const phoneMatch = trimmed.match(/(?:phone|number)\s+(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
    const addressMatch = trimmed.match(/(?:lives at|address)\s+(\d+\s+[A-Za-z\s]+)/i);
    const insuranceMatch = trimmed.match(/(?:insurance|covered by)\s+([A-Za-z\s]+)(?:,|member)/i);

    const patientData = {
      first_name: nameMatch ? nameMatch[1] : '',
      last_name: nameMatch ? nameMatch[2] : '',
      dob: dobMatch ? new Date(dobMatch[1]).toISOString().split('T')[0] : null,
      phone: phoneMatch ? phoneMatch[1].replace(/[-.\s]/g, '') : '',
      address_line1: addressMatch ? addressMatch[1] : '',
      insurance_carrier: insuranceMatch ? insuranceMatch[1].trim() : ''
    };

    res.json({ extracted: patientData });
  } catch (error) {
    console.error('Error extracting patient data:', error);
    res.status(500).json({ error: 'Failed to extract patient data' });
  }
});

// ==========================================
// PROBLEM LIST ENDPOINTS
// ==========================================

app.post('/api/patients/:id/problems', rbac.requireResourceAccess('problems'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    const err = requireFields(req.body, ['problem_name']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const problemData = {
      patient_id: id,
      problem_name: sanitizeString(req.body.problem_name, 300),
      icd10_code: sanitizeString(req.body.icd10_code, 10),
      onset_date: req.body.onset_date || null,
      status: req.body.status || 'active',
      notes: sanitizeString(req.body.notes, 1000)
    };
    const result = await db.addProblem(problemData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding problem:', error);
    res.status(500).json({ error: 'Failed to add problem' });
  }
});

// ==========================================
// MEDICATION ENDPOINTS
// ==========================================

app.get('/api/patients/:id/medications', rbac.requireResourceAccess('medications'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    const medications = await db.getPatientMedications(id);
    res.json(medications);
  } catch (error) {
    console.error('Error fetching medications:', error);
    res.status(500).json({ error: 'Failed to fetch medications' });
  }
});

app.post('/api/patients/:id/medications', rbac.requireResourceAccess('medications'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid patient ID' });
    }

    const err = requireFields(req.body, ['medication_name']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const medData = {
      patient_id: id,
      medication_name: sanitizeString(req.body.medication_name, 200),
      generic_name: sanitizeString(req.body.generic_name, 200),
      dose: sanitizeString(req.body.dose, 50),
      route: sanitizeString(req.body.route, 20),
      frequency: sanitizeString(req.body.frequency, 50),
      start_date: req.body.start_date || null,
      status: req.body.status || 'active',
      prescriber: sanitizeString(req.body.prescriber, 200)
    };
    const result = await db.addMedication(medData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding medication:', error);
    res.status(500).json({ error: 'Failed to add medication' });
  }
});

// ==========================================
// ENCOUNTER ENDPOINTS
// ==========================================

app.get('/api/encounters', async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    let encounters;
    if (patient_id) {
      const pid = validateId(patient_id);
      if (!pid) return res.status(400).json({ error: 'Invalid patient_id' });
      encounters = await db.dbAll(
        `SELECT e.*, p.first_name, p.last_name, p.mrn
         FROM encounters e JOIN patients p ON e.patient_id = p.id
         WHERE e.patient_id = ? ORDER BY e.encounter_date DESC`,
        [pid]
      );
    } else if (status) {
      encounters = await db.dbAll(
        `SELECT e.*, p.first_name, p.last_name, p.mrn
         FROM encounters e JOIN patients p ON e.patient_id = p.id
         WHERE e.status = ? ORDER BY e.encounter_date DESC`,
        [status]
      );
    } else {
      encounters = await db.dbAll(
        `SELECT e.*, p.first_name, p.last_name, p.mrn
         FROM encounters e JOIN patients p ON e.patient_id = p.id
         ORDER BY e.encounter_date DESC LIMIT 50`
      );
    }
    res.json(encounters.map((encounter) => filterEncounterForRole(req, encounter)));
  } catch (error) {
    console.error('Error fetching encounters:', error);
    res.status(500).json({ error: 'Failed to fetch encounters' });
  }
});

app.get('/api/encounters/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid encounter ID' });

    const encounter = await db.getEncounterById(id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

    res.json(filterEncounterForRole(req, encounter));
  } catch (error) {
    console.error('Error fetching encounter:', error);
    res.status(500).json({ error: 'Failed to fetch encounter' });
  }
});

app.post('/api/encounters', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const encounterData = {
      patient_id: patientId,
      encounter_date: req.body.encounter_date || new Date().toISOString().split('T')[0],
      encounter_type: sanitizeString(req.body.encounter_type, 100),
      chief_complaint: sanitizeString(req.body.chief_complaint, 500),
      provider: sanitizeString(req.body.provider || process.env.PROVIDER_NAME || 'Dr. Provider', 200)
    };
    const result = await db.createEncounter(encounterData);

    // Auto-create workflow for this encounter
    try {
      const wf = await workflow.createWorkflow(result.id, patientId, {
        assigned_ma: req.body.assigned_ma || null,
        assigned_provider: encounterData.provider
      });
      result.workflow = wf;
    } catch (wfErr) {
      console.error('Warning: Could not create workflow:', wfErr.message);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating encounter:', error);
    res.status(500).json({ error: 'Failed to create encounter' });
  }
});

app.patch('/api/encounters/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid encounter ID' });
    }

    if (req.body.status !== undefined) {
      const allowedStatuses = ['in-progress', 'completed', 'signed'];
      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
      }
    }

    const updates = {};
    if (req.body.transcript !== undefined) updates.transcript = sanitizeString(req.body.transcript, 50000);
    if (req.body.soap_note !== undefined) updates.soap_note = sanitizeString(req.body.soap_note, 50000);
    if (req.body.chief_complaint !== undefined) updates.chief_complaint = sanitizeString(req.body.chief_complaint, 500);
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.duration_minutes !== undefined) updates.duration_minutes = parseInt(req.body.duration_minutes, 10) || null;

    const result = await db.updateEncounter(id, updates);

    // If transcript was updated, run CDS evaluation
    let cdsSuggestions = [];
    if (updates.transcript && req.body.patient_id) {
      try {
        const pid = validateId(req.body.patient_id);
        if (pid) {
          const context = await cds.buildPatientContext(pid, id);
          cdsSuggestions = await cds.evaluatePatientContext(id, pid, context);
        }
      } catch (cdsErr) {
        console.error('CDS evaluation error (non-fatal):', cdsErr.message);
      }
    }

    res.json({ ...result, cds_suggestions: cdsSuggestions });
  } catch (error) {
    console.error('Error updating encounter:', error);
    res.status(500).json({ error: 'Failed to update encounter' });
  }
});

// ==========================================
// AI/CLINICAL DATA ENDPOINTS
// ==========================================

app.post('/api/ai/extract-data', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const patient = patient_id ? await db.getPatientById(validateId(patient_id)) : null;
    const result = await aiClient.extractClinicalData(sanitizeString(transcript, 20000), patient);

    // Unwrap the result (extractClinicalData returns { extracted, extraction_summary })
    const extracted = result.extracted || result;
    const extractionSummary = result.extraction_summary || null;

    // If encounter_id is provided, run CDS after extraction
    let cdsSuggestions = [];
    if (encounter_id && patient_id) {
      try {
        const eid = validateId(encounter_id);
        const pid = validateId(patient_id);
        if (eid && pid) {
          const context = await cds.buildPatientContext(pid, eid);
          // Merge extracted vitals into context for immediate CDS
          if (extracted.vitals && Object.keys(extracted.vitals).length > 0) {
            Object.assign(context.vitals, extracted.vitals);
          }
          cdsSuggestions = await cds.evaluatePatientContext(eid, pid, context);
        }
      } catch (cdsErr) {
        console.error('CDS evaluation error (non-fatal):', cdsErr.message);
      }
    }

    res.json({
      mode: aiClient.getMode(),
      extracted,
      extraction_summary: extractionSummary,
      cds_suggestions: cdsSuggestions
    });
  } catch (error) {
    console.error('Error extracting clinical data:', error);
    res.status(500).json({ error: 'Failed to extract clinical data' });
  }
});

app.post('/api/ai/generate-note', async (req, res) => {
  try {
    const { transcript, patient_id, vitals } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const pid = validateId(patient_id);
    if (!pid) {
      return res.status(400).json({ error: 'Valid patient_id is required' });
    }

    const patient = await db.getPatientById(pid);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const soapNote = await aiClient.generateSOAPNote(sanitizeString(transcript, 20000), patient, vitals || {});

    res.json({
      mode: aiClient.getMode(),
      soap_note: soapNote,
      claude_enabled: aiClient.isClaudeEnabled()
    });
  } catch (error) {
    console.error('Error generating SOAP note:', error);
    res.status(500).json({ error: 'Failed to generate SOAP note' });
  }
});

// ==========================================
// PRESCRIPTION ENDPOINTS
// ==========================================

app.post('/api/prescriptions', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'medication_name', 'dose', 'route', 'frequency']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const rxData = {
      patient_id: patientId,
      encounter_id: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
      medication_name: sanitizeString(req.body.medication_name, 200),
      generic_name: sanitizeString(req.body.generic_name, 200),
      dose: sanitizeString(req.body.dose, 50),
      route: sanitizeString(req.body.route, 20),
      frequency: sanitizeString(req.body.frequency, 50),
      quantity: parseInt(req.body.quantity, 10) || null,
      refills: parseInt(req.body.refills, 10) || 0,
      instructions: sanitizeString(req.body.instructions, 1000),
      indication: sanitizeString(req.body.indication, 300),
      icd10_codes: sanitizeString(req.body.icd10_codes, 100),
      prescriber: sanitizeString(req.body.prescriber || process.env.PROVIDER_NAME || 'Dr. Provider', 200),
      prescribed_date: req.body.prescribed_date || new Date().toISOString().split('T')[0],
      status: req.body.status || 'signed'
    };

    // Drug-safety screening at sign time (warn-and-allow policy: the prescription is
    // never blocked, but interaction / boxed-warning / allergy-contraindication alerts
    // and a fail-closed screening-unavailable flag are surfaced to the prescriber).
    let safety = null;
    try {
      const [allMeds, allergies] = await Promise.all([
        db.getPatientMedications(patientId),
        db.getPatientAllergies(patientId)
      ]);
      const activeMeds = (allMeds || []).filter(m => m.status === 'active');
      const check = await drugSafety.fullSafetyCheck(rxData.medication_name, activeMeds, allergies || []);
      safety = {
        alerts: check.alerts,
        interactionScreeningUnavailable: check.interactionScreeningUnavailable,
        boxedWarning: check.boxedWarning
      };
    } catch (safetyErr) {
      // Fail closed: a failed screen must NOT read as "no interactions found."
      console.error('Drug-safety screening error (non-fatal, fail-closed):', safetyErr.message);
      safety = {
        alerts: [{
          type: 'interaction_screening_unavailable',
          severity: 'warning',
          title: `Interaction check unavailable: ${rxData.medication_name}`,
          description: 'Automated drug-safety screening could not be completed. Verify interactions, boxed warnings, and allergies manually.',
          source: 'drug-safety-service',
          unavailable: true
        }],
        interactionScreeningUnavailable: true,
        boxedWarning: { hasBoxedWarning: false, warning: null }
      };
    }

    const result = await db.createPrescription(rxData);

    // Also add to medications list if requested
    if (req.body.add_to_medications) {
      await db.addMedication({
        patient_id: patientId,
        medication_name: rxData.medication_name,
        generic_name: rxData.generic_name,
        dose: rxData.dose,
        route: rxData.route,
        frequency: rxData.frequency,
        start_date: rxData.prescribed_date,
        status: 'active',
        prescriber: rxData.prescriber
      });
    }

    // Record provider learning — associate only with the matching indication
    try {
      const encounter = rxData.encounter_id ? await db.getEncounterById(rxData.encounter_id) : null;
      if (encounter) {
        const problems = await db.getPatientProblems(patientId);
        const matchingProblems = problems.filter(p => p.status === 'active' && (
          (rxData.indication && p.problem_name && rxData.indication.toLowerCase().includes(p.problem_name.toLowerCase())) ||
          (rxData.icd10_codes && p.icd10_code && rxData.icd10_codes.includes(p.icd10_code))
        ));
        for (const prob of matchingProblems) {
          await providerLearning.recordProviderAction(
            rxData.prescriber, prob.icd10_code, prob.problem_name,
            'medication', JSON.stringify(rxData)
          );
        }
      }
    } catch (learnErr) {
      console.error('Provider learning error (non-fatal):', learnErr.message);
    }

    res.status(201).json({ ...result, safety });
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

app.post('/api/prescriptions/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const patientId = validateId(patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Valid patient_id is required' });
    }

    const encId = encounter_id ? validateId(encounter_id) : null;
    const medications = aiClient.extractMedications(transcript);
    const prescriptions = [];

    // Fetch patient meds + allergies once for the warn-and-allow safety screen below.
    const [allMeds, allergies] = await Promise.all([
      db.getPatientMedications(patientId),
      db.getPatientAllergies(patientId)
    ]);
    const activeMeds = (allMeds || []).filter(m => m.status === 'active');

    for (const med of medications) {
      const isNew = transcript.toLowerCase().includes('start') &&
                    transcript.toLowerCase().includes(med.name.toLowerCase());

      if (isNew) {
        const rxData = {
          patient_id: patientId,
          encounter_id: encId,
          medication_name: med.name,
          generic_name: med.name,
          dose: med.dose,
          route: med.route,
          frequency: med.frequency,
          quantity: med.frequency === 'weekly' ? 4 : 30,
          refills: 0,
          instructions: `Take ${med.dose} ${med.route} ${med.frequency}`,
          prescriber: process.env.PROVIDER_NAME || 'Dr. Provider',
          prescribed_date: new Date().toISOString().split('T')[0],
          status: 'signed'
        };

        // Warn-and-allow drug-safety screen (never blocks the script; fails closed).
        let safety = null;
        try {
          const check = await drugSafety.fullSafetyCheck(rxData.medication_name, activeMeds, allergies || []);
          safety = {
            alerts: check.alerts,
            interactionScreeningUnavailable: check.interactionScreeningUnavailable,
            boxedWarning: check.boxedWarning
          };
        } catch (safetyErr) {
          console.error('Drug-safety screening error (non-fatal, fail-closed):', safetyErr.message);
          safety = {
            alerts: [{
              type: 'interaction_screening_unavailable',
              severity: 'warning',
              title: `Interaction check unavailable: ${rxData.medication_name}`,
              description: 'Automated drug-safety screening could not be completed. Verify interactions, boxed warnings, and allergies manually.',
              source: 'drug-safety-service',
              unavailable: true
            }],
            interactionScreeningUnavailable: true,
            boxedWarning: { hasBoxedWarning: false, warning: null }
          };
        }

        const result = await db.createPrescription(rxData);
        prescriptions.push({ ...rxData, id: result.id, safety });
      }
    }

    res.json({ prescriptions });
  } catch (error) {
    console.error('Error generating prescriptions:', error);
    res.status(500).json({ error: 'Failed to generate prescriptions' });
  }
});

// ==========================================
// LAB ORDER ENDPOINTS
// ==========================================

app.get('/api/lab-orders', async (req, res) => {
  try {
    const { patient_id, encounter_id } = req.query;
    let orders;
    if (encounter_id) {
      orders = await db.dbAll(
        'SELECT * FROM lab_orders WHERE encounter_id = ? ORDER BY order_date DESC',
        [validateId(encounter_id)]
      );
    } else if (patient_id) {
      orders = await db.dbAll(
        'SELECT * FROM lab_orders WHERE patient_id = ? ORDER BY order_date DESC',
        [validateId(patient_id)]
      );
    } else {
      orders = await db.dbAll('SELECT * FROM lab_orders ORDER BY order_date DESC LIMIT 50');
    }
    res.json(orders);
  } catch (error) {
    console.error('Error fetching lab orders:', error);
    res.status(500).json({ error: 'Failed to fetch lab orders' });
  }
});

app.post('/api/lab-orders', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'test_name']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const orderData = {
      patient_id: patientId,
      encounter_id: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
      test_name: sanitizeString(req.body.test_name, 200),
      cpt_code: sanitizeString(req.body.cpt_code, 10),
      indication: sanitizeString(req.body.indication, 300),
      icd10_codes: sanitizeString(req.body.icd10_codes, 100),
      order_date: req.body.order_date || new Date().toISOString().split('T')[0],
      scheduled_date: req.body.scheduled_date || null,
      priority: req.body.priority || 'routine',
      fasting_required: req.body.fasting_required ? 1 : 0,
      special_instructions: sanitizeString(req.body.special_instructions, 500),
      ordered_by: sanitizeString(req.body.ordered_by || process.env.PROVIDER_NAME || 'Dr. Provider', 200),
      status: 'ordered'
    };

    const result = await db.createLabOrder(orderData);

    // Record provider learning — associate only with the matching indication
    try {
      const problems = await db.getPatientProblems(patientId);
      const matchingProblems = problems.filter(p => p.status === 'active' && (
        (orderData.indication && p.problem_name && orderData.indication.toLowerCase().includes(p.problem_name.toLowerCase())) ||
        (orderData.icd10_codes && p.icd10_code && orderData.icd10_codes.includes(p.icd10_code))
      ));
      for (const prob of matchingProblems) {
        await providerLearning.recordProviderAction(
          orderData.ordered_by, prob.icd10_code, prob.problem_name,
          'lab_order', JSON.stringify(orderData)
        );
      }
    } catch (learnErr) {
      console.error('Provider learning error (non-fatal):', learnErr.message);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating lab order:', error);
    res.status(500).json({ error: 'Failed to create lab order' });
  }
});

app.post('/api/lab-orders/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const patientId = validateId(patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Valid patient_id is required' });
    }

    const encId = encounter_id ? validateId(encounter_id) : null;
    const labs = aiClient.extractLabOrders(transcript);
    const orders = [];

    // Parse scheduled date if mentioned
    let scheduledDate = null;
    const dateMatch = transcript.match(/(\d+)\s+weeks?/i);
    if (dateMatch) {
      const weeksFromNow = parseInt(dateMatch[1], 10);
      const d = new Date();
      d.setDate(d.getDate() + (weeksFromNow * 7));
      scheduledDate = d.toISOString().split('T')[0];
    }

    for (const lab of labs) {
      const orderData = {
        patient_id: patientId,
        encounter_id: encId,
        test_name: lab.name,
        cpt_code: lab.cpt,
        order_date: new Date().toISOString().split('T')[0],
        scheduled_date: scheduledDate,
        priority: 'routine',
        ordered_by: process.env.PROVIDER_NAME || 'Dr. Provider'
      };

      const result = await db.createLabOrder(orderData);
      orders.push({ ...orderData, id: result.id });
    }

    res.json({ orders });
  } catch (error) {
    console.error('Error generating lab orders:', error);
    res.status(500).json({ error: 'Failed to generate lab orders' });
  }
});

// ==========================================
// IMAGING ORDER ENDPOINTS
// ==========================================

app.get('/api/imaging-orders', async (req, res) => {
  try {
    const { patient_id, encounter_id } = req.query;
    let orders;
    if (encounter_id) {
      orders = await db.dbAll(
        'SELECT * FROM imaging_orders WHERE encounter_id = ? ORDER BY order_date DESC',
        [validateId(encounter_id)]
      );
    } else if (patient_id) {
      orders = await db.dbAll(
        'SELECT * FROM imaging_orders WHERE patient_id = ? ORDER BY order_date DESC',
        [validateId(patient_id)]
      );
    } else {
      orders = await db.dbAll('SELECT * FROM imaging_orders ORDER BY order_date DESC LIMIT 50');
    }
    res.json(orders);
  } catch (error) {
    console.error('Error fetching imaging orders:', error);
    res.status(500).json({ error: 'Failed to fetch imaging orders' });
  }
});

app.post('/api/imaging-orders', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'study_type', 'body_part']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const orderData = {
      patient_id: patientId,
      encounter_id: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
      study_type: sanitizeString(req.body.study_type, 100),
      body_part: sanitizeString(req.body.body_part, 100),
      indication: sanitizeString(req.body.indication, 300),
      icd10_codes: sanitizeString(req.body.icd10_codes, 100),
      contrast_required: req.body.contrast_required ? 1 : 0,
      order_date: req.body.order_date || new Date().toISOString().split('T')[0],
      priority: req.body.priority || 'routine',
      special_instructions: sanitizeString(req.body.special_instructions, 500),
      ordered_by: sanitizeString(req.body.ordered_by || process.env.PROVIDER_NAME || 'Dr. Provider', 200),
      status: 'ordered'
    };

    const result = await db.createImagingOrder(orderData);

    // Record provider learning — associate only with the matching indication
    try {
      const problems = await db.getPatientProblems(patientId);
      const matchingProblems = problems.filter(p => p.status === 'active' && (
        (orderData.indication && p.problem_name && orderData.indication.toLowerCase().includes(p.problem_name.toLowerCase())) ||
        (orderData.icd10_codes && p.icd10_code && orderData.icd10_codes.includes(p.icd10_code))
      ));
      for (const prob of matchingProblems) {
        await providerLearning.recordProviderAction(
          orderData.ordered_by, prob.icd10_code, prob.problem_name,
          'imaging', JSON.stringify(orderData)
        );
      }
    } catch (learnErr) {
      console.error('Provider learning error (non-fatal):', learnErr.message);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating imaging order:', error);
    res.status(500).json({ error: 'Failed to create imaging order' });
  }
});

// ==========================================
// REFERRAL ENDPOINTS
// ==========================================

app.get('/api/referrals', async (req, res) => {
  try {
    const { patient_id, encounter_id } = req.query;
    let referrals;
    if (encounter_id) {
      referrals = await db.dbAll(
        'SELECT * FROM referrals WHERE encounter_id = ? ORDER BY referred_date DESC',
        [validateId(encounter_id)]
      );
    } else if (patient_id) {
      referrals = await db.dbAll(
        'SELECT * FROM referrals WHERE patient_id = ? ORDER BY referred_date DESC',
        [validateId(patient_id)]
      );
    } else {
      referrals = await db.dbAll('SELECT * FROM referrals ORDER BY referred_date DESC LIMIT 50');
    }
    res.json(referrals);
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

app.post('/api/referrals', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'specialty']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const referralData = {
      patient_id: patientId,
      encounter_id: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
      specialty: sanitizeString(req.body.specialty, 100),
      reason: sanitizeString(req.body.reason, 500),
      urgency: req.body.urgency || 'routine',
      referred_by: sanitizeString(req.body.referred_by || process.env.PROVIDER_NAME || 'Dr. Provider', 200),
      referred_date: req.body.referred_date || new Date().toISOString().split('T')[0],
      notes: sanitizeString(req.body.notes, 1000),
      status: 'pending'
    };

    const result = await db.createReferral(referralData);

    // Record provider learning — associate only with the matching indication
    try {
      const problems = await db.getPatientProblems(patientId);
      const matchingProblems = problems.filter(p => p.status === 'active' && (
        (referralData.reason && p.problem_name && referralData.reason.toLowerCase().includes(p.problem_name.toLowerCase())) ||
        (referralData.icd10_codes && p.icd10_code && referralData.icd10_codes.includes(p.icd10_code))
      ));
      for (const prob of matchingProblems) {
        await providerLearning.recordProviderAction(
          referralData.referred_by, prob.icd10_code, prob.problem_name,
          'referral', JSON.stringify(referralData)
        );
      }
    } catch (learnErr) {
      console.error('Provider learning error (non-fatal):', learnErr.message);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating referral:', error);
    res.status(500).json({ error: 'Failed to create referral' });
  }
});

// ==========================================
// VITALS ENDPOINTS
// ==========================================

app.post('/api/vitals', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id']);
    if (err) {
      return res.status(400).json({ error: err });
    }

    const patientId = validateId(req.body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Invalid patient_id' });
    }

    const encounterId = req.body.encounter_id ? validateId(req.body.encounter_id) : null;

    const vitalsData = {
      patient_id: patientId,
      encounter_id: encounterId,
      systolic_bp: req.body.systolic_bp != null ? parseInt(req.body.systolic_bp, 10) : null,
      diastolic_bp: req.body.diastolic_bp != null ? parseInt(req.body.diastolic_bp, 10) : null,
      heart_rate: req.body.heart_rate != null ? parseInt(req.body.heart_rate, 10) : null,
      respiratory_rate: req.body.respiratory_rate != null ? parseInt(req.body.respiratory_rate, 10) : null,
      temperature: req.body.temperature != null ? parseFloat(req.body.temperature) : null,
      weight: req.body.weight != null ? parseFloat(req.body.weight) : null,
      height: req.body.height != null ? parseFloat(req.body.height) : null,
      spo2: req.body.spo2 != null ? parseInt(req.body.spo2, 10) : null,
      recorded_by: sanitizeString(req.body.recorded_by || process.env.PROVIDER_NAME || 'MA', 200)
    };
    const result = await db.addVitals(vitalsData);

    // Auto-trigger CDS evaluation after vitals entry
    let cdsSuggestions = [];
    if (encounterId) {
      try {
        const context = await cds.buildPatientContext(patientId, encounterId);
        cdsSuggestions = await cds.evaluatePatientContext(encounterId, patientId, context);
      } catch (cdsErr) {
        console.error('CDS evaluation after vitals (non-fatal):', cdsErr.message);
      }
    }

    res.status(201).json({ ...result, cds_suggestions: cdsSuggestions });
  } catch (error) {
    console.error('Error adding vitals:', error);
    res.status(500).json({ error: 'Failed to add vitals' });
  }
});

app.post('/api/vitals/from-speech', async (req, res) => {
  try {
    const { transcript, patient_id, encounter_id } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const patientId = validateId(patient_id);
    if (!patientId) {
      return res.status(400).json({ error: 'Valid patient_id is required' });
    }

    const vitals = aiClient.extractVitals(transcript);

    if (Object.keys(vitals).length > 0) {
      vitals.patient_id = patientId;
      const encId = encounter_id ? validateId(encounter_id) : null;
      if (encId) vitals.encounter_id = encId;

      const result = await db.addVitals(vitals);

      // Auto-trigger CDS evaluation
      let cdsSuggestions = [];
      if (encId) {
        try {
          const context = await cds.buildPatientContext(patientId, encId);
          cdsSuggestions = await cds.evaluatePatientContext(encId, patientId, context);
        } catch (cdsErr) {
          console.error('CDS evaluation after speech vitals (non-fatal):', cdsErr.message);
        }
      }

      res.json({ ...vitals, id: result.id, cds_suggestions: cdsSuggestions });
    } else {
      res.json({ message: 'No vitals found in transcript' });
    }
  } catch (error) {
    console.error('Error extracting vitals:', error);
    res.status(500).json({ error: 'Failed to extract vitals' });
  }
});

// ==========================================
// WORKFLOW ENDPOINTS
// ==========================================

// Create workflow for an encounter
app.post('/api/workflow', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id', 'patient_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    const patientId = validateId(req.body.patient_id);
    if (!encounterId || !patientId) {
      return res.status(400).json({ error: 'Invalid encounter_id or patient_id' });
    }

    const result = await workflow.createWorkflow(encounterId, patientId, {
      assigned_ma: req.body.assigned_ma,
      assigned_provider: req.body.assigned_provider
    });
    res.status(result.existing ? 200 : 201).json(result);
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

// Get queue by state (for dashboard) — must precede /api/workflow/:encounterId
app.get('/api/workflow/queue/:state', async (req, res) => {
  try {
    const encounters = await workflow.getQueue(req.params.state);
    res.json(encounters);
  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// Get current workflow state
app.get('/api/workflow/:encounterId', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const state = await workflow.getCurrentState(encounterId);
    state.valid_transitions = workflow.getValidTransitions(state.current_state);
    res.json(state);
  } catch (error) {
    if (error.message.includes('No workflow found')) {
      return res.status(404).json({ error: error.message });
    }
    console.error('Error fetching workflow:', error);
    res.status(500).json({ error: 'Failed to fetch workflow state' });
  }
});

// Transition workflow state
app.post('/api/workflow/:encounterId/transition', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const err = requireFields(req.body, ['target_state']);
    if (err) return res.status(400).json({ error: err });

    const userRole = req.user?.role || req.session?.userRole || null;
    const result = await workflow.transitionState(encounterId, req.body.target_state, {
      assigned_ma: req.body.assigned_ma,
      assigned_provider: req.body.assigned_provider
    }, userRole);

    // If transitioning to 'vitals-recorded' or 'provider-examining', run initial CDS
    let cdsSuggestions = [];
    if (['vitals-recorded', 'provider-examining'].includes(req.body.target_state)) {
      try {
        const wf = await workflow.getCurrentState(encounterId);
        const context = await cds.buildPatientContext(wf.patient_id, encounterId);

        // Also include provider preferences
        const provSuggestions = await providerLearning.getSuggestionsFromPreferences(
          context.providerName, context.problems
        );

        cdsSuggestions = await cds.evaluatePatientContext(encounterId, wf.patient_id, context);
        cdsSuggestions = [...cdsSuggestions, ...provSuggestions];
      } catch (cdsErr) {
        console.error('CDS evaluation on transition (non-fatal):', cdsErr.message);
      }
    }

    res.json({ ...result, cds_suggestions: cdsSuggestions });
  } catch (error) {
    if (error.message.includes('Invalid transition')) {
      // Bad/illegal target state for the current state — client error.
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('cannot transition')) {
      // Role not permitted for this transition — authorization failure, not a
      // server fault. Returning 403 (not 500) keeps the encounter from being
      // stranded behind an opaque server error (UR-005).
      return res.status(403).json({ error: error.message });
    }
    console.error('Error transitioning workflow:', error);
    res.status(500).json({ error: 'Failed to transition workflow' });
  }
});

// Get workflow timeline
app.get('/api/workflow/:encounterId/timeline', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const timeline = await workflow.getWorkflowTimeline(encounterId);
    res.json(timeline);
  } catch (error) {
    console.error('Error fetching timeline:', error);
    res.status(500).json({ error: 'Failed to fetch workflow timeline' });
  }
});

// Get all active workflows
app.get('/api/workflows', async (req, res) => {
  try {
    const workflows = await workflow.getAllWorkflows();
    res.json(workflows);
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

// ==========================================
// CDS (CLINICAL DECISION SUPPORT) ENDPOINTS
// ==========================================

// Trigger CDS evaluation
app.post('/api/cds/evaluate', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id', 'patient_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    const patientId = validateId(req.body.patient_id);
    if (!encounterId || !patientId) {
      return res.status(400).json({ error: 'Invalid encounter_id or patient_id' });
    }

    const context = await cds.buildPatientContext(patientId, encounterId);

    // Also include provider preference suggestions
    const provSuggestions = await providerLearning.getSuggestionsFromPreferences(
      context.providerName, context.problems
    );

    let ruleSuggestions = await cds.evaluatePatientContext(encounterId, patientId, context);
    if (ruleSuggestions.length === 0) {
      ruleSuggestions = await db.getEncounterSuggestions(encounterId, 'pending');
    }

    // Persist provider suggestions too
    const savedProvSuggestions = [];
    for (const s of provSuggestions) {
      const result = await db.createSuggestion({
        encounter_id: encounterId,
        patient_id: patientId,
        ...s
      });
      savedProvSuggestions.push({ id: result.id, ...s });
    }

    res.json({
      suggestions: [...ruleSuggestions, ...savedProvSuggestions],
      context_summary: {
        patient: context.patient ? `${context.patient.first_name} ${context.patient.last_name}` : 'Unknown',
        problems_count: (context.problems || []).length,
        medications_count: (context.medications || []).length,
        has_vitals: context.vitals && Object.keys(context.vitals).length > 0,
        has_transcript: !!context.transcript
      }
    });
  } catch (error) {
    console.error('Error running CDS evaluation:', error);
    res.status(500).json({ error: 'Failed to evaluate CDS rules' });
  }
});

// Get suggestions for an encounter
app.get('/api/cds/suggestions/:encounterId', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const status = req.query.status || null;
    let suggestions;
    if (status) {
      suggestions = await db.dbAll(
        'SELECT * FROM cds_suggestions WHERE encounter_id = ? AND status = ? ORDER BY priority ASC',
        [encounterId, status]
      );
    } else {
      suggestions = await db.getEncounterSuggestions(encounterId);
    }

    // Parse JSON fields
    for (const s of suggestions) {
      try {
        if (typeof s.suggested_action === 'string') s.suggested_action = JSON.parse(s.suggested_action);
      } catch { /* leave as string */ }
    }

    res.json(suggestions);
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// Accept a suggestion (auto-executes the order)
app.post('/api/cds/suggestions/:id/accept', async (req, res) => {
  try {
    const suggestionId = validateId(req.params.id);
    if (!suggestionId) return res.status(400).json({ error: 'Invalid suggestion ID' });

    const encounterId = req.body.encounter_id ? validateId(req.body.encounter_id) : null;
    const patientId = req.body.patient_id ? validateId(req.body.patient_id) : null;
    const providerName = req.body.provider_name || process.env.PROVIDER_NAME || 'Dr. Provider';

    // Execute the suggestion (creates orders automatically)
    const result = await cds.executeSuggestion(suggestionId, encounterId, patientId, providerName);

    // Record acceptance for provider learning — associate only with matching indication
    try {
      const suggestion = await db.getSuggestionById(suggestionId);
      if (suggestion && patientId) {
        const problems = await db.getPatientProblems(patientId);
        let actionDetail;
        try {
          actionDetail = typeof suggestion.suggested_action === 'string'
            ? suggestion.suggested_action
            : JSON.stringify(suggestion.suggested_action);
        } catch { actionDetail = '{}'; }

        let parsedAction;
        try {
          parsedAction = typeof suggestion.suggested_action === 'string'
            ? JSON.parse(suggestion.suggested_action)
            : suggestion.suggested_action;
        } catch { parsedAction = {}; }

        const indication = parsedAction?.indication || suggestion.title || '';
        const icd10Codes = parsedAction?.icd10_codes || '';
        const matchingProblems = problems.filter(p => p.status === 'active' && (
          (indication && p.problem_name && indication.toLowerCase().includes(p.problem_name.toLowerCase())) ||
          (icd10Codes && p.icd10_code && icd10Codes.includes(p.icd10_code))
        ));
        for (const prob of matchingProblems) {
          await providerLearning.recordProviderAction(
            providerName, prob.icd10_code, prob.problem_name,
            suggestion.suggestion_type, actionDetail
          );
        }
      }
    } catch (learnErr) {
      console.error('Provider learning on accept (non-fatal):', learnErr.message);
    }

    res.json(result);
  } catch (error) {
    if (error.message === 'Suggestion not found') {
      return res.status(404).json({ error: 'Suggestion not found' });
    }
    console.error('Error accepting suggestion:', error);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  }
});

// Reject/skip a suggestion
app.post('/api/cds/suggestions/:id/reject', async (req, res) => {
  try {
    const suggestionId = validateId(req.params.id);
    if (!suggestionId) return res.status(400).json({ error: 'Invalid suggestion ID' });

    const reason = sanitizeString(req.body.reason || 'skipped', 500);
    await db.updateSuggestionStatus(suggestionId, 'rejected');

    res.json({ suggestion_id: suggestionId, status: 'rejected', reason });
  } catch (error) {
    console.error('Error rejecting suggestion:', error);
    res.status(500).json({ error: 'Failed to reject suggestion' });
  }
});

// Defer a suggestion (keep for later)
app.post('/api/cds/suggestions/:id/defer', async (req, res) => {
  try {
    const suggestionId = validateId(req.params.id);
    if (!suggestionId) return res.status(400).json({ error: 'Invalid suggestion ID' });

    await db.updateSuggestionStatus(suggestionId, 'deferred');
    res.json({ suggestion_id: suggestionId, status: 'deferred' });
  } catch (error) {
    console.error('Error deferring suggestion:', error);
    res.status(500).json({ error: 'Failed to defer suggestion' });
  }
});

// ==========================================
// DECISION QUEUE ENDPOINTS (Provider Decision Queue + AI Triage)
// ==========================================
//
// Two-tier clinical AI surface:
//   - Upstream TRIAGE (top tier, sonnet) sorts the patient to a level of care
//     via the AHRQ Emergency Severity Index (ESI, 5-level acuity).
//   - A MID-tier (haiku) one-paragraph patient summary + a TOP-tier decision
//     tree of >= 4 one-click options are generated on read for pending items
//     and persisted (cached) so the demo is deterministic and offline-capable.
//   - The provider's chosen action (or dictated free text) is routed to the
//     MEDICAL-ASSISTANT close-out queue and transitions the encounter to
//     'orders-pending' (the MA-actionable workflow state).
//
// RBAC: GET/decide are provider-only (physician/NP); MA close-out is gated to
// ma + physician/NP. We use requireRole here (not requireResourceAccess)
// because decision_queue is a feature surface, not a base RBAC resource type,
// and MA needs POST access that the resource-action matrix would deny.

const PROVIDER_DECISION_ROLES = ['physician', 'nurse_practitioner'];
const MA_CLOSEOUT_ROLES = ['ma', 'physician', 'nurse_practitioner'];

// Build the patient record passed to the triage/summary/decision functions.
async function buildDecisionRecord(item) {
  const patient = await db.getPatientById(item.patient_id);
  const problems = await db.getPatientProblems(item.patient_id);
  const vitalsRows = await db.dbAll(
    'SELECT * FROM vitals WHERE encounter_id = ? ORDER BY recorded_date DESC LIMIT 1',
    [item.encounter_id]
  );
  const vitals = vitalsRows[0] || {};
  return {
    first_name: patient?.first_name,
    last_name: patient?.last_name,
    sex: patient?.sex,
    dob: patient?.dob,
    age: patient ? db.calculateAge(patient.dob) : null,
    chief_complaint: item.chief_complaint,
    vitals,
    problems: (problems || []).filter(p => p.status === 'active' || p.status === 'chronic'),
  };
}

// Shape a decision_queue row for the API response (parse JSON options).
function serializeDecisionItem(row) {
  let options = [];
  try {
    options = row.decision_options ? JSON.parse(row.decision_options) : [];
  } catch { options = []; }
  // EMERGENCY BYPASS: ESI 1-2 are emergent (AHRQ ESI v4 — level 1 = immediate
  // life-saving intervention; level 2 = high-risk, cannot wait). These bypass
  // the routine deliberative path: they pin to the top, render with critical
  // styling, and route to immediate handling rather than routine MA close-out.
  const is_emergency = triage.isEmergency(row.esi_level);
  // An EMERGENCY ESCALATION is recorded when a provider takes a 911/ED action.
  // The MA close-out then shows "confirm 911/ED handoff" rather than a routine
  // task. Derived from the recorded decision_key (preferred) and falls back to
  // the acuity flag for any decided emergency item.
  const emergency_escalated =
    triage.EMERGENCY_DECISION_KEYS.includes(row.decision_key) ||
    (is_emergency && row.status !== 'pending');
  return {
    id: row.id,
    encounter_id: row.encounter_id,
    patient_id: row.patient_id,
    status: row.status,
    is_emergency,
    emergency_escalated,
    patient: {
      first_name: row.first_name,
      last_name: row.last_name,
      mrn: row.mrn,
      dob: row.dob,
      sex: row.sex,
      age: row.dob ? db.calculateAge(row.dob) : null,
    },
    chief_complaint: row.chief_complaint,
    triage: {
      esi_level: row.esi_level,
      level_of_care: row.level_of_care,
      rationale: row.triage_rationale,
      model: row.triage_model,
    },
    summary: row.ai_summary,
    summary_model: row.summary_model,
    options,
    decision_model: row.decision_model,
    decision: {
      key: row.decision_key,
      label: row.decision_label,
      text: row.decision_text,
      decided_by: row.decided_by,
      decided_at: row.decided_at,
    },
    ma_status: row.ma_status,
    closed_by: row.closed_by,
    closed_at: row.closed_at,
    created_at: row.created_at,
  };
}

// GET /api/decisions — provider queue (pending + decided), sickest-first.
// For pending items lacking cached AI output, generate triage (top), summary
// (mid), and the decision tree (top) on read and persist them.
app.get('/api/decisions', rbac.requireRole(...PROVIDER_DECISION_ROLES), async (req, res) => {
  try {
    const items = await db.getProviderDecisionQueue();

    for (const item of items) {
      const needsGeneration = item.status === 'pending' && (!item.ai_summary || !item.decision_options);
      if (!needsGeneration) continue;

      const record = await buildDecisionRecord(item);
      const triageResult = await triage.triagePatient(record);
      const summaryResult = await triage.summarizePatient(record);
      const decisionResult = await triage.buildDecisionOptions(record, triageResult);

      await db.updateDecisionQueueAI(item.id, {
        esi_level: triageResult.esi_level,
        level_of_care: triageResult.level_of_care,
        triage_rationale: triageResult.rationale,
        triage_model: triageResult.model,
        ai_summary: summaryResult.summary,
        summary_model: summaryResult.model,
        decision_options: decisionResult.options,
        decision_model: decisionResult.model,
      });

      // Reflect the freshly-generated values onto the row we return now.
      item.esi_level = triageResult.esi_level;
      item.level_of_care = triageResult.level_of_care;
      item.triage_rationale = triageResult.rationale;
      item.triage_model = triageResult.model;
      item.ai_summary = summaryResult.summary;
      item.summary_model = summaryResult.model;
      item.decision_options = JSON.stringify(decisionResult.options);
      item.decision_model = decisionResult.model;
    }

    // Re-sort sickest-first now that pending items have an esi_level.
    items.sort((a, b) => {
      const statusRank = (s) => (s === 'pending' ? 0 : 1);
      if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
      return (a.esi_level || 99) - (b.esi_level || 99);
    });

    // EMERGENCY BYPASS: count emergent (ESI 1-2) items so the UI can surface a
    // top-of-page critical banner. The esi-asc sort above already pins these
    // first; emergency cards render with critical styling and a one-click
    // "Call 911 / Send to ED now" headline action.
    const serialized = items.map(serializeDecisionItem);
    const emergency_count = serialized.filter(i => i.is_emergency).length;

    res.json({
      mode: aiClient.getMode(),
      count: items.length,
      emergency_count,
      items: serialized,
    });
  } catch (error) {
    logger.error('Error fetching decision queue', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch decision queue' });
  }
});

// POST /api/decisions/:id/decide — provider records a decision.
// Body: { decision_key } (chosen one-click option) OR { decision_text }
// (dictated custom decision). Sets status='decided', ma_status='awaiting',
// transitions the encounter workflow to 'orders-pending', and returns the row.
app.post('/api/decisions/:id/decide', rbac.requireRole(...PROVIDER_DECISION_ROLES), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid decision ID' });

    const decisionKey = req.body.decision_key ? sanitizeString(req.body.decision_key, 100) : null;
    const decisionText = req.body.decision_text ? sanitizeString(req.body.decision_text, 2000) : null;
    if (!decisionKey && !decisionText) {
      return res.status(400).json({ error: 'Provide either decision_key (a one-click option) or decision_text (a dictated decision)' });
    }

    const item = await db.getDecisionQueueItemById(id);
    if (!item) return res.status(404).json({ error: 'Decision item not found' });
    if (item.status !== 'pending') {
      return res.status(409).json({ error: `Decision already ${item.status}` });
    }

    // Resolve the human label for the chosen option from cached options.
    let decisionLabel = decisionText ? 'Dictated decision' : decisionKey;
    if (decisionKey && item.decision_options) {
      try {
        const opts = JSON.parse(item.decision_options);
        const match = opts.find(o => o.key === decisionKey);
        if (match) decisionLabel = match.label;
      } catch { /* leave label as key */ }
    }

    // EMERGENCY BYPASS: a 911/ED action is an emergency escalation, not a
    // routine disposition. Record an unambiguous emergency disposition label so
    // the MA close-out worklist shows "EMERGENCY — confirm 911/ED handoff"
    // rather than a routine task. (AHRQ ESI v4 — ESI 1-2 are emergent.)
    const isEmergencyAction = triage.EMERGENCY_DECISION_KEYS.includes(decisionKey);
    if (isEmergencyAction) {
      decisionLabel = '911 activated / ED transfer';
    }

    const decidedBy = req.user?.name || req.user?.username || process.env.PROVIDER_NAME || 'Provider';
    const result = await db.recordDecision(id, {
      decision_key: decisionKey,
      decision_label: decisionLabel,
      decision_text: decisionText,
      decided_by: decidedBy,
    });
    if (result.changes === 0) {
      return res.status(409).json({ error: 'Decision could not be recorded (already decided)' });
    }

    // Route to the MA queue by advancing the encounter workflow to
    // 'orders-pending' (the MA-actionable state). Non-fatal if the workflow is
    // not in a transitionable state — the decision itself is already recorded.
    let workflowTransition = null;
    try {
      const userRole = req.user?.role || null;
      workflowTransition = await workflow.transitionState(item.encounter_id, 'orders-pending', {}, userRole);
    } catch (wfErr) {
      logger.warn('Decision workflow transition skipped (non-fatal)', { encounter_id: item.encounter_id, error: wfErr.message });
    }

    const updated = await db.getDecisionQueueItemByEncounter(item.encounter_id);
    const enriched = await db.getProviderDecisionQueue();
    const joined = enriched.find(r => r.id === updated.id) || { ...updated };
    res.json({ ...serializeDecisionItem(joined), workflow_transition: workflowTransition });
  } catch (error) {
    logger.error('Error recording decision', { error: error.message });
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

// GET /api/decisions/ma/closeouts — MA worklist: decided items awaiting close.
app.get('/api/decisions/ma/closeouts', rbac.requireRole(...MA_CLOSEOUT_ROLES), async (req, res) => {
  try {
    const items = await db.getMaCloseouts();
    res.json({ count: items.length, items: items.map(serializeDecisionItem) });
  } catch (error) {
    logger.error('Error fetching MA close-outs', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch MA close-outs' });
  }
});

// POST /api/decisions/:id/close — MA (or provider) closes out a decided item.
// Sets status='closed', ma_status='closed', records closed_by/closed_at, and
// advances the encounter workflow forward when legal (non-fatal otherwise).
app.post('/api/decisions/:id/close', rbac.requireRole(...MA_CLOSEOUT_ROLES), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid decision ID' });

    const item = await db.getDecisionQueueItemById(id);
    if (!item) return res.status(404).json({ error: 'Decision item not found' });
    if (item.status === 'closed') {
      return res.status(409).json({ error: 'Decision already closed' });
    }
    if (item.status !== 'decided') {
      return res.status(409).json({ error: 'Decision must be decided by a provider before close-out' });
    }

    const closedBy = req.user?.name || req.user?.username || 'MA';
    const result = await db.closeDecision(id, { closed_by: closedBy });
    if (result.changes === 0) {
      return res.status(409).json({ error: 'Decision could not be closed' });
    }

    // Advance the encounter forward (orders-pending -> documentation) when the
    // workflow is in that state. Non-fatal: the close-out itself is recorded.
    try {
      const wf = await workflow.getCurrentState(item.encounter_id);
      if (wf.current_state === 'orders-pending') {
        const userRole = req.user?.role || null;
        await workflow.transitionState(item.encounter_id, 'documentation', {}, userRole);
      }
    } catch (wfErr) {
      logger.warn('Close-out workflow transition skipped (non-fatal)', { encounter_id: item.encounter_id, error: wfErr.message });
    }

    const updated = await db.getDecisionQueueItemById(id);
    res.json(serializeDecisionItem(updated));
  } catch (error) {
    logger.error('Error closing decision', { error: error.message });
    res.status(500).json({ error: 'Failed to close decision' });
  }
});

// ==========================================
// PROVIDER LEARNING ENDPOINTS
// ==========================================

// Get provider profile (learned preferences)
app.get('/api/provider/preferences', async (req, res) => {
  try {
    const providerName = req.query.provider || process.env.PROVIDER_NAME || 'Dr. Provider';
    const prefs = await providerLearning.getProviderProfile(providerName);
    res.json({
      provider: providerName,
      preferences: prefs,
      count: prefs.length
    });
  } catch (error) {
    console.error('Error fetching provider preferences:', error);
    res.status(500).json({ error: 'Failed to fetch provider preferences' });
  }
});

// Manually decay old preferences
app.post('/api/provider/preferences/decay', async (req, res) => {
  try {
    await providerLearning.decayPreferences();
    res.json({ message: 'Preference decay completed' });
  } catch (error) {
    console.error('Error decaying preferences:', error);
    res.status(500).json({ error: 'Failed to decay preferences' });
  }
});

// ==========================================
// ALLERGIES ENDPOINTS
// ==========================================

app.get('/api/patients/:id/allergies', rbac.requireResourceAccess('allergies'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid patient ID' });

    const allergies = await db.getPatientAllergies(id);
    res.json(allergies);
  } catch (error) {
    console.error('Error fetching allergies:', error);
    res.status(500).json({ error: 'Failed to fetch allergies' });
  }
});

app.post('/api/patients/:id/allergies', rbac.requireResourceAccess('allergies'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid patient ID' });

    const err = requireFields(req.body, ['allergen']);
    if (err) return res.status(400).json({ error: err });

    const result = await db.addAllergy({
      patient_id: id,
      allergen: sanitizeString(req.body.allergen, 200),
      reaction: sanitizeString(req.body.reaction, 300),
      severity: req.body.severity || 'moderate',
      onset_date: req.body.onset_date || null
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding allergy:', error);
    res.status(500).json({ error: 'Failed to add allergy' });
  }
});

// ==========================================
// PATIENT LABS & VITALS HISTORY
// ==========================================

app.get('/api/patients/:id/labs', rbac.requireResourceAccess('labs'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid patient ID' });

    const labs = await db.getPatientLabs(id);
    res.json(labs);
  } catch (error) {
    console.error('Error fetching labs:', error);
    res.status(500).json({ error: 'Failed to fetch labs' });
  }
});

app.post('/api/patients/:id/labs', rbac.requireResourceAccess('labs'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid patient ID' });

    const err = requireFields(req.body, ['test_name', 'result_value']);
    if (err) return res.status(400).json({ error: err });

    const result = await db.addLab({
      patient_id: id,
      test_name: sanitizeString(req.body.test_name, 200),
      result_value: sanitizeString(String(req.body.result_value), 100),
      reference_range: req.body.reference_range || null,
      units: req.body.units || null,
      result_date: req.body.result_date || new Date().toISOString().split('T')[0],
      status: req.body.status || 'final',
      abnormal_flag: req.body.abnormal_flag || null,
      notes: req.body.notes || null
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error adding lab result:', error);
    res.status(500).json({ error: 'Failed to add lab result' });
  }
});

app.get('/api/patients/:id/vitals', rbac.requireResourceAccess('vitals'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid patient ID' });

    const vitals = await db.getPatientVitals(id);
    res.json(vitals);
  } catch (error) {
    console.error('Error fetching vitals:', error);
    res.status(500).json({ error: 'Failed to fetch vitals' });
  }
});

// ==========================================
// ENCOUNTER ORDERS SUMMARY
// ==========================================

app.get('/api/encounters/:id/orders', requireAnyResourceAccess('lab_orders', 'imaging_orders', 'referrals', 'prescriptions'), async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid encounter ID' });

    const [labOrders, imagingOrders, referrals, prescriptions] = await Promise.all([
      db.dbAll('SELECT * FROM lab_orders WHERE encounter_id = ? ORDER BY order_date DESC', [id]),
      db.dbAll('SELECT * FROM imaging_orders WHERE encounter_id = ? ORDER BY order_date DESC', [id]),
      db.dbAll('SELECT * FROM referrals WHERE encounter_id = ? ORDER BY referred_date DESC', [id]),
      db.dbAll('SELECT * FROM prescriptions WHERE encounter_id = ? ORDER BY prescribed_date DESC', [id])
    ]);

    res.json(filterEncounterOrdersForRole(req, {
      encounter_id: id,
      lab_orders: labOrders,
      imaging_orders: imagingOrders,
      referrals,
      prescriptions,
      total_orders: labOrders.length + imagingOrders.length + referrals.length + prescriptions.length
    }));
  } catch (error) {
    console.error('Error fetching encounter orders:', error);
    res.status(500).json({ error: 'Failed to fetch encounter orders' });
  }
});

// Get CPT code suggestions for an encounter
app.get('/api/encounters/:id/cpt-suggestions', rbac.requireRole('physician', 'nurse_practitioner', 'billing'), async (req, res) => {
  try {
    const encounterId = validateId(req.params.id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const encounter = await db.getEncounterById(encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

    // Build billing context for CPT suggestion
    const context = await billing.buildBillingContext(encounterId, encounter.patient_id);
    const suggestions = billing.suggestCPTCodes(context);

    res.json({
      encounter_id: encounterId,
      suggestions,
      count: suggestions.length,
      note: 'These are suggested additional codes beyond the E/M code. Review and confirm before billing.'
    });
  } catch (error) {
    logger.error('Error generating CPT suggestions', { error: error.message });
    res.status(500).json({ error: 'Failed to generate CPT suggestions' });
  }
});

// ==========================================
// DASHBOARD / SUMMARY ENDPOINTS
// ==========================================

app.get('/api/dashboard', async (req, res) => {
  try {
    const [patients, workflows, encounters] = await Promise.all([
      db.getAllPatients(),
      workflow.getAllWorkflows(),
      db.dbAll(
        `SELECT e.*, p.first_name, p.last_name, p.mrn
         FROM encounters e JOIN patients p ON e.patient_id = p.id
         WHERE e.status IN ('in-progress', 'active', 'scheduled')
         ORDER BY e.encounter_date DESC LIMIT 20`
      )
    ]);

    // Build queue counts
    const queueCounts = {};
    for (const wf of workflows) {
      const state = wf.current_state;
      if (!queueCounts[state]) queueCounts[state] = 0;
      queueCounts[state]++;
    }

    res.json({
      patient_count: patients.length,
      active_encounters: encounters.length,
      workflows: workflows.map(wf => ({
        ...wf,
        valid_transitions: workflow.getValidTransitions(wf.current_state)
      })),
      queue_counts: queueCounts,
      recent_encounters: encounters.map((encounter) => filterEncounterForRole(req, encounter))
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ==========================================
// SYSTEM ENDPOINTS
// ==========================================

app.get('/api/health', async (req, res) => {
  // Database connectivity check
  let dbStatus = 'unknown';
  try {
    const row = await db.dbGet('SELECT 1 as ok');
    dbStatus = row && row.ok === 1 ? 'connected' : 'error';
  } catch {
    dbStatus = 'disconnected';
  }

  const memUsage = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);

  const isHealthy = dbStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    uptime_seconds: uptimeSeconds,
    database: dbStatus,
    memory: {
      rss_mb: Math.round(memUsage.rss / 1048576),
      heap_used_mb: Math.round(memUsage.heapUsed / 1048576),
      heap_total_mb: Math.round(memUsage.heapTotal / 1048576),
    },
    ai_mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development',
    features: {
      clinical_decision_support: true,
      workflow_management: true,
      provider_learning: true,
      voice_recognition: true,
      pattern_matching: true,
      soap_generation: true,
      audit_logging: true,
      phi_encryption: true,
      jwt_authentication: true,
      rbac: true,
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    features: {
      pattern_matching: true,
      claude_api: aiClient.isClaudeEnabled(),
      real_time_extraction: true,
      soap_generation: true,
      clinical_decision_support: true,
      provider_learning: true
    }
  });
});

// ==========================================
// AUDIT LOG ENDPOINTS
// ==========================================

app.get('/api/audit/logs', async (req, res) => {
  try {
    const result = await audit.queryAuditLogs({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
      user: req.query.user || undefined,
      action: req.query.action || undefined,
      resource_type: req.query.resource_type || undefined,
      patient_id: req.query.patient_id || undefined,
      phi_only: req.query.phi_only === 'true',
      date_from: req.query.date_from || undefined,
      date_to: req.query.date_to || undefined,
      search: req.query.search ? sanitizeString(req.query.search, 100) : undefined,
      session_id: req.query.session_id || undefined,
    });
    res.json(result);
  } catch (error) {
    console.error('Error querying audit logs:', error);
    res.status(500).json({ error: 'Failed to query audit logs' });
  }
});

app.get('/api/audit/stats', async (req, res) => {
  try {
    const stats = await audit.getAuditStats({
      date_from: req.query.date_from || undefined,
      date_to: req.query.date_to || undefined,
    });
    res.json(stats);
  } catch (error) {
    console.error('Error fetching audit stats:', error);
    res.status(500).json({ error: 'Failed to fetch audit stats' });
  }
});

app.get('/api/audit/sessions', rbac.requireRole('admin'), async (req, res) => {
  try {
    const result = await audit.getAuditSessions({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      active_only: req.query.active_only === 'true',
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching audit sessions:', error);
    res.status(500).json({ error: 'Failed to fetch audit sessions' });
  }
});

app.get('/api/audit/patient/:id', async (req, res) => {
  try {
    const patientId = validateId(req.params.id);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

    const result = await audit.queryAuditLogs({
      patient_id: patientId,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching patient audit trail:', error);
    res.status(500).json({ error: 'Failed to fetch patient audit trail' });
  }
});

app.get('/api/audit/export', rbac.requireRole('admin'), async (req, res) => {
  try {
    const result = await audit.queryAuditLogs({
      page: 1,
      limit: 10000,
      phi_only: req.query.phi_only === 'true',
      date_from: req.query.date_from || undefined,
      date_to: req.query.date_to || undefined,
    });

    const headers = ['timestamp','user_identity','user_role','action','resource_type','resource_id','patient_id','phi_accessed','request_path','response_status','ip_address','duration_ms'];
    const rows = result.logs.map(log => headers.map(h => JSON.stringify(log[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// ==========================================
// GLOBAL ERROR HANDLER (must be after all routes)
// ==========================================

app.use((err, req, res, _next) => {
  // CORS errors
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Forbidden: CORS policy violation' });
  }

  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    logger.warn('Malformed JSON request rejected', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    return res.status(400).json({ error: 'Malformed JSON request body' });
  }

  logger.error('Unhandled Express error', {
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An internal error occurred'
      : err.message,
  });
});

// ==========================================
// SCHEDULING ENDPOINTS
// ==========================================

app.get('/api/schedule', async (req, res) => {
  try {
    const { date, provider } = req.query;
    if (!date) return res.status(400).json({ error: 'date query parameter required (YYYY-MM-DD)' });
    const appointments = await db.getAppointmentsByDate(date, provider || null);
    res.json({ date, provider: provider || 'all', appointments });
  } catch (err) {
    logger.error('Error fetching schedule', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

app.get('/api/patients/:id/appointments', async (req, res) => {
  try {
    const patientId = validateId(req.params.id);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });
    const appointments = await db.getAppointmentsByPatient(patientId);
    res.json(appointments);
  } catch (err) {
    logger.error('Error fetching patient appointments', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

app.get('/api/appointments/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment ID' });
    const appt = await db.getAppointmentById(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    res.json(appt);
  } catch (err) {
    logger.error('Error fetching appointment', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const { patient_id, provider_name, appointment_date, appointment_time,
      duration_minutes, appointment_type, chief_complaint, notes } = req.body;

    if (!patient_id || !provider_name || !appointment_date || !appointment_time || !appointment_type) {
      return res.status(400).json({
        error: 'Required fields: patient_id, provider_name, appointment_date, appointment_time, appointment_type'
      });
    }

    const validTypes = ['new_patient','follow_up','sick_visit','wellness','procedure','telehealth','referral','urgent'];
    if (!validTypes.includes(appointment_type)) {
      return res.status(400).json({ error: `appointment_type must be one of: ${validTypes.join(', ')}` });
    }

    const appt = await db.createAppointment({
      patient_id: validateId(patient_id),
      provider_name: sanitizeString(provider_name, 100),
      appointment_date,
      appointment_time,
      duration_minutes: duration_minutes || 20,
      appointment_type,
      chief_complaint: chief_complaint ? sanitizeString(chief_complaint, 500) : null,
      notes: notes ? sanitizeString(notes, 1000) : null
    });
    res.status(201).json(appt);
  } catch (err) {
    logger.error('Error creating appointment', { error: err.message });
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

app.patch('/api/appointments/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment ID' });
    const appt = await db.getAppointmentById(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const allowed = ['status','chief_complaint','notes','appointment_date',
      'appointment_time','duration_minutes','encounter_id','appointment_type'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    await db.updateAppointment(id, updates);
    const updated = await db.getAppointmentById(id);
    res.json(updated);
  } catch (err) {
    logger.error('Error updating appointment', { error: err.message });
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

app.delete('/api/appointments/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment ID' });
    await db.deleteAppointment(id);
    res.json({ message: 'Appointment deleted' });
  } catch (err) {
    logger.error('Error deleting appointment', { error: err.message });
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

// ==========================================
// BILLING / CHARGE CAPTURE ENDPOINTS
// ==========================================

// Get charge for an encounter (or compute E/M suggestion without saving)
app.get('/api/encounters/:id/charge', rbac.requireRole('physician', 'nurse_practitioner', 'billing'), async (req, res) => {
  try {
    const encounterId = validateId(req.params.id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const existing = await db.getChargeByEncounter(encounterId);
    if (existing) {
      return res.json(existing);
    }

    // No charge yet — return E/M suggestion for preview
    const encounter = await db.getEncounterById(encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

    const context = await billing.buildBillingContext(encounterId, encounter.patient_id);
    const suggestion = billing.assessMDM(context);
    res.json({ encounter_id: encounterId, status: 'draft', em_suggestion: suggestion, charge: null });
  } catch (err) {
    logger.error('Error fetching charge', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch charge' });
  }
});

// Capture charge (creates/updates draft — does not finalize)
app.post('/api/encounters/:id/charge', rbac.requireRole('physician', 'nurse_practitioner', 'billing'), async (req, res) => {
  try {
    const encounterId = validateId(req.params.id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const encounter = await db.getEncounterById(encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

    const charge = await billing.captureCharge(
      encounterId,
      encounter.patient_id,
      req.user?.name || encounter.provider,
      {
        em_level: req.body.em_level || null,
        cpt_codes: req.body.cpt_codes || [],
        icd10_codes: req.body.icd10_codes || null,
        notes: req.body.notes || null
      }
    );
    res.status(201).json(charge);
  } catch (err) {
    logger.error('Error capturing charge', { error: err.message });
    res.status(500).json({ error: 'Failed to capture charge' });
  }
});

// Checkout — finalizes charge and marks encounter checked-out
app.post('/api/encounters/:id/checkout', rbac.requireRole('physician', 'nurse_practitioner', 'billing'), async (req, res) => {
  try {
    const encounterId = validateId(req.params.id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const encounter = await db.getEncounterById(encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

    const charge = await billing.finalizeCheckout(
      encounterId,
      encounter.patient_id,
      req.user?.name || encounter.provider,
      {
        em_level: req.body.em_level || null,
        cpt_codes: req.body.cpt_codes || [],
        icd10_codes: req.body.icd10_codes || null,
        notes: req.body.notes || null
      }
    );
    res.json({ message: 'Checkout complete', charge });
  } catch (err) {
    logger.error('Error processing checkout', { error: err.message });
    res.status(500).json({ error: 'Failed to process checkout' });
  }
});

// Get charges by status (billing worklist)
app.get('/api/billing/charges', async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['draft','finalized','submitted','billed','paid','denied','voided'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const charges = await db.getChargesByStatus(status || 'finalized');
    res.json(charges);
  } catch (err) {
    logger.error('Error fetching charges', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch charges' });
  }
});

// ==========================================
// INSURANCE ELIGIBILITY VERIFICATION API
// ==========================================

// Known insurance carriers for mock eligibility verification
const KNOWN_CARRIERS = [
  'Aetna', 'Anthem', 'Ambetter', 'BlueCross', 'Cigna', 'Humana', 'Kaiser',
  'Medicare', 'Medicaid', 'UnitedHealth', 'Optum', 'Molina'
];

// POST /api/insurance/verify-eligibility
// Mock eligibility check endpoint
app.post('/api/insurance/verify-eligibility', async (req, res) => {
  try {
    const { patient_id, insurance_carrier, insurance_id } = req.body;

    if (!patient_id || !insurance_carrier || !insurance_id) {
      return res.status(400).json({ error: 'patient_id, insurance_carrier, and insurance_id are required' });
    }

    // Validate carrier name format (alphanumeric + spaces)
    if (!/^[A-Za-z\s]+$/.test(insurance_carrier)) {
      return res.status(400).json({ error: 'insurance_carrier must contain only letters and spaces' });
    }

    // Validate ID format (alphanumeric, hyphens, underscores)
    if (!/^[A-Za-z0-9\-_]+$/.test(insurance_id)) {
      return res.status(400).json({ error: 'insurance_id must contain only alphanumeric characters, hyphens, and underscores' });
    }

    // Determine eligibility based on known carriers
    const isKnown = KNOWN_CARRIERS.some(c => insurance_carrier.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(insurance_carrier.toLowerCase()));
    const eligible = isKnown;

    // Generate mock eligibility response
    const response = {
      eligible,
      carrier: insurance_carrier,
      plan_type: eligible ? ['PPO', 'HMO', 'EPO', 'HDHP'][Math.floor(Math.random() * 4)] : null,
      copay: eligible ? [20, 25, 30, 35, 40][Math.floor(Math.random() * 5)] : null,
      deductible: eligible ? [500, 1000, 1500, 2000, 2500][Math.floor(Math.random() * 5)] : null,
      coverage_effective: eligible ? '2026-01-01' : null,
      coverage_end: eligible ? '2026-12-31' : null,
      group_number: eligible ? `GRP-${Math.floor(Math.random() * 100000)}` : null,
      verification_timestamp: new Date().toISOString()
    };

    logger.info('Insurance eligibility verified', {
      patient_id,
      carrier: insurance_carrier,
      eligible,
      session_id: req.headers['x-session-id']
    });

    res.json(response);
  } catch (err) {
    logger.error('Error verifying insurance eligibility', { error: err.message });
    res.status(500).json({ error: 'Failed to verify insurance eligibility' });
  }
});

// GET /api/insurance/carriers
// List supported insurance carriers
app.get('/api/insurance/carriers', (req, res) => {
  res.json({
    carriers: KNOWN_CARRIERS,
    count: KNOWN_CARRIERS.length,
    note: 'Unknown carriers will return eligible: false'
  });
});

// ==========================================
// SERVE REACT APP (catch-all must be last)
// ==========================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ==========================================
// START SERVER
// ==========================================

let initializationPromise = null;
let serverInstance = null;
let shutdownHandlersRegistered = false;

async function initializeServerState() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    await db.ready;
    await runMigrations(db);
    await auth.init(db);
    await refreshTokens.init(db);

    try {
      await seedDecisionQueue(db);
    } catch (err) {
      logger.warn('Decision queue seed on startup failed (non-fatal)', { error: err.message });
    }

    try {
      await providerLearning.decayPreferences();
    } catch (err) {
      logger.warn('Preference decay on startup failed (non-fatal)', { error: err.message });
    }

    try {
      const { MessageBus } = require('./agents/message-bus');
      const messageBus = new MessageBus(db);
      messageBus.wireCATCDataFlows();

      const eventBus = require('./integrations/event-bus');
      const EVENT_MAP = {
        'NOTE_SIGNED': 'note.signed',
        'ENCOUNTER_COMPLETED': 'encounter.completed',
        'PRESCRIPTION_CREATED': 'prescription.created',
        'LAB_RESULTED': 'lab.resulted',
        'CARE_GAP_DETECTED': 'care_gap.detected',
        'REFERRAL_STATUS': 'referral.created'
      };
      for (const [internal, external] of Object.entries(EVENT_MAP)) {
        messageBus.subscribe('event_bus_bridge', internal, async (msg) => {
          const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
          eventBus.emit(external, { ...payload, patient_id: msg.patient_id, encounter_id: msg.encounter_id });
        });
      }
      app.locals.messageBus = messageBus;
      logger.info('CATC cross-module data flows initialized');
    } catch (err) {
      logger.warn('CATC data flow init failed (non-fatal)', { error: err.message });
    }
  })();

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;
    throw error;
  }
}

function registerGracefulShutdown(server) {
  if (shutdownHandlersRegistered) {
    return;
  }

  shutdownHandlersRegistered = true;
  const gracefulShutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed');
      db.close();
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

async function startServer() {
  if (serverInstance) {
    return serverInstance;
  }

  await initializeServerState();

  serverInstance = app.listen(PORT, () => {
    logger.info('Server started', {
      port: PORT,
      ai_mode: aiClient.getMode(),
      claude_enabled: aiClient.isClaudeEnabled(),
      node_env: process.env.NODE_ENV || 'development',
    });
    console.log('[MJR-EHR] Server running on http://localhost:' + PORT);
  });

  serverInstance.on('close', () => {
    serverInstance = null;
  });

  registerGracefulShutdown(serverInstance);
  return serverInstance;
}

if (require.main === module) {
  startServer().catch(err => {
    logger.fatal('Server failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = {
  app,
  initializeServerState,
  startServer,
};
