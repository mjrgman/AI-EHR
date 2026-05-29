'use strict';

/**
 * HEDIS BCS-E — Breast Cancer Screening (ECDS reporting).
 *
 * Spec (MY 2026):
 *   Denominator: Women 50-74 years old as of December 31 of the measurement year
 *                continuously enrolled (we approximate by patient existence in the system)
 *   Numerator:   At least one mammogram (CPT/HCPCS in the value set) any time on or
 *                between October 1 two years prior to the measurement year and
 *                December 31 of the measurement year (i.e., a 27-month look-back window).
 *   Exclusions:  Bilateral mastectomy or two unilateral mastectomies; hospice; advanced
 *                illness with frailty (we implement the bilateral mastectomy + hospice
 *                exclusions; advanced illness/frailty deferred).
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §7.2;
 *            NCQA HEDIS MY 2026 specs.
 */

const { ageAsOf } = require('../../../utils/date-helpers');

const MEASURE_ID = 'BCS-E';
const MIN_AGE = 50;
const MAX_AGE = 74;
const LOOKBACK_MONTHS = 27;

// CPT/HCPCS codes that satisfy the BCS-E numerator
const MAMMOGRAM_CODES = new Set([
  '77065', '77066', '77067',  // Diagnostic + screening mammography
  '77063',                     // Screening digital breast tomosynthesis
  'G0202'                      // Screening mammography, bilateral
]);

// Exclusion: bilateral mastectomy ICD-10 / SNOMED proxies
const BILATERAL_MASTECTOMY_DX = ['Z90.13'];          // Acquired absence of bilateral breasts
const UNILATERAL_MASTECTOMY_DX = ['Z90.11', 'Z90.12']; // Acquired absence of right/left breast
const MASTECTOMY_PROCEDURE_CODES = new Set([
  '19303', '19304', '19305', '19306', '19307'  // Mastectomy CPT codes
]);

// Hospice
const HOSPICE_DX = ['Z51.5'];

function isMastectomy(problems, procedures) {
  const hasBilateralDx = (problems || []).some(p => BILATERAL_MASTECTOMY_DX.includes(String(p.icd10_code || '').toUpperCase()));
  if (hasBilateralDx) return { excluded: true, reason: 'Bilateral mastectomy diagnosis (Z90.13).' };

  // Two unilateral mastectomies (different sides)
  const unilateralDx = (problems || []).filter(p => UNILATERAL_MASTECTOMY_DX.includes(String(p.icd10_code || '').toUpperCase()));
  if (unilateralDx.length >= 2) {
    const sides = new Set(unilateralDx.map(p => p.icd10_code));
    if (sides.size >= 2) return { excluded: true, reason: 'Two unilateral mastectomies (right + left).' };
  }

  // Mastectomy procedures (defensive: skip null/undefined entries)
  const mastectomyProc = (procedures || []).filter(p => p && MASTECTOMY_PROCEDURE_CODES.has(String(p.cpt_code)));
  if (mastectomyProc.length >= 2) {
    return { excluded: true, reason: `${mastectomyProc.length} mastectomy procedures documented.` };
  }

  return { excluded: false };
}

function isHospice(problems) {
  return (problems || []).some(p => HOSPICE_DX.includes(String(p.icd10_code || '').toUpperCase()));
}

/**
 * Evaluate BCS-E for a patient.
 *
 * @param {object} input
 * @param {object} input.patient - { dob, sex }
 * @param {object[]} input.problems
 * @param {object[]} input.procedures - [{ cpt_code, performed_date }]
 * @param {Date|string} [input.measurementYearEnd] - Default = December 31 of current year
 * @returns {object}
 */
function evaluate(input) {
  const { patient = {}, problems = [], procedures = [] } = input || {};
  const measurementYearEnd = input.measurementYearEnd ? new Date(input.measurementYearEnd) : new Date(new Date().getFullYear(), 11, 31);

  // ---- Denominator gate 1: sex ----
  const sex = String(patient.sex || '').toUpperCase().charAt(0);
  if (sex !== 'F') {
    return { measure_id: MEASURE_ID, in_denominator: false, reason: 'Patient is not female.' };
  }

  // ---- Denominator gate 2: age 50-74 as of Dec 31 of measurement year ----
  const age = ageAsOf(patient.dob, measurementYearEnd);
  if (age === null) {
    return { measure_id: MEASURE_ID, in_denominator: false, reason: 'Missing or invalid DOB.' };
  }
  if (age < MIN_AGE || age > MAX_AGE) {
    return { measure_id: MEASURE_ID, in_denominator: false, reason: `Age ${age} not in 50-74 window.` };
  }

  // ---- Exclusions ----
  const mastectomy = isMastectomy(problems, procedures);
  if (mastectomy.excluded) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: mastectomy.reason };
  }
  if (isHospice(problems)) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: 'Hospice (Z51.5).' };
  }

  // ---- Numerator: mammogram in 27-month lookback ----
  const lookbackStart = new Date(measurementYearEnd);
  lookbackStart.setMonth(lookbackStart.getMonth() - LOOKBACK_MONTHS);
  const matchingProcedures = (procedures || []).filter(p => {
    if (!p) return false;  // defensive: skip null/undefined entries
    if (!MAMMOGRAM_CODES.has(String(p.cpt_code))) return false;
    const d = new Date(p.performed_date);
    if (isNaN(d.getTime())) return false;
    return d >= lookbackStart && d <= measurementYearEnd;
  });

  const inNumerator = matchingProcedures.length > 0;

  return {
    measure_id: MEASURE_ID,
    in_denominator: true,
    in_numerator: inNumerator,
    status: inNumerator ? 'met' : 'gap',
    age,
    measurement_year_end: measurementYearEnd.toISOString().slice(0, 10),
    lookback_start: lookbackStart.toISOString().slice(0, 10),
    matching_procedures: matchingProcedures.map(p => ({
      cpt_code: p.cpt_code,
      performed_date: p.performed_date
    })),
    recommendation: inNumerator
      ? `Up-to-date — last mammogram ${matchingProcedures[0].performed_date}.`
      : 'GAP — schedule screening mammography (CPT 77067).'
  };
}

module.exports = {
  evaluate,
  MEASURE_ID,
  MIN_AGE,
  MAX_AGE,
  LOOKBACK_MONTHS,
  MAMMOGRAM_CODES,
  BILATERAL_MASTECTOMY_DX,
  UNILATERAL_MASTECTOMY_DX,
  MASTECTOMY_PROCEDURE_CODES,
  HOSPICE_DX
};
