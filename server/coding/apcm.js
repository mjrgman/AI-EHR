'use strict';

/**
 * APCM (Advanced Primary Care Management) — eligibility matcher.
 *
 * Phase 7 of the primary-care deepening plan. APCM is a CMS CY 2025+ code
 * family that bundles many existing care-management capabilities. See
 * docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §3.4.
 *
 * Three levels:
 *   G0556 — Level 1: ≤1 chronic condition
 *   G0557 — Level 2: ≥2 chronic conditions
 *   G0558 — Level 3: dual-eligible OR ≥2 chronic conditions with high complexity
 *
 * Stacking restrictions (CMS): APCM cannot be billed concurrently with CCM
 * (99490, 99491), Complex CCM (99487, 99489), PCM (99424-99427), or BHI (99484).
 *
 * QPP requirement: to bill APCM, the practice must EITHER report the Value in
 * Primary Care MVP OR participate in MSSP / REACH ACO. Caller passes the
 * `qppPathway` to confirm one of these.
 *
 * QID 487 note: CMS retired Quality ID 487 (Screening for Social Drivers of
 * Health) from the 2026 MIPS quality measure set; replaced by Improvement
 * Activity / MVP-level requirement. Not a measure to remove from this codebase
 * (was never added) — flagged for documentation completeness.
 */

const CCM_CONFLICT_CPTS = new Set(['99490', '99439', '99491', '99437', '99487', '99489']);
const PCM_CONFLICT_CPTS = new Set(['99424', '99425', '99426', '99427']);
const BHI_CONFLICT_CPTS = new Set(['99484', '99492', '99493', '99494']);
const ALL_CONFLICTS = new Set([...CCM_CONFLICT_CPTS, ...PCM_CONFLICT_CPTS, ...BHI_CONFLICT_CPTS]);

const VALID_QPP_PATHWAYS = new Set([
  'value_in_primary_care_mvp',
  'mssp',
  'reach_aco'
]);

// Chronic-condition prefix list (mirrors g2211.js conservative subset).
const CHRONIC_CONDITION_PREFIXES = [
  'E10', 'E11', 'I10', 'I11', 'I12', 'I25', 'I48', 'I50', 'I69', 'I70',
  'J44', 'J45', 'N18', 'F32', 'F33', 'F41', 'E66', 'E78', 'M05', 'M06',
  'G20', 'G35', 'C', 'K70', 'K72', 'K74', 'B20'
];

function countChronicConditions(problems) {
  return (problems || []).filter(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return CHRONIC_CONDITION_PREFIXES.some(prefix => code.startsWith(prefix));
  }).length;
}

function hasActiveConflict(activeBillingCodes) {
  return (activeBillingCodes || []).some(cpt => ALL_CONFLICTS.has(String(cpt)));
}

/**
 * Determine the patient's APCM level based on chronic-condition count + dual-eligibility flag.
 *
 * Returns null if the patient does not qualify or QPP requirements are not met.
 *
 * @param {object} patient - { id, insurance: { medicare: bool, medicaid: bool } }
 * @param {object[]} problems
 * @param {object} options
 * @param {string} [options.qppPathway] - one of VALID_QPP_PATHWAYS
 * @param {string[]} [options.activeBillingCodes] - currently-billed care-management CPTs (for conflict detection)
 * @param {boolean} [options.highComplexity] - QHP-determined high complexity flag
 * @returns {{level: number, cpt: string, basis: string, warnings: string[]} | {eligible: false, reason: string}}
 */
function determineAPCMLevel(patient, problems, options = {}) {
  // QPP pathway gate (CMS requirement to bill APCM)
  const qppPathway = options.qppPathway;
  if (!VALID_QPP_PATHWAYS.has(qppPathway)) {
    return {
      eligible: false,
      reason: 'APCM billing requires reporting Value in Primary Care MVP, or participating in MSSP, or REACH ACO.',
      missingPrerequisite: 'qpp_pathway'
    };
  }

  // Conflict gate
  if (hasActiveConflict(options.activeBillingCodes)) {
    return {
      eligible: false,
      reason: 'APCM cannot be billed concurrent with CCM (99490/99491), PCM (99424-99427), or BHI (99484/CoCM).',
      conflictingCodes: (options.activeBillingCodes || []).filter(c => ALL_CONFLICTS.has(String(c)))
    };
  }

  // Insurance + chronic-count → level
  const insurance = patient.insurance || {};
  const dualEligible = !!(insurance.medicare && insurance.medicaid);
  const chronicCount = countChronicConditions(problems);

  let level;
  let cpt;
  let basis;
  const warnings = [];

  if (dualEligible || (chronicCount >= 2 && options.highComplexity)) {
    level = 3;
    cpt = 'G0558';
    basis = dualEligible
      ? 'Dual-eligible (Medicare + Medicaid) → APCM Level 3'
      : `${chronicCount} chronic conditions + QHP-determined high complexity → APCM Level 3`;
  } else if (chronicCount >= 2) {
    level = 2;
    cpt = 'G0557';
    basis = `${chronicCount} chronic conditions → APCM Level 2`;
  } else if (chronicCount <= 1) {
    level = 1;
    cpt = 'G0556';
    basis = `${chronicCount} chronic condition(s) → APCM Level 1`;
  } else {
    return { eligible: false, reason: 'No qualifying chronic conditions documented.' };
  }

  if (chronicCount === 0) {
    warnings.push('Zero chronic conditions on file — verify the patient meets the practice\'s APCM enrollment criteria before billing.');
  }

  return {
    eligible: true,
    level,
    cpt,
    basis,
    chronicConditionCount: chronicCount,
    dualEligible,
    qppPathway,
    warnings
  };
}

module.exports = {
  determineAPCMLevel,
  countChronicConditions,
  hasActiveConflict,
  CCM_CONFLICT_CPTS,
  PCM_CONFLICT_CPTS,
  BHI_CONFLICT_CPTS,
  ALL_CONFLICTS,
  VALID_QPP_PATHWAYS,
  CHRONIC_CONDITION_PREFIXES
};
