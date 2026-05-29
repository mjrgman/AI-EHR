'use strict';

// Unit tests for P3 correctness findings:
//   age-calc-leap-11           — calendar-based age (no /365.25 off-by-one);
//                                 includes a Feb-29 leap-year birthday case.
//   fhir-condition-recordeddate-12 — Condition mapper emits recordedDate and
//                                 omits the unsupported hardcoded verificationStatus.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ageAsOf, calculateAge } = require('../../server/utils/date-helpers');
const bcsE = require('../../server/quality/hedis/measures/bcs-e');
const cbp = require('../../server/quality/hedis/measures/cbp');
const uspstf = require('../../server/quality/uspstf-matcher');
const { toFhirCondition } = require('../../server/fhir/mappers/condition');

// ============================================================
describe('age-calc-leap-11: ageAsOf is calendar-based (year diff adjusted by month/day)', () => {
  // NOTE: construct DOB with local Y/M/D components (new Date(y, m, d)) so the
  // comparison is timezone-stable. An ISO 'YYYY-MM-DD' string parses as UTC
  // midnight, which on a negative-offset host shifts the local day backward and
  // would muddle a day-boundary assertion. The production code's calendar logic
  // is the unit under test here, independent of string-parse timezone semantics.
  const dob = (y, m, d) => new Date(y, m - 1, d);

  test('exact birthday returns the round age (no off-by-one)', () => {
    // Born 1990-06-15, evaluated on the 34th birthday → exactly 34.
    assert.equal(ageAsOf(dob(1990, 6, 15), new Date(2024, 5, 15)), 34);
  });

  test('day before birthday is one year younger', () => {
    assert.equal(ageAsOf(dob(1990, 6, 15), new Date(2024, 5, 14)), 33);
  });

  test('day after birthday holds the new age', () => {
    assert.equal(ageAsOf(dob(1990, 6, 15), new Date(2024, 5, 16)), 34);
  });

  test('Feb-29 birthday: in a COMMON year the person turns N on Mar-1, not Feb-28', () => {
    // Born 2000-02-29 (leap year). Evaluated in 2023 (a common year):
    //   - Feb-28, 2023 → not yet 23 (birthday hasn't occurred) → 22
    //   - Mar-1,  2023 → 23
    assert.equal(ageAsOf(dob(2000, 2, 29), new Date(2023, 1, 28)), 22, 'Feb-28 of a common year: not yet birthday');
    assert.equal(ageAsOf(dob(2000, 2, 29), new Date(2023, 2, 1)), 23, 'Mar-1 of a common year: birthday has passed');
  });

  test('Feb-29 birthday: in a LEAP year the actual Feb-29 is the birthday', () => {
    // Evaluated 2024 (leap year): Feb-29, 2024 → exactly 24.
    assert.equal(ageAsOf(dob(2000, 2, 29), new Date(2024, 1, 29)), 24);
    assert.equal(ageAsOf(dob(2000, 2, 29), new Date(2024, 1, 28)), 23, 'Feb-28 of a leap year: not yet birthday');
  });

  test('Dec-31 birthday evaluated as of Dec-31 returns the round age (HEDIS "as of Dec 31")', () => {
    // The ms/365.25 method undercounts this boundary; calendar comparison is exact.
    assert.equal(ageAsOf(dob(1950, 12, 31), new Date(2026, 11, 31)), 76);
  });

  test('invalid / missing DOB returns null', () => {
    assert.equal(ageAsOf(null, new Date()), null);
    assert.equal(ageAsOf('not-a-date', new Date()), null);
  });

  test('calculateAge delegates to ageAsOf with now', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 40);
    assert.equal(calculateAge(dob.toISOString().slice(0, 10)), 40);
  });

  test('HEDIS BCS-E uses calendar age: woman turning 50 exactly on Dec-31 is in the 50-74 denominator', () => {
    // DOB 1976-12-31, measurement year end 2026-12-31 → exactly 50 (boundary).
    const r = bcsE.evaluate({
      patient: { dob: '1976-12-31', sex: 'F' },
      measurementYearEnd: '2026-12-31'
    });
    assert.equal(r.in_denominator, true);
    assert.equal(r.age, 50);
  });

  test('HEDIS CBP uses calendar age: adult exactly 18 on Dec-31 is in the 18-85 denominator', () => {
    const r = cbp.evaluate({
      patient: { dob: '2008-12-31' },
      problems: [{ icd10_code: 'I10', status: 'active', onset_date: '2026-01-05' }],
      encounters: [{ type: 'office_visit', date: '2026-03-01' }],
      measurementYearEnd: '2026-12-31'
    });
    assert.equal(r.in_denominator, true);
  });

  test('USPSTF ageInYears still works through the shared calendar helper', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 50);
    assert.equal(uspstf.ageInYears(dob.toISOString().slice(0, 10)), 50);
  });
});

// ============================================================
describe('fhir-condition-recordeddate-12: Condition mapper recordedDate + verificationStatus', () => {
  const problem = {
    id: 42,
    patient_id: 7,
    problem_name: 'Essential hypertension',
    icd10_code: 'I10',
    status: 'active',
    onset_date: '2020-03-01',
    created_at: '2026-05-28T14:30:00Z'
  };

  test('emits recordedDate sourced from created_at', () => {
    const c = toFhirCondition(problem);
    assert.equal(c.recordedDate, '2026-05-28T14:30:00Z');
  });

  test('omits hardcoded verificationStatus (schema carries no certainty column)', () => {
    const c = toFhirCondition(problem);
    assert.equal(c.verificationStatus, undefined);
  });

  test('still produces the core Condition fields', () => {
    const c = toFhirCondition(problem);
    assert.equal(c.resourceType, 'Condition');
    assert.equal(c.id, '42');
    assert.ok(c.clinicalStatus, 'clinicalStatus present');
    assert.ok(c.code, 'code present');
    assert.ok(c.subject, 'subject present');
    assert.equal(c.onsetDateTime, '2020-03-01');
  });

  test('recordedDate omitted when created_at is absent (fails closed, no fabricated date)', () => {
    const c = toFhirCondition({ id: 1, patient_id: 7, problem_name: 'x', status: 'active' });
    assert.equal(c.recordedDate, undefined);
  });
});
