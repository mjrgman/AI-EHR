/**
 * MJR-EHR Clinical Decision Support Engine
 * Evaluates clinical rules against patient context and generates suggestions.
 */

const db = require('./database');

// Pharmaceutical knowledge base (graceful fallback if unavailable)
let drugSafetyService = null;
try {
  drugSafetyService = require('./pharma/drug-safety-service');
} catch {
  console.warn('[CDS] Drug safety service unavailable — using local rules only');
}

// ==========================================
// RULE EVALUATION ENGINE
// ==========================================

function evaluateCondition(actual, operator, threshold) {
  if (actual === null || actual === undefined) return false;
  const val = typeof actual === 'string' ? parseFloat(actual) : actual;
  if (isNaN(val)) return false;
  switch (operator) {
    case '>':  return val > threshold;
    case '>=': return val >= threshold;
    case '<':  return val < threshold;
    case '<=': return val <= threshold;
    case '==': return val === threshold;
    case '!=': return val !== threshold;
    default: return false;
  }
}

function monthsSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

// ==========================================
// EVALUATE BY RULE TYPE
// ==========================================

function evaluateVitalRules(rules, vitals, context) {
  if (!vitals || Object.keys(vitals).length === 0) return [];
  const suggestions = [];

  for (const rule of rules.filter(r => r.rule_type === 'vital_alert')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }
    let fired = false;

    if (trigger.or) {
      fired = trigger.or.some(c => evaluateCondition(vitals[c.field], c.operator, c.value));
    } else if (trigger.field) {
      fired = evaluateCondition(vitals[trigger.field], trigger.operator, trigger.value);
    }

    if (fired) {
      let desc = actions.description;
      if (vitals.systolic_bp && vitals.diastolic_bp) {
        desc = desc.replace('{systolic}', vitals.systolic_bp).replace('{diastolic}', vitals.diastolic_bp);
      }
      suggestions.push({
        suggestion_type: 'vital_alert',
        category: actions.category || 'routine',
        priority: rule.priority,
        title: actions.title,
        description: desc,
        rationale: `Rule: ${rule.rule_name}. ${rule.evidence_source || ''}`,
        suggested_action: actions.actions || [],
        source: 'rule_engine'
      });
    }
  }
  return suggestions;
}

function evaluateLabRules(rules, labs, context) {
  if (!labs || labs.length === 0) return [];
  const suggestions = [];

  for (const rule of rules.filter(r => r.rule_type === 'lab_alert')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    const labResult = labs.find(l => l.test_name === trigger.test_name);
    if (!labResult) continue;

    const val = parseFloat(labResult.result_value);
    if (!evaluateCondition(val, trigger.operator, trigger.value)) continue;

    // Check if a specific problem is required
    if (trigger.requires_problem_prefix && context.problems) {
      if (!context.problems.some(p => p.icd10_code && p.icd10_code.startsWith(trigger.requires_problem_prefix))) continue;
    }

    suggestions.push({
      suggestion_type: 'lab_order',
      category: actions.category || 'routine',
      priority: rule.priority,
      title: `${actions.title} (${labResult.test_name}: ${labResult.result_value} ${labResult.units || ''})`,
      description: actions.description,
      rationale: `${labResult.test_name} = ${labResult.result_value} (ref: ${labResult.reference_range}). ${rule.evidence_source || ''}`,
      suggested_action: actions.actions || [],
      source: 'rule_engine'
    });
  }
  return suggestions;
}

