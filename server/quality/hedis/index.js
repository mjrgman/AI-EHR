'use strict';

/**
 * HEDIS measure registry + dispatcher.
 *
 * Each measure module exports `evaluate(input)` returning a structured result.
 * Phase 6 lands BCS-E + CBP as representative measures; CCS-E, COL-E, CDC,
 * IMA-E follow next iteration using the same shape.
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §7.
 */

const bcsE = require('./measures/bcs-e');
const cbp = require('./measures/cbp');

const MEASURES = {
  'BCS-E': bcsE,
  'CBP': cbp
};

function listMeasures() {
  return Object.keys(MEASURES);
}

function evaluateMeasure(measureId, input) {
  const m = MEASURES[String(measureId).toUpperCase()];
  if (!m) return { measure_id: measureId, error: 'Unknown HEDIS measure ID.' };
  return m.evaluate(input);
}

/**
 * Evaluate every registered measure for a single patient.
 * Returns a panel-style row: { patient_id, results: [per-measure...] }.
 */
function evaluateAllForPatient(input) {
  const patientId = input.patient && input.patient.id;
  return {
    patient_id: patientId,
    measurement_year_end: input.measurementYearEnd
      ? new Date(input.measurementYearEnd).toISOString().slice(0, 10)
      : new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10),
    results: listMeasures().map(id => evaluateMeasure(id, input))
  };
}

module.exports = {
  MEASURES,
  listMeasures,
  evaluateMeasure,
  evaluateAllForPatient
};
