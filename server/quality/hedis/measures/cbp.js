'use strict';

/**
 * HEDIS CBP — Controlling High Blood Pressure.
 *
 * Spec (MY 2026):
 *   Denominator: Adults 18-85 with hypertension. NCQA requires the hypertension
 *                diagnosis to be (a) confirmed by a qualifying ENCOUNTER/event
 *                (outpatient / telephone / e-visit / virtual check-in, etc.) and
 *                (b) present on or before June 30 of the measurement year ("event/
 *                diagnosis prior to June 30" timing gate).
 *   Numerator (Rate 1):  Most recent BP during measurement year is <140/90 mm Hg
 *   Numerator (Rate 2):  Most recent BP during measurement year is <130/80 mm Hg
 *                        (CMS dual-rate option for MY 2026 — both rates reported)
 *   Exclusions:  ESRD, kidney transplant, pregnancy during measurement year, hospice
 *
 * ============================================================================
 * !! NOT NCQA-CERTIFIED !! — This is an ILLUSTRATIVE / point-of-care gap finder.
 * It is NOT a certified HEDIS engine and its output MUST NOT be used as a
 * reportable HEDIS rate. The denominator implements the timing/event gates
 * below on a best-effort basis from the data supplied; it does not implement
 * NCQA continuous-enrollment, allowable-gap, medication-event, or the full
 * value-set logic, and it does not undergo NCQA measure certification. Every
 * result carries `certified: false` and a `disclaimer`. See `CERTIFICATION`.
 * Fail-conservative posture: when timing/event evidence is absent the patient is
 * marked `denominator_uncertain` (NOT counted as a clean compliant denominator
 * member) so the tool never over-states a controlled rate.
 * ============================================================================
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §7.2;
 *            NCQA HEDIS MY 2026 specs.
 */

const { ageAsOf } = require('../../../utils/date-helpers');

const MEASURE_ID = 'CBP';
const CERTIFIED = false;
const DISCLAIMER =
  'Illustrative gap finder — NOT NCQA-certified. Do not use as a reportable HEDIS rate; '
  + 'verify denominator/numerator against the certified measure before reporting.';
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

// Encounter/visit types that satisfy the CBP "qualifying event" requirement.
// (Outpatient, telehealth, telephone, e-visit, virtual check-in, and the
// generic office-visit aliases the EHR emits.) Matched case-insensitively as a
// substring so 'office_visit', 'Office Visit', 'telehealth-followup' all pass.
const QUALIFYING_ENCOUNTER_TOKENS = [
  'outpatient', 'office', 'visit', 'telehealth', 'telephone',
  'e-visit', 'evisit', 'virtual', 'encounter', 'wellness', 'preventive'
];

function hasActiveDiagnosis(problems, prefixes) {
  return (problems || []).some(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return prefixes.some(prefix => code.startsWith(prefix));
  });
}

/**
 * Best-effort onset/recorded date for a problem row. The EHR may carry the HTN
 * onset under several column names; we accept any of them. Returns a valid Date
 * or null when no parseable date is present.
 */
