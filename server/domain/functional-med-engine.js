/**
 * Functional Medicine / HRT / Peptide Rule Evaluation Engine
 *
 * Mirrors the shape of server/cds-engine.js: each evaluator function takes
 * a slice of patient context + the matching rules, and returns an array of
 * suggestion objects. The engine itself is orchestrated by the
 * DomainLogicAgent.
 *
 * EVALUATION ORDER (hard contract):
 *   1. Interaction / safety rules FIRST.
 *      - If any fire, they produce suggestions AND can populate a
 *        `blockedRuleTypes` Set that short-circuits other rule types.
 *   2. Lab-triggered pattern rules (functional medicine).
 *   3. HRT initiation / titration rules.
 *   4. Peptide initiation / titration rules.
 *
 * Each suggestion carries:
 *   - `suggestion_type`, `category`, `priority`, `title`, `description`,
 *     `rationale`, `suggested_action` (array), `source: 'domain_logic_engine'`
 *   - `requiresDosingApproval` (boolean) — flags whether the orchestrating
 *     agent must route this through `requestDosingApproval()` before it
 *     becomes actionable.
 *   - `evidence_source` — pulled from the rule itself; never empty.
 */

const knowledgeBase = require('./knowledge-base');

// ==========================================
// LOW-LEVEL HELPERS
// ==========================================

function evaluateComparison(actual, operator, threshold) {
  if (actual === null || actual === undefined) return false;
  const val = typeof actual === 'string' ? parseFloat(actual) : actual;
  if (Number.isNaN(val)) return false;
  switch (operator) {
    case '>':  return val > threshold;
    case '>=': return val >= threshold;
    case '<':  return val < threshold;
    case '<=': return val <= threshold;
    case '==': return val === threshold;
    case '!=': return val !== threshold;
    case 'between':
      return Array.isArray(threshold) && val >= threshold[0] && val <= threshold[1];
    default:
      return false;
  }
}

// Lab code aliases — maps rule-friendly short codes to substrings the engine
// will match against any incoming lab test_name. Use lowercase, no separators.
// When adding a new rule, add the short code here with all likely aliases.
const LAB_ALIASES = {
  hba1c: ['a1c', 'hemoglobina1c', 'glycohemoglobin', 'hgba1c'],
  total_testosterone: ['totaltestosterone', 'testosteronetotal', 'testosterone'],
  free_testosterone: ['freetestosterone'],
  hematocrit: ['hct', 'hematocrit'],
  psa: ['psa', 'prostatespecificantigen'],
  psa_delta: ['psadelta', 'psachange'], // Calculated separately; falls through
  fasting_insulin: ['fastinginsulin', 'insulinfasting', 'insulin'],
  homa_ir: ['homair', 'homa'],
  triglycerides: ['triglycerides', 'trig', 'tg'],
  hdl: ['hdl', 'hdlcholesterol'],
  tsh: ['tsh', 'thyroidstimulatinghormone'],
  free_t4: ['freet4', 't4free'],
  free_t3: ['freet3', 't3free'],
  tpo_antibody: ['tpoantibody', 'tpoab', 'thyroidperoxidase'],
  b12: ['b12', 'vitaminb12', 'cobalamin'],
  homocysteine: ['homocysteine', 'homocyst'],
  mma: ['mma', 'methylmalonicacid'],
  cortisol_am: ['cortisolam', 'amcortisol', 'cortisolmorning', 'cortisol'],
  hs_crp: ['hscrp', 'hscreactive', 'highsensitivitycrp', 'crp'],
  fibrinogen: ['fibrinogen'],
  ferritin: ['ferritin'],
  beta_hcg: ['betahcg', 'bhcg', 'hcg', 'quantitativehcg', 'pregnancytest'],
  '25_oh_vitamin_d': ['25ohvitamind', '25hydroxyvitamind', 'vitamind25', 'vitamind', '25oh']
};

