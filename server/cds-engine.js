/**
 * MJR-EHR Clinical Decision Support Engine
 * Evaluates clinical rules against patient context and generates suggestions.
 */

const db = require('./database');

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);
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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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
    const trigger = JSON.parse(rule.trigger_condition);
    const actions = JSON.parse(rule.suggested_actions);

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

  // Persist to database
  const saved = [];
  for (const s of unique) {
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
  evaluatePrescribingAdvisoryRules
};
