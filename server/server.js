const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('./database');
const aiClient = require('./ai-client');
const workflow = require('./workflow-engine');
const cds = require('./cds-engine');
const providerLearning = require('./provider-learning');
const llmCds = require('./llm-cds');
const voicePipeline = require('./voice-pipeline');
const communications = require('./communications');
const billing = require('./billing-engine');
const agentOrchestrator = require('./agent-orchestrator');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_BEFORE_PRODUCTION';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting — general API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// Core middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// ==========================================
// JWT AUTHENTICATION
// ==========================================

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function authenticateToken(req, res, next) {
  // Skip auth in development when JWT_SECRET is default
  if (process.env.NODE_ENV !== 'production' && JWT_SECRET === 'CHANGE_ME_BEFORE_PRODUCTION') {
    req.user = { id: 1, username: 'dev', role: 'provider' };
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Auth endpoints (public)
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Demo mode: accept any credentials with matching username/password
    // In production, validate against a users table with bcrypt-hashed passwords
    if (process.env.NODE_ENV !== 'production') {
      const token = generateToken({ id: 1, username, role: 'provider' });
      return res.json({ token, user: { id: 1, username, role: 'provider' } });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/refresh', authenticateToken, (req, res) => {
  const token = generateToken(req.user);
  res.json({ token });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Apply auth to all API routes below (except health, auth, and static)
app.use('/api/patients', authenticateToken);
app.use('/api/encounters', authenticateToken);
app.use('/api/prescriptions', authenticateToken);
app.use('/api/lab-orders', authenticateToken);
app.use('/api/imaging-orders', authenticateToken);
app.use('/api/referrals', authenticateToken);
app.use('/api/vitals', authenticateToken);
app.use('/api/workflow', authenticateToken);
app.use('/api/workflows', authenticateToken);
app.use('/api/cds', authenticateToken);
app.use('/api/ai', authenticateToken);
app.use('/api/llm-cds', authenticateToken);
app.use('/api/voice', authenticateToken);
app.use('/api/communications', authenticateToken);
app.use('/api/billing', authenticateToken);
app.use('/api/agents', authenticateToken);
app.use('/api/provider', authenticateToken);
app.use('/api/dashboard', authenticateToken);

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

// ==========================================
// PATIENT ENDPOINTS
// ==========================================

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    const patients = await db.getAllPatients();
    res.json(patients);
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

    const [problems, medications, allergies, labs, vitals] = await Promise.all([
      db.getPatientProblems(id),
      db.getPatientMedications(id),
      db.getPatientAllergies(id),
      db.getPatientLabs(id),
      db.getPatientVitals(id)
    ]);

    res.json({
      ...patient,
      age: db.calculateAge(patient.dob),
      problems,
      medications,
      allergies,
      labs,
      vitals: vitals.length > 0 ? vitals[0] : null,
      vitals_history: vitals
    });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Create new patient
app.post('/api/patients', async (req, res) => {
  try {
    const err = requireFields(req.body, ['first_name', 'last_name', 'dob']);
    if (err) {
      return res.status(400).json({ error: err });
    }

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
    const extracted = await aiClient.extractClinicalData(trimmed, {});

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

app.post('/api/patients/:id/problems', async (req, res) => {
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

app.get('/api/patients/:id/medications', async (req, res) => {
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

app.post('/api/patients/:id/medications', async (req, res) => {
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
    res.json(encounters);
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

    res.json(encounter);
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
    const extracted = await aiClient.extractClinicalData(sanitizeString(transcript, 20000), patient);

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

    // Record provider learning
    try {
      const encounter = rxData.encounter_id ? await db.getEncounterById(rxData.encounter_id) : null;
      if (encounter) {
        const problems = await db.getPatientProblems(patientId);
        for (const prob of problems.filter(p => p.status === 'active')) {
          await providerLearning.recordProviderAction(
            rxData.prescriber, prob.icd10_code, prob.problem_name,
            'medication', JSON.stringify(rxData)
          );
        }
      }
    } catch (learnErr) {
      console.error('Provider learning error (non-fatal):', learnErr.message);
    }

    res.status(201).json(result);
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

        const result = await db.createPrescription(rxData);
        prescriptions.push({ ...rxData, id: result.id });
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

    // Record provider learning
    try {
      const problems = await db.getPatientProblems(patientId);
      for (const prob of problems.filter(p => p.status === 'active')) {
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

    // Record provider learning
    try {
      const problems = await db.getPatientProblems(patientId);
      for (const prob of problems.filter(p => p.status === 'active')) {
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

    // Record provider learning
    try {
      const problems = await db.getPatientProblems(patientId);
      for (const prob of problems.filter(p => p.status === 'active')) {
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
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
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

    const result = await workflow.transitionState(encounterId, req.body.target_state, {
      assigned_ma: req.body.assigned_ma,
      assigned_provider: req.body.assigned_provider
    });

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
      return res.status(400).json({ error: error.message });
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

// Get queue by state (for dashboard)
app.get('/api/workflow/queue/:state', async (req, res) => {
  try {
    const encounters = await workflow.getQueue(req.params.state);
    res.json(encounters);
  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
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

    const ruleSuggestions = await cds.evaluatePatientContext(encounterId, patientId, context);

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

    // Record acceptance for provider learning
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

        for (const prob of problems.filter(p => p.status === 'active')) {
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

app.get('/api/patients/:id/allergies', async (req, res) => {
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

app.post('/api/patients/:id/allergies', async (req, res) => {
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

app.get('/api/patients/:id/labs', async (req, res) => {
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

app.get('/api/patients/:id/vitals', async (req, res) => {
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

app.get('/api/encounters/:id/orders', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid encounter ID' });

    const [labOrders, imagingOrders, referrals, prescriptions] = await Promise.all([
      db.dbAll('SELECT * FROM lab_orders WHERE encounter_id = ? ORDER BY order_date DESC', [id]),
      db.dbAll('SELECT * FROM imaging_orders WHERE encounter_id = ? ORDER BY order_date DESC', [id]),
      db.dbAll('SELECT * FROM referrals WHERE encounter_id = ? ORDER BY referred_date DESC', [id]),
      db.dbAll('SELECT * FROM prescriptions WHERE encounter_id = ? ORDER BY prescribed_date DESC', [id])
    ]);

    res.json({
      encounter_id: id,
      lab_orders: labOrders,
      imaging_orders: imagingOrders,
      referrals,
      prescriptions,
      total_orders: labOrders.length + imagingOrders.length + referrals.length + prescriptions.length
    });
  } catch (error) {
    console.error('Error fetching encounter orders:', error);
    res.status(500).json({ error: 'Failed to fetch encounter orders' });
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
      recent_encounters: encounters
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ==========================================
// LLM-AUGMENTED CDS ENDPOINTS
// ==========================================

app.post('/api/llm-cds/reason', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id']);
    if (err) return res.status(400).json({ error: err });

    const patientId = validateId(req.body.patient_id);
    const encounterId = req.body.encounter_id ? validateId(req.body.encounter_id) : null;
    if (!patientId) return res.status(400).json({ error: 'Invalid patient_id' });

    const context = await cds.buildPatientContext(patientId, encounterId);

    // Get existing rule-based suggestions
    let ruleSuggestions = [];
    if (encounterId) {
      ruleSuggestions = await cds.evaluatePatientContext(encounterId, patientId, context);
    }

    // Run augmented reasoning
    const result = await llmCds.augmentedClinicalReasoning(context, ruleSuggestions);
    res.json(result);
  } catch (error) {
    console.error('LLM CDS reasoning error:', error);
    res.status(500).json({ error: 'Failed to run clinical reasoning' });
  }
});

app.post('/api/llm-cds/differential', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id']);
    if (err) return res.status(400).json({ error: err });

    const patientId = validateId(req.body.patient_id);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient_id' });

    const context = await cds.buildPatientContext(patientId, req.body.encounter_id ? validateId(req.body.encounter_id) : null);
    context.chiefComplaint = req.body.chief_complaint || '';
    context.transcript = req.body.transcript || '';

    const result = await llmCds.generateDifferentialDiagnosis(context);
    res.json(result);
  } catch (error) {
    console.error('Differential diagnosis error:', error);
    res.status(500).json({ error: 'Failed to generate differential' });
  }
});

app.post('/api/llm-cds/treatment-plan', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'diagnosis']);
    if (err) return res.status(400).json({ error: err });

    const patientId = validateId(req.body.patient_id);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient_id' });

    const context = await cds.buildPatientContext(patientId, req.body.encounter_id ? validateId(req.body.encounter_id) : null);
    const result = await llmCds.generateTreatmentPlan(context, req.body.diagnosis);
    res.json(result);
  } catch (error) {
    console.error('Treatment plan error:', error);
    res.status(500).json({ error: 'Failed to generate treatment plan' });
  }
});

// ==========================================
// VOICE PIPELINE ENDPOINTS
// ==========================================

app.get('/api/voice/config', (req, res) => {
  const config = voicePipeline.getASRConfig();
  res.json(config);
});

app.post('/api/voice/sessions', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id', 'patient_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    const patientId = validateId(req.body.patient_id);
    if (!encounterId || !patientId) return res.status(400).json({ error: 'Invalid IDs' });

    const session = voicePipeline.createSession(encounterId, patientId, {
      autoExtract: req.body.auto_extract !== false
    });
    res.status(201).json({ encounterId, patientId, status: 'active' });
  } catch (error) {
    console.error('Voice session error:', error);
    res.status(500).json({ error: 'Failed to create voice session' });
  }
});

app.post('/api/voice/sessions/:encounterId/segment', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter ID' });

    const session = voicePipeline.getSession(encounterId);
    if (!session) return res.status(404).json({ error: 'No active voice session for this encounter' });

    const { text, speaker, confidence, is_final } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const segment = session.addSegment(text, { speaker, confidence, isFinal: is_final });
    res.json({ segment, extractedData: session.extractedData });
  } catch (error) {
    console.error('Voice segment error:', error);
    res.status(500).json({ error: 'Failed to process voice segment' });
  }
});

app.get('/api/voice/sessions/:encounterId', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    const session = voicePipeline.getSession(encounterId);
    if (!session) return res.status(404).json({ error: 'No active voice session' });

    res.json(session.getSummary());
  } catch (error) {
    console.error('Voice session query error:', error);
    res.status(500).json({ error: 'Failed to get voice session' });
  }
});

app.delete('/api/voice/sessions/:encounterId', async (req, res) => {
  try {
    const encounterId = validateId(req.params.encounterId);
    const summary = voicePipeline.endSession(encounterId);
    if (!summary) return res.status(404).json({ error: 'No active voice session' });

    res.json(summary);
  } catch (error) {
    console.error('Voice session end error:', error);
    res.status(500).json({ error: 'Failed to end voice session' });
  }
});

app.post('/api/voice/parse-command', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const command = voicePipeline.parseVoiceCommand(text);
  res.json({ command, isCommand: !!command });
});

app.get('/api/voice/sessions', (req, res) => {
  res.json(voicePipeline.getActiveSessions());
});

// ==========================================
// COMMUNICATIONS ENDPOINTS
// ==========================================

app.post('/api/communications/sms', async (req, res) => {
  try {
    const err = requireFields(req.body, ['to', 'body']);
    if (err) return res.status(400).json({ error: err });

    const result = await communications.sendSMS(
      sanitizeString(req.body.to, 20),
      sanitizeString(req.body.body, 1600),
      {
        patientId: req.body.patient_id ? validateId(req.body.patient_id) : null,
        encounterId: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
        patientName: req.body.patient_name,
        staffMember: req.body.staff_member
      }
    );
    res.json(result);
  } catch (error) {
    console.error('SMS send error:', error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

app.post('/api/communications/email', async (req, res) => {
  try {
    const err = requireFields(req.body, ['to', 'subject', 'body']);
    if (err) return res.status(400).json({ error: err });

    const result = await communications.sendEmail(
      sanitizeString(req.body.to, 200),
      sanitizeString(req.body.subject, 200),
      sanitizeString(req.body.body, 10000),
      {
        patientId: req.body.patient_id ? validateId(req.body.patient_id) : null,
        staffMember: req.body.staff_member
      }
    );
    res.json(result);
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

app.post('/api/communications/template', async (req, res) => {
  try {
    const err = requireFields(req.body, ['template_name', 'variables', 'recipient']);
    if (err) return res.status(400).json({ error: err });

    const result = await communications.sendTemplatedMessage(
      req.body.template_name,
      req.body.variables,
      req.body.recipient,
      { patientId: req.body.patient_id ? validateId(req.body.patient_id) : null }
    );
    res.json(result);
  } catch (error) {
    console.error('Templated message error:', error);
    res.status(500).json({ error: error.message || 'Failed to send templated message' });
  }
});

app.get('/api/communications/templates', async (req, res) => {
  try {
    const templates = await communications.getMessageTemplates(req.query.category || null);
    res.json(templates);
  } catch (error) {
    console.error('Templates fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

app.get('/api/communications/log', async (req, res) => {
  try {
    if (req.query.patient_id) {
      const pid = validateId(req.query.patient_id);
      if (!pid) return res.status(400).json({ error: 'Invalid patient_id' });
      const log = await communications.getPatientCommunications(pid, { channel: req.query.channel });
      return res.json(log);
    }
    const log = await communications.getRecentCommunications(parseInt(req.query.limit, 10) || 50);
    res.json(log);
  } catch (error) {
    console.error('Communication log error:', error);
    res.status(500).json({ error: 'Failed to fetch communication log' });
  }
});

app.post('/api/communications/calls/inbound', async (req, res) => {
  try {
    const result = await communications.logInboundCall(req.body.caller_phone, {
      patientId: req.body.patient_id ? validateId(req.body.patient_id) : null,
      callerName: req.body.caller_name,
      reason: req.body.reason,
      urgency: req.body.urgency,
      assignedTo: req.body.assigned_to
    });
    res.json(result);
  } catch (error) {
    console.error('Inbound call error:', error);
    res.status(500).json({ error: 'Failed to log inbound call' });
  }
});

app.post('/api/communications/calls/triage', async (req, res) => {
  try {
    const err = requireFields(req.body, ['caller_phone']);
    if (err) return res.status(400).json({ error: err });

    const result = await communications.triageCall(req.body.call_id, req.body.caller_phone);
    res.json(result);
  } catch (error) {
    console.error('Call triage error:', error);
    res.status(500).json({ error: 'Failed to triage call' });
  }
});

app.get('/api/communications/call-queue', async (req, res) => {
  try {
    const queue = await communications.getCallQueue(req.query.status || null);
    res.json(queue);
  } catch (error) {
    console.error('Call queue error:', error);
    res.status(500).json({ error: 'Failed to fetch call queue' });
  }
});

app.post('/api/communications/video-session', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id', 'patient_id']);
    if (err) return res.status(400).json({ error: err });

    const result = await communications.createVideoSession(
      validateId(req.body.encounter_id),
      validateId(req.body.patient_id),
      { providerName: req.body.provider_name }
    );
    res.json(result);
  } catch (error) {
    console.error('Video session error:', error);
    res.status(500).json({ error: 'Failed to create video session' });
  }
});

app.post('/api/communications/:id/suggest-response', async (req, res) => {
  try {
    const commId = validateId(req.params.id);
    if (!commId) return res.status(400).json({ error: 'Invalid communication ID' });

    const suggestion = await communications.generateSuggestedResponse(commId);
    res.json({ suggestion });
  } catch (error) {
    console.error('Suggest response error:', error);
    res.status(500).json({ error: 'Failed to generate suggested response' });
  }
});

// ==========================================
// BILLING / REVENUE CYCLE ENDPOINTS
// ==========================================

app.post('/api/billing/claims/generate', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter_id' });

    const claim = await billing.generateClaimFromEncounter(encounterId);
    res.status(201).json(claim);
  } catch (error) {
    console.error('Claim generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate claim' });
  }
});

app.post('/api/billing/claims/:id/scrub', async (req, res) => {
  try {
    const claimId = validateId(req.params.id);
    if (!claimId) return res.status(400).json({ error: 'Invalid claim ID' });

    const result = await billing.scrubClaim(claimId);
    res.json(result);
  } catch (error) {
    console.error('Claim scrub error:', error);
    res.status(500).json({ error: error.message || 'Failed to scrub claim' });
  }
});

app.post('/api/billing/claims/:id/submit', async (req, res) => {
  try {
    const claimId = validateId(req.params.id);
    if (!claimId) return res.status(400).json({ error: 'Invalid claim ID' });

    const result = await billing.submitClaim(claimId);
    res.json(result);
  } catch (error) {
    console.error('Claim submission error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit claim' });
  }
});

app.get('/api/billing/claims', async (req, res) => {
  try {
    const claims = await billing.getClaims({
      status: req.query.status,
      patient_id: req.query.patient_id ? validateId(req.query.patient_id) : null,
      payer_id: req.query.payer_id ? validateId(req.query.payer_id) : null
    });
    res.json(claims);
  } catch (error) {
    console.error('Claims fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

app.get('/api/billing/claims/:id', async (req, res) => {
  try {
    const claimId = validateId(req.params.id);
    if (!claimId) return res.status(400).json({ error: 'Invalid claim ID' });

    const claim = await billing.getClaimById(claimId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    res.json(claim);
  } catch (error) {
    console.error('Claim fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch claim' });
  }
});

app.post('/api/billing/claims/:id/deny', async (req, res) => {
  try {
    const claimId = validateId(req.params.id);
    if (!claimId) return res.status(400).json({ error: 'Invalid claim ID' });

    const err = requireFields(req.body, ['denial_code', 'denial_reason']);
    if (err) return res.status(400).json({ error: err });

    const result = await billing.recordDenial(claimId, req.body);
    res.json(result);
  } catch (error) {
    console.error('Denial record error:', error);
    res.status(500).json({ error: error.message || 'Failed to record denial' });
  }
});

app.post('/api/billing/eligibility/:patientId', async (req, res) => {
  try {
    const patientId = validateId(req.params.patientId);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

    const result = await billing.verifyEligibility(patientId);
    res.json(result);
  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify eligibility' });
  }
});

app.post('/api/billing/payments', async (req, res) => {
  try {
    const err = requireFields(req.body, ['patient_id', 'payment_type', 'amount', 'payment_date']);
    if (err) return res.status(400).json({ error: err });

    const result = await billing.postPayment({
      ...req.body,
      patient_id: validateId(req.body.patient_id),
      claim_id: req.body.claim_id ? validateId(req.body.claim_id) : null
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Payment posting error:', error);
    res.status(500).json({ error: 'Failed to post payment' });
  }
});

app.get('/api/billing/patients/:id/balance', async (req, res) => {
  try {
    const patientId = validateId(req.params.id);
    if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

    const balance = await billing.getPatientBalance(patientId);
    res.json(balance);
  } catch (error) {
    console.error('Balance fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch patient balance' });
  }
});

app.get('/api/billing/payers', async (req, res) => {
  try {
    const payers = await billing.getPayers();
    res.json(payers);
  } catch (error) {
    console.error('Payers fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch payers' });
  }
});

app.get('/api/billing/fee-schedule', async (req, res) => {
  try {
    const fees = await billing.getFeeSchedule(req.query.category || null);
    res.json(fees);
  } catch (error) {
    console.error('Fee schedule error:', error);
    res.status(500).json({ error: 'Failed to fetch fee schedule' });
  }
});

app.get('/api/billing/analytics', async (req, res) => {
  try {
    const analytics = await billing.getRevenueAnalytics(req.query.start_date, req.query.end_date);
    res.json(analytics);
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch revenue analytics' });
  }
});

// ==========================================
// AGENT ORCHESTRATION ENDPOINTS
// ==========================================

app.get('/api/agents/status', async (req, res) => {
  try {
    const status = await agentOrchestrator.getAgentStatus();
    res.json(status);
  } catch (error) {
    console.error('Agent status error:', error);
    res.status(500).json({ error: 'Failed to fetch agent status' });
  }
});

app.post('/api/agents/tasks', async (req, res) => {
  try {
    const err = requireFields(req.body, ['task_type', 'agent']);
    if (err) return res.status(400).json({ error: err });

    const result = await agentOrchestrator.submitTask(req.body.task_type, req.body.agent, {
      patientId: req.body.patient_id ? validateId(req.body.patient_id) : null,
      encounterId: req.body.encounter_id ? validateId(req.body.encounter_id) : null,
      input: req.body.input || {},
      priority: req.body.priority
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Agent task error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit agent task' });
  }
});

app.get('/api/agents/tasks', async (req, res) => {
  try {
    const tasks = await agentOrchestrator.getAgentTasks({
      agent: req.query.agent,
      status: req.query.status,
      taskType: req.query.task_type,
      patientId: req.query.patient_id ? validateId(req.query.patient_id) : null,
      encounterId: req.query.encounter_id ? validateId(req.query.encounter_id) : null
    });
    res.json(tasks);
  } catch (error) {
    console.error('Agent tasks fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch agent tasks' });
  }
});

app.post('/api/agents/tasks/:id/approve', async (req, res) => {
  try {
    const taskId = validateId(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Invalid task ID' });

    const result = await agentOrchestrator.approveTask(taskId, req.body.approved_by || 'Provider');
    res.json(result);
  } catch (error) {
    console.error('Task approval error:', error);
    res.status(500).json({ error: error.message || 'Failed to approve task' });
  }
});

app.post('/api/agents/orchestrate/encounter', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id', 'patient_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    const patientId = validateId(req.body.patient_id);
    if (!encounterId || !patientId) return res.status(400).json({ error: 'Invalid IDs' });

    const result = await agentOrchestrator.orchestrateEncounter(encounterId, patientId);
    res.json(result);
  } catch (error) {
    console.error('Encounter orchestration error:', error);
    res.status(500).json({ error: 'Failed to orchestrate encounter' });
  }
});

app.post('/api/agents/orchestrate/billing', async (req, res) => {
  try {
    const err = requireFields(req.body, ['encounter_id']);
    if (err) return res.status(400).json({ error: err });

    const encounterId = validateId(req.body.encounter_id);
    if (!encounterId) return res.status(400).json({ error: 'Invalid encounter_id' });

    const result = await agentOrchestrator.orchestratePostEncounterBilling(encounterId);
    res.json(result);
  } catch (error) {
    console.error('Billing orchestration error:', error);
    res.status(500).json({ error: 'Failed to orchestrate billing' });
  }
});

app.get('/api/agents/sessions', async (req, res) => {
  try {
    const sessions = await agentOrchestrator.getAgentSessions(req.query.status || null);
    res.json(sessions);
  } catch (error) {
    console.error('Agent sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch agent sessions' });
  }
});

// ==========================================
// SYSTEM ENDPOINTS
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ai_mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    features: {
      clinical_decision_support: true,
      llm_augmented_cds: llmCds.isEnabled(),
      llm_available: llmCds.isLLMAvailable(),
      workflow_management: true,
      provider_learning: true,
      voice_recognition: true,
      voice_pipeline: voicePipeline.getASRConfig().provider,
      pattern_matching: true,
      soap_generation: true,
      communications: {
        sms: communications.isTwilioConfigured(),
        email: communications.isSendgridConfigured(),
        video: true
      },
      billing: true,
      agent_orchestration: true
    },
    modules: {
      llm_cds: 'active',
      voice_pipeline: 'active',
      communications: 'active',
      billing_engine: 'active',
      agent_orchestrator: 'active'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    mode: aiClient.getMode(),
    claude_enabled: aiClient.isClaudeEnabled(),
    llm_cds_enabled: llmCds.isEnabled(),
    llm_available: llmCds.isLLMAvailable(),
    asr_provider: voicePipeline.getASRConfig().provider,
    features: {
      pattern_matching: true,
      claude_api: aiClient.isClaudeEnabled(),
      real_time_extraction: true,
      soap_generation: true,
      clinical_decision_support: true,
      llm_augmented_cds: llmCds.isEnabled(),
      differential_diagnosis: true,
      treatment_planning: true,
      provider_learning: true,
      voice_pipeline: true,
      voice_commands: true,
      agent_orchestration: true
    }
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

async function startServer() {
  // Wait for database to be ready
  await db.ready;

  // Initialize new module schemas
  try {
    await communications.initCommunicationsSchema();
    console.log('Communications schema initialized');
  } catch (err) {
    console.error('Communications schema init failed (non-fatal):', err.message);
  }

  try {
    await billing.initBillingSchema();
    console.log('Billing schema initialized');
  } catch (err) {
    console.error('Billing schema init failed (non-fatal):', err.message);
  }

  try {
    await agentOrchestrator.initAgentSchema();
    console.log('Agent orchestrator schema initialized');
  } catch (err) {
    console.error('Agent schema init failed (non-fatal):', err.message);
  }

  // Run preference decay on startup
  try {
    await providerLearning.decayPreferences();
  } catch (err) {
    console.error('Preference decay on startup failed (non-fatal):', err.message);
  }

  const asrConfig = voicePipeline.getASRConfig();

  const server = app.listen(PORT, () => {
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MJR-EHR Intelligent Clinical Agent System v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Server running on: http://localhost:${PORT}
  AI Mode: ${aiClient.getMode()}
  Claude API: ${aiClient.isClaudeEnabled() ? 'Enabled' : 'Disabled (using pattern matching)'}

  Security:
    JWT Auth:            ${JWT_SECRET === 'CHANGE_ME_BEFORE_PRODUCTION' ? 'Dev mode (auth bypassed)' : 'Enabled'}
    Security Headers:    Helmet active
    Rate Limiting:       200 req/15min (API), 10 req/15min (auth)

  Core Modules:
    Database:            Connected (better-sqlite3, WAL mode)
    CDS Engine:          25 clinical rules active
    Workflow Engine:     9-state machine ready
    Provider Learning:   Preference tracking enabled
    Speech Recognition:  Ready (browser-based)

  New Modules (v2.0):
    LLM-Augmented CDS:  ${llmCds.isEnabled() ? 'Enabled' : 'Disabled'} (LLM: ${llmCds.isLLMAvailable() ? 'Connected' : 'Mock mode'})
    Voice Pipeline:      ${asrConfig.provider} (${asrConfig.available ? 'Ready' : 'Not configured'})
    Communications:      SMS: ${communications.isTwilioConfigured() ? 'Twilio' : 'Queued'} | Email: ${communications.isSendgridConfigured() ? 'SendGrid' : 'Queued'}
    Billing/RCM:         Active (${process.env.CLEARINGHOUSE || 'no clearinghouse'})
    Agent Orchestrator:  5 agents registered

  API Endpoints: ~85 routes active
  Ready for production workflows!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

startServer().catch(err => {
  console.error('Fatal: Server failed to start:', err);
  process.exit(1);
});

module.exports = app;