function evaluateDrugInteractionRules(rules, medications, allergies, context) {
  const suggestions = [];
  if (!medications) medications = [];
  if (!allergies) allergies = [];

  // Drug-Allergy checks
  for (const rule of rules.filter(r => r.rule_type === 'drug_allergy')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    const hasAllergy = allergies.some(a => a.allergen.toLowerCase() === trigger.allergen.toLowerCase());
    if (!hasAllergy) continue;

    // Check if patient is on any blocked drug
    if (trigger.blocked_drugs) {
      const conflict = medications.find(m =>
        m.status === 'active' && trigger.blocked_drugs.some(d => m.medication_name.toLowerCase().includes(d.toLowerCase()))
      );
      if (conflict) {
        suggestions.push({
          suggestion_type: 'allergy_alert',
          category: 'urgent',
          priority: rule.priority,
          title: actions.title,
          description: `${actions.description} Current: ${conflict.medication_name}. Allergy: ${trigger.allergen}.`,
          rationale: rule.evidence_source || '',
          suggested_action: [],
          source: 'rule_engine'
        });
      }
    }

    // Cross-reactivity warning
    if (trigger.drug_classes) {
      const conflict = medications.find(m =>
        m.status === 'active' && trigger.drug_classes.some(d => m.medication_name.toLowerCase().includes(d.toLowerCase()))
      );
      if (conflict) {
        suggestions.push({
          suggestion_type: 'allergy_alert',
          category: 'urgent',
          priority: rule.priority,
          title: actions.title,
          description: `${actions.description} Current: ${conflict.medication_name}.`,
          rationale: rule.evidence_source || '',
          suggested_action: [],
          source: 'rule_engine'
        });
      }
    }
  }

  // Drug-Interaction checks
  for (const rule of rules.filter(r => r.rule_type === 'drug_interaction')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    let onDrug = false;
    if (trigger.drug) {
      onDrug = medications.some(m => m.status === 'active' && m.medication_name.toLowerCase().includes(trigger.drug.toLowerCase()));
    }
    if (trigger.drug_classes) {
      onDrug = medications.some(m => m.status === 'active' && trigger.drug_classes.some(d => m.medication_name.toLowerCase().includes(d.toLowerCase())));
    }
    if (!onDrug) continue;

    // Check problem requirement
    if (trigger.requires_problem_prefix && context.problems) {
      if (!context.problems.some(p => p.icd10_code && p.icd10_code.startsWith(trigger.requires_problem_prefix))) continue;
    }

    // Check lab condition
    if (trigger.lab_condition && context.labs) {
      const lab = context.labs.find(l => l.test_name === trigger.lab_condition.test_name);
      if (!lab || !evaluateCondition(parseFloat(lab.result_value), trigger.lab_condition.operator, trigger.lab_condition.value)) continue;
    }

    suggestions.push({
      suggestion_type: 'interaction_alert',
      category: actions.category || 'routine',
      priority: rule.priority,
      title: actions.title,
      description: actions.description,
      rationale: rule.evidence_source || '',
      suggested_action: actions.actions || [],
      source: 'rule_engine'
    });
  }

  return suggestions;
}

function evaluateDifferentialRules(rules, chiefComplaint, transcript, context) {
  if (!chiefComplaint && !transcript) return [];
  const text = `${chiefComplaint || ''} ${transcript || ''}`.toLowerCase();
  const suggestions = [];

  for (const rule of rules.filter(r => r.rule_type === 'differential')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    const matched = trigger.symptom_keywords && trigger.symptom_keywords.some(kw => text.includes(kw.toLowerCase()));
    if (!matched) continue;

    // Check problem requirement if any
    if (trigger.requires_problem_prefix && context.problems) {
      if (!context.problems.some(p => p.icd10_code && p.icd10_code.startsWith(trigger.requires_problem_prefix))) continue;
    }

    suggestions.push({
      suggestion_type: 'differential_diagnosis',
      category: actions.category || 'routine',
      priority: rule.priority,
      title: actions.title,
      description: actions.description,
      rationale: `Differential diagnoses based on presentation. ${rule.evidence_source || ''}`,
      suggested_action: {
        differentials: actions.differentials || [],
        actions: actions.actions || []
      },
      source: 'rule_engine'
    });
  }
  return suggestions;
}

