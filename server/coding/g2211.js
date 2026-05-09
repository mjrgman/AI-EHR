'use strict';

/**
 * G2211 — Visit Complexity Add-On detector.
 *
 * Per CMS MM13473 + AAFP G2211 guidance:
 *   "G2211 captures the inherent complexity of the visit that's derived from
 *    the longitudinal nature of the practitioner-patient relationship, as well
 *    as ongoing medical care related to a patient's single, serious condition
 *    or complex condition."
 *
 * Eligible base codes:
 *   - 99202–99215 (office/outpatient E/M, since 2024)
 *   - 99202–99215 telehealth (since 2025)
 *   - 99341, 99342, 99344, 99345, 99347, 99348, 99349, 99350 (home/residence — NEW IN CY 2026)
 *
 * Modifier 25 rule (2025+):
 *   G2211 IS payable when the base E/M is appended with modifier 25 same-day as:
 *     - Annual Wellness Visit (G0438/G0439)
 *     - Vaccine administration
 *     - Any Medicare Part B preventive service
 *
 * NOT billable:
 *   - Discrete, routine, or time-limited visits with no ongoing-care relationship
 *   - Procedure-only visits
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §5.
 */

// CPT codes that G2211 may be appended to.
const ELIGIBLE_OFFICE_OUTPATIENT = ['99202', '99203', '99204', '99205', '99212', '99213', '99214', '99215'];
const ELIGIBLE_HOME_RESIDENCE_2026 = ['99341', '99342', '99344', '99345', '99347', '99348', '99349', '99350'];
const ELIGIBLE_BASE_CODES = new Set([...ELIGIBLE_OFFICE_OUTPATIENT, ...ELIGIBLE_HOME_RESIDENCE_2026]);

// Chronic condition prefixes that establish "ongoing medical care related to
// a single serious / complex condition." Conservative subset — primary-care
// HCC-relevant chronic disease codes.
const CHRONIC_CONDITION_PREFIXES = [
  'E10', 'E11',           // Diabetes
  'I10', 'I11', 'I12',    // Hypertension and HTN-driven CKD/HF
  'I25',                  // Chronic ischemic heart disease
  'I48',                  // Atrial fibrillation
  'I50',                  // Heart failure
  'I69',                  // Sequelae of stroke
  'I70',                  // Atherosclerosis
  'J44',                  // COPD
  'J45',                  // Asthma (when persistent)
  'N18',                  // CKD
  'F32', 'F33',           // Major depressive disorder
  'F41',                  // Anxiety disorders
  'E66',                  // Obesity
  'E78',                  // Lipid disorders
  'M05', 'M06',           // Rheumatoid arthritis
  'G20',                  // Parkinson's
  'G35',                  // Multiple sclerosis
  'C',                    // Active malignancies
  'K70', 'K72', 'K74',    // Chronic liver disease
  'B20'                   // HIV
];

// Encounter types that, by their nature, establish longitudinal intent.
const LONGITUDINAL_INTENT_ENCOUNTER_TYPES = new Set([
  'follow_up', 'follow-up', 'followup',
  'chronic_disease_management', 'chronic disease management',
  'annual_wellness_visit', 'awv', 'wellness',
  'medication_management', 'medication management',
  'preventive', 'preventive_care'
]);

// Encounter types that explicitly do NOT establish longitudinal intent.
// Note: 'procedure_only' is intentionally NOT in this set — it has a dedicated
// check below that fires first with a clearer rationale message.
const ACUTE_ONLY_ENCOUNTER_TYPES = new Set([
  'urgent_care', 'urgent care', 'walk_in', 'walk-in', 'walkin',
  'workers_comp', 'workers comp',
  'sports_physical', 'sports physical',
  'preop', 'pre_op', 'pre-op'
]);

const RVU_2026_G2211 = 0.33;
const ESTIMATED_REIMBURSEMENT_USD = 16.05;  // Approximate national CY 2026

/**
 * Detect G2211 eligibility for an encounter.
 *
 * @param {object} context - encounter context (patient, encounter, problems)
 * @param {string} [baseCpt] - the base E/M CPT code being attached. If omitted,
 *   eligibility is assessed against any standard E/M code family.
 * @returns {{
 *   eligible: boolean,
 *   addOnCpt: string|null,
 *   rationale: string,
 *   signals: object,
 *   modifier25Allowed: boolean,
 *   estimatedReimbursementUSD: number
 * }}
 */