function problemDate(p) {
  const raw = p && (p.onset_date || p.diagnosed_date || p.recorded_date
    || p.diagnosis_date || p.created_at || p.date);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * CBP timing gate: is there an active HTN diagnosis whose recorded/onset date is
 * on or before June 30 of the measurement year?
 *
 * Returns one of: 'met' (a dated HTN dx ≤ June 30), 'too_late' (every dated HTN
 * dx is after June 30), or 'undated' (HTN dx present but no parseable date — we
 * cannot confirm the gate). Callers treat 'undated' as fail-conservative
 * (uncertain), NOT as a clean denominator member.
 */
function htnDiagnosisTiming(problems, measurementYearEnd) {
  const june30 = new Date(measurementYearEnd.getFullYear(), 5, 30, 23, 59, 59, 999); // month 5 = June
  let sawDated = false;
  let sawUndated = false;
  for (const p of (problems || [])) {
    if (!p) continue;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') continue;
    const code = String(p.icd10_code || '').toUpperCase();
    if (!HTN_DX_PREFIXES.some(prefix => code.startsWith(prefix))) continue;
    const d = problemDate(p);
    if (d === null) { sawUndated = true; continue; }
    sawDated = true;
    if (d <= june30) return 'met';
  }
  if (sawUndated) return 'undated';
  if (sawDated) return 'too_late';
  return 'too_late'; // no HTN dx at all — caller already gated on presence
}

/**
 * CBP event/visit gate: did the patient have at least one qualifying encounter
 * during the measurement year? Accepts an `encounters` array (each row may carry
 * `type`/`encounter_type`/`visit_type`/`class` and a date), or a boolean/`count`
 * shortcut. Returns 'met', 'none' (encounters supplied but none qualify), or
 * 'unknown' (no encounter data supplied at all — caller fails conservative).
 */
function hasQualifyingEvent(input, yearStart, yearEnd) {
  // Explicit boolean override (e.g., upstream already confirmed eligibility).
  if (input.has_qualifying_event === true) return 'met';
  if (input.has_qualifying_event === false) return 'none';

  const encounters = input.encounters;
  if (!Array.isArray(encounters)) return 'unknown';
  if (encounters.length === 0) return 'none';

  let sawDated = false;
  let datedQualifying = false;
  let undatedQualifying = false;

  for (const e of encounters) {
    if (!e) continue;
    const typeStr = String(
      e.type || e.encounter_type || e.visit_type || e.class || e.kind || ''
    ).toLowerCase();
    const qualifies = typeStr === ''
      ? true // untyped encounter — treat presence as a visit (conservative-inclusive for denominator)
      : QUALIFYING_ENCOUNTER_TOKENS.some(tok => typeStr.includes(tok));
    if (!qualifies) continue;

    const raw = e.date || e.encounter_date || e.visit_date || e.start || e.created_at;
    if (!raw) { undatedQualifying = true; continue; }
    const d = new Date(raw);
    if (isNaN(d.getTime())) { undatedQualifying = true; continue; }
    sawDated = true;
    if (d >= yearStart && d <= yearEnd) datedQualifying = true;
  }

  if (datedQualifying) return 'met';
  // Qualifying encounter present but undated → can't confirm it's in-year; treat
  // as met only on a best-effort basis (a visit happened, year unknown).
  if (undatedQualifying && !sawDated) return 'met';
  return 'none';
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

  // Every CBP result carries the non-certified flag + disclaimer so it can
  // never be mistaken for a reportable HEDIS rate.
  const base = () => ({ measure_id: MEASURE_ID, certified: CERTIFIED, disclaimer: DISCLAIMER });

  // ---- Denominator gate: age 18-85 as of Dec 31 ----
  const age = ageAsOf(patient.dob, measurementYearEnd);
  if (age === null) return { ...base(), in_denominator: false, reason: 'Missing or invalid DOB.' };
  if (age < MIN_AGE || age > MAX_AGE) {
    return { ...base(), in_denominator: false, reason: `Age ${age} not in 18-85 window.` };
  }

  // ---- Denominator gate: HTN diagnosis present ----
  if (!hasActiveDiagnosis(problems, HTN_DX_PREFIXES)) {
    return { ...base(), in_denominator: false, reason: 'No active hypertension diagnosis.' };
  }

  // ---- Denominator gate: HTN diagnosis timing (on/before June 30) ----
  // NCQA requires the HTN diagnosis/event prior to June 30 of the measurement
  // year. A dated HTN dx that is entirely after June 30 falls OUT of the
  // denominator. An undated dx cannot be confirmed → fail-conservative
  // (denominator_uncertain): we keep the patient as a gap candidate but flag the
  // unconfirmed timing so the rate is never overstated.
  const timing = htnDiagnosisTiming(problems, measurementYearEnd);
  if (timing === 'too_late') {
    return {
      ...base(),
      in_denominator: false,
      reason: 'Hypertension diagnosis not established on or before June 30 of the measurement year.'
    };
  }

  // ---- Denominator gate: qualifying event/visit during the measurement year ----
  const event = hasQualifyingEvent(input, measurementYearStart, measurementYearEnd);
  if (event === 'none') {
    return {
      ...base(),
      in_denominator: false,
      reason: 'No qualifying encounter/visit during the measurement year (CBP event requirement not met).'
    };
  }

  // Track uncertainty from gates we could not positively confirm from the data.
  const gateUncertainties = [];
  if (timing === 'undated') gateUncertainties.push('htn_diagnosis_date_unknown');
  if (event === 'unknown') gateUncertainties.push('qualifying_event_unverified');
  const denominatorUncertain = gateUncertainties.length > 0;

  // ---- Exclusions ----
  if (hasActiveDiagnosis(problems, ESRD_DX_PREFIXES)) {
    return { ...base(), in_denominator: true, status: 'excluded', reason: 'ESRD diagnosis.' };
  }
  if (hasActiveDiagnosis(problems, KIDNEY_TRANSPLANT_DX)) {
    return { ...base(), in_denominator: true, status: 'excluded', reason: 'Kidney transplant history.' };
  }
  if (hasActiveDiagnosis(problems, HOSPICE_DX)) {
    return { ...base(), in_denominator: true, status: 'excluded', reason: 'Hospice.' };
  }
  // Pregnancy exclusion only applies to female patients during the year
  if (String(patient.sex || '').toUpperCase().startsWith('F')
      && hasActiveDiagnosis(problems, PREGNANCY_DX_PREFIXES)) {
    return { ...base(), in_denominator: true, status: 'excluded', reason: 'Pregnancy during measurement year.' };
  }

  // Denominator-gate metadata attached to every in-denominator result.
  const denominatorMeta = {
    in_denominator: true,
    denominator_uncertain: denominatorUncertain,
    denominator_gates: {
      htn_diagnosis_timing: timing,        // 'met' | 'undated'
      qualifying_event: event              // 'met' | 'unknown'
    },
    ...(denominatorUncertain
      ? { denominator_caveats: gateUncertainties }
      : {})
  };

  // ---- Numerator: most recent BP during year ----
  const bp = mostRecentBP(bp_observations, measurementYearStart, measurementYearEnd);
  if (!bp) {
    return {
      ...base(),
      ...denominatorMeta,
      in_numerator_rate1: false,
      in_numerator_rate2: false,
      status: 'gap',
      reason: 'No BP recorded during measurement year.',
      recommendation: 'Schedule BP measurement; document at next visit.'
    };
  }

  const bpControlledRate1 = bp.systolic_bp < RATE_1_SBP && bp.diastolic_bp < RATE_1_DBP;
  const bpControlledRate2 = bp.systolic_bp < RATE_2_SBP && bp.diastolic_bp < RATE_2_DBP;

  // Fail-conservative: a patient can only be counted as numerator-compliant when
  // denominator membership is CONFIRMED. If the denominator is uncertain (undated
  // dx / unverified event), do NOT assert compliance — report the BP control
  // status separately and force status to a non-compliant 'gap' with a caveat.
  const inRate1 = bpControlledRate1 && !denominatorUncertain;
  const inRate2 = bpControlledRate2 && !denominatorUncertain;

  let status;
  let recommendation;
  if (denominatorUncertain) {
    status = 'gap';
    recommendation = bpControlledRate1
      ? `BP appears controlled (${bp.systolic_bp}/${bp.diastolic_bp}) but denominator membership is unconfirmed (${gateUncertainties.join(', ')}). Confirm HTN diagnosis date and a qualifying visit before counting as compliant.`
      : 'GAP — most recent BP not at goal; intensify antihypertensive therapy or recheck. Denominator membership also unconfirmed.';
  } else if (bpControlledRate1) {
    status = 'met_rate1';
    recommendation = bpControlledRate2
      ? 'Excellent control — meets both Rate 1 (<140/90) and Rate 2 (<130/80).'
      : 'Meets Rate 1 (<140/90); consider intensifying for Rate 2 (<130/80).';
  } else {
    status = 'gap';
    recommendation = 'GAP — most recent BP not at goal; intensify antihypertensive therapy or recheck.';
  }

  return {
    ...base(),
    ...denominatorMeta,
    in_numerator_rate1: inRate1,
    in_numerator_rate2: inRate2,
    bp_controlled_rate1: bpControlledRate1,  // raw BP-vs-threshold, independent of denominator certainty
    bp_controlled_rate2: bpControlledRate2,
    status,
    most_recent_bp: { systolic: bp.systolic_bp, diastolic: bp.diastolic_bp, date: bp._date.toISOString().slice(0, 10) },
    rate1_threshold: '<140/90',
    rate2_threshold: '<130/80',
    recommendation
  };
}

module.exports = {
  evaluate,
  mostRecentBP,
  htnDiagnosisTiming,
  hasQualifyingEvent,
  MEASURE_ID,
  CERTIFIED,
  DISCLAIMER,
  MIN_AGE,
  MAX_AGE,
  HTN_DX_PREFIXES,
  ESRD_DX_PREFIXES,
  KIDNEY_TRANSPLANT_DX,
  PREGNANCY_DX_PREFIXES,
  HOSPICE_DX,
  QUALIFYING_ENCOUNTER_TOKENS
};