function evaluatePrescribingAdvisoryRules(rules, medications, chiefComplaint, transcript, context) {
  if (!medications || medications.length === 0) return [];
  const text = `${chiefComplaint || ''} ${transcript || ''}`.toLowerCase();
  const suggestions = [];

  for (const rule of rules.filter(r => r.rule_type === 'prescribing_advisory')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    // Check if chief complaint/transcript matches the target keywords
    if (trigger.chief_complaint_keywords) {
      if (!trigger.chief_complaint_keywords.some(kw => text.includes(kw.toLowerCase()))) continue;
    }

    // Check if an antibiotic from the drug_classes list is being prescribed
    let hasDrug = false;
    if (trigger.drug_classes) {
      hasDrug = medications.some(m =>
        m.status === 'active' &&
        trigger.drug_classes.some(d => m.medication_name.toLowerCase().includes(d.toLowerCase()))
      );
    }
    if (!hasDrug) continue;

    suggestions.push({
      suggestion_type: 'prescribing_advisory',
      category: actions.category || 'routine',
      priority: rule.priority,
      title: actions.title,
      description: actions.description,
      rationale: rule.evidence_source || '',
      suggested_action: actions.actions || [],
      source: 'rule_engine'
    });
  }
  return suggestions;
}

function evaluateScreeningRules(rules, problems, labs, context) {
  if (!problems || problems.length === 0) return [];
  const suggestions = [];

  for (const rule of rules.filter(r => r.rule_type === 'screening')) {
    let trigger, actions;
    try {
      trigger = JSON.parse(rule.trigger_condition);
      actions = JSON.parse(rule.suggested_actions);
    } catch (err) {
      console.warn(`[CDS] Malformed rule ${rule.id}: invalid JSON`);
      continue;
    }

    // Check if patient has the required condition
    if (!problems.some(p => p.icd10_code && p.icd10_code.startsWith(trigger.requires_problem_prefix))) continue;

    // Check which tests are due
    const dueTests = [];
    if (trigger.required_tests) {
      for (const req of trigger.required_tests) {
        const lastResult = (labs || [])
          .filter(l => l.test_name === req.test_name)
          .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))[0];

        if (!lastResult || monthsSince(lastResult.result_date) >= req.interval_months) {
          dueTests.push(req.test_name);
        }
      }
    }

    if (dueTests.length > 0) {
      suggestions.push({
        suggestion_type: 'preventive_care',
        category: 'routine',
        priority: rule.priority,
        title: `${actions.title} (${dueTests.length} test${dueTests.length > 1 ? 's' : ''} due)`,
        description: `${actions.description} Due: ${dueTests.join(', ')}.`,
        rationale: rule.evidence_source || '',
        suggested_action: actions.actions || [],
        source: 'rule_engine'
      });
    }
  }
  return suggestions;
}

// ==========================================
// HEART SCORE PROTOCOL
// ==========================================

const HEART_CHEST_PAIN_KEYWORDS = [
  'chest pain', 'chest pressure', 'chest tightness', 'substernal', 'angina',
  'chest discomfort', 'chest heaviness', 'crushing chest', 'chest burning'
];

const CARDIAC_RISK_FACTOR_CODES = [
  'I10',    // Hypertension
  'E11',    // Type 2 diabetes
  'E10',    // Type 1 diabetes
  'E78',    // Hyperlipidemia / dyslipidemia
  'E66',    // Obesity
  'F17',    // Nicotine / tobacco use
  'Z87.891', // Personal history of nicotine dependence
  'I25',    // Chronic ischemic heart disease / known CAD
  'I63',    // Stroke
  'I65',    // Occlusion of precerebral arteries (PAD)
  'I70',    // Atherosclerosis
];

const KNOWN_ATHEROSCLEROSIS_CODES = ['I25', 'I70', 'I63', 'I65'];

/**
 * Evaluate HEART score (History, ECG, Age, Risk factors, Troponin) for chest pain presentations.
 * Triggered when chief complaint or transcript contains chest pain keywords.
 *
 * HEART score 0-3: Low risk  (<2% MACE at 6 weeks — discharge with follow-up)
 * HEART score 4-6: Moderate  (observe, serial troponins, stress testing)
 * HEART score 7-10: High risk (early invasive strategy, cardiology consult)
 *
 * Reference: Six ACS Risk Scores for Chest Pain in the ED — HEART Score. Ann Emerg Med 2010.
 */
