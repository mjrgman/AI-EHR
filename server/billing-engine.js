/**
 * MJR-EHR Billing Engine — E/M Level Suggestion and Charge Capture
 *
 * Implements 2021 AMA E/M guidelines (effective January 1, 2021) for
 * office/outpatient visits (99202-99215). Level is determined by the
 * higher of Medical Decision Making (MDM) or total time.
 *
 * MDM has three elements — level is set by meeting 2 of 3 at a threshold:
 *   1. Problems Addressed (number and complexity)
 *   2. Amount/Complexity of Data (tests ordered/reviewed, independent interpretation)
 *   3. Risk of Complications (highest risk element present in the encounter)
 *
 * Reference: AMA CPT® 2021 Professional Edition, Office/Outpatient E/M Descriptor Changes.
 */

const db = require('./database');

// ==========================================
// E/M LEVEL CONSTANTS
// ==========================================

// Standard RVU work values (2024 Medicare Physician Fee Schedule)
const EM_RVU = {
  '99202': 0.93, '99203': 1.60, '99204': 2.60, '99205': 3.50,
  '99211': 0.18, '99212': 0.70, '99213': 1.30, '99214': 1.92, '99215': 2.80
};

// ICD-10 prefix groups used to assess problem complexity
const CHRONIC_CONDITION_PREFIXES = [
  'E11','E10','E78','I10','I25','N18','J44','F32','F33','M79','E03','E66','I50'
];
const HIGH_COMPLEXITY_PREFIXES = [
  'I21','I22','I20','J18','J15','K92','K57','N17','G40','F20','I63','I61'
];

/**
 * Assess MDM complexity from patient encounter context.
 * Returns { problems, data, risk, level, code, rationale }
 *
 * @param {Object} context - Patient context from buildPatientContext()
 * @returns {Object} mdm assessment
 */
function assessMDM(context) {
  const problems = context.problems || [];
  const labs = context.labs || [];
  const labOrders = context.labOrders || [];
  const imagingOrders = context.imagingOrders || [];
  const medications = context.medications || [];
  const chiefComplaint = context.chiefComplaint || '';
  const transcript = context.transcript || '';
  const text = `${chiefComplaint} ${transcript}`.toLowerCase();

  // --- ELEMENT 1: Problems Addressed ---
  // High: new problem requiring workup, multiple chronic unstable conditions
  // Moderate: 1 chronic condition with exacerbation, or 1 new undiagnosed problem
  // Low: 1-2 self-limited/minor problems, or 1 stable chronic condition
  const activeProblems = problems.filter(p => p.status === 'active' || !p.status);
  const chronicCount = activeProblems.filter(p =>
    CHRONIC_CONDITION_PREFIXES.some(pfx => (p.icd10_code || '').startsWith(pfx))
  ).length;
  const highComplexity = activeProblems.some(p =>
    HIGH_COMPLEXITY_PREFIXES.some(pfx => (p.icd10_code || '').startsWith(pfx))
  );

  const newProblemKeywords = ['new diagnosis', 'new onset', 'first visit', 'new complaint', 'undiagnosed'];
  const exacerbationKeywords = ['worse', 'exacerbation', 'flare', 'uncontrolled', 'decompensated', 'not controlled'];
  const hasNewProblem = newProblemKeywords.some(kw => text.includes(kw));
  const hasExacerbation = exacerbationKeywords.some(kw => text.includes(kw));

  let problemsLevel;
  if (highComplexity || (chronicCount >= 2 && hasExacerbation)) {
    problemsLevel = 'high';
  } else if (chronicCount >= 1 && hasExacerbation || hasNewProblem || chronicCount >= 2) {
    problemsLevel = 'moderate';
  } else {
    problemsLevel = 'low';
  }

  // --- ELEMENT 2: Data Reviewed/Ordered ---
  // High: independent interpretation of tests, discussion with other provider, review of external records
  // Moderate: review of tests ordered by another provider, ordering tests, or ordering medications with review
  // Low: ordering tests (labs/imaging), review of results
  const ordersPlaced = labOrders.length + imagingOrders.length;
  const recentLabs = labs.filter(l => {
    const d = new Date(l.result_date || l.created_at || 0);
    return (Date.now() - d.getTime()) < 90 * 24 * 60 * 60 * 1000; // last 90 days
  }).length;

  const independentInterpKeywords = ['ekg', 'ecg', 'x-ray', 'ct scan', 'mri', 'echo', 'stress test', 'spirometry'];
  const hasIndependentInterp = independentInterpKeywords.some(kw => text.includes(kw));

  let dataLevel;
  if (hasIndependentInterp || recentLabs >= 4) {
    dataLevel = 'high';
  } else if (ordersPlaced >= 2 || recentLabs >= 2) {
    dataLevel = 'moderate';
  } else {
    dataLevel = 'low';
  }

  // --- ELEMENT 3: Risk ---
  // High: drug therapy requiring intensive monitoring, decision for hospitalization, surgery
  // Moderate: prescription drug management, social determinants of health as risk
  // Low: OTC medications, minor surgical procedure
  const prescriptionMeds = medications.filter(m => m.status === 'active').length;
  const hospitalizationKeywords = ['admit', 'admission', 'hospitalize', 'emergency', 'er referral', 'icu'];
  const surgeryKeywords = ['surgery', 'procedure', 'biopsy', 'excision', 'incision'];
  const intensiveMonitoringKeywords = ['coumadin', 'warfarin', 'insulin', 'lithium', 'digoxin', 'chemotherapy', 'immunosuppressant'];

  const needsHospitalization = hospitalizationKeywords.some(kw => text.includes(kw));
  const needsSurgery = surgeryKeywords.some(kw => text.includes(kw));
  const hasIntensiveMed = intensiveMonitoringKeywords.some(kw => text.includes(kw)) ||
    medications.some(m => intensiveMonitoringKeywords.some(kw => (m.medication_name || '').toLowerCase().includes(kw)));

  let riskLevel;
  if (needsHospitalization || needsSurgery || hasIntensiveMed) {
    riskLevel = 'high';
  } else if (prescriptionMeds >= 1 || chronicCount >= 1) {
    riskLevel = 'moderate';
  } else {
    riskLevel = 'low';
  }

  // --- FINAL MDM LEVEL: 2 of 3 elements at threshold ---
  const levelScore = { low: 1, moderate: 2, high: 3 };
  const scores = [levelScore[problemsLevel], levelScore[dataLevel], levelScore[riskLevel]].sort((a, b) => a - b);
  // Take the second-highest (2 of 3 rule)
  const mdmScore = scores[1];

  let mdmLevel, emCode;
  const isNewPatient = (context.encounter?.encounter_type === 'new_patient') ||
    text.includes('new patient') || text.includes('first visit');

  if (mdmScore >= 3) {
    mdmLevel = 'high';
    emCode = isNewPatient ? '99205' : '99215';
  } else if (mdmScore >= 2) {
    mdmLevel = 'moderate';
    emCode = isNewPatient ? '99204' : '99214';
  } else {
    mdmLevel = 'low';
    emCode = isNewPatient ? '99203' : '99213';
  }

  return {
    problems: { level: problemsLevel, activeCount: activeProblems.length, chronicCount },
    data: { level: dataLevel, ordersPlaced, recentLabs },
    risk: { level: riskLevel, prescriptionMeds },
    mdmLevel,
    code: emCode,
    rvu: EM_RVU[emCode] || 0,
    isNewPatient,
    rationale: `MDM: Problems=${problemsLevel} (${activeProblems.length} active, ${chronicCount} chronic), ` +
      `Data=${dataLevel} (${ordersPlaced} orders, ${recentLabs} recent labs), ` +
      `Risk=${riskLevel} (${prescriptionMeds} active Rx). ` +
      `2-of-3 → ${mdmLevel} complexity → ${emCode}.`
  };
}

