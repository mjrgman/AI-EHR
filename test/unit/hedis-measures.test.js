'use strict';

// Unit tests for server/quality/hedis/* — Phase 6 of the primary-care deepening plan.
//
// Coverage:
//   1. BCS-E denominator gates (sex, age 50-74)
//   2. BCS-E numerator (mammogram in 27-month lookback)
//   3. BCS-E exclusions (bilateral mastectomy, two unilateral, hospice)
//   4. CBP denominator gates (age 18-85, HTN diagnosis)
//   5. CBP exclusions (ESRD, transplant, pregnancy if female, hospice)
//   6. CBP numerator dual-rate (<140/90 and <130/80)
//   7. Registry + dispatcher

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const bcsE = require('../../server/quality/hedis/measures/bcs-e');
const cbp = require('../../server/quality/hedis/measures/cbp');
const hedis = require('../../server/quality/hedis');

const dobAt = (years) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

const isoMonthsAgo = (months) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
};

// ============================================================
describe('hedis: BCS-E denominator gates', () => {
  test('male patient excluded', () => {
    const r = bcsE.evaluate({ patient: { dob: dobAt(60), sex: 'M' } });
    assert.equal(r.in_denominator, false);
    assert.match(r.reason, /female/);
  });

  test('woman age 45 excluded (below 50)', () => {
    const r = bcsE.evaluate({ patient: { dob: dobAt(45), sex: 'F' } });
    assert.equal(r.in_denominator, false);
  });

  test('woman age 80 excluded (above 74)', () => {
    const r = bcsE.evaluate({ patient: { dob: dobAt(80), sex: 'F' } });
    assert.equal(r.in_denominator, false);
  });

  test('woman age 60 in denominator', () => {
    const r = bcsE.evaluate({ patient: { dob: dobAt(60), sex: 'F' } });
    assert.equal(r.in_denominator, true);
  });
});

describe('hedis: BCS-E numerator', () => {
  test('mammogram 12 months ago → meets numerator', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      procedures: [{ cpt_code: '77067', performed_date: isoMonthsAgo(12) }]
    });
    assert.equal(r.in_numerator, true);
    assert.equal(r.status, 'met');
  });

  test('mammogram 30 months ago → outside 27-month window, gap', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      procedures: [{ cpt_code: '77067', performed_date: isoMonthsAgo(30) }]
    });
    assert.equal(r.in_numerator, false);
    assert.equal(r.status, 'gap');
  });

  test('no mammogram → gap', () => {
    const r = bcsE.evaluate({ patient: { dob: dobAt(60), sex: 'F' } });
    assert.equal(r.status, 'gap');
    assert.match(r.recommendation, /77067/);
  });

  test('multiple mammogram codes are recognized', () => {
    for (const cpt of ['77065', '77066', '77067', 'G0202']) {
      const r = bcsE.evaluate({
        patient: { dob: dobAt(60), sex: 'F' },
        procedures: [{ cpt_code: cpt, performed_date: isoMonthsAgo(6) }]
      });
      assert.equal(r.in_numerator, true, `CPT ${cpt} should satisfy numerator`);
    }
  });
});

describe('hedis: BCS-E exclusions', () => {
  test('bilateral mastectomy diagnosis (Z90.13) excludes', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'Z90.13' }]
    });
    assert.equal(r.status, 'excluded');
    assert.match(r.reason, /Bilateral mastectomy/);
  });

  test('two unilateral mastectomies (Z90.11 + Z90.12) exclude', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'Z90.11' }, { icd10_code: 'Z90.12' }]
    });
    assert.equal(r.status, 'excluded');
  });

  test('single unilateral mastectomy does NOT exclude', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'Z90.11' }]
    });
    assert.notEqual(r.status, 'excluded');
  });

  test('hospice (Z51.5) excludes', () => {
    const r = bcsE.evaluate({
      patient: { dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'Z51.5' }]
    });
    assert.equal(r.status, 'excluded');
  });
});

// ============================================================
describe('hedis: CBP denominator gates', () => {
  test('age 17 excluded (below 18)', () => {
    const r = cbp.evaluate({ patient: { dob: dobAt(17) }, problems: [{ icd10_code: 'I10' }] });
    assert.equal(r.in_denominator, false);
  });

  test('age 90 excluded (above 85)', () => {
    const r = cbp.evaluate({ patient: { dob: dobAt(90) }, problems: [{ icd10_code: 'I10' }] });
    assert.equal(r.in_denominator, false);
  });

  test('no HTN diagnosis → not in denominator', () => {
    const r = cbp.evaluate({ patient: { dob: dobAt(50) }, problems: [{ icd10_code: 'E11.9' }] });
    assert.equal(r.in_denominator, false);
    assert.match(r.reason, /hypertension/);
  });

  test('age 50 with HTN → in denominator', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      problems: [{ icd10_code: 'I10', status: 'active' }]
    });
    assert.equal(r.in_denominator, true);
  });
});

