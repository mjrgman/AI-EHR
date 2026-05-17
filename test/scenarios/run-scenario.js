#!/usr/bin/env node

/**
 * MJR-EHR Clinical Scenario Runner
 * Executes clinical scenarios from the scenario database against the live API.
 *
 * Usage:
 *   node test/scenarios/run-scenario.js                    # Run all scenarios
 *   node test/scenarios/run-scenario.js DM-UNCONTROLLED-001  # Run specific scenario by ID
 *   node test/scenarios/run-scenario.js --list              # List available scenarios
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';
const SCENARIOS_FILE = path.join(__dirname, 'clinical-scenarios.json');
const RESULTS_DIR = path.join(__dirname, 'results');
const TEST_USERNAME = process.env.TEST_USERNAME || process.env.EHR_TEST_USERNAME || 'scenario.runner';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.EHR_TEST_PASSWORD || 'SecurePass!234';
const requestContext = {
  sessionId: null,
  token: null,
  userRole: process.env.TEST_USER_ROLE || 'physician',
  userId: process.env.TEST_USER_ID || `scenario-runner-${process.pid}`
};

// ==========================================
// HTTP CLIENT
// ==========================================

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + urlPath);
    const headers = {
      'Content-Type': 'application/json',
      'x-user-role': requestContext.userRole,
      'x-user-id': requestContext.userId
    };

    if (requestContext.sessionId) {
      headers['x-session-id'] = requestContext.sessionId;
    }
    if (requestContext.token) {
      headers.Authorization = `Bearer ${requestContext.token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    };

    const req = http.request(options, (res) => {
      if (res.headers['x-session-id']) {
        requestContext.sessionId = res.headers['x-session-id'];
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body)
};

// ==========================================
// SCENARIO EXECUTOR
// ==========================================

async function checkServer() {
  try {
    const res = await api.get('/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

async function authenticate() {
  const res = await api.post('/auth/login', {
    username: TEST_USERNAME,
    password: TEST_PASSWORD
  });

  if (res.status !== 200 || !res.data?.token) {
    throw new Error(
      `Scenario runner login failed for ${TEST_USERNAME}: HTTP ${res.status}. ` +
      'Create the test clinician or set TEST_USERNAME/TEST_PASSWORD.'
    );
  }

  requestContext.token = res.data.token;
  requestContext.userRole = res.data.user?.role || requestContext.userRole;
  requestContext.userId = res.data.user?.id ? String(res.data.user.id) : requestContext.userId;
}

async function runScenario(scenario) {
  const result = {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    severity: scenario.severity,
    timestamp: new Date().toISOString(),
    steps: [],
    cds_results: [],
    pass: true,
    errors: []
  };

  const log = (step, status, detail) => {
    result.steps.push({ step, status, detail, time: new Date().toISOString() });
    const icon = status === 'OK' ? '\u2713' : status === 'FAIL' ? '\u2717' : '\u25CB';
    console.log(`  ${icon} ${step}: ${detail}`);
  };

  console.log(`\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
  console.log(`  SCENARIO: ${scenario.name} [${scenario.id}]`);
  console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`);

  try {
    // Step 1: Create patient
    const patientRes = await api.post('/patients', scenario.patient);
    if (patientRes.status !== 201 && patientRes.status !== 200) {
      log('Create Patient', 'FAIL', `HTTP ${patientRes.status}: ${JSON.stringify(patientRes.data)}`);
      result.pass = false;
      result.errors.push(`Failed to create patient: ${JSON.stringify(patientRes.data)}`);
      return result;
    }
    const patientId = patientRes.data.id;
    const mrn = patientRes.data.mrn;
    result.patient_id = patientId;
    result.mrn = mrn;
    log('Create Patient', 'OK', `${scenario.patient.first_name} ${scenario.patient.last_name} (MRN: ${mrn}, ID: ${patientId})`);

    // Step 2: Add problems
    for (const problem of scenario.problems) {
      const res = await api.post(`/patients/${patientId}/problems`, { ...problem, patient_id: patientId });
      if (res.status === 200 || res.status === 201) {
        log('Add Problem', 'OK', `${problem.problem_name} (${problem.icd10_code})`);
      } else {
        log('Add Problem', 'FAIL', `${problem.problem_name}: HTTP ${res.status}`);
        result.errors.push(`Failed to add problem: ${problem.problem_name}`);
      }
    }

    // Step 3: Add medications
    for (const med of scenario.medications) {
      const res = await api.post(`/patients/${patientId}/medications`, {
        ...med,
        patient_id: patientId,
        start_date: med.start_date || '2024-01-01'
      });
      if (res.status === 200 || res.status === 201) {
        log('Add Medication', 'OK', `${med.medication_name} ${med.dose} ${med.frequency}`);
      } else {
        log('Add Medication', 'FAIL', `${med.medication_name}: HTTP ${res.status}`);
        result.errors.push(`Failed to add medication: ${med.medication_name}`);
      }
    }

    // Step 4: Add allergies
    for (const allergy of scenario.allergies) {
      const res = await api.post(`/patients/${patientId}/allergies`, { ...allergy, patient_id: patientId });
      if (res.status === 200 || res.status === 201) {
        log('Add Allergy', 'OK', `${allergy.allergen} (${allergy.severity})`);
      } else {
        log('Add Allergy', 'FAIL', `${allergy.allergen}: HTTP ${res.status}`);
        result.errors.push(`Failed to add allergy: ${allergy.allergen}`);
      }
    }

    // Step 5: Add lab results (pre-existing)
    for (const lab of scenario.labs) {
      const labRes = await api.post(`/patients/${patientId}/labs`, { ...lab, patient_id: patientId });
      if (labRes.status === 200 || labRes.status === 201) {
        log('Add Lab Result', 'OK', `${lab.test_name}: ${lab.result_value} ${lab.units} ${lab.abnormal_flag ? '[ABNORMAL]' : ''}`);
      } else {
        log('Add Lab Result', 'FAIL', `${lab.test_name}: HTTP ${labRes.status}`);
        result.errors.push(`Failed to add lab: ${lab.test_name}`);
      }
    }

    // Step 6: Create encounter
    const encRes = await api.post('/encounters', {
      patient_id: patientId,
      ...scenario.encounter
    });
    if (encRes.status !== 200 && encRes.status !== 201) {
      log('Create Encounter', 'FAIL', `HTTP ${encRes.status}`);
      result.pass = false;
      result.errors.push('Failed to create encounter');
      return result;
    }
    const encounterId = encRes.data.id;
    result.encounter_id = encounterId;
    log('Create Encounter', 'OK', `${scenario.encounter.encounter_type} — "${scenario.encounter.chief_complaint}" (ID: ${encounterId})`);

    // Step 7: Record vitals
    const vitalsRes = await api.post('/vitals', {
      patient_id: patientId,
      encounter_id: encounterId,
      ...scenario.vitals
    });
    if (vitalsRes.status === 200 || vitalsRes.status === 201) {
      const v = scenario.vitals;
      log('Record Vitals', 'OK', `BP ${v.systolic_bp}/${v.diastolic_bp} | HR ${v.heart_rate} | Temp ${v.temperature} | SpO2 ${v.spo2}% | Wt ${v.weight}`);
    } else {
      log('Record Vitals', 'FAIL', `HTTP ${vitalsRes.status}`);
      result.errors.push('Failed to record vitals');
    }

    // Step 8: Create workflow
    const wfRes = await api.post('/workflow', {
      encounter_id: encounterId,
      patient_id: patientId,
      assigned_ma: 'MA Johnson',
      assigned_provider: scenario.encounter.provider
    });
    if (wfRes.status === 200 || wfRes.status === 201) {
      log('Create Workflow', 'OK', `State: ${wfRes.data.state || 'scheduled'}`);
    } else {
      log('Create Workflow', 'WARN', `HTTP ${wfRes.status} — workflow may already exist`);
    }

    // Step 9: Run CDS evaluation
    const cdsRes = await api.post('/cds/evaluate', {
      encounter_id: encounterId,
      patient_id: patientId
    });
    if (cdsRes.status === 200 || cdsRes.status === 201) {
      const suggestions = cdsRes.data.suggestions || cdsRes.data || [];
      result.cds_results = suggestions;
      log('CDS Evaluation', 'OK', `${suggestions.length} suggestion(s) generated`);

      // Log each suggestion
      for (const s of suggestions) {
        const cat = s.category || 'info';
        console.log(`    \u2502 [${cat.toUpperCase()}] ${s.title}`);
      }

      // Validate expected CDS
      if (scenario.expected_cds) {
        const titles = suggestions.map(s => (s.title || '').toLowerCase());

        for (const expected of (scenario.expected_cds.should_fire || [])) {
          const found = titles.some(t => t.includes(expected.toLowerCase()));
          if (found) {
            log('CDS Verify', 'OK', `Expected rule fired: "${expected}"`);
          } else {
            log('CDS Verify', 'FAIL', `Expected rule DID NOT fire: "${expected}"`);
            result.errors.push(`CDS rule "${expected}" did not fire as expected`);
          }
        }

        for (const notExpected of (scenario.expected_cds.should_not_fire || [])) {
          const found = titles.some(t => t.includes(notExpected.toLowerCase()));
          if (found) {
            log('CDS Verify', 'FAIL', `Rule fired but should NOT have: "${notExpected}"`);
            result.errors.push(`CDS rule "${notExpected}" fired unexpectedly`);
          } else {
            log('CDS Verify', 'OK', `Correctly absent: "${notExpected}"`);
          }
        }
      }
    } else {
      log('CDS Evaluation', 'FAIL', `HTTP ${cdsRes.status}`);
      result.errors.push('CDS evaluation failed');
    }

    // Step 10: Process transcript if present
    if (scenario.transcript) {
      const extractRes = await api.post('/ai/extract-data', {
        transcript: scenario.transcript,
        patient_id: patientId,
        encounter_id: encounterId
      });
      if (extractRes.status === 200 || extractRes.status === 201) {
        const extracted = extractRes.data;
        const vCount = Object.keys(extracted.vitals || {}).length;
        const mCount = (extracted.medications || []).length;
        const pCount = (extracted.problems || []).length;
        log('AI Extract', 'OK', `Vitals: ${vCount} fields | Meds: ${mCount} | Problems: ${pCount}`);
      } else {
        log('AI Extract', 'WARN', `HTTP ${extractRes.status} — extraction may have partial results`);
      }

      // Generate SOAP note
      const noteRes = await api.post('/ai/generate-note', {
        transcript: scenario.transcript,
        patient_id: patientId,
        encounter_id: encounterId
      });
      if (noteRes.status === 200 || noteRes.status === 201) {
        const note = noteRes.data.soap_note || noteRes.data.note || '';
        const hasSubjective = note.includes('SUBJECTIVE');
        const hasObjective = note.includes('OBJECTIVE');
        const hasAssessment = note.includes('ASSESSMENT');
        const hasPlan = note.includes('PLAN');
        if (hasSubjective && hasObjective && hasAssessment && hasPlan) {
          log('SOAP Note', 'OK', `Generated (${note.length} chars) — All 4 sections present`);
        } else {
          const missing = [];
          if (!hasSubjective) missing.push('SUBJECTIVE');
          if (!hasObjective) missing.push('OBJECTIVE');
          if (!hasAssessment) missing.push('ASSESSMENT');
          if (!hasPlan) missing.push('PLAN');
          log('SOAP Note', 'WARN', `Generated but missing sections: ${missing.join(', ')}`);
        }
      } else {
        log('SOAP Note', 'WARN', `HTTP ${noteRes.status}`);
      }
    }

  } catch (err) {
    log('Fatal Error', 'FAIL', err.message);
    result.pass = false;
    result.errors.push(err.message);
  }

  // Final result
  result.pass = result.errors.length === 0;
  const status = result.pass ? 'PASS' : 'FAIL';
  console.log(`\n  Result: ${status}${result.errors.length > 0 ? ` (${result.errors.length} error(s))` : ''}`);

  return result;
}

// ==========================================
// MAIN
// ==========================================

// ==========================================
// LIFECYCLE SCENARIOS (Embedded)
// ==========================================

const LIFECYCLE_SCENARIOS = [
  {
    "id": "AWV-NEW-PATIENT-001",
    "name": "New Patient Annual Wellness Visit",
    "category": "lifecycle",
    "severity": "low",
    "patient": {
      "first_name": "Margaret", "middle_name": "Ruth", "last_name": "Henderson",
      "dob": "1972-03-15", "sex": "F", "phone": "478-555-0101",
      "email": "margaret.henderson@email.com", "address_line1": "445 Oak Ridge Road",
      "city": "Bonaire", "state": "GA", "zip": "31005",
      "insurance_carrier": "Anthem", "insurance_id": "ANT-5511234"
    },
    "problems": [],
    "medications": [],
    "allergies": [],
    "labs": [],
    "encounter": {
      "encounter_type": "Annual Wellness Visit", "chief_complaint": "Annual physical",
      "provider": "Dr. Renner"
    },
    "vitals": {
      "systolic_bp": 128, "diastolic_bp": 80, "heart_rate": 72,
      "temperature": 98.6, "weight": 165, "height": 66, "spo2": 99, "respiratory_rate": 14
    },
    "transcript": "52-year-old female here for annual wellness visit. No acute complaints. States she feels well. Sleep is good. Exercise 3x per week. Denies tobacco, alcohol use is social."
  },
  {
    "id": "URI-ACUTE-001",
    "name": "Acute Sinusitis",
    "category": "lifecycle",
    "severity": "low",
    "patient": {
      "first_name": "David", "middle_name": "James", "last_name": "Martinez",
      "dob": "1990-07-22", "sex": "M", "phone": "478-555-0202",
      "email": "david.martinez@email.com", "address_line1": "312 Maple Street",
      "city": "Macon", "state": "GA", "zip": "31201",
      "insurance_carrier": "Ambetter", "insurance_id": "AMB-7722301"
    },
    "problems": [
      { "problem_name": "Acute Sinusitis", "icd10_code": "J01.90", "status": "active", "onset_date": "2026-04-04" }
    ],
    "medications": [],
    "allergies": [
      { "allergen": "Sulfa drugs", "reaction": "Rash", "severity": "mild" }
    ],
    "labs": [],
    "encounter": {
      "encounter_type": "Office Visit - Acute", "chief_complaint": "Sinus infection",
      "provider": "Dr. Renner"
    },
    "vitals": {
      "systolic_bp": 120, "diastolic_bp": 76, "heart_rate": 88,
      "temperature": 100.4, "weight": 175, "height": 70, "spo2": 98, "respiratory_rate": 16
    },
    "transcript": "34-year-old male with sinus congestion, facial pressure, nasal discharge x5 days. Mild fever. Denies shortness of breath. Previously had sinus infection last year. Prescribed amoxicillin-clavulanate. Will follow up in 2 weeks if not improving."
  },
  {
    "id": "CDM-DM-HTN-001",
    "name": "Chronic Disease Management: Diabetes + Hypertension",
    "category": "lifecycle",
    "severity": "medium",
    "patient": {
      "first_name": "Dorothy", "middle_name": "Elizabeth", "last_name": "Morrison",
      "dob": "1958-11-08", "sex": "F", "phone": "478-555-0303",
      "email": "dorothy.morrison@email.com", "address_line1": "789 Heritage Lane",
      "city": "Bonaire", "state": "GA", "zip": "31005",
      "insurance_carrier": "Medicare", "insurance_id": "MCR-5811089"
    },
    "problems": [
      { "problem_name": "Type 2 Diabetes Mellitus", "icd10_code": "E11.9", "status": "active", "onset_date": "2015-06-01" },
      { "problem_name": "Essential Hypertension", "icd10_code": "I10", "status": "active", "onset_date": "2010-03-15" }
    ],
    "medications": [
      { "medication_name": "Metformin", "generic_name": "Metformin", "dose": "1000mg", "route": "PO", "frequency": "twice daily", "status": "active", "prescriber": "Dr. Renner" },
      { "medication_name": "Lisinopril", "generic_name": "Lisinopril", "dose": "20mg", "route": "PO", "frequency": "daily", "status": "active", "prescriber": "Dr. Renner" }
    ],
    "allergies": [],
    "labs": [
      { "test_name": "HbA1c", "result_value": "7.2", "units": "%", "abnormal_flag": false, "result_date": "2026-03-15" },
      { "test_name": "Glucose", "result_value": "142", "units": "mg/dL", "abnormal_flag": true, "result_date": "2026-03-15" }
    ],
    "encounter": {
      "encounter_type": "Office Visit - Chronic", "chief_complaint": "Diabetes and hypertension follow-up",
      "provider": "Dr. Renner"
    },
    "vitals": {
      "systolic_bp": 135, "diastolic_bp": 82, "heart_rate": 76,
      "temperature": 98.6, "weight": 198, "height": 64, "spo2": 98, "respiratory_rate": 16
    },
    "transcript": "68-year-old female with type 2 diabetes and hypertension. Reports good medication adherence. Glucose readings at home have been 120-150 fasting. BP readings 130-140 systolic. States she is monitoring diet and trying to walk daily. Last HbA1c was 7.2 three weeks ago. No polyuria, polydipsia, or visual changes."
  },
  {
    "id": "CHEST-PAIN-URGENT-001",
    "name": "Chest Pain - Urgent Evaluation",
    "category": "lifecycle",
    "severity": "high",
    "patient": {
      "first_name": "Richard", "middle_name": "Thomas", "last_name": "Sullivan",
      "dob": "1966-09-12", "sex": "M", "phone": "478-555-0404",
      "email": "richard.sullivan@email.com", "address_line1": "654 Elm Grove Drive",
      "city": "Macon", "state": "GA", "zip": "31210",
      "insurance_carrier": "BlueCross", "insurance_id": "BC-6609121"
    },
    "problems": [
      { "problem_name": "Hypertension", "icd10_code": "I10", "status": "active", "onset_date": "2005-01-01" },
      { "problem_name": "Hyperlipidemia", "icd10_code": "E78.5", "status": "active", "onset_date": "2008-06-01" }
    ],
    "medications": [
      { "medication_name": "Atorvastatin", "generic_name": "Atorvastatin", "dose": "40mg", "route": "PO", "frequency": "daily", "status": "active", "prescriber": "Dr. Renner" },
      { "medication_name": "Metoprolol", "generic_name": "Metoprolol", "dose": "50mg", "route": "PO", "frequency": "twice daily", "status": "active", "prescriber": "Dr. Renner" }
    ],
    "allergies": [],
    "labs": [],
    "encounter": {
      "encounter_type": "Office Visit - Urgent", "chief_complaint": "Chest discomfort",
      "provider": "Dr. Renner"
    },
    "vitals": {
      "systolic_bp": 148, "diastolic_bp": 92, "heart_rate": 102,
      "temperature": 98.8, "weight": 210, "height": 72, "spo2": 97, "respiratory_rate": 18
    },
    "transcript": "58-year-old male presenting with chest discomfort x2 hours. Describes pressure sensation in substernal region. Associated with shortness of breath. Denies radiation to arm. No diaphoresis. Risk factors: hypertension, hyperlipidemia, former smoker. EKG ordered stat. Patient appears anxious."
  }
];

async function main() {
  const args = process.argv.slice(2);
  const allScenarios = JSON.parse(fs.readFileSync(SCENARIOS_FILE, 'utf-8'));

  if (args.includes('--list')) {
    console.log('\nAvailable Clinical Scenarios:\n');
    for (const s of allScenarios.scenarios) {
      console.log(`  ${s.id.padEnd(25)} ${s.name} [${s.severity}]`);
    }
    console.log('\nLifecycle Scenarios (--lifecycle flag):\n');
    for (const s of LIFECYCLE_SCENARIOS) {
      console.log(`  ${s.id.padEnd(25)} ${s.name} [${s.severity}]`);
    }
    console.log(`\n  Total: ${allScenarios.scenarios.length + LIFECYCLE_SCENARIOS.length} scenarios\n`);
    return;
  }

  // Check server
  console.log('\nChecking EHR server...');
  const serverUp = await checkServer();
  if (!serverUp) {
    console.error('\nServer is not running at ' + API_BASE);
    console.error('Start it with: npm run server\n');
    process.exit(1);
  }
  console.log('Server is running.\n');

  await authenticate();
  console.log(`Authenticated scenario runner as ${TEST_USERNAME}.\n`);

  // Filter scenarios
  let toRun = allScenarios.scenarios;

  // Handle --lifecycle flag
  if (args.includes('--lifecycle')) {
    toRun = LIFECYCLE_SCENARIOS;
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // Check in both standard and lifecycle scenarios
    toRun = allScenarios.scenarios.filter(s => s.id === args[0]);
    if (toRun.length === 0) {
      toRun = LIFECYCLE_SCENARIOS.filter(s => s.id === args[0]);
    }
    if (toRun.length === 0) {
      console.error(`Scenario not found: ${args[0]}`);
      console.error('Use --list to see available scenarios.');
      process.exit(1);
    }
  }

  console.log(`Running ${toRun.length} scenario(s)...\n`);

  const allResults = [];
  for (const scenario of toRun) {
    const result = await runScenario(scenario);
    allResults.push(result);
  }

  // Summary
  console.log('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  console.log('  SCENARIO EXECUTION SUMMARY');
  console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n');

  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.filter(r => !r.pass).length;

  for (const r of allResults) {
    const icon = r.pass ? '\u2713' : '\u2717';
    console.log(`  ${icon} ${r.id.padEnd(25)} ${r.name} — ${r.pass ? 'PASS' : 'FAIL'}`);
    if (!r.pass) {
      for (const err of r.errors) {
        console.log(`    \u2514\u2500 ${err}`);
      }
    }
  }

  console.log(`\n  Total: ${allResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / allResults.length) * 100).toFixed(1)}%\n`);

  // Save results
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = path.join(RESULTS_DIR, `run-${timestamp}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify({ timestamp: new Date().toISOString(), results: allResults }, null, 2));
  console.log(`  Results saved to: ${resultsFile}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
