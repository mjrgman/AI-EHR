'use strict';

/**
 * AWV (Annual Wellness Visit) Agent.
 *
 * Phase 3 of the primary-care deepening plan. Replaces the inline
 * `_checkAWVComponents` in quality-agent.js with a dedicated module that:
 *   - Detects AWV-type encounters
 *   - Verifies 12-month eligibility window (vs prior G0438/G0439)
 *   - Determines G0438 (initial) vs G0439 (subsequent)
 *   - Enforces required components (HRA + SDOH + cognitive + fall risk +
 *     depression + BMI + BP + prevention plan)
 *   - Suggests add-on codes: G2211, 99497/99498 (ACP), 99483 (deep cognitive),
 *     G0136 (SDOH-only)
 *
 * CATC Tier 2: surfaces eligibility + checklist + bill suggestion;
 * physician approves before sign-off.
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §1.
 */

const { BaseAgent } = require('./base-agent');

// Allow whitespace, underscore, or hyphen as separator (e.g. "annual_wellness_visit",
// "Annual Wellness Visit", "annual-wellness-visit" all match).
const AWV_ENCOUNTER_TYPE_PATTERNS = [
  /\bawv\b/i,
  /annual[\s_-]*wellness/i,
  /wellness[\s_-]*visit/i,
  /medicare[\s_-]*wellness/i,
];

// CMS 12-month window — bill no more frequently than once per 12 calendar months
const ELIGIBILITY_WINDOW_DAYS = 365;

// Required components per CMS MLN6775421 (G0438 + G0439 share most; G0438 adds
// initial-establishment vs G0439's update flow).
function requiredComponents(awvType, patientAge) {
  const base = [
    { key: 'hra', label: 'Health Risk Assessment (HRA)', initial: true, subsequent: true },
    { key: 'sdoh_hra', label: 'Social Determinants of Health Risk Assessment (2024+ MM13486)', initial: true, subsequent: true },
    { key: 'medical_family_history', label: 'Medical/Family History (Establish for Initial; Update for Subsequent)', initial: true, subsequent: true },
    { key: 'providers_list', label: 'List of current providers/suppliers', initial: true, subsequent: true },
    { key: 'measurements', label: 'Height, Weight, BMI, Blood Pressure', initial: true, subsequent: true },
    { key: 'cognitive_screening', label: 'Cognitive impairment detection (Mini-Cog/MoCA/GPCOG/MIS/AD8)', initial: true, subsequent: true },
    { key: 'depression_screening', label: 'Depression screening (PHQ-2/PHQ-9)', initial: true, subsequent: true },
    { key: 'functional_safety', label: 'Functional ability + safety (incl. fall risk via TUG/StayIndependent)', initial: true, subsequent: true },
    { key: 'screening_schedule', label: 'Written screening schedule for next 5-10 years', initial: true, subsequent: true },
    { key: 'risk_factor_interventions', label: 'List of risk factors with recommended interventions', initial: true, subsequent: true },
    { key: 'personalized_health_advice', label: 'Personalized health advice and prevention referrals', initial: true, subsequent: true },
  ];

  const filtered = base.filter(c => awvType === 'INITIAL_G0438' ? c.initial : c.subsequent);

  // Hearing impairment screening is age-related guidance — flag for 65+ as priority
  if (patientAge !== null && patientAge >= 65) {
    filtered.push({ key: 'hearing_impairment', label: 'Hearing impairment review (65+ priority)', initial: true, subsequent: true });
  }

  return filtered;
}

// Component-detection patterns from encounter transcript.
// Keep narrow/precise to avoid false positives.
const COMPONENT_PATTERNS = {
  hra: /\b(?:health\s*risk\s*assessment|hra(?:\s*completed)?|risk\s*assessment\s*(?:tool|completed))\b/i,
  sdoh_hra: /\b(?:sdoh|social\s*determinants?(?:\s*of\s*health)?|housing\s*insecur|food\s*insecur|transportation\s*barrier|safety\s*concern)\b/i,
  medical_family_history: /\b(?:family\s*history|medical\s*history|past\s*medical)\b/i,
  providers_list: /\b(?:provider\s*list|other\s*(?:providers|specialists)|current\s*specialists?|consulting\s*providers)\b/i,
  measurements: null,  // Computed from vitals presence, not transcript
  cognitive_screening: /\b(?:mini.?cog|moca|gpcog|ad8|mis\s*test|cognitive\s*screen|memory\s*screen|clock\s*draw)\b/i,
  depression_screening: /\b(?:phq.?2|phq.?9|depression\s*screen|beck\s*depression|geriatric\s*depression)\b/i,
  functional_safety: /\b(?:fall\s*risk|stay\s*independent|timed\s*up\s*and\s*go|tug\b|morse\s*fall|gait\s*assess|balance\s*assess|home\s*safety)\b/i,
  hearing_impairment: /\b(?:hearing\s*screen|hearing\s*loss|whisper\s*test|audiomet)\b/i,
  screening_schedule: /\b(?:screening\s*schedule|prevention\s*plan|health\s*maintenance\s*schedule|preventive\s*services\s*plan)\b/i,
  risk_factor_interventions: /\b(?:risk\s*factor|intervention\s*list|risk\s*reduction\s*plan)\b/i,
  personalized_health_advice: /\b(?:personalized\s*advice|health\s*coaching|behavior\s*change|prevention\s*counsel)\b/i,
};

