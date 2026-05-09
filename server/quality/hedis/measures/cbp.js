'use strict';

/**
 * HEDIS CBP — Controlling High Blood Pressure.
 *
 * Spec (MY 2026):
 *   Denominator: Adults 18-85 with hypertension (active diagnosis on or before
 *                June 30 of the measurement year)
 *   Numerator (Rate 1):  Most recent BP during measurement year is <140/90 mm Hg
 *   Numerator (Rate 2):  Most recent BP during measurement year is <130/80 mm Hg
 *                        (CMS dual-rate option for MY 2026 — both rates reported)
 *   Exclusions:  ESRD, kidney transplant, pregnancy during measurement year, hospice
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §7.2;
 *            NCQA HEDIS MY 2026 specs.
 */

const MEASURE_ID = 'CBP';
const MIN_AGE = 18;
const MAX_AGE = 85;
const RATE_1_SBP = 140;
const RATE_1_DBP = 90;
const RATE_2_SBP = 130;
const RATE_2_DBP = 80;

const HTN_DX_PREFIXES = ['I10', 'I11', 'I12', 'I13', 'I15', 'I16'];
const ESRD_DX_PREFIXES = ['N18.6'];
const KIDNEY_TRANSPLANT_DX = ['Z94.0'];
const PREGNANCY_DX_PREFIXES = ['O', 'Z34', 'Z3A'];
const HOSPICE_DX = ['Z51.5'];

function ageAsOf(dob, asOfDate) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  return Math.floor((asOfDate.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function hasActiveDiagnosis(problems, prefixes) {
  return (problems || []).some(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return prefixes.some(prefix => code.startsWith(prefix));
  });
}

/**
 * Most-recent BP observation within the measurement year.
 * Expects observations in the shape: { systolic_bp, diastolic_bp, observed_date }
 * (mirrors the EHR vitals row shape).
 */
function mostRecentBP(observations, yearStart, yearEnd) {
  if (!Array.isArray(observations)) return null;
  const valid = observations
    .filter(o => o && typeof o.systolic_bp === 'number' && typeof o.diastolic_bp === 'number')
    .map(o => ({ ...o, _date: new Date(o.observed_date || o.recorded_at || o.created_at) }))
    .filter(o => !isNaN(o._date.getTime()) && o._date >= yearStart && o._date <= yearEnd)
    .sort((a, b) => b._date - a._date);
  return valid[0] || null;
}

/**
 * Evaluate CBP for a patient.
 *
 * @param {object} input
 * @param {object} input.patient - { dob }
 * @param {object[]} input.problems
 * @param {object[]} input.bp_observations - [{ systolic_bp, diastolic_bp, observed_date }]
 * @param {Date|string} [input.measurementYearEnd]
 * @returns {object}
 */
function evaluate(input) {
  const { patient = {}, problems = [], bp_observations = [] } = input || {};
  const measurementYearEnd = input.measurementYearEnd ? new Date(input.measurementYearEnd) : new Date(new Date().getFullYear(), 11, 31);
  const measurementYearStart = new Date(measurementYearEnd.getFullYear(), 0, 1);

  // ---- Denominator gate: age 18-85 as of Dec 31 ----
  const age = ageAsOf(patient.dob, measurementYearEnd);
  if (age === null) return { measure_id: MEASURE_ID, in_denominator: false, reason: 'Missing or invalid DOB.' };
  if (age < MIN_AGE || age > MAX_AGE) {
    return { measure_id: MEASURE_ID, in_denominator: false, reason: `Age ${age} not in 18-85 window.` };
  }

  // ---- Denominator gate: HTN diagnosis ----
  if (!hasActiveDiagnosis(problems, HTN_DX_PREFIXES)) {
    return { measure_id: MEASURE_ID, in_denominator: false, reason: 'No active hypertension diagnosis.' };
  }

  // ---- Exclusions ----
  if (hasActiveDiagnosis(problems, ESRD_DX_PREFIXES)) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: 'ESRD diagnosis.' };
  }
  if (hasActiveDiagnosis(problems, KIDNEY_TRANSPLANT_DX)) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: 'Kidney transplant history.' };
  }
  if (hasActiveDiagnosis(problems, HOSPICE_DX)) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: 'Hospice.' };
  }
  // Pregnancy exclusion only applies to female patients during the year
  if (String(patient.sex || '').toUpperCase().startsWith('F')
      && hasActiveDiagnosis(problems, PREGNANCY_DX_PREFIXES)) {
    return { measure_id: MEASURE_ID, in_denominator: true, status: 'excluded', reason: 'Pregnancy during measurement year.' };
  }

  // ---- Numerator: most recent BP during year ----
  const bp = mostRecentBP(bp_observations, measurementYearStart, measurementYearEnd);
  if (!bp) {
    return {
      measure_id: MEASURE_ID,
      in_denominator: true,
      in_numerator_rate1: false,
      in_numerator_rate2: false,
      status: 'gap',
      reason: 'No BP recorded during measurement year.',
      recommendation: 'Schedule BP measurement; document at next visit.'
    };
  }

  const inRate1 = bp.systolic_bp < RATE_1_SBP && bp.diastolic_bp < RATE_1_DBP;
  const inRate2 = bp.systolic_bp < RATE_2_SBP && bp.diastolic_bp < RATE_2_DBP;

  return {
    measure_id: MEASURE_ID,
    in_denominator: true,
    in_numerator_rate1: inRate1,
    in_numerator_rate2: inRate2,
    status: inRate1 ? 'met_rate1' : 'gap',
    most_recent_bp: { systolic: bp.systolic_bp, diastolic: bp.diastolic_bp, date: bp._date.toISOString().slice(0, 10) },
    rate1_threshold: '<140/90',
    rate2_threshold: '<130/80',
    recommendation: inRate1
      ? (inRate2 ? 'Excellent control — meets both Rate 1 (<140/90) and Rate 2 (<130/80).' : 'Meets Rate 1 (<140/90); consider intensifying for Rate 2 (<130/80).')
      : 'GAP — most recent BP not at goal; intensify antihypertensive therapy or recheck.'
  };
}

module.exports = {
  evaluate,
  mostRecentBP,
  MEASURE_ID,
  MIN_AGE,
  MAX_AGE,
  HTN_DX_PREFIXES,
  ESRD_DX_PREFIXES,
  KIDNEY_TRANSPLANT_DX,
  PREGNANCY_DX_PREFIXES,
  HOSPICE_DX
};