function detectG2211Eligibility(context, baseCpt) {
  if (!context || typeof context !== 'object') {
    return _ineligible('Invalid context provided', { context_provided: false });
  }

  const patient = context.patient || {};
  const encounter = context.encounter || {};
  const problems = context.problems || [];
  const encounterType = String(encounter.encounter_type || '').toLowerCase().trim();
  const locationType = String(encounter.location_type || '').toLowerCase().trim();

  // Signal extraction
  const signals = {
    hasPatientRecord: !!patient.id,
    establishedRelationship: _hasEstablishedRelationship(patient),
    hasOngoingChronicCondition: _hasChronicCondition(problems),
    encounterType,
    locationType,
    isTelehealth: !!encounter.is_telehealth,
    isOfficeOutpatient: locationType === '' || locationType === 'office' || locationType === 'outpatient',
    isHomeOrResidence: locationType === 'home' || locationType === 'residence' || locationType === 'assisted_living',
    isLongitudinalIntentType: LONGITUDINAL_INTENT_ENCOUNTER_TYPES.has(encounterType),
    isAcuteOnly: ACUTE_ONLY_ENCOUNTER_TYPES.has(encounterType),
    baseCptEligible: baseCpt ? ELIGIBLE_BASE_CODES.has(String(baseCpt)) : null,
    isProcedureOnly: encounterType.includes('procedure') && !encounterType.includes('follow')
  };

  // Procedure-only visits are not eligible (check first for clearer rationale)
  if (signals.isProcedureOnly) {
    return _ineligible('Procedure-only visits are not G2211-eligible.', signals);
  }

  // Acute-only encounter types are explicitly not G2211-eligible
  if (signals.isAcuteOnly) {
    return _ineligible(
      `Encounter type '${encounterType}' is explicitly acute / time-limited; G2211 requires longitudinal care intent.`,
      signals
    );
  }

  // If a baseCpt was provided and it's not in the eligible family, fail
  if (baseCpt && !signals.baseCptEligible) {
    return _ineligible(
      `Base CPT ${baseCpt} is not in the G2211-eligible code family (99202–99215 office/outpatient, ` +
      '99341–99350 home/residence as of CY 2026).',
      signals
    );
  }

  // Setting must be office/outpatient, home/residence, or telehealth
  const settingEligible = signals.isOfficeOutpatient || signals.isHomeOrResidence || signals.isTelehealth;
  if (!settingEligible) {
    return _ineligible(
      `Setting '${locationType}' is not in the G2211-eligible setting list (office, home/residence, or telehealth).`,
      signals
    );
  }

  // Longitudinal-intent test — at least ONE of:
  //   1. Established patient relationship (>= 1 year), OR
  //   2. Active chronic condition documented in problems list, OR
  //   3. Encounter type explicitly indicates longitudinal intent (followup, AWV, chronic mgmt)
  const longitudinal = signals.establishedRelationship
    || signals.hasOngoingChronicCondition
    || signals.isLongitudinalIntentType;

  if (!longitudinal) {
    return _ineligible(
      'No longitudinal-care relationship signal detected (no established history, no chronic condition, ' +
      'no follow-up/wellness/chronic-management encounter type).',
      signals
    );
  }

  return {
    eligible: true,
    addOnCpt: 'G2211',
    rationale: _buildRationale(signals),
    signals,
    modifier25Allowed: true,  // 2025+ — same-day with AWV, vaccine, or Medicare Part B preventive
    documentationGuidance: 'No additional documentation required by CMS, but recording the longitudinal-care ' +
      'intent (e.g., "patient established with this practice; ongoing management of [condition]") strengthens ' +
      'audit defense.',
    estimatedReimbursementUSD: ESTIMATED_REIMBURSEMENT_USD,
    rvu_2026: RVU_2026_G2211
  };
}

// ==========================================
// HELPERS
// ==========================================

function _ineligible(rationale, signals) {
  return {
    eligible: false,
    addOnCpt: null,
    rationale,
    signals,
    modifier25Allowed: false,
    estimatedReimbursementUSD: 0,
    rvu_2026: 0
  };
}

function _hasEstablishedRelationship(patient) {
  if (!patient.created_at) return false;
  const created = new Date(patient.created_at);
  if (isNaN(created.getTime())) return false;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  return created.getTime() <= oneYearAgo;
}

function _hasChronicCondition(problems) {
  return (problems || []).some(p => {
    if (!p || (p.status && p.status !== 'active' && p.status !== 'chronic')) return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return CHRONIC_CONDITION_PREFIXES.some(prefix => code.startsWith(prefix));
  });
}

function _buildRationale(signals) {
  const reasons = [];
  if (signals.establishedRelationship) reasons.push('established patient relationship (>= 1 year)');
  if (signals.hasOngoingChronicCondition) reasons.push('active chronic condition in problem list');
  if (signals.isLongitudinalIntentType) reasons.push(`encounter type '${signals.encounterType}' indicates longitudinal intent`);
  return `G2211 supported by: ${reasons.join('; ')}.`;
}

module.exports = {
  detectG2211Eligibility,
  ELIGIBLE_BASE_CODES,
  ELIGIBLE_OFFICE_OUTPATIENT,
  ELIGIBLE_HOME_RESIDENCE_2026,
  CHRONIC_CONDITION_PREFIXES,
  RVU_2026_G2211,
  ESTIMATED_REIMBURSEMENT_USD
};
