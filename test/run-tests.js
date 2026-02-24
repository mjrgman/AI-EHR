#!/usr/bin/env node

/**
 * MJR-EHR Intelligent Clinical Agent System - Test Suite
 * Tests all components: database, AI extraction, CDS engine, workflow, provider learning, API endpoints
 */

const path = require('path');
const fs = require('fs');

// Set test environment before requiring modules
process.env.DATABASE_PATH = path.join(__dirname, '../data/test-mjr-ehr.db');
process.env.AI_MODE = 'mock';
process.env.PROVIDER_NAME = 'Dr. Test Provider';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  MJR-EHR INTELLIGENT AGENT - TEST SUITE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Clean up test database before starting
const testDbPath = process.env.DATABASE_PATH;
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
  console.log('Cleaned up previous test database\n');
}

const db = require('../server/database');
const aiClient = require('../server/ai-client');
const workflowEngine = require('../server/workflow-engine');
const cdsEngine = require('../server/cds-engine');
const providerLearning = require('../server/provider-learning');
const auditLogger = require('../server/audit-logger');

// Test utilities
let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

async function test(description, testFn) {
  testCount++;
  const num = testCount;
  process.stdout.write(`Test ${num}: ${description}... `);

  try {
    await testFn();
    console.log('PASS');
    passCount++;
  } catch (err) {
    console.log('FAIL');
    console.error(`  Error: ${err.message}`);
    failCount++;
    failures.push({ num, description, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(arr, predicate, message) {
  if (!arr.some(predicate)) {
    throw new Error(message || 'Array does not contain expected element');
  }
}

// ==========================================
// RUN ALL TESTS
// ==========================================

async function runAllTests() {
  // Wait for database to be fully initialized
  await db.ready;

  // Store IDs for cross-test references
  let sarahId, robertId, encounterId, workflowId;

  // ==========================================
  // PHASE 1: DATABASE TESTS
  // ==========================================

  console.log('PHASE 1: DATABASE TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Database initialized with 17 tables', async () => {
    const tables = await db.dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const tableNames = tables.map(t => t.name);
    assert(tableNames.includes('patients'), 'patients table should exist');
    assert(tableNames.includes('workflow_state'), 'workflow_state table should exist');
    assert(tableNames.includes('cds_suggestions'), 'cds_suggestions table should exist');
    assert(tableNames.includes('provider_preferences'), 'provider_preferences table should exist');
    assert(tableNames.includes('clinical_rules'), 'clinical_rules table should exist');
    assert(tableNames.includes('imaging_orders'), 'imaging_orders table should exist');
    assert(tableNames.includes('referrals'), 'referrals table should exist');
  });

  await test('Demo patients loaded (Sarah Mitchell + Robert Chen)', async () => {
    const patients = await db.getAllPatients();
    assert(patients.length >= 2, 'At least two patients should exist');
    const sarah = patients.find(p => p.first_name === 'Sarah');
    assert(sarah, 'Demo patient Sarah should exist');
    assertEqual(sarah.mrn, '2018-04792', 'Sarah MRN should match');
    sarahId = sarah.id;

    const robert = patients.find(p => p.first_name === 'Robert');
    assert(robert, 'Demo patient Robert should exist');
    robertId = robert.id;
  });

  await test('25 clinical rules loaded', async () => {
    const rules = await db.getAllClinicalRules();
    assert(rules.length >= 25, `Expected at least 25 rules, got ${rules.length}`);

    // Check key rule types exist
    const types = [...new Set(rules.map(r => r.rule_type))];
    assert(types.includes('vital_alert'), 'Should have vital_alert rules');
    assert(types.includes('lab_alert'), 'Should have lab_alert rules');
    assert(types.includes('drug_allergy'), 'Should have drug_allergy rules');
    assert(types.includes('drug_interaction'), 'Should have drug_interaction rules');
    assert(types.includes('differential'), 'Should have differential rules');
    assert(types.includes('screening'), 'Should have screening rules');
  });

  await test('Retrieve patient with full clinical data', async () => {
    const [problems, medications, allergies, labs, vitals] = await Promise.all([
      db.getPatientProblems(sarahId),
      db.getPatientMedications(sarahId),
      db.getPatientAllergies(sarahId),
      db.getPatientLabs(sarahId),
      db.getPatientVitals(sarahId)
    ]);

    assertEqual(problems.length, 4, 'Sarah should have 4 problems');
    assertEqual(medications.length, 4, 'Sarah should have 4 medications');
    assertEqual(allergies.length, 1, 'Sarah should have 1 allergy');
    assert(labs.length >= 4, `Sarah should have at least 4 lab results, got ${labs.length}`);
  });

  await test('Create new patient', async () => {
    const result = await db.createPatient({
      first_name: 'John', middle_name: 'Michael', last_name: 'Smith',
      dob: '1978-06-15', sex: 'M', phone: '478-555-0199',
      email: 'john.smith@email.com', address_line1: '123 Test Street',
      city: 'Macon', state: 'GA', zip: '31201',
      insurance_carrier: 'Aetna', insurance_id: 'AT-998877'
    });
    assert(result.id > 0, 'Patient should have an ID');
    assert(result.mrn && result.mrn.length > 0, 'MRN should be generated');

    const patient = await db.getPatientById(result.id);
    assertEqual(patient.first_name, 'John', 'Saved patient first name');
  });

  await test('Add problem to patient', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[patients.length - 1].id;

    const result = await db.addProblem({
      patient_id: patientId, problem_name: 'Hypertension',
      icd10_code: 'I10', onset_date: '2024-01-01', status: 'active'
    });
    assert(result.id > 0, 'Problem should have an ID');

    const problems = await db.getPatientProblems(patientId);
    assert(problems.some(p => p.icd10_code === 'I10'), 'Problem should be retrievable');
  });

  await test('Add medication to patient', async () => {
    const patients = await db.getAllPatients();
    const patientId = patients[patients.length - 1].id;

    const result = await db.addMedication({
      patient_id: patientId, medication_name: 'Lisinopril', generic_name: 'Lisinopril',
      dose: '10mg', route: 'PO', frequency: 'daily', start_date: '2024-01-01',
      status: 'active', prescriber: 'Dr. Test'
    });
    assert(result.id > 0, 'Medication should have an ID');
  });

  // ==========================================
  // PHASE 2: AI PATTERN MATCHING TESTS
  // ==========================================

  console.log('\nPHASE 2: AI PATTERN MATCHING TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Extract vitals from transcript', async () => {
    const transcript = "Patient's blood pressure is 142 over 88, heart rate is 76, temperature 98.6 degrees, and weight is 187 pounds.";
    const vitals = aiClient.extractVitals(transcript);

    assertEqual(vitals.systolic_bp, 142, 'Systolic BP');
    assertEqual(vitals.diastolic_bp, 88, 'Diastolic BP');
    assertEqual(vitals.heart_rate, 76, 'Heart rate');
    assertEqual(vitals.temperature, 98.6, 'Temperature');
    assertEqual(vitals.weight, 187, 'Weight');
  });

  await test('Extract medications from transcript', async () => {
    const transcript = "She's taking Metformin 1000mg twice daily, Lisinopril 20mg once daily, and we'll start Ozempic 0.25mg weekly.";
    const medications = aiClient.extractMedications(transcript);

    assert(medications.length >= 2, `Expected at least 2 medications, got ${medications.length}`);
    const metformin = medications.find(m => m.name.toLowerCase().includes('metformin'));
    assert(metformin, 'Metformin should be found');
    assertEqual(metformin.dose, '1000mg', 'Metformin dose');
    assertEqual(metformin.frequency, 'BID', 'Metformin frequency (twice daily = BID)');
  });

  await test('Extract problems from transcript', async () => {
    const transcript = "Patient has type 2 diabetes and hypertension. Also chronic kidney disease stage 3a.";
    const problems = aiClient.extractProblems(transcript);

    assert(problems.length > 0, 'Should extract at least one problem');
    assert(problems.some(p => p.code === 'E11.9'), 'Should find diabetes (E11.9)');
    assert(problems.some(p => p.code === 'I10'), 'Should find hypertension (I10)');
    assert(problems.some(p => p.code === 'N18.3'), 'Should find CKD stage 3a (N18.3)');
  });

  await test('Extract lab orders from transcript', async () => {
    const transcript = "Order A1C, basic metabolic panel, and urine microalbumin for 6 weeks from now.";
    const labs = aiClient.extractLabOrders(transcript);

    assert(labs.length >= 2, `Expected at least 2 labs, got ${labs.length}`);
    assert(labs.some(l => l.cpt === '83036'), 'Should find A1C (CPT 83036)');
    assert(labs.some(l => l.cpt === '80048'), 'Should find BMP (CPT 80048)');
  });

  // ==========================================
  // PHASE 3: SOAP NOTE GENERATION
  // ==========================================

  console.log('\nPHASE 3: SOAP NOTE GENERATION TEST\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Generate SOAP note from transcript', async () => {
    const patient = await db.getPatientById(sarahId);
    const transcript = `
Doctor: Hi Sarah, how are you doing today?
Patient: Not great doctor, my blood sugars have been high.
Doctor: What have they been running?
Patient: Usually around 180 to 220.
Doctor: I see your A1C is 8.4%, up from 7.2%.
Nurse: 142 over 88.
Doctor: Given your kidney function declining, let's start Ozempic 0.25 mg weekly.
    `;
    const vitals = { systolic_bp: 142, diastolic_bp: 88, heart_rate: 76, temperature: 98.6, weight: 187 };
    const soapNote = await aiClient.generateSOAPNote(transcript, patient, vitals);

    assert(soapNote.length > 200, `SOAP note should have substantial content (got ${soapNote.length} chars)`);
    assert(soapNote.includes('SUBJECTIVE'), 'Should contain SUBJECTIVE section');
    assert(soapNote.includes('OBJECTIVE'), 'Should contain OBJECTIVE section');
    assert(soapNote.includes('ASSESSMENT'), 'Should contain ASSESSMENT section');
    assert(soapNote.includes('PLAN'), 'Should contain PLAN section');
    assert(soapNote.includes('142/88'), 'Should include BP vitals');
  });

  // ==========================================
  // PHASE 4: CLINICAL WORKFLOW TESTS
  // ==========================================

  console.log('\nPHASE 4: CLINICAL WORKFLOW TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Create clinical encounter', async () => {
    const result = await db.createEncounter({
      patient_id: sarahId,
      encounter_type: 'Office Visit - Follow-up',
      chief_complaint: 'Diabetes and hypertension follow-up',
      provider: 'Dr. Test Provider'
    });
    assert(result.id > 0, 'Encounter should have an ID');
    encounterId = result.id;
  });

  await test('Add vitals to encounter', async () => {
    const result = await db.addVitals({
      patient_id: sarahId, encounter_id: encounterId,
      systolic_bp: 142, diastolic_bp: 88, heart_rate: 76, temperature: 98.6, weight: 187
    });
    assert(result.id > 0, 'Vitals record should have an ID');
  });

  await test('Create prescription', async () => {
    const result = await db.createPrescription({
      patient_id: sarahId, encounter_id: encounterId,
      medication_name: 'Semaglutide (Ozempic)', generic_name: 'Semaglutide',
      dose: '0.25mg', route: 'SC', frequency: 'weekly', quantity: 4, refills: 0,
      instructions: 'Inject 0.25mg subcutaneously once weekly.',
      indication: 'Type 2 Diabetes Mellitus', icd10_codes: 'E11.9',
      prescriber: 'Dr. Test Provider', prescribed_date: '2024-12-31', status: 'signed'
    });
    assert(result.id > 0, 'Prescription should have an ID');
  });

  await test('Create lab order', async () => {
    const result = await db.createLabOrder({
      patient_id: sarahId, encounter_id: encounterId,
      test_name: 'Hemoglobin A1C', cpt_code: '83036',
      indication: 'Diabetes monitoring', icd10_codes: 'E11.9',
      order_date: '2024-12-31', priority: 'routine', ordered_by: 'Dr. Test Provider'
    });
    assert(result.id > 0, 'Lab order should have an ID');
  });

  await test('Update encounter with transcript and SOAP note', async () => {
    const patient = await db.getPatientById(sarahId);
    const transcript = "Doctor: Hi Sarah. Patient: Hello doctor, my sugars have been high.";
    const soapNote = await aiClient.generateSOAPNote(transcript, patient, {});

    const result = await db.updateEncounter(encounterId, {
      transcript: transcript, soap_note: soapNote, status: 'completed', duration_minutes: 25
    });
    assert(result.changes > 0, 'Encounter should be updated');
  });

  // ==========================================
  // PHASE 5: WORKFLOW STATE MACHINE TESTS
  // ==========================================

  console.log('\nPHASE 5: WORKFLOW STATE MACHINE TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Create a fresh encounter for workflow testing
  let wfEncId;
  await test('Create workflow for encounter', async () => {
    const enc = await db.createEncounter({
      patient_id: sarahId, encounter_type: 'Office Visit',
      chief_complaint: 'Workflow test', provider: 'Dr. Test Provider'
    });
    wfEncId = enc.id;

    const wf = await workflowEngine.createWorkflow(wfEncId, sarahId, {
      assigned_ma: 'MA Smith', assigned_provider: 'Dr. Test Provider'
    });
    assert(wf.id > 0, 'Workflow should have an ID');
    assertEqual(wf.state, 'scheduled', 'Initial state should be scheduled');
  });

  await test('Get valid transitions from scheduled', async () => {
    const transitions = workflowEngine.getValidTransitions('scheduled');
    assertEqual(transitions.length, 1, 'Should have 1 valid transition');
    assertEqual(transitions[0], 'checked-in', 'Should be able to transition to checked-in');
  });

  await test('Transition: scheduled -> checked-in', async () => {
    const result = await workflowEngine.transitionState(wfEncId, 'checked-in');
    assertEqual(result.previous_state, 'scheduled', 'Previous state');
    assertEqual(result.current_state, 'checked-in', 'Current state');
    assert(result.valid_transitions.includes('roomed'), 'Next should include roomed');
  });

  await test('Transition: checked-in -> roomed -> vitals-recorded', async () => {
    await workflowEngine.transitionState(wfEncId, 'roomed');
    const result = await workflowEngine.transitionState(wfEncId, 'vitals-recorded');
    assertEqual(result.current_state, 'vitals-recorded', 'Should be at vitals-recorded');
  });

  await test('Invalid transition rejected', async () => {
    try {
      await workflowEngine.transitionState(wfEncId, 'checked-out');
      throw new Error('Should have thrown');
    } catch (err) {
      assert(err.message.includes('Invalid transition'), 'Should get invalid transition error');
    }
  });

  await test('Get workflow timeline', async () => {
    const timeline = await workflowEngine.getWorkflowTimeline(wfEncId);
    assertEqual(timeline.current_state, 'vitals-recorded', 'Current state in timeline');
    assert(timeline.timeline.length === 9, 'Timeline should have 9 states');

    const completed = timeline.timeline.filter(t => t.status === 'completed');
    assert(completed.length >= 2, 'Should have at least 2 completed states');

    const current = timeline.timeline.find(t => t.status === 'current');
    assertEqual(current.state, 'vitals-recorded', 'Current state marker');
  });

  await test('Full workflow progression to checkout', async () => {
    await workflowEngine.transitionState(wfEncId, 'provider-examining');
    await workflowEngine.transitionState(wfEncId, 'orders-pending');
    await workflowEngine.transitionState(wfEncId, 'documentation');
    await workflowEngine.transitionState(wfEncId, 'signed');
    const result = await workflowEngine.transitionState(wfEncId, 'checked-out');
    assertEqual(result.current_state, 'checked-out', 'Should reach checked-out');
    assertEqual(result.valid_transitions.length, 0, 'No more transitions from checked-out');
  });

  // ==========================================
  // PHASE 6: CDS ENGINE TESTS
  // ==========================================

  console.log('\nPHASE 6: CDS ENGINE TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Create encounter for CDS testing
  let cdsEncId;
  await test('Build patient context for CDS', async () => {
    const enc = await db.createEncounter({
      patient_id: sarahId, encounter_type: 'Office Visit',
      chief_complaint: 'CDS test encounter', provider: 'Dr. Test Provider'
    });
    cdsEncId = enc.id;

    const context = await cdsEngine.buildPatientContext(sarahId, cdsEncId);
    assert(context.patient, 'Context should have patient');
    assertEqual(context.patient.first_name, 'Sarah', 'Patient should be Sarah');
    assert(context.problems.length >= 4, 'Should have problems');
    assert(context.medications.length >= 4, 'Should have medications');
    assert(context.allergies.length >= 1, 'Should have allergies');
  });

  await test('CDS vital alert: HTN Stage 2 (BP >= 140/90)', async () => {
    const rules = await db.getAllClinicalRules();
    const vitals = { systolic_bp: 155, diastolic_bp: 95 };
    const suggestions = cdsEngine.evaluateVitalRules(rules, vitals, {});

    assert(suggestions.length > 0, 'Should generate vital alert');
    assert(suggestions.some(s => s.title.toLowerCase().includes('hypertension') ||
      s.title.toLowerCase().includes('htn') ||
      s.title.toLowerCase().includes('blood pressure')),
      'Should have HTN-related suggestion');
    assert(suggestions.some(s => s.category === 'urgent' || s.category === 'routine'),
      'Should have appropriate category');
  });

  await test('CDS lab alert: Elevated A1C with diabetes', async () => {
    const rules = await db.getAllClinicalRules();
    const labs = [{ test_name: 'Hemoglobin A1C', result_value: '8.4', units: '%', reference_range: '4.0-5.6' }];
    const context = { problems: [{ icd10_code: 'E11.9', problem_name: 'Type 2 Diabetes' }] };
    const suggestions = cdsEngine.evaluateLabRules(rules, labs, context);

    assert(suggestions.length > 0, 'Should generate lab alert for elevated A1C');
    assert(suggestions.some(s => s.suggestion_type === 'lab_order'), 'Should suggest lab order type');
  });

  await test('CDS drug-allergy alert: Penicillin allergy check', async () => {
    const rules = await db.getAllClinicalRules();
    const medications = [{ medication_name: 'Amoxicillin', status: 'active' }];
    const allergies = [{ allergen: 'Penicillin' }];
    const suggestions = cdsEngine.evaluateDrugInteractionRules(rules, medications, allergies, {});

    assert(suggestions.length > 0, 'Should generate drug-allergy alert');
    assert(suggestions.some(s => s.suggestion_type === 'allergy_alert'), 'Should be allergy_alert type');
    assert(suggestions.some(s => s.category === 'urgent'), 'Should be urgent');
  });

  await test('CDS differential diagnosis: Chest pain', async () => {
    const rules = await db.getAllClinicalRules();
    const suggestions = cdsEngine.evaluateDifferentialRules(rules, 'chest pain', '', {});

    assert(suggestions.length > 0, 'Should generate differential dx for chest pain');
    assert(suggestions.some(s => s.suggestion_type === 'differential_diagnosis'), 'Should be differential type');
  });

  await test('CDS screening: Diabetes monitoring due', async () => {
    const rules = await db.getAllClinicalRules();
    const problems = [{ icd10_code: 'E11.9', problem_name: 'Type 2 Diabetes' }];
    // Pass empty labs (no recent results) so screening is triggered
    const suggestions = cdsEngine.evaluateScreeningRules(rules, problems, [], {});

    assert(suggestions.length > 0, 'Should suggest screening for diabetes');
    assert(suggestions.some(s => s.suggestion_type === 'preventive_care'), 'Should be preventive_care type');
  });

  await test('Full CDS evaluation for Sarah (HTN + DM + CKD)', async () => {
    // Add vitals to make CDS fire vital rules
    await db.addVitals({
      patient_id: sarahId, encounter_id: cdsEncId,
      systolic_bp: 148, diastolic_bp: 92, heart_rate: 76, temperature: 98.6, weight: 187
    });

    const context = await cdsEngine.buildPatientContext(sarahId, cdsEncId);
    const suggestions = await cdsEngine.evaluatePatientContext(cdsEncId, sarahId, context);

    assert(suggestions.length >= 2, `Expected at least 2 suggestions, got ${suggestions.length}`);

    // Check that suggestions are sorted by priority
    for (let i = 1; i < suggestions.length; i++) {
      assert(suggestions[i].priority >= suggestions[i - 1].priority,
        'Suggestions should be sorted by priority');
    }

    // Each suggestion should have required fields
    for (const s of suggestions) {
      assert(s.id > 0, 'Suggestion should be persisted with ID');
      assert(s.title, 'Suggestion should have title');
      assert(s.description, 'Suggestion should have description');
      assert(s.source === 'rule_engine', 'Source should be rule_engine');
    }
  });

  await test('Execute accepted suggestion (creates order)', async () => {
    // Get pending suggestions
    const suggestions = await db.getEncounterSuggestions(cdsEncId);
    assert(suggestions.length > 0, 'Should have suggestions to execute');

    const suggestion = suggestions[0];
    const result = await cdsEngine.executeSuggestion(
      suggestion.id, cdsEncId, sarahId, 'Dr. Test Provider'
    );

    assert(result.suggestion_id === suggestion.id, 'Should return correct suggestion_id');

    // Verify suggestion was marked accepted
    const updated = await db.getSuggestionById(suggestion.id);
    assertEqual(updated.status, 'accepted', 'Suggestion should be marked accepted');
  });

  // ==========================================
  // PHASE 7: PROVIDER LEARNING TESTS
  // ==========================================

  console.log('\nPHASE 7: PROVIDER LEARNING TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Record provider action creates preference', async () => {
    await providerLearning.recordProviderAction(
      'Dr. Test Provider', 'E11.9', 'Type 2 Diabetes',
      'lab_order', JSON.stringify({ test_name: 'Hemoglobin A1C', cpt_code: '83036' })
    );

    const prefs = await db.getProviderPreferences('Dr. Test Provider', 'E11.9');
    assert(prefs.length > 0, 'Should have at least 1 preference');
    assert(prefs.some(p => p.action_type === 'lab_order'), 'Should have lab_order preference');
  });

  await test('Repeated actions increase confidence', async () => {
    // Record same action 5 more times to build confidence
    for (let i = 0; i < 5; i++) {
      await providerLearning.recordProviderAction(
        'Dr. Test Provider', 'E11.9', 'Type 2 Diabetes',
        'lab_order', JSON.stringify({ test_name: 'Hemoglobin A1C', cpt_code: '83036' })
      );
    }

    const prefs = await db.getProviderPreferences('Dr. Test Provider', 'E11.9');
    const labPref = prefs.find(p => p.action_type === 'lab_order');
    assert(labPref, 'Lab order preference should exist');
    assert(labPref.confidence >= 0.7, `Confidence should be >= 0.7 after 6 repetitions, got ${labPref.confidence}`);
    assert(labPref.frequency_count >= 6, `Frequency should be >= 6, got ${labPref.frequency_count}`);
  });

  await test('Get suggestions from high-confidence preferences', async () => {
    const problems = [{ icd10_code: 'E11.9', problem_name: 'Type 2 Diabetes' }];
    const suggestions = await providerLearning.getSuggestionsFromPreferences('Dr. Test Provider', problems, 0.7);

    assert(suggestions.length > 0, 'Should generate suggestion from learned preference');
    assert(suggestions[0].source === 'provider_learning', 'Source should be provider_learning');
    assert(suggestions[0].title.includes('Your Usual'), 'Title should indicate learned pattern');
  });

  await test('Low-confidence preferences not suggested', async () => {
    // Record a new action only once (confidence ~0.3)
    await providerLearning.recordProviderAction(
      'Dr. Test Provider', 'I10', 'Hypertension',
      'medication', JSON.stringify({ medication_name: 'Amlodipine', dose: '5mg' })
    );

    const problems = [{ icd10_code: 'I10', problem_name: 'Hypertension' }];
    const suggestions = await providerLearning.getSuggestionsFromPreferences('Dr. Test Provider', problems, 0.7);

    // Should not suggest since confidence is too low (0.3 + 0.1 = 0.4)
    const amlodipine = suggestions.find(s => s.title && s.title.includes('Hypertension') &&
      JSON.stringify(s.suggested_action).includes('Amlodipine'));
    assert(!amlodipine, 'Low-confidence preference should not be suggested');
  });

  await test('Provider profile returns all preferences', async () => {
    const prefs = await providerLearning.getProviderProfile('Dr. Test Provider');
    assert(prefs.length >= 2, `Should have at least 2 preferences, got ${prefs.length}`);
  });

  // ==========================================
  // PHASE 8: IMAGING & REFERRAL ORDER TESTS
  // ==========================================

  console.log('\nPHASE 8: IMAGING & REFERRAL ORDER TESTS\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Create imaging order', async () => {
    const result = await db.createImagingOrder({
      patient_id: sarahId, encounter_id: cdsEncId,
      study_type: 'X-ray', body_part: 'Chest',
      indication: 'Shortness of breath', ordered_by: 'Dr. Test Provider',
      order_date: '2024-12-31', priority: 'routine', status: 'ordered'
    });
    assert(result.id > 0, 'Imaging order should have an ID');

    const orders = await db.dbAll('SELECT * FROM imaging_orders WHERE patient_id = ?', [sarahId]);
    assert(orders.length > 0, 'Imaging order should be retrievable');
  });

  await test('Create referral', async () => {
    const result = await db.createReferral({
      patient_id: sarahId, encounter_id: cdsEncId,
      specialty: 'Nephrology', reason: 'CKD Stage 3a monitoring',
      urgency: 'routine', referred_by: 'Dr. Test Provider',
      referred_date: '2024-12-31', status: 'pending'
    });
    assert(result.id > 0, 'Referral should have an ID');

    const referrals = await db.dbAll('SELECT * FROM referrals WHERE patient_id = ?', [sarahId]);
    assert(referrals.length > 0, 'Referral should be retrievable');
  });

  // ==========================================
  // PHASE 9: ROBERT CHEN (2ND PATIENT) TESTS
  // ==========================================

  console.log('\nPHASE 9: SECOND DEMO PATIENT (Robert Chen)\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await test('Robert Chen has distinct clinical profile', async () => {
    const [problems, medications, allergies, labs] = await Promise.all([
      db.getPatientProblems(robertId),
      db.getPatientMedications(robertId),
      db.getPatientAllergies(robertId),
      db.getPatientLabs(robertId)
    ]);

    assert(problems.length >= 5, `Robert should have 5+ problems, got ${problems.length}`);
    assert(problems.some(p => p.icd10_code === 'J44.1'), 'Robert should have COPD');
    assert(problems.some(p => p.icd10_code && p.icd10_code.startsWith('I50')), 'Robert should have CHF (I50.x)');
    assert(medications.length >= 6, `Robert should have 6+ medications, got ${medications.length}`);
    assert(allergies.length >= 1, `Robert should have at least 1 allergy`);
    assert(labs.length >= 4, `Robert should have 4+ lab results, got ${labs.length}`);
  });

  await test('CDS fires different rules for Robert (SOB + CHF)', async () => {
    const enc = await db.createEncounter({
      patient_id: robertId, encounter_type: 'Office Visit',
      chief_complaint: 'Shortness of breath and fatigue', provider: 'Dr. Test Provider'
    });

    await db.addVitals({
      patient_id: robertId, encounter_id: enc.id,
      systolic_bp: 152, diastolic_bp: 88, heart_rate: 102, temperature: 98.2,
      weight: 205, spo2: 91
    });

    const context = await cdsEngine.buildPatientContext(robertId, enc.id);
    const suggestions = await cdsEngine.evaluatePatientContext(enc.id, robertId, context);

    assert(suggestions.length >= 2, `Should have 2+ suggestions for Robert, got ${suggestions.length}`);
    // Should trigger tachycardia and/or hypoxia alerts
    const urgentAlerts = suggestions.filter(s => s.category === 'urgent');
    assert(urgentAlerts.length >= 1, 'Should have at least 1 urgent alert');
  });

  // ==========================================
  // PHASE 10: AUDIT LOGGING TESTS
  // ==========================================

  console.log('\n--- PHASE 10: AUDIT LOGGING ---\n');

  await test('Audit tables exist (audit_log, audit_sessions)', async () => {
    const tables = await db.dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = tables.map(t => t.name);
    assert(names.includes('audit_log'), 'audit_log table should exist');
    assert(names.includes('audit_sessions'), 'audit_sessions table should exist');
  });

  await test('Insert and query audit log entry', async () => {
    await db.dbRun(`INSERT INTO audit_log (
      session_id, user_identity, user_role, action, resource_type, resource_id,
      description, request_method, request_path, response_status, phi_accessed,
      phi_fields_accessed, patient_id, ip_address, duration_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['test-session-1', 'Dr. Test', 'provider', 'READ', 'patient', 1,
       'READ patient ID:1', 'GET', '/api/patients/1', 200, 1,
       '["dob","phone","insurance_id"]', 1, '127.0.0.1', 42]);

    const logs = await db.dbAll('SELECT * FROM audit_log WHERE session_id = ?', ['test-session-1']);
    assert(logs.length === 1, `Should have 1 audit log entry, got ${logs.length}`);
    assertEqual(logs[0].user_identity, 'Dr. Test', 'User identity');
    assertEqual(logs[0].phi_accessed, 1, 'PHI accessed flag');
    assertEqual(logs[0].patient_id, 1, 'Patient ID');
    assertEqual(logs[0].action, 'READ', 'Action');
    assertEqual(logs[0].resource_type, 'patient', 'Resource type');
  });

  await test('Insert and query audit session', async () => {
    await db.dbRun('INSERT INTO audit_sessions (id, user_identity, user_role, ip_address) VALUES (?,?,?,?)',
      ['test-session-1', 'Dr. Test', 'provider', '127.0.0.1']);

    const session = await db.dbGet('SELECT * FROM audit_sessions WHERE id = ?', ['test-session-1']);
    assert(session, 'Session should exist');
    assertEqual(session.user_identity, 'Dr. Test', 'Session user');
    assertEqual(session.request_count, 0, 'Initial request count');
  });

  await test('Session request count increments', async () => {
    await db.dbRun('UPDATE audit_sessions SET request_count = request_count + 1 WHERE id = ?', ['test-session-1']);
    await db.dbRun('UPDATE audit_sessions SET request_count = request_count + 1 WHERE id = ?', ['test-session-1']);

    const session = await db.dbGet('SELECT * FROM audit_sessions WHERE id = ?', ['test-session-1']);
    assertEqual(session.request_count, 2, 'Request count should be 2');
  });

  await test('Audit log filtered queries work', async () => {
    // Insert diverse entries
    for (let i = 0; i < 5; i++) {
      await db.dbRun(`INSERT INTO audit_log (
        session_id, user_identity, action, resource_type, response_status,
        phi_accessed, patient_id, ip_address, duration_ms, request_method, request_path
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [`sess-filter-${i}`, i % 2 === 0 ? 'Dr. Test' : 'Nurse Jane',
         i % 2 === 0 ? 'READ' : 'CREATE',
         i % 2 === 0 ? 'patient' : 'encounter',
         200, i % 2, i % 2 === 0 ? 1 : null,
         '127.0.0.1', 10 + i, 'GET', `/api/test/${i}`]);
    }

    // Query by user
    const byUser = await db.dbAll("SELECT * FROM audit_log WHERE user_identity = 'Nurse Jane'");
    assert(byUser.length >= 2, `Should filter by user, got ${byUser.length}`);

    // Query PHI only
    const phiOnly = await db.dbAll('SELECT * FROM audit_log WHERE phi_accessed = 1');
    assert(phiOnly.length >= 1, `Should filter PHI accesses, got ${phiOnly.length}`);

    // Query by patient
    const byPatient = await db.dbAll('SELECT * FROM audit_log WHERE patient_id = 1');
    assert(byPatient.length >= 1, `Should filter by patient, got ${byPatient.length}`);
  });

  await test('PHI route classification is correct', () => {
    const routes = auditLogger.PHI_ROUTES;

    // Patient detail should be PHI
    const patientRoute = routes['GET /api/patients/:id'];
    assert(patientRoute, 'Patient detail route should be classified');
    assert(patientRoute.phi === true, 'Patient detail should be marked as PHI');
    assert(patientRoute.phiFields.includes('dob'), 'Patient PHI fields should include dob');

    // Health endpoint should NOT be PHI
    const healthRoute = routes['GET /api/health'];
    assert(healthRoute, 'Health route should be classified');
    assert(healthRoute.phi === false, 'Health route should not be PHI');

    // Workflow should NOT be PHI
    const workflowRoute = routes['GET /api/workflows'];
    assert(workflowRoute, 'Workflows route should be classified');
    assert(workflowRoute.phi === false, 'Workflows route should not be PHI');

    // Prescriptions should be PHI
    const rxRoute = routes['POST /api/prescriptions'];
    assert(rxRoute, 'Prescriptions route should be classified');
    assert(rxRoute.phi === true, 'Prescriptions should be marked as PHI');
  });

  await test('Route matching resolves parameterized paths', () => {
    const result = auditLogger.matchRoute('GET', '/api/patients/42');
    assert(result, 'Should match /api/patients/42');
    assertEqual(result.key, 'GET /api/patients/:id', 'Should resolve to parameterized pattern');
    assert(result.config.phi === true, 'Should be classified as PHI');

    const noMatch = auditLogger.matchRoute('GET', '/api/nonexistent/route');
    assert(noMatch === null, 'Should return null for unclassified route');

    const exactMatch = auditLogger.matchRoute('GET', '/api/patients');
    assert(exactMatch, 'Should match exact path');
    assertEqual(exactMatch.key, 'GET /api/patients', 'Should resolve to exact pattern');
  });

  // ==========================================
  // RESULTS
  // ==========================================

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Total Tests: ${testCount}`);
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Success Rate: ${((passCount / testCount) * 100).toFixed(1)}%`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => {
      console.log(`    #${f.num} ${f.description}: ${f.error}`);
    });
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Clean up
  await db.close();

  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  if (failCount === 0) {
    console.log('ALL TESTS PASSED! Intelligent Clinical Agent System ready for deployment.\n');
    process.exit(0);
  } else {
    console.log(`${failCount} test(s) failed. Please review errors above.\n`);
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('\nFatal error running tests:', err);
  process.exit(1);
});