function evaluateHeartScoreProtocol(context) {
  const text = `${context.chiefComplaint || ''} ${context.transcript || ''}`.toLowerCase();

  const isChestPain = HEART_CHEST_PAIN_KEYWORDS.some(kw => text.includes(kw));
  if (!isChestPain) return [];

  const components = {};

  // --- H: History ---
  // Highly suspicious: squeezing/pressure/radiation/diaphoresis/exertional onset
  const highlyTypical = ['squeezing', 'pressure', 'radiation', 'radiates', 'left arm', 'jaw', 'diaphoresis', 'sweating', 'exertion', 'exertional'].some(kw => text.includes(kw));
  // Slightly suspicious: pleuritic, positional, sharp, reproducible, no cardiac features
  const slightlySuspicious = ['sharp', 'pleuritic', 'positional', 'reproducible', 'palpation', 'musculoskeletal'].some(kw => text.includes(kw));
  components.history = highlyTypical ? 2 : slightlySuspicious ? 0 : 1;

  // --- E: ECG ---
  // Cannot evaluate without EKG data in current model; default 1 (non-specific changes pending)
  components.ecg = 1; // Default: non-specific repolarization
  const ecgReview = {
    ecg_needs_review: true,
    ecg_note: 'ECG component defaulted to 1 (non-specific). Manual ECG review required for accurate HEART score.'
  };

  // --- A: Age ---
  let ageScore = 0;
  if (context.patient && context.patient.dob) {
    const birthDate = new Date(context.patient.dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) {
      age--;
    }
    ageScore = age >= 65 ? 2 : age >= 45 ? 1 : 0;
  }
  components.age = ageScore;

  // --- R: Risk Factors ---
  const problems = context.problems || [];
  const problemCodes = problems.map(p => p.icd10_code || p.code || '');

  const hasAtherosclerosis = KNOWN_ATHEROSCLEROSIS_CODES.some(code =>
    problemCodes.some(pc => pc.startsWith(code))
  );
  const riskFactorCount = CARDIAC_RISK_FACTOR_CODES.filter(code =>
    problemCodes.some(pc => pc.startsWith(code))
  ).length;

  components.riskFactors = (hasAtherosclerosis || riskFactorCount >= 3) ? 2 : riskFactorCount >= 1 ? 1 : 0;

  // --- T: Troponin ---
  // Check labs for troponin result
  const labs = context.labs || [];
  const troponinLab = labs.find(l => {
    const name = (l.test_name || l.name || '').toLowerCase();
    return name.includes('troponin') || name.includes('trop');
  });
  if (troponinLab) {
    const result = parseFloat(troponinLab.result || troponinLab.value || '');
    const uln = parseFloat(troponinLab.reference_range_high || troponinLab.upper_limit || '');
    if (!isNaN(result) && !isNaN(uln) && uln > 0) {
      components.troponin = result > uln * 3 ? 2 : result > uln ? 1 : 0;
    } else {
      components.troponin = 1; // Result present but can't parse value — moderate pending
    }
  } else {
    components.troponin = 1; // No troponin ordered yet — flag as pending
  }

  const totalScore = components.history + components.ecg + components.age + components.riskFactors + components.troponin;

  let tier, recommendation, category;
  if (totalScore <= 3) {
    tier = 'Low Risk';
    category = 'routine';
    recommendation = 'HEART score ≤ 3 (low risk). < 2% MACE risk at 6 weeks. Consider discharge with outpatient follow-up if troponin normal and clinical picture consistent.';
  } else if (totalScore <= 6) {
    tier = 'Moderate Risk';
    category = 'urgent';
    recommendation = 'HEART score 4-6 (moderate risk). Admit for observation, serial troponins at 3 and 6 hours, stress testing or coronary imaging prior to discharge.';
  } else {
    tier = 'High Risk';
    category = 'critical';
    recommendation = 'HEART score ≥ 7 (high risk). Early invasive strategy indicated. Cardiology consult, antiplatelet therapy, and urgent catheterization per institutional protocol.';
  }

  return [{
    suggestion_type: 'clinical_protocol',
    category,
    priority: 5, // Highest priority — potential ACS
    title: `HEART Score: ${totalScore}/10 — ${tier}`,
    description: recommendation,
    rationale: `HEART score components: History=${components.history}, ECG=${components.ecg} (pending review), Age=${components.age}, Risk Factors=${components.riskFactors}, Troponin=${components.troponin}. Note: ECG score defaults to 1 (non-specific) pending physician review.`,
    suggested_action: {
      protocol: 'HEART_SCORE',
      score: totalScore,
      components,
      ...ecgReview,
      actions: totalScore >= 4 ? [
        { type: 'order_lab', description: 'Serial Troponin (3-hour)', payload: { test_name: 'Troponin I', cpt_code: '84484' } },
        { type: 'order_lab', description: 'Serial Troponin (6-hour)', payload: { test_name: 'Troponin I', cpt_code: '84484' } }
      ] : []
    },
    source: 'heart_score_protocol'
  }];
}

