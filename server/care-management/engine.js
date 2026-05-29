'use strict';

/**
 * Care management engine — monthly billable code computation.
 *
 * Given a patient's enrollment state + time log + active billing set,
 * returns the set of billable CPTs for the month with supporting evidence.
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §4.
 *            Implementation plan: docs/research/PRIMARY_CARE_IMPLEMENTATION_PLAN_2026-05-03.md §4.
 */

const codes = require('./codes');
const stacking = require('./stacking-rules');
const eligibility = require('./eligibility');
const { determineAPCMLevel } = require('../coding/apcm');

/**
 * Sum minutes from a time-log array, optionally filtered by performer role.
 *
 * @param {object[]} timeLog - [{ minutes, staff_role, ... }, ...]
 * @param {string|null} role - 'physician_or_qhp' | 'clinical_staff' | null (all)
 * @returns {number} total minutes
 */
function sumMinutes(timeLog, role = null) {
  return (timeLog || []).reduce((sum, entry) => {
    if (!entry || typeof entry.minutes !== 'number') return sum;
    if (role === 'physician_or_qhp') {
      if (!['physician', 'np', 'pa'].includes(entry.staff_role)) return sum;
    } else if (role === 'clinical_staff') {
      if (!['rn', 'ma', 'sw', 'lcsw'].includes(entry.staff_role)) return sum;
    }
    return sum + entry.minutes;
  }, 0);
}

/**
 * Compute CCM billable codes for a month given staff/physician minutes and MDM.
 */
function computeCCMCodes(staffMinutes, physicianMinutes, mdmComplexity) {
  const result = [];

  // Complex CCM (99487) requires moderate-or-high MDM AND ≥60 min staff time
  if (staffMinutes >= 60 && (mdmComplexity === 'moderate' || mdmComplexity === 'high')) {
    result.push({ cpt: '99487', units: 1, supporting_minutes: 60 });
    const additional = staffMinutes - 60;
    if (additional > 0) {
      const addOnUnits = Math.floor(additional / 30);
      if (addOnUnits > 0) result.push({ cpt: '99489', units: addOnUnits, supporting_minutes: addOnUnits * 30 });
    }
  } else if (staffMinutes >= 20) {
    // Non-complex CCM
    result.push({ cpt: '99490', units: 1, supporting_minutes: 20 });
    const additional = staffMinutes - 20;
    if (additional > 0) {
      const addOnUnits = Math.min(2, Math.floor(additional / 20));  // cap of 2 add-on units
      if (addOnUnits > 0) result.push({ cpt: '99439', units: addOnUnits, supporting_minutes: addOnUnits * 20 });
    }
  }

  // Physician-personal CCM
  if (physicianMinutes >= 30) {
    result.push({ cpt: '99491', units: 1, supporting_minutes: 30 });
    const additional = physicianMinutes - 30;
    if (additional > 0) {
      const addOnUnits = Math.floor(additional / 30);
      if (addOnUnits > 0) result.push({ cpt: '99437', units: addOnUnits, supporting_minutes: addOnUnits * 30 });
    }
  }

  return result;
}

/**
 * Main entry point: compute the billable codes for a patient for a month.
 *
 * @param {object} input
 * @param {object} input.patient - { id, dob, sex, insurance, ... }
 * @param {object[]} input.problems
 * @param {object} input.enrollment - { program_type, consent, mdm_complexity }
 * @param {object[]} input.timeLog - [{ minutes, staff_role, service_date, activity_summary }]
 * @param {string[]} input.activeBillingCpts - already-billed care-management CPTs this month
 * @param {object} [input.recentDischarge] - { discharge_date }
 * @param {object} [input.tcmContext] - { faceToFaceCompletedDate, mdmComplexity, interactiveContactCompletedDate }
 * @param {object} [input.apcmOptions] - { qppPathway, highComplexity }
 * @returns {{ programType: string, codes: object[], suppressed: object[], rationale: string[] }}
 */