function detectMeasurementsComplete(vitals) {
  if (!vitals) return false;
  return !!(vitals.height && vitals.weight && vitals.systolic_bp && vitals.diastolic_bp);
}

function isAwvEncounter(encounterType) {
  if (!encounterType) return false;
  const t = String(encounterType).toLowerCase();
  return AWV_ENCOUNTER_TYPE_PATTERNS.some(p => p.test(t));
}

function ageInYears(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  return Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Eligibility — Medicare allows G0438 once-per-lifetime + G0439 no more than
 * once per 12-month window.
 */
function checkEligibility(priorAwvRecords, today = new Date()) {
  const records = (priorAwvRecords || []).slice().sort((a, b) =>
    new Date(b.visit_date) - new Date(a.visit_date)
  );

  if (records.length === 0) {
    return {
      eligible: true,
      proposedType: 'INITIAL_G0438',
      reason: 'No prior AWV on record — patient eligible for Initial AWV (G0438).',
      lastAwvDate: null,
      nextEligibleDate: null
    };
  }

  const last = records[0];
  const lastDate = new Date(last.visit_date);
  const daysSince = Math.floor((today - lastDate) / (24 * 60 * 60 * 1000));
  const nextEligible = new Date(lastDate);
  nextEligible.setDate(nextEligible.getDate() + ELIGIBILITY_WINDOW_DAYS);

  if (daysSince < ELIGIBILITY_WINDOW_DAYS) {
    return {
      eligible: false,
      proposedType: null,
      reason: `Prior AWV ${daysSince} days ago (${lastDate.toISOString().slice(0, 10)}); 12-month window not yet elapsed.`,
      lastAwvDate: last.visit_date,
      nextEligibleDate: nextEligible.toISOString().slice(0, 10)
    };
  }

  // Past initial → subsequent
  const hadInitial = records.some(r => r.awv_type === 'INITIAL_G0438');
  return {
    eligible: true,
    proposedType: hadInitial ? 'SUBSEQUENT_G0439' : 'INITIAL_G0438',
    reason: hadInitial
      ? `Prior Initial AWV documented; eligible for Subsequent AWV (G0439).`
      : `Prior AWV record exists but no Initial G0438 — billing as Initial.`,
    lastAwvDate: last.visit_date,
    nextEligibleDate: null
  };
}

/**
 * Pure function: evaluate AWV components from encounter context.
 * Used both by the agent's process() and exposed for direct testing.
 */
function evaluateComponents(context, awvType) {
  const transcript = String(context.encounter?.transcript || '');
  const vitals = context.vitals || {};
  const patient = context.patient || {};
  const age = ageInYears(patient.dob);

  const required = requiredComponents(awvType, age);
  const evaluated = required.map(comp => {
    let documented = false;
    if (comp.key === 'measurements') {
      documented = detectMeasurementsComplete(vitals);
    } else {
      const pattern = COMPONENT_PATTERNS[comp.key];
      documented = pattern ? pattern.test(transcript) : false;
    }
    return {
      key: comp.key,
      label: comp.label,
      required: true,
      documented,
      action: documented ? null : `Document: ${comp.label}`
    };
  });

  const completeCount = evaluated.filter(c => c.documented).length;
  return {
    components: evaluated,
    completeness: {
      complete: completeCount,
      total: evaluated.length,
      percentage: Math.round((completeCount / evaluated.length) * 100)
    },
    missingRequired: evaluated.filter(c => !c.documented)
  };
}

/**
 * Suggest add-on codes based on encounter context.
 */
function suggestAddOns(context, componentsResult) {
  const transcript = String(context.encounter?.transcript || '').toLowerCase();
  const addOns = [];

  // 99497/99498 — ACP if discussed >= 16 minutes (proxy: explicit ACP keywords)
  if (/\b(?:advance\s*(?:care|directive)|living\s*will|health\s*care\s*proxy|polst|code\s*status|surrogate\s*decision)\b/.test(transcript)) {
    addOns.push({
      cpt: '99497',
      label: 'Advance Care Planning, first 30 minutes',
      rationale: 'ACP discussion documented; 99497 covers first 30 min, 99498 for each additional 30. Deductible/coinsurance waived when same-day as AWV.',
      requires_minutes: 16,
      modifier: '33'  // preventive when same-day as AWV
    });
  }

  // 99483 — separate cognitive deep-dive if cognitive screen positive
  if (/\b(?:cognitive\s*(?:concern|impairment|decline|positive)|mci|dementia|memory\s*loss)\b/.test(transcript)) {
    addOns.push({
      cpt: '99483',
      label: 'Cognitive Assessment & Care Plan Services (50-min comprehensive)',
      rationale: 'Cognitive concern documented; 99483 provides separate reimbursement for detailed evaluation and care plan.',
      requires_minutes: 50
    });
  }

  // G2211 — visit complexity add-on (longitudinal care relationship)
  // AWV inherently establishes longitudinal intent; 2025+ allows G2211 with mod 25
  addOns.push({
    cpt: 'G2211',
    label: 'Visit Complexity Add-On (longitudinal care)',
    rationale: 'AWV documents longitudinal-care intent. G2211 may be appended same-day per 2025+ CMS rules (modifier 25 on the AWV).',
    modifier: '25_on_base'
  });

  // G0136 — standalone SDOH risk assessment (5-15 min) when SDOH was the focus
  // and it's not simply rolled into HRA
  const sdohComponent = componentsResult.components.find(c => c.key === 'sdoh_hra');
  if (sdohComponent && sdohComponent.documented &&
      /\b(?:sdoh\s*assessment|social\s*needs\s*screen|housing\s*assess|food\s*insecurity\s*screen)\b/.test(transcript)) {
    addOns.push({
      cpt: 'G0136',
      label: 'Standalone SDOH Risk Assessment (5-15 minutes)',
      rationale: 'SDOH assessment was a focused component; G0136 separately reimbursable.',
      requires_minutes: 5
    });
  }

  return addOns;
}

class AWVAgent extends BaseAgent {
  constructor(options = {}) {
    super('awv', {
      description: 'Annual Wellness Visit — eligibility, components, billing-code selection, add-ons',
      dependsOn: ['scribe', 'cds'],
      priority: 35,
      autonomyTier: 2,
      ...options
    });
  }

  /**
   * @param {PatientContext} context — must include encounter (with transcript + encounter_type),
   *   patient (with dob), vitals, and optionally priorAwvRecords.
   * @returns {Promise<object>}
   */
  async process(context, _agentResults = {}) {
    const encounterType = context.encounter?.encounter_type || '';
    const isAwv = isAwvEncounter(encounterType);

    if (!isAwv) {
      return {
        applicable: false,
        reason: `Encounter type '${encounterType}' is not an AWV — agent skipped.`,
        billableCpt: null
      };
    }

    const eligibility = checkEligibility(context.priorAwvRecords || [], new Date());
    if (!eligibility.eligible) {
      return {
        applicable: true,
        eligible: false,
        eligibility,
        billableCpt: null,
        warning: 'Encounter coded as AWV but patient is not yet eligible. Bill as standard E/M instead.'
      };
    }

    const awvType = eligibility.proposedType;
    const componentsResult = evaluateComponents(context, awvType);
    const addOns = suggestAddOns(context, componentsResult);

    const billableCpt = awvType === 'INITIAL_G0438' ? 'G0438' : 'G0439';

    return {
      applicable: true,
      eligible: true,
      eligibility,
      awvType,
      billableCpt,
      ...componentsResult,
      addOns,
      readyToSign: componentsResult.missingRequired.length === 0,
      summary: componentsResult.missingRequired.length === 0
        ? `AWV ready to sign — all ${componentsResult.completeness.total} required components documented.`
        : `AWV checklist: ${componentsResult.completeness.complete}/${componentsResult.completeness.total} components complete; ${componentsResult.missingRequired.length} missing.`
    };
  }
}

module.exports = {
  AWVAgent,
  // Pure helpers (testable in isolation)
  isAwvEncounter,
  checkEligibility,
  evaluateComponents,
  suggestAddOns,
  requiredComponents,
  ageInYears,
  ELIGIBILITY_WINDOW_DAYS,
  COMPONENT_PATTERNS
};
