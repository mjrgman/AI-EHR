'use strict';

/**
 * USPSTF Matcher — given a patient + encounter context, returns the
 * applicable Grade A/B recommendations and their satisfaction status.
 *
 * Status values per recommendation:
 *   - 'not_applicable'   — patient does not meet age / sex / risk-factor criteria
 *   - 'excluded'         — patient already has the diagnosis the screen would identify
 *   - 'due_now'          — applicable; never satisfied OR cadence elapsed
 *   - 'up_to_date'       — applicable; satisfied within cadence window
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §6.
 *            Source seed: server/seed/uspstf_recommendations_seed.json
 */

const path = require('path');
const fs = require('fs');
const { ageAsOf } = require('../utils/date-helpers');

let cachedSeed = null;
const SEED_PATH = path.join(__dirname, '..', 'seed', 'uspstf_recommendations_seed.json');

function loadSeed() {
  if (cachedSeed) return cachedSeed;
  cachedSeed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  return cachedSeed;
}

function clearCache() {
  cachedSeed = null;
}

// ==========================================
// AGE HELPER
// ==========================================

function ageInYears(dob) {
  // Calendar-based completed-years age (year diff adjusted by month/day) via the
  // shared helper, so leap-year boundaries don't off-by-one. Was previously
  // ms/365.25 (age-calc-leap-11).
  return ageAsOf(dob, new Date());
}

// ==========================================
// APPLICABILITY
// ==========================================

/**
 * Is the recommendation applicable to this patient based on demographics
 * and risk factors?
 */
function isApplicable(rec, patient, additionalSignals = {}) {
  const age = ageInYears(patient.dob);

  if (rec.min_age !== undefined && (age === null || age < rec.min_age)) return false;
  if (rec.max_age !== undefined && age !== null && age > rec.max_age) return false;

  if (rec.sex && patient.sex && rec.sex !== String(patient.sex).toUpperCase().charAt(0)) return false;

  if (rec.trigger_bmi_min !== undefined) {
    const bmi = additionalSignals.bmi;
    if (typeof bmi !== 'number' || bmi < rec.trigger_bmi_min) return false;
  }

  if (Array.isArray(rec.risk_factors) && rec.risk_factors.length > 0) {
    const patientRiskFactors = additionalSignals.risk_factors || [];
    const anyMatched = rec.risk_factors.some(rf => patientRiskFactors.includes(rf));
    if (!anyMatched) return false;
  }

  return true;
}

/**
 * Is the patient already excluded from screening because they have the
 * diagnosis the screen would identify? (e.g., HTN screening doesn't apply
 * to a patient with I10 already on the problem list.)
 */
function isExcluded(rec, problems) {
  if (!Array.isArray(rec.exclude_if_diagnosis) || rec.exclude_if_diagnosis.length === 0) return false;
  const codes = (problems || []).map(p => String(p.icd10_code || '').toUpperCase());
  return rec.exclude_if_diagnosis.some(prefix =>
    codes.some(c => c.startsWith(prefix))
  );
}

// ==========================================
// COMPLETION CHECK
// ==========================================

/**
 * Determine the most recent date this recommendation was satisfied for the
 * patient, by scanning historical CPT/HCPCS codes from prior encounters.
 *
 * @param {object} rec - the USPSTF recommendation
 * @param {object[]} priorProcedures - [{cpt_code, performed_date}, ...]
 * @returns {Date|null}
 */
function lastCompletionDate(rec, priorProcedures) {
  if (!Array.isArray(rec.cpt_codes_satisfying) || rec.cpt_codes_satisfying.length === 0) return null;
  const matchingDates = (priorProcedures || [])
    .filter(p => p.cpt_code && rec.cpt_codes_satisfying.includes(String(p.cpt_code)))
    .map(p => new Date(p.performed_date))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b - a);
  return matchingDates[0] || null;
}

/**
 * Determine the next-due date based on cadence.
 * For one-time screens, returns null when already done; returns `now` when not done.
 *
 * @param {object} rec
 * @param {Date|null} lastCompleted
 * @param {Date} [now] - Pass the caller's `now` so equality comparisons aren't lost
 *                       to millisecond drift between separate `new Date()` calls.
 */
function nextDueDate(rec, lastCompleted, now = new Date()) {
  if (rec.one_time) return lastCompleted ? null : now;
  if (!rec.cadence_months) return now;
  if (!lastCompleted) return now;
  const next = new Date(lastCompleted);
  next.setMonth(next.getMonth() + rec.cadence_months);
  return next;
}

// ==========================================
// MAIN ENTRY
// ==========================================

/**
 * Match all USPSTF recommendations against a patient and return their status.
 *
 * @param {object} patient - { id, dob, sex }
 * @param {object} options - { problems, priorProcedures, additionalSignals }
 * @returns {{ applicable: object[], not_applicable_count: number, due_now: object[], up_to_date: object[] }}
 */
function matchApplicableRecommendations(patient, options = {}) {
  const seed = loadSeed();
  const problems = options.problems || [];
  const priorProcedures = options.priorProcedures || [];
  const additionalSignals = options.additionalSignals || {};
  const now = new Date();

  const applicable = [];
  const due_now = [];
  const up_to_date = [];
  let not_applicable_count = 0;

  for (const rec of seed.recommendations || []) {
    if (!isApplicable(rec, patient, additionalSignals)) {
      not_applicable_count += 1;
      continue;
    }

    if (isExcluded(rec, problems)) {
      applicable.push({
        topic_key: rec.topic_key,
        title: rec.title,
        grade: rec.grade,
        category: rec.category,
        status: 'excluded',
        message: 'Already diagnosed with the condition this screen would identify.',
      });
      continue;
    }

    const lastCompleted = lastCompletionDate(rec, priorProcedures);
    const nextDue = nextDueDate(rec, lastCompleted, now);
    const isDue = nextDue !== null && nextDue.getTime() <= now.getTime();

    const entry = {
      topic_key: rec.topic_key,
      title: rec.title,
      grade: rec.grade,
      category: rec.category,
      status: isDue ? 'due_now' : 'up_to_date',
      last_completed: lastCompleted ? lastCompleted.toISOString().slice(0, 10) : null,
      next_due: nextDue ? nextDue.toISOString().slice(0, 10) : null,
      cadence_months: rec.cadence_months || null,
      one_time: !!rec.one_time,
      recommendation_text: rec.recommendation_text
    };

    applicable.push(entry);
    if (isDue) due_now.push(entry);
    else up_to_date.push(entry);
  }

  return {
    applicable,
    due_now,
    up_to_date,
    not_applicable_count,
    summary: {
      total_evaluated: (seed.recommendations || []).length,
      applicable_count: applicable.length,
      due_now_count: due_now.length,
      up_to_date_count: up_to_date.length,
      not_applicable_count
    }
  };
}

module.exports = {
  matchApplicableRecommendations,
  isApplicable,
  isExcluded,
  lastCompletionDate,
  nextDueDate,
  ageInYears,
  loadSeed,
  clearCache
};