describe('hedis: CBP exclusions', () => {
  test('ESRD (N18.6) excludes', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(60) },
      problems: [{ icd10_code: 'I10', status: 'active' }, { icd10_code: 'N18.6', status: 'active' }]
    });
    assert.equal(r.status, 'excluded');
  });

  test('kidney transplant (Z94.0) excludes', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(60) },
      problems: [{ icd10_code: 'I10', status: 'active' }, { icd10_code: 'Z94.0', status: 'active' }]
    });
    assert.equal(r.status, 'excluded');
  });

  test('pregnancy excludes female patients', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(30), sex: 'F' },
      problems: [{ icd10_code: 'I10', status: 'active' }, { icd10_code: 'O09.90', status: 'active' }]
    });
    assert.equal(r.status, 'excluded');
  });

  test('pregnancy diagnosis on a male patient does NOT exclude', () => {
    // (Defensive check — a male patient with O-code is malformed but shouldn't error)
    const r = cbp.evaluate({
      patient: { dob: dobAt(50), sex: 'M' },
      problems: [{ icd10_code: 'I10', status: 'active' }, { icd10_code: 'O09.90', status: 'active' }]
    });
    assert.notEqual(r.status, 'excluded');
  });
});

describe('hedis: CBP numerator dual-rate', () => {
  // NOTE (2026-05-28, hedis-cbp-denominator-10): CBP now enforces NCQA timing
  // (HTN dx on/before June 30) + qualifying-event gates. A patient can only be
  // counted numerator-COMPLIANT when denominator membership is CONFIRMED, so
  // these tests now supply a dated HTN dx + a qualifying in-year encounter. An
  // undated dx with no encounter would be `denominator_uncertain` and is covered
  // by the dedicated gating tests below.
  const yearStart = new Date(new Date().getFullYear(), 0, 5).toISOString(); // early-Jan, ≤ June 30
  const baseProblems = [{ icd10_code: 'I10', status: 'active', onset_date: yearStart }];
  const baseEncounters = [{ type: 'office_visit', date: isoMonthsAgo(2) }];
  const confirmedDenom = { problems: baseProblems, encounters: baseEncounters };

  test('BP 130/82 → meets Rate 1 (<140/90), NOT Rate 2 (<130/80)', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: [{ systolic_bp: 130, diastolic_bp: 82, observed_date: new Date().toISOString() }]
    });
    // 130 < 140 ✓ AND 82 < 90 ✓ → Rate 1 = true
    assert.equal(r.in_numerator_rate1, true, 'BP 130/82 should meet Rate 1 (<140/90)');
    // 130 < 130 ✗ → Rate 2 = false
    assert.equal(r.in_numerator_rate2, false, 'BP 130/82 should NOT meet Rate 2 (<130/80) — strict less-than');
  });

  test('BP 138/88 → meets Rate 1, not Rate 2', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: [{ systolic_bp: 138, diastolic_bp: 88, observed_date: new Date().toISOString() }]
    });
    assert.equal(r.in_numerator_rate1, true);
    assert.equal(r.in_numerator_rate2, false);
    assert.equal(r.status, 'met_rate1');
  });

  test('BP 125/75 → meets BOTH rates', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: [{ systolic_bp: 125, diastolic_bp: 75, observed_date: new Date().toISOString() }]
    });
    assert.equal(r.in_numerator_rate1, true);
    assert.equal(r.in_numerator_rate2, true);
    assert.match(r.recommendation, /Excellent control/);
  });

  test('BP 145/95 → gap, not at goal', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: [{ systolic_bp: 145, diastolic_bp: 95, observed_date: new Date().toISOString() }]
    });
    assert.equal(r.in_numerator_rate1, false);
    assert.equal(r.status, 'gap');
  });

  test('multiple BPs → uses most recent', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: [
        { systolic_bp: 145, diastolic_bp: 95, observed_date: isoMonthsAgo(11) },  // older, uncontrolled
        { systolic_bp: 128, diastolic_bp: 78, observed_date: isoMonthsAgo(1) }     // recent, controlled
      ]
    });
    assert.equal(r.in_numerator_rate1, true);
    assert.equal(r.in_numerator_rate2, true);
  });

  test('no BP recorded in measurement year → gap', () => {
    const r = cbp.evaluate({
      patient: { dob: dobAt(50) },
      ...confirmedDenom,
      bp_observations: []
    });
    assert.equal(r.status, 'gap');
    assert.match(r.reason, /No BP recorded/);
  });
});