// ==========================================
// RXNORM-BASED INTERACTION CHECKING
// ==========================================

/**
 * Check drug interactions using NLM RxNorm API data.
 * Supplements local rule-based checking with real pharmacological data.
 * Returns CDS suggestions for any interactions found.
 */
async function evaluateRxNormInteractions(medications) {
  if (!drugSafetyService || !medications || medications.length < 2) return [];

  const suggestions = [];
  const activeMeds = medications.filter(m => m.status === 'active');
  const checked = new Set();

  for (const med of activeMeds) {
    const key = med.medication_name.toLowerCase();
    if (checked.has(key)) continue;
    checked.add(key);

    const otherMeds = activeMeds.filter(m => m.medication_name.toLowerCase() !== key);
    if (otherMeds.length === 0) continue;

    try {
      const interactions = await drugSafetyService.checkDrugInteractions(
        med.medication_name, otherMeds
      );
      for (const interaction of interactions) {
        const pairKey = [interaction.drug1, interaction.drug2].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        suggestions.push({
          suggestion_type: 'interaction_alert',
          category: interaction.severity === 'critical' ? 'urgent' : 'routine',
          priority: interaction.severity === 'critical' ? 1 : interaction.severity === 'serious' ? 2 : 3,
          title: `${interaction.drug1} ↔ ${interaction.drug2} (${interaction.severity})`,
          description: interaction.description,
          rationale: `Source: ${interaction.source}. Severity: ${interaction.severity}.`,
          suggested_action: [],
          source: 'rxnorm_api'
        });
      }
    } catch (err) {
      console.warn(`[CDS] RxNorm interaction check failed for ${med.medication_name}: ${err.message}`);
    }
  }

  return suggestions;
}

// ==========================================
// MAIN EVALUATION
// ==========================================

async function evaluatePatientContext(encounterId, patientId, context) {
  const rules = await db.getAllClinicalRules();
  const suggestions = [];

  suggestions.push(...evaluateVitalRules(rules, context.vitals, context));
  suggestions.push(...evaluateLabRules(rules, context.labs, context));
  suggestions.push(...evaluateDrugInteractionRules(rules, context.medications, context.allergies, context));
  suggestions.push(...evaluateDifferentialRules(rules, context.chiefComplaint, context.transcript, context));
  suggestions.push(...evaluateScreeningRules(rules, context.problems, context.labs, context));
  suggestions.push(...evaluatePrescribingAdvisoryRules(rules, context.medications, context.chiefComplaint, context.transcript, context));
  suggestions.push(...evaluateHeartScoreProtocol(context));

  // RxNorm-based interaction checking (supplements local rules)
  try {
    const rxnormSuggestions = await evaluateRxNormInteractions(context.medications);
    suggestions.push(...rxnormSuggestions);
  } catch (err) {
    console.warn(`[CDS] RxNorm evaluation skipped: ${err.message}`);
  }

  // Deduplicate by title
  const seen = new Set();
  const unique = [];
  for (const s of suggestions) {
    if (!seen.has(s.title)) {
      seen.add(s.title);
      unique.push(s);
    }
  }

  // Sort by priority (lower number = higher priority)
  unique.sort((a, b) => a.priority - b.priority);

  // Persist to database (with deduplication against existing pending suggestions)
  const saved = [];
  for (const s of unique) {
    const existing = await db.dbGet(
      'SELECT id FROM cds_suggestions WHERE encounter_id = ? AND title = ? AND status = ?',
      [encounterId, s.title, 'pending']
    );
    if (existing) continue; // Skip duplicate

    const result = await db.createSuggestion({
      encounter_id: encounterId,
      patient_id: patientId,
      ...s
    });
    saved.push({ id: result.id, ...s });
  }

  return saved;
}