/**
 * Build or update the charge record for an encounter.
 * Called at checkout or when encounter is signed.
 *
 * @param {number} encounterId
 * @param {number} patientId
 * @param {string} providerName
 * @param {Object} [overrides] - Optional provider-supplied values { em_level, cpt_codes, icd10_codes, notes }
 * @returns {Promise<Object>} charge record with em_suggestion
 */
async function captureCharge(encounterId, patientId, providerName, overrides = {}) {
  const context = await buildBillingContext(encounterId, patientId);
  const emSuggestion = assessMDM(context);

  // Collect ICD-10 codes from active problem list for billing linkage
  const icd10Codes = overrides.icd10_codes ||
    (context.problems || [])
      .filter(p => p.status === 'active' || !p.status)
      .map(p => p.icd10_code)
      .filter(Boolean)
      .slice(0, 12); // CMS allows up to 12 diagnosis codes per claim

  // Build CPT code list — E/M code + any additional procedure codes
  const emCode = overrides.em_level || emSuggestion.code;
  const additionalCpts = overrides.cpt_codes || [];
  const cptCodes = [
    { code: emCode, description: `Office/Outpatient Visit — ${emSuggestion.mdmLevel} complexity`, units: 1 },
    ...additionalCpts
  ];

  // Upsert charge record
  const existing = await db.getChargeByEncounter(encounterId);
  if (!existing) {
    await db.createCharge({ encounter_id: encounterId, patient_id: patientId, provider_name: providerName });
  }

  await db.updateCharge(encounterId, {
    em_level: emCode,
    cpt_codes: cptCodes,
    icd10_codes: icd10Codes,
    em_suggestion: emSuggestion,
    total_rvu: EM_RVU[emCode] || 0,
    notes: overrides.notes || null
  });

  return db.getChargeByEncounter(encounterId);
}

/**
 * Finalize charge at checkout — marks status 'finalized' and sets checkout time on workflow.
 */
async function finalizeCheckout(encounterId, patientId, providerName, overrides = {}) {
  const charge = await captureCharge(encounterId, patientId, providerName, overrides);
  await db.finalizeCharge(encounterId);

  // Update workflow state to checked-out
  try {
    await db.updateWorkflowState(encounterId, { checkout_time: new Date().toISOString() });
    await db.dbRun(
      `UPDATE workflow_state SET current_state='checked-out' WHERE encounter_id=?`,
      [encounterId]
    );
  } catch (wfErr) {
    console.error('[BILLING] Workflow state update error (non-fatal):', wfErr.message);
  }

  return db.getChargeByEncounter(encounterId);
}

/**
 * Build context for billing MDM assessment — combines encounter data with clinical context.
 */
async function buildBillingContext(encounterId, patientId) {
  const [encounter, problems, medications, labs] = await Promise.all([
    db.getEncounterById(encounterId),
    db.getPatientProblems(patientId),
    db.getPatientMedications(patientId),
    db.getPatientLabs(patientId)
  ]);

  const labOrders = await db.dbAll(
    'SELECT * FROM lab_orders WHERE encounter_id = ?', [encounterId]
  );
  const imagingOrders = await db.dbAll(
    'SELECT * FROM imaging_orders WHERE encounter_id = ?', [encounterId]
  );

  return {
    encounter,
    problems,
    medications,
    labs,
    labOrders,
    imagingOrders,
    chiefComplaint: encounter ? encounter.chief_complaint : '',
    transcript: encounter ? encounter.transcript : ''
  };
}

module.exports = {
  assessMDM,
  captureCharge,
  finalizeCheckout,
  buildBillingContext,
  EM_RVU
};