// ============================================================
// hedis-cbp-denominator-10: NCQA timing/event gates + non-certified labeling.
describe('hedis: CBP denominator timing/event gates (NCQA MY 2026)', () => {
  const dobConfirmed = () => dobAt(55);
  const jan = () => new Date(new Date().getFullYear(), 0, 10).toISOString();   // ≤ June 30
  const aug = () => new Date(new Date().getFullYear(), 7, 10).toISOString();   // > June 30
  const inYearVisit = () => ({ type: 'office_visit', date: isoMonthsAgo(2) });
  const goodBP = () => [{ systolic_bp: 125, diastolic_bp: 75, observed_date: new Date().toISOString() }];

  test('every CBP result is labeled NOT NCQA-certified', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: jan() }],
      encounters: [inYearVisit()],
      bp_observations: goodBP()
    });
    assert.equal(r.certified, false);
    assert.match(r.disclaimer, /NOT NCQA-certified/i);
  });

  test('HTN dx dated AFTER June 30 → out of denominator', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: aug() }],
      encounters: [inYearVisit()],
      bp_observations: goodBP()
    });
    assert.equal(r.in_denominator, false);
    assert.match(r.reason, /June 30/);
  });

  test('HTN dx dated on/before June 30 + qualifying visit → confirmed denominator, can be compliant', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: jan() }],
      encounters: [inYearVisit()],
      bp_observations: goodBP()
    });
    assert.equal(r.in_denominator, true);
    assert.equal(r.denominator_uncertain, false);
    assert.equal(r.in_numerator_rate1, true);
    assert.equal(r.denominator_gates.htn_diagnosis_timing, 'met');
    assert.equal(r.denominator_gates.qualifying_event, 'met');
  });

  test('explicitly supplied encounters with no qualifying type → out of denominator (event gate)', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: jan() }],
      encounters: [{ type: 'lab_only', date: isoMonthsAgo(2) }],
      bp_observations: goodBP()
    });
    assert.equal(r.in_denominator, false);
    assert.match(r.reason, /qualifying encounter/i);
  });

  test('FAIL-CONSERVATIVE: undated dx + no encounter data + controlled BP → NOT counted compliant', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active' }], // no date
      // no encounters supplied
      bp_observations: goodBP()
    });
    assert.equal(r.in_denominator, true);
    assert.equal(r.denominator_uncertain, true);
    // BP is controlled in raw terms…
    assert.equal(r.bp_controlled_rate1, true);
    // …but we MUST NOT count it as numerator-compliant (don't over-count compliant).
    assert.equal(r.in_numerator_rate1, false);
    assert.equal(r.in_numerator_rate2, false);
    assert.equal(r.status, 'gap');
    assert.ok(Array.isArray(r.denominator_caveats) && r.denominator_caveats.length > 0);
  });

  test('has_qualifying_event boolean override is honored', () => {
    const r = cbp.evaluate({
      patient: { dob: dobConfirmed() },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: jan() }],
      has_qualifying_event: true,
      bp_observations: goodBP()
    });
    assert.equal(r.in_denominator, true);
    assert.equal(r.denominator_gates.qualifying_event, 'met');
  });
});

// ============================================================
describe('hedis: registry + dispatcher', () => {
  test('listMeasures returns BCS-E and CBP', () => {
    const m = hedis.listMeasures();
    assert.ok(m.includes('BCS-E'));
    assert.ok(m.includes('CBP'));
  });

  test('evaluateMeasure dispatches to the right module', () => {
    const r = hedis.evaluateMeasure('BCS-E', { patient: { dob: dobAt(60), sex: 'F' } });
    assert.equal(r.measure_id, 'BCS-E');
  });

  test('unknown measure returns error', () => {
    const r = hedis.evaluateMeasure('NOPE', {});
    assert.match(r.error, /Unknown/);
  });

  test('evaluateAllForPatient returns all measures', () => {
    const r = hedis.evaluateAllForPatient({
      patient: { id: 1, dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'I10', status: 'active' }],
      bp_observations: [{ systolic_bp: 125, diastolic_bp: 75, observed_date: new Date().toISOString() }]
    });
    assert.equal(r.results.length, 2);
    assert.equal(r.patient_id, 1);
  });
});
