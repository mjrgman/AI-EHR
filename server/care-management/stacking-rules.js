'use strict';

/**
 * Care management stacking rules — CY 2025-2026.
 *
 * Per CMS guidance + AAFP confirmations:
 *   - CCM (99490, 99491) cannot be billed during a TCM service period (99495, 99496) for the same patient
 *   - CCM and PCM cannot both be billed for the same patient in the same calendar month
 *   - BHI (99484) and CoCM (99492-99494) cannot be billed concurrently for the same patient
 *   - APCM (G0556-G0558) replaces CCM/PCM/BHI/RPM for enrolled patients — cannot stack
 *   - RPM and RTM cannot both be billed for the same patient in the same month
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §4.8.
 */

const { CCM_CODES, PCM_CODES, TCM_CODES, BHI_CODES, RPM_CODES, RTM_CODES, APCM_CODES } = require('./codes');

const CCM_CPTS = new Set(Object.keys(CCM_CODES));
const PCM_CPTS = new Set(Object.keys(PCM_CODES));
const TCM_CPTS = new Set(Object.keys(TCM_CODES));
const BHI_GENERAL_CPTS = new Set(['99484']);
const COCM_CPTS = new Set(['99492', '99493', '99494']);
const RPM_CPTS = new Set(Object.keys(RPM_CODES));
const RTM_CPTS = new Set(Object.keys(RTM_CODES));
const APCM_CPTS = new Set(Object.keys(APCM_CODES));

// Conflict matrix: when key family is requested, the value sets cannot also be billed.
const CONFLICTS = {
  CCM: ['TCM', 'PCM', 'APCM'],          // CCM↔TCM (during TCM 30d period); CCM↔PCM (same month); CCM↔APCM (replaced)
  PCM: ['CCM', 'APCM'],                  // PCM↔CCM (same month); PCM↔APCM (replaced)
  TCM: ['CCM', 'PCM'],                   // TCM↔CCM/PCM during 30-day TCM period
  BHI_GENERAL: ['CoCM', 'APCM'],         // 99484 vs 99492-99494; APCM replaces
  CoCM: ['BHI_GENERAL', 'APCM'],
  RPM: ['RTM'],                          // RPM↔RTM (same month)
  RTM: ['RPM'],
  APCM: ['CCM', 'PCM', 'BHI_GENERAL', 'CoCM', 'RPM', 'RTM']  // APCM replaces all
};

const FAMILY_CPT_SETS = {
  CCM: CCM_CPTS,
  PCM: PCM_CPTS,
  TCM: TCM_CPTS,
  BHI_GENERAL: BHI_GENERAL_CPTS,
  CoCM: COCM_CPTS,
  RPM: RPM_CPTS,
  RTM: RTM_CPTS,
  APCM: APCM_CPTS
};

/**
 * Identify the conflict-family of a CPT.
 */
function familyOf(cpt) {
  for (const [family, set] of Object.entries(FAMILY_CPT_SETS)) {
    if (set.has(String(cpt))) return family;
  }
  return null;
}

/**
 * Check whether a proposed code conflicts with the active billing set.
 *
 * @param {string} proposedCpt
 * @param {string[]} activeCpts - CPTs currently billed for this patient/month
 * @param {object} options
 * @param {boolean} [options.tcmActiveServicePeriod] - true if patient is inside a TCM 30-day period
 * @returns {{ allowed: boolean, conflicts: object[], rationale: string }}
 */
function checkConflict(proposedCpt, activeCpts = [], options = {}) {
  const family = familyOf(proposedCpt);
  if (!family) {
    return {
      allowed: true,
      conflicts: [],
      rationale: `CPT ${proposedCpt} is not in the care-management code set; no conflict check applies.`
    };
  }

  const blockingFamilies = CONFLICTS[family] || [];
  const conflicts = [];

  for (const activeCpt of activeCpts) {
    const activeFamily = familyOf(activeCpt);
    if (!activeFamily) continue;
    if (blockingFamilies.includes(activeFamily)) {
      conflicts.push({
        proposedCpt,
        proposedFamily: family,
        conflictingCpt: activeCpt,
        conflictingFamily: activeFamily,
        reason: _conflictReason(family, activeFamily)
      });
    }
  }

  // Special case: TCM service-period rule blocks CCM even when TCM CPT not yet billed
  if (family === 'CCM' && options.tcmActiveServicePeriod) {
    conflicts.push({
      proposedCpt,
      proposedFamily: 'CCM',
      conflictingFamily: 'TCM',
      reason: 'Patient is inside an active 30-day TCM service period; CCM cannot be billed during that window.'
    });
  }

  if (conflicts.length === 0) {
    return {
      allowed: true,
      conflicts: [],
      rationale: `CPT ${proposedCpt} (${family}) is allowed — no conflicts with active billing set.`
    };
  }

  return {
    allowed: false,
    conflicts,
    rationale: `CPT ${proposedCpt} (${family}) blocked by ${conflicts.length} conflict(s): ${conflicts.map(c => c.reason).join('; ')}`
  };
}

function _conflictReason(family, activeFamily) {
  if (family === 'CCM' && activeFamily === 'TCM') return 'CCM cannot overlap a TCM service period';
  if (family === 'CCM' && activeFamily === 'PCM') return 'CCM and PCM cannot both be billed in the same calendar month';
  if (family === 'PCM' && activeFamily === 'CCM') return 'PCM and CCM cannot both be billed in the same calendar month';
  if (family === 'TCM' && (activeFamily === 'CCM' || activeFamily === 'PCM')) return `TCM blocks ${activeFamily} during its 30-day service period`;
  if (family === 'BHI_GENERAL' && activeFamily === 'CoCM') return 'BHI 99484 cannot be billed concurrent with CoCM 99492-99494';
  if (family === 'CoCM' && activeFamily === 'BHI_GENERAL') return 'CoCM cannot be billed concurrent with BHI 99484';
  if (family === 'RPM' && activeFamily === 'RTM') return 'RPM and RTM cannot both be billed for the same patient in the same month';
  if (family === 'RTM' && activeFamily === 'RPM') return 'RTM and RPM cannot both be billed for the same patient in the same month';
  if (family === 'APCM' || activeFamily === 'APCM') return 'APCM enrollment replaces CCM/PCM/BHI/RPM/RTM for the patient';
  return `${family} conflicts with ${activeFamily}`;
}

module.exports = {
  familyOf,
  checkConflict,
  CONFLICTS,
  FAMILY_CPT_SETS
};