// ==========================================
// EXECUTE ACCEPTED SUGGESTION
// ==========================================

async function executeSuggestion(suggestionId, encounterId, patientId, providerName) {
  const suggestion = await db.getSuggestionById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');

  await db.updateSuggestionStatus(suggestionId, 'accepted');

  let actionData;
  try {
    actionData = typeof suggestion.suggested_action === 'string'
      ? JSON.parse(suggestion.suggested_action)
      : suggestion.suggested_action;
  } catch {
    return { type: 'info', message: 'Suggestion accepted (no automated action)' };
  }

  const results = [];
  const actions = Array.isArray(actionData) ? actionData : (actionData.actions || []);
  const today = new Date().toISOString().split('T')[0];

  for (const action of actions) {
    const payload = action.payload || {};
    payload.patient_id = patientId;
    payload.encounter_id = encounterId;

    try {
      switch (action.type) {
        case 'create_lab_order':
          payload.ordered_by = payload.ordered_by || providerName;
          payload.order_date = payload.order_date || today;
          const labResult = await db.createLabOrder(payload);
          results.push({ type: 'lab_order', id: labResult.id, description: action.description });
          break;

        case 'create_prescription':
          payload.prescriber = payload.prescriber || providerName;
          payload.prescribed_date = payload.prescribed_date || today;
          payload.status = payload.status || 'signed';
          const rxResult = await db.createPrescription(payload);
          results.push({ type: 'prescription', id: rxResult.id, description: action.description });
          break;

        case 'create_imaging_order':
          payload.ordered_by = payload.ordered_by || providerName;
          payload.order_date = payload.order_date || today;
          payload.body_part = payload.body_part || 'Unspecified';
          payload.study_type = payload.study_type || 'Unspecified';
          const imgResult = await db.createImagingOrder(payload);
          results.push({ type: 'imaging_order', id: imgResult.id, description: action.description });
          break;

        case 'create_referral':
          payload.referred_by = payload.referred_by || providerName;
          payload.referred_date = payload.referred_date || today;
          payload.specialty = payload.specialty || 'Unspecified';
          payload.reason = payload.reason || suggestion.title;
          const refResult = await db.createReferral(payload);
          results.push({ type: 'referral', id: refResult.id, description: action.description });
          break;

        case 'medication_adjustment':
        case 'dose_adjustment':
          results.push({ type: action.type, description: action.description, payload });
          break;

        default:
          results.push({ type: 'info', description: action.description });
      }
    } catch (err) {
      results.push({ type: 'error', description: action.description, error: err.message });
    }
  }

  return { suggestion_id: suggestionId, executed: results };
}

// ==========================================
// BUILD PATIENT CONTEXT
// ==========================================

async function buildPatientContext(patientId, encounterId) {
  const [patient, problems, medications, allergies, labs, vitals] = await Promise.all([
    db.getPatientById(patientId),
    db.getPatientProblems(patientId),
    db.getPatientMedications(patientId),
    db.getPatientAllergies(patientId),
    db.getPatientLabs(patientId),
    db.getPatientVitals(patientId)
  ]);

  let encounter = null;
  if (encounterId) {
    encounter = await db.getEncounterById(encounterId);
  }

  return {
    patient,
    problems,
    medications,
    allergies,
    labs,
    vitals: vitals.length > 0 ? vitals[0] : {},
    chiefComplaint: encounter ? encounter.chief_complaint : '',
    transcript: encounter ? encounter.transcript : '',
    providerName: encounter ? encounter.provider : process.env.PROVIDER_NAME || 'Dr. Provider'
  };
}

module.exports = {
  evaluatePatientContext,
  executeSuggestion,
  buildPatientContext,
  evaluateVitalRules,
  evaluateLabRules,
  evaluateDrugInteractionRules,
  evaluateDifferentialRules,
  evaluateScreeningRules,
  evaluatePrescribingAdvisoryRules,
  evaluateHeartScoreProtocol
};
