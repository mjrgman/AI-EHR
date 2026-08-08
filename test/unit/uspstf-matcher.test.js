'use strict';

// Unit tests for server/quality/uspstf-matcher.js — Phase 5 of the primary-care deepening plan.
//
// Coverage targets:
//   1. Age applicability gates (min_age, max_age)
//   2. Sex filter
//   3. BMI trigger (obesity intervention)
//   4. Risk-factor matching
//   5. Diagnostic exclusion (HTN already on problem list)
//   6. Cadence-based due/up-to-date logic
//   7. One-time screen handling (HCV, AAA)
//   8. Aggregate counts in result summary

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const matcher = require('../../server/quality/uspstf-matcher');

const dobAt = (years) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

describe('uspstf-matcher: age applicability', () => {
  test('breast cancer screening applies to a 50yo woman', () => {
    const result = matcher.matchApplicableRecommendations({ dob: dobAt(50), sex: 'F' });
    const breastCancer = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.ok(breastCancer, 'should be applicable');
  });

  test('breast cancer screening NOT applicable to a 35yo woman', () => {
    const result = matcher.matchApplicableRecommendations({ dob: dobAt(35), sex: 'F' });
    const breastCancer = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.equal(breastCancer, undefined);
  });

  test('breast cancer screening NOT applicable to an 80yo woman (above max_age)', () => {
    const result = matcher.matchApplicableRecommendations({ dob: dobAt(80), sex: 'F' });
    const breastCancer = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.equal(breastCancer, undefined);
  });

  test('cervical cancer screening NOT applicable to a male', () => {
    const result = matcher.matchApplicableRecommendations({ dob: dobAt(40), sex: 'M' });
    const cervix = result.applicable.find(r => r.topic_key === 'cervical_cancer_screening');
    assert.equal(cervix, undefined);
  });

  test('AAA screening applies only to male 65-75 with smoking history', () => {
    const noRisk = matcher.matchApplicableRecommendations({ dob: dobAt(70), sex: 'M' });
    assert.equal(noRisk.applicable.find(r => r.topic_key === 'abdominal_aortic_aneurysm_screening'), undefined);

    const withRisk = matcher.matchApplicableRecommendations(
      { dob: dobAt(70), sex: 'M' },
      { additionalSignals: { risk_factors: ['smoking_history'] } }
    );
    assert.ok(withRisk.applicable.find(r => r.topic_key === 'abdominal_aortic_aneurysm_screening'));
  });
});

describe('uspstf-matcher: BMI trigger', () => {
  test('adult obesity behavioral intervention triggers at BMI 32', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(45), sex: 'M' },
      { additionalSignals: { bmi: 32 } }
    );
    const obesity = result.applicable.find(r => r.topic_key === 'obesity_behavioral_intervention');
    assert.ok(obesity);
  });

  test('adult obesity behavioral intervention does NOT trigger at BMI 28', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(45), sex: 'M' },
      { additionalSignals: { bmi: 28 } }
    );
    const obesity = result.applicable.find(r => r.topic_key === 'obesity_behavioral_intervention');
    assert.equal(obesity, undefined);
  });
});

describe('uspstf-matcher: diagnostic exclusion', () => {
  test('HTN screening excluded when patient already has I10', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(40), sex: 'F' },
      { problems: [{ icd10_code: 'I10', status: 'active' }] }
    );
    const htn = result.applicable.find(r => r.topic_key === 'hypertension_screening');
    assert.ok(htn);
    assert.equal(htn.status, 'excluded');
  });

  test('Diabetes screening excluded when patient already has E11.9', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(50), sex: 'F' },
      {
        problems: [{ icd10_code: 'E11.9', status: 'active' }],
        additionalSignals: { risk_factors: ['overweight_or_obesity'] }
      }
    );
    const dm = result.applicable.find(r => r.topic_key === 'prediabetes_t2dm_screening');
    assert.ok(dm);
    assert.equal(dm.status, 'excluded');
  });
});

describe('uspstf-matcher: cadence + completion', () => {
  test('breast cancer screening due_now when never done', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(50), sex: 'F' },
      { priorProcedures: [] }
    );
    const breast = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.equal(breast.status, 'due_now');
  });

  test('breast cancer screening up_to_date when done 6 months ago (cadence 24mo)', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(50), sex: 'F' },
      { priorProcedures: [{ cpt_code: '77067', performed_date: sixMonthsAgo.toISOString() }] }
    );
    const breast = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.equal(breast.status, 'up_to_date');
    assert.ok(breast.last_completed);
    assert.ok(breast.next_due);
  });

  test('breast cancer screening due_now when done 30 months ago (cadence elapsed)', () => {
    const thirtyMonthsAgo = new Date();
    thirtyMonthsAgo.setMonth(thirtyMonthsAgo.getMonth() - 30);
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(50), sex: 'F' },
      { priorProcedures: [{ cpt_code: '77067', performed_date: thirtyMonthsAgo.toISOString() }] }
    );
    const breast = result.applicable.find(r => r.topic_key === 'breast_cancer_screening');
    assert.equal(breast.status, 'due_now');
  });
});

describe('uspstf-matcher: one-time screens', () => {
  test('HCV screening due_now when never done', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(40), sex: 'M' },
      { priorProcedures: [] }
    );
    const hcv = result.applicable.find(r => r.topic_key === 'hcv_screening');
    assert.equal(hcv.status, 'due_now');
    assert.equal(hcv.one_time, true);
  });

  test('HCV screening up_to_date once done (one-time, never re-due)', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(40), sex: 'M' },
      { priorProcedures: [{ cpt_code: '86803', performed_date: '2020-01-01' }] }
    );
    const hcv = result.applicable.find(r => r.topic_key === 'hcv_screening');
    assert.equal(hcv.status, 'up_to_date');
    assert.equal(hcv.next_due, null);
  });
});

describe('uspstf-matcher: aggregate summary', () => {
  test('summary counts add up correctly', () => {
    const result = matcher.matchApplicableRecommendations(
      { dob: dobAt(50), sex: 'F' },
      {
        problems: [{ icd10_code: 'I10', status: 'active' }],
        additionalSignals: { bmi: 32, risk_factors: ['overweight_or_obesity'] }
      }
    );
    assert.equal(
      result.summary.applicable_count + result.summary.not_applicable_count,
      result.summary.total_evaluated
    );
    assert.equal(
      result.summary.due_now_count + result.summary.up_to_date_count,
      result.applicable.filter(a => a.status !== 'excluded').length
    );
  });

  test('all returned applicable entries have required fields', () => {
    const result = matcher.matchApplicableRecommendations({ dob: dobAt(45), sex: 'F' });
    for (const a of result.applicable) {
      assert.ok(a.topic_key);
      assert.ok(a.title);
      assert.ok(a.grade);
      assert.ok(a.status);
    }
  });
});
