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

// ==========================================
// HTTP CLIENT
// ==========================================

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
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

async function main() {
  const args = process.argv.slice(2);
  const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_FILE, 'utf-8'));

  if (args.includes('--list')) {
    console.log('\nAvailable Clinical Scenarios:\n');
    for (const s of scenarios.scenarios) {
      console.log(`  ${s.id.padEnd(25)} ${s.name} [${s.severity}]`);
    }
    console.log(`\n  Total: ${scenarios.scenarios.length} scenarios\n`);
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

  // Filter scenarios
  let toRun = scenarios.scenarios;
  if (args.length > 0 && !args[0].startsWith('--')) {
    toRun = scenarios.scenarios.filter(s => s.id === args[0]);
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