function normalizeLabName(s) {
  return (s || '').toLowerCase().replace(/[_\s\-(),.\/]/g, '');
}

function findLabValue(labs, code) {
  if (!Array.isArray(labs) || labs.length === 0) return null;
  const aliases = LAB_ALIASES[code] || [code.toLowerCase().replace(/[_\s-]/g, '')];
  const match = labs
    .filter((l) => {
      const name = normalizeLabName(l.test_name || l.code || '');
      if (!name) return false;
      // Match if any alias is a substring of the test name OR vice versa
      return aliases.some((alias) => name.includes(alias) || alias.includes(name));
    })
    .sort((a, b) => new Date(b.result_date || 0) - new Date(a.result_date || 0))[0];
  if (!match) return null;
  const raw = match.result_value !== undefined ? match.result_value : match.value;
  const val = typeof raw === 'string' ? parseFloat(raw) : raw;
  return Number.isNaN(val) ? null : val;
}

function patientHasAnyProblem(problems, candidates) {
  if (!Array.isArray(problems) || problems.length === 0) return false;
  const needles = candidates.map((c) => c.toLowerCase());
  return problems.some((p) => {
    const name = (p.problem_name || p.name || '').toLowerCase();
    const code = (p.icd10_code || '').toLowerCase();
    return needles.some((n) => name.includes(n) || code.includes(n));
  });
}

function patientOnMedication(medications, drugName) {
  if (!Array.isArray(medications) || medications.length === 0) return false;
  const needle = drugName.toLowerCase();
  return medications.some((m) => {
    if (m.status && m.status !== 'active') return false;
    const name = (m.medication_name || m.name || '').toLowerCase();
    return name.includes(needle);
  });
}

function patientHasAnySymptom(transcript, symptomsList) {
  if (!transcript || !Array.isArray(symptomsList)) return false;
  const lowered = transcript.toLowerCase();
  return symptomsList.some((s) => lowered.includes(s.toLowerCase()));
}

function patientAge(patient) {
  if (!patient?.dob) return null;
  const dob = new Date(patient.dob);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase().replace(/[_-]/g, ' ').trim();
}

function hasPregnancyCondition(ctx) {
  const problems = ctx.problems || [];
  if (!Array.isArray(problems) || problems.length === 0) return false;

  return problems.some((problem) => {
    const name = normalizeStatus(problem.problem_name || problem.name);
    const code = normalizeStatus(problem.icd10_code || problem.code);
    return name.includes('pregnan') ||
      name.includes('gestation') ||
      code.startsWith('z33') ||
      code.startsWith('z34') ||
      code.startsWith('z3a') ||
      /^o\d/.test(code);
  });
}

function hasNegativePregnancyStatus(ctx) {
  const status = normalizeStatus(firstPresent(
    ctx.pregnancy_status,
    ctx.pregnancyStatus,
    ctx.patient?.pregnancy_status,
    ctx.patient?.pregnancyStatus,
    ctx.encounter?.pregnancy_status,
    ctx.encounter?.pregnancyStatus
  ));

  if (status) {
    if (status.includes('pregnant') && !status.includes('not pregnant') && !status.includes('non pregnant')) {
      return false;
    }
    if (
      status.includes('not pregnant') ||
      status.includes('non pregnant') ||
      status === 'negative' ||
      status.includes('negative pregnancy') ||
      status.includes('postmenopausal') ||
      status.includes('menopause confirmed') ||
      status.includes('surgically sterile')
    ) {
      return true;
    }
  }

  const betaHcg = findLabValue(ctx.labs || [], 'beta_hcg');
  return betaHcg !== null && betaHcg < 5;
}

function hasDocumentedLmp(ctx) {
  return !!firstPresent(
    ctx.lmp,
    ctx.lmp_date,
    ctx.last_menstrual_period,
    ctx.patient?.lmp,
    ctx.patient?.lmp_date,
    ctx.patient?.last_menstrual_period,
    ctx.encounter?.lmp,
    ctx.encounter?.lmp_date,
    ctx.encounter?.last_menstrual_period
  );
}