function computeMonthlyBillableCodes(input) {
  const {
    patient = {}, problems = [], enrollment = {}, timeLog = [],
    activeBillingCpts = [], recentDischarge = null, tcmContext = null,
    apcmOptions = null
  } = input || {};

  const programType = enrollment.program_type;
  const result = {
    programType,
    codes: [],
    suppressed: [],
    rationale: []
  };

  if (!programType) {
    result.rationale.push('No enrollment program_type provided; cannot compute codes.');
    return result;
  }

  // ---- APCM short-circuits everything ----
  if (programType === 'APCM') {
    if (!apcmOptions) {
      result.rationale.push('APCM requested but apcmOptions (qppPathway) not provided.');
      return result;
    }
    const apcm = determineAPCMLevel(patient, problems, {
      qppPathway: apcmOptions.qppPathway,
      activeBillingCodes: activeBillingCpts,
      highComplexity: apcmOptions.highComplexity
    });
    if (!apcm.eligible) {
      result.rationale.push(`APCM not eligible: ${apcm.reason}`);
      return result;
    }
    result.codes.push({ cpt: apcm.cpt, units: 1, basis: apcm.basis });
    result.rationale.push(`APCM ${apcm.cpt} eligible (${apcm.basis}). Suppresses concurrent CCM/PCM/BHI/RPM/RTM.`);
    return result;
  }

  // ---- CCM ----
  if (programType === 'CCM') {
    const elig = eligibility.checkCCMEligibility(patient, problems, enrollment.consent);
    if (!elig.eligible) {
      result.rationale.push(`CCM not eligible: ${elig.reason}`);
      return result;
    }
    const staffMin = sumMinutes(timeLog, 'clinical_staff');
    const docMin = sumMinutes(timeLog, 'physician_or_qhp');
    const rawProposed = computeCCMCodes(staffMin, docMin, enrollment.mdm_complexity);

    // Intra-CCM mutual exclusion: 99490/99487 (staff time) and 99491 (physician
    // time) cannot both be billed for the same patient-month. Collapse to the
    // single highest-value compliant base path before inter-family checks.
    const collapse = stacking.selectSingleCCMPath(rawProposed);
    const proposed = collapse.selected;
    if (collapse.rationale) {
      result.rationale.push(collapse.rationale);
      for (const d of collapse.dropped) {
        result.suppressed.push({ ...d, reason: collapse.rationale, conflicts: [] });
      }
    }

    for (const p of proposed) {
      const conflict = stacking.checkConflict(p.cpt, activeBillingCpts, {
        tcmActiveServicePeriod: !!recentDischarge && _isInTCMPeriod(recentDischarge)
      });
      if (conflict.allowed) {
        result.codes.push(p);
      } else {
        result.suppressed.push({ ...p, reason: conflict.rationale, conflicts: conflict.conflicts });
      }
    }
    result.rationale.push(`CCM eligible (${elig.basis}). Staff ${staffMin}m / physician ${docMin}m.`);
    return result;
  }

  // ---- TCM ----
  if (programType === 'TCM') {
    const elig = eligibility.checkTCMEligibility(patient, recentDischarge);
    if (!elig.eligible) {
      result.rationale.push(`TCM not eligible: ${elig.reason}`);
      return result;
    }
    if (!tcmContext || !tcmContext.faceToFaceCompletedDate) {
      result.rationale.push('TCM requires face-to-face within window; not yet completed.');
      return result;
    }
    const dischargeDate = new Date(recentDischarge.discharge_date);
    const f2fDate = new Date(tcmContext.faceToFaceCompletedDate);
    const f2fDays = Math.floor((f2fDate - dischargeDate) / (24 * 60 * 60 * 1000));
    let cpt;
    if (tcmContext.mdmComplexity === 'high' && f2fDays <= 7) {
      cpt = '99496';
    } else if (f2fDays <= 14 && (tcmContext.mdmComplexity === 'moderate' || tcmContext.mdmComplexity === 'high')) {
      cpt = '99495';
    } else {
      result.rationale.push(`TCM face-to-face was ${f2fDays} days post-discharge with ${tcmContext.mdmComplexity} MDM — does not satisfy 99495 (≤14d moderate) or 99496 (≤7d high).`);
      return result;
    }
    result.codes.push({ cpt, units: 1, supporting_face_to_face_days: f2fDays });
    result.rationale.push(`TCM ${cpt} eligible (${elig.basis}, MDM ${tcmContext.mdmComplexity}, F2F day ${f2fDays}).`);
    return result;
  }

  // ---- BHI ----
  if (programType === 'BHI') {
    const elig = eligibility.checkBHIEligibility(patient, problems, enrollment.consent);
    if (!elig.eligible) {
      result.rationale.push(`BHI not eligible: ${elig.reason}`);
      return result;
    }
    const staffMin = sumMinutes(timeLog, 'clinical_staff');
    if (staffMin >= 20) {
      const conflict = stacking.checkConflict('99484', activeBillingCpts);
      if (conflict.allowed) {
        result.codes.push({ cpt: '99484', units: 1, supporting_minutes: 20 });
      } else {
        result.suppressed.push({ cpt: '99484', units: 1, reason: conflict.rationale });
      }
    } else {
      result.rationale.push(`BHI 99484 requires ≥20 min/month; ${staffMin}m logged.`);
    }
    return result;
  }

  // ---- RPM ----
  if (programType === 'RPM') {
    const elig = eligibility.checkRPMEligibility(patient, problems, enrollment.consent, enrollment.deviceData);
    if (!elig.eligible) {
      result.rationale.push(`RPM not eligible: ${elig.reason}`);
      return result;
    }
    // 99454 (device supply) — if ≥16 days of data
    result.codes.push({ cpt: '99454', units: 1, supporting_days: enrollment.deviceData.daysOfData });
    // 99457 (treatment management) — if ≥20 min
    const totalMin = sumMinutes(timeLog);
    if (totalMin >= 20) {
      result.codes.push({ cpt: '99457', units: 1, supporting_minutes: 20 });
      const addOnUnits = Math.floor((totalMin - 20) / 20);
      if (addOnUnits > 0) result.codes.push({ cpt: '99458', units: addOnUnits, supporting_minutes: addOnUnits * 20 });
    }
    return result;
  }

  result.rationale.push(`Program type '${programType}' not yet implemented in engine.`);
  return result;
}

function _isInTCMPeriod(recentDischarge) {
  if (!recentDischarge || !recentDischarge.discharge_date) return false;
  const days = Math.floor((Date.now() - new Date(recentDischarge.discharge_date)) / (24 * 60 * 60 * 1000));
  return days >= 0 && days <= 30;
}

module.exports = {
  computeMonthlyBillableCodes,
  computeCCMCodes,
  sumMinutes
};
