'use strict';

// Unit tests for server/coding/g2211.js — Phase 4 of the primary-care deepening plan.
//
// Coverage targets:
//   1. Eligible: established patient + chronic condition + office E/M
//   2. Eligible: home/residence visit (NEW for CY 2026)
//   3. Eligible: telehealth office visit
//   4. NOT eligible: acute-only encounter (urgent care, walk-in)
//   5. NOT eligible: procedure-only visit
//   6. NOT eligible: base CPT outside the G2211-eligible family
//   7. NOT eligible: no longitudinal signals
//   8. Defensive: invalid context, missing patient/encounter
//
// Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §5.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detectG2211Eligibility, ELIGIBLE_BASE_CODES, ELIGIBLE_HOME_RESIDENCE_2026 } = require('../../server/coding/g2211');

// Helpers — keeps each test concise.
const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
const SIX_MONTHS_AGO = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

function ctx(overrides = {}) {
  return {
    patient: { id: 1, created_at: TWO_YEARS_AGO },
    encounter: { encounter_type: 'follow_up', location_type: 'office' },
    problems: [{ icd10_code: 'E11.65', status: 'active' }],
    ...overrides
  };
}

describe('g2211: eligible scenarios', () => {
  test('established patient + chronic condition + office E/M = eligible', () => {
    const result = detectG2211Eligibility(ctx());
    assert.equal(result.eligible, true);
    assert.equal(result.addOnCpt, 'G2211');
    assert.equal(result.estimatedReimbursementUSD, 16.05);
    assert.match(result.rationale, /chronic condition/);
  });

  test('chronic condition alone (new patient) is sufficient', () => {
    const result = detectG2211Eligibility(ctx({
      patient: { id: 1, created_at: SIX_MONTHS_AGO }
    }));
    assert.equal(result.eligible, true, 'chronic condition is its own longitudinal signal');
  });

  test('established relationship without chronic condition is sufficient', () => {
    const result = detectG2211Eligibility(ctx({
      problems: [],
      encounter: { encounter_type: 'office_visit', location_type: 'office' }
    }));
    assert.equal(result.eligible, true, 'longstanding relationship implies longitudinal intent');
  });

  test('AWV encounter type triggers G2211 eligibility (modifier 25 path)', () => {
    const result = detectG2211Eligibility(ctx({
      patient: { id: 1, created_at: SIX_MONTHS_AGO },
      problems: [],
      encounter: { encounter_type: 'annual_wellness_visit', location_type: 'office' }
    }));
    assert.equal(result.eligible, true);
    assert.equal(result.modifier25Allowed, true);
  });

  test('CY 2026: home/residence E/M (99347) is eligible (NEW)', () => {
    const result = detectG2211Eligibility(
      ctx({
        encounter: { encounter_type: 'follow_up', location_type: 'home' }
      }),
      '99347'
    );
    assert.equal(result.eligible, true, '99347 became G2211-eligible in CY 2026');
  });

  test('all 99341-99350 home/residence codes are in the eligible set', () => {
    for (const code of ELIGIBLE_HOME_RESIDENCE_2026) {
      assert.ok(ELIGIBLE_BASE_CODES.has(code), `${code} should be eligible`);
    }
  });

  test('telehealth visit with chronic condition is eligible', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'follow_up', location_type: '', is_telehealth: true }
    }));
    assert.equal(result.eligible, true);
  });

  test('eligible result includes documentation guidance', () => {
    const result = detectG2211Eligibility(ctx());
    assert.match(result.documentationGuidance, /longitudinal/);
  });
});

describe('g2211: NOT eligible scenarios', () => {
  test('urgent-care encounter type is NOT eligible', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'urgent_care', location_type: 'office' }
    }));
    assert.equal(result.eligible, false);
    assert.match(result.rationale, /acute/);
  });

  test('walk-in encounter type is NOT eligible', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'walk_in', location_type: 'office' }
    }));
    assert.equal(result.eligible, false);
  });

  test('procedure-only encounter is NOT eligible', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'procedure_only', location_type: 'office' }
    }));
    assert.equal(result.eligible, false);
    assert.match(result.rationale, /Procedure-only/);
  });

  test('sports physical is NOT eligible (acute-only)', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'sports_physical', location_type: 'office' }
    }));
    assert.equal(result.eligible, false);
  });

  test('base CPT outside eligible family (99213 OK, 12001 NOT OK)', () => {
    const eligible = detectG2211Eligibility(ctx(), '99213');
    const ineligible = detectG2211Eligibility(ctx(), '12001');
    assert.equal(eligible.eligible, true);
    assert.equal(ineligible.eligible, false);
    assert.match(ineligible.rationale, /not in the G2211-eligible code family/);
  });

  test('hospital inpatient setting is NOT eligible', () => {
    const result = detectG2211Eligibility(ctx({
      encounter: { encounter_type: 'follow_up', location_type: 'hospital_inpatient' }
    }));
    assert.equal(result.eligible, false);
    assert.match(result.rationale, /not in the G2211-eligible setting/);
  });

  test('new patient + no chronic condition + no longitudinal-intent type = NOT eligible', () => {
    const result = detectG2211Eligibility({
      patient: { id: 1, created_at: SIX_MONTHS_AGO },
      encounter: { encounter_type: 'office_visit', location_type: 'office' },
      problems: []
    });
    assert.equal(result.eligible, false);
    assert.match(result.rationale, /No longitudinal-care relationship signal/);
  });

  test('only acute (non-chronic) problems is NOT eligible', () => {
    const result = detectG2211Eligibility({
      patient: { id: 1, created_at: SIX_MONTHS_AGO },
      encounter: { encounter_type: 'office_visit', location_type: 'office' },
      problems: [{ icd10_code: 'J06.9', status: 'active' }]  // URI
    });
    assert.equal(result.eligible, false);
  });
});

describe('g2211: defensive input handling', () => {
  test('null context returns ineligible with explanation', () => {
    const result = detectG2211Eligibility(null);
    assert.equal(result.eligible, false);
    assert.match(result.rationale, /Invalid context/);
  });

  test('empty context handled gracefully', () => {
    const result = detectG2211Eligibility({});
    assert.equal(result.eligible, false);
  });

  test('inactive chronic conditions are not counted', () => {
    const result = detectG2211Eligibility({
      patient: { id: 1, created_at: SIX_MONTHS_AGO },
      encounter: { encounter_type: 'office_visit', location_type: 'office' },
      problems: [{ icd10_code: 'E11.9', status: 'resolved' }]
    });
    assert.equal(result.eligible, false, 'resolved diabetes should not count as ongoing chronic');
  });

  test('result always includes signals object for transparency', () => {
    const eligible = detectG2211Eligibility(ctx());
    const ineligible = detectG2211Eligibility({});
    assert.ok(eligible.signals);
    assert.ok(ineligible.signals);
  });
});