function passesPregnancyGate(trigger, ctx) {
  const gate = trigger.pregnancy_gate;
  if (!gate?.required) return true;

  if (ctx.patient?.sex !== 'F') return true;
  if (ctx.patient?.has_uterus === false) return true;

  const age = patientAge(ctx.patient);
  const maxAge = gate.reproductive_age_max ?? 55;
  if (age !== null && age > maxAge) return true;

  if (hasPregnancyCondition(ctx)) return false;
  if (gate.lmp_required !== false && !hasDocumentedLmp(ctx)) return false;

  return hasNegativePregnancyStatus(ctx);
}

// ==========================================
// TRIGGER EVALUATION
// ==========================================

/**
 * Evaluate a rule's trigger_condition against the patient context.
 * Returns true if the rule should fire.
 */
function evaluateTrigger(trigger, ctx) {
  if (!trigger) return false;

  // Sex gate
  if (trigger.sex && ctx.patient?.sex !== trigger.sex) return false;

  // Age gate
  if (trigger.age_min != null || trigger.age_max != null) {
    const age = patientAge(ctx.patient);
    if (age == null) return false;
    if (trigger.age_min != null && age < trigger.age_min) return false;
    if (trigger.age_max != null && age > trigger.age_max) return false;
  }

  if (!passesPregnancyGate(trigger, ctx)) return false;

  // BMI gate
  if (trigger.bmi_min != null) {
    const bmi = ctx.vitals?.bmi;
    if (bmi == null || bmi < trigger.bmi_min) return false;
  }

  // Problem list required
  if (Array.isArray(trigger.problems_any) && trigger.problems_any.length > 0) {
    if (!patientHasAnyProblem(ctx.problems || [], trigger.problems_any)) return false;
  }

  // Contraindications — any present means fail
  if (Array.isArray(trigger.contraindications_none) && trigger.contraindications_none.length > 0) {
    if (patientHasAnyProblem(ctx.problems || [], trigger.contraindications_none)) return false;
  }

  // On medication
  if (trigger.on_medication) {
    if (!patientOnMedication(ctx.medications || [], trigger.on_medication)) return false;
  }

  // Not on medication
  if (trigger.not_on_medication) {
    if (patientOnMedication(ctx.medications || [], trigger.not_on_medication)) return false;
  }

  // Symptoms (substring match against transcript)
  if (Array.isArray(trigger.symptoms_any) && trigger.symptoms_any.length > 0) {
    const transcript = ctx.encounter?.transcript || ctx.transcript || '';
    if (!patientHasAnySymptom(transcript, trigger.symptoms_any)) return false;
  }

  // Single lab comparison
  if (trigger.lab) {
    const { code, operator, value } = trigger.lab;
    const actual = findLabValue(ctx.labs || [], code);
    if (!evaluateComparison(actual, operator, value)) return false;
  }

  // Composite "any_of" (OR)
  if (Array.isArray(trigger.any_of) && trigger.any_of.length > 0) {
    const anyFired = trigger.any_of.some((sub) => evaluateTrigger(sub, ctx));
    if (!anyFired) return false;
  }

  // Composite "and" (AND) inside any_of sub-branches is handled recursively via evaluateTrigger
  if (Array.isArray(trigger.and) && trigger.and.length > 0) {
    const allFired = trigger.and.every((sub) => evaluateTrigger(sub, ctx));
    if (!allFired) return false;
  }

  // has_uterus is a positive assertion; only enforce if the patient record says otherwise
  if (trigger.has_uterus === true && ctx.patient?.has_uterus === false) return false;
  if (trigger.has_uterus === false && ctx.patient?.has_uterus === true) return false;

  return true;
}

// ==========================================
// SUGGESTION ASSEMBLY
// ==========================================

function ruleToSuggestion(rule) {
  const actions = rule.suggested_actions || {};
  const requiresApproval = Array.isArray(actions.actions)
    && actions.actions.some((a) => a.requiresDosingApproval === true);

  return {
    suggestion_type: rule.rule_type,
    category: rule.category,
    priority: rule.priority || 50,
    title: actions.title || rule.rule_name,
    description: actions.description || '',
    rationale: rule.evidence_source,
    suggested_action: actions.actions || [],
    source: 'domain_logic_engine',
    rule_id: rule.id,
    evidence_source: rule.evidence_source,
    requiresDosingApproval: requiresApproval,
    educational_only: rule.educational_only === true,
    emitEvent: actions.emitEvent || null,
    blocksRuleTypes: actions.blocksRuleTypes || []
  };
}

// ==========================================
// MAIN EVALUATOR
// ==========================================

/**
 * Evaluate the full rule set against patient context.
 *
 * @param {Object} ctx - { patient, encounter, vitals, problems, medications, labs, transcript }
 * @returns {{
 *   suggestions: Array,
 *   dosingProposals: Array,
 *   patternEvents: Array,
 *   blockedRuleTypes: Array<string>,
 *   safetyBlocks: Array
 * }}
 */
function evaluate(ctx) {
  const rules = knowledgeBase.loadRules();
  const suggestions = [];
  const dosingProposals = [];
  const patternEvents = [];
  const safetyBlocks = [];
  const blockedRuleTypes = new Set();

  // Phase 1: interaction / safety rules FIRST
  const interactionRules = rules.filter((r) => r.category === 'interaction');
  for (const rule of interactionRules) {
    try {
      if (evaluateTrigger(rule.trigger_condition, ctx)) {
        const suggestion = ruleToSuggestion(rule);
        suggestions.push(suggestion);
        safetyBlocks.push({
          rule_id: rule.id,
          reason: suggestion.title,
          blocks: suggestion.blocksRuleTypes
        });
        for (const t of suggestion.blocksRuleTypes) blockedRuleTypes.add(t);
      }
    } catch (err) {
      console.error(`[DomainEngine] Interaction rule ${rule.id} errored:`, err.message);
    }
  }

  // Phase 2+: everything else
  const nonInteraction = rules.filter((r) => r.category !== 'interaction');
  for (const rule of nonInteraction) {
    if (blockedRuleTypes.has(rule.rule_type)) continue;
    try {
      if (evaluateTrigger(rule.trigger_condition, ctx)) {
        const suggestion = ruleToSuggestion(rule);
        suggestions.push(suggestion);

        // Collect dosing proposals (for the agent to route through approval)
        const dosingActions = (rule.suggested_actions.actions || [])
          .filter((a) => a.requiresDosingApproval === true);
        for (const action of dosingActions) {
          dosingProposals.push({
            rule_id: rule.id,
            rule_name: rule.rule_name,
            evidence_source: rule.evidence_source,
            action
          });
        }

        // Collect functional pattern events
        if (suggestion.emitEvent === 'FUNCTIONAL_PATTERN_DETECTED') {
          patternEvents.push({
            rule_id: rule.id,
            category: rule.category,
            title: suggestion.title,
            description: suggestion.description,
            evidence_source: rule.evidence_source
          });
        }
      }
    } catch (err) {
      console.error(`[DomainEngine] Rule ${rule.id} errored:`, err.message);
    }
  }

  suggestions.sort((a, b) => (a.priority || 50) - (b.priority || 50));

  return {
    suggestions,
    dosingProposals,
    patternEvents,
    blockedRuleTypes: Array.from(blockedRuleTypes),
    safetyBlocks
  };
}

module.exports = {
  evaluate,
  evaluateTrigger,     // exported for unit tests
  findLabValue,        // exported for unit tests
  patientHasAnyProblem,
  patientOnMedication,
  patientHasAnySymptom
};
