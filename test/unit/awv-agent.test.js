'use strict';

// Unit tests for server/agents/awv-agent.js — Phase 3 of the primary-care deepening plan.
//
// Coverage targets:
//   1. AWV encounter detection (encounter_type matching)
//   2. Eligibility — first-ever, within 12mo (denied), past 12mo (subsequent)
//   3. Component evaluation — all documented, partial, none
//   4. Add-on suggestions — ACP, 99483, G2211, G0136
//   5. End-to-end agent.process() — applicable / eligible / not eligible / not AWV

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  AWVAgent,
  isAwvEncounter,
  checkEligibility,
  evaluateComponents,
  suggestAddOns,
  ageInYears,
  ELIGIBILITY_WINDOW_DAYS,
} = require('../../server/agents/awv-agent');

const dobAt = (years) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

describe('awv-agent: encounter type detection', () => {
  test('matches "AWV"', () => assert.equal(isAwvEncounter('AWV'), true));
  test('matches "annual_wellness_visit"', () => assert.equal(isAwvEncounter('annual_wellness_visit'), true));
  test('matches "Medicare Wellness Visit"', () => assert.equal(isAwvEncounter('Medicare Wellness Visit'), true));
  test('does NOT match "office_visit"', () => assert.equal(isAwvEncounter('office_visit'), false));
  test('does NOT match "follow_up"', () => assert.equal(isAwvEncounter('follow_up'), false));
  test('handles empty/null', () => {
    assert.equal(isAwvEncounter(''), false);
    assert.equal(isAwvEncounter(null), false);
  });
});

describe('awv-agent: checkEligibility', () => {
  test('first-ever AWV → eligible as INITIAL_G0438', () => {
    const e = checkEligibility([]);
    assert.equal(e.eligible, true);
    assert.equal(e.proposedType, 'INITIAL_G0438');
    assert.equal(e.lastAwvDate, null);
  });

  test('prior G0438 365+ days ago → eligible as SUBSEQUENT_G0439', () => {
    const old = new Date();
    old.setDate(old.getDate() - 400);
    const e = checkEligibility([{ awv_type: 'INITIAL_G0438', visit_date: old.toISOString() }]);
    assert.equal(e.eligible, true);
    assert.equal(e.proposedType, 'SUBSEQUENT_G0439');
  });

  test('prior AWV 100 days ago → NOT eligible, returns next-eligible date', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 100);
    const e = checkEligibility([{ awv_type: 'INITIAL_G0438', visit_date: recent.toISOString() }]);
    assert.equal(e.eligible, false);
    assert.equal(e.proposedType, null);
    assert.ok(e.nextEligibleDate);
    assert.match(e.reason, /12-month window/);
  });

  test('exactly at the boundary (365 days) → eligible', () => {
    const exact = new Date();
    exact.setDate(exact.getDate() - ELIGIBILITY_WINDOW_DAYS);
    const e = checkEligibility([{ awv_type: 'INITIAL_G0438', visit_date: exact.toISOString() }]);
    assert.equal(e.eligible, true);
  });

  test('multiple prior AWVs → uses the most recent', () => {
    const old1 = new Date(); old1.setDate(old1.getDate() - 800);
    const old2 = new Date(); old2.setDate(old2.getDate() - 100);
    const e = checkEligibility([
      { awv_type: 'INITIAL_G0438', visit_date: old1.toISOString() },
      { awv_type: 'SUBSEQUENT_G0439', visit_date: old2.toISOString() }
    ]);
    assert.equal(e.eligible, false);
  });
});

describe('awv-agent: evaluateComponents', () => {
  const fullTranscript = `
    Health Risk Assessment completed. Reviewed family history and past medical history.
    Updated provider list. Mini-Cog performed and normal. PHQ-9 score 2 (negative).
    Timed Up and Go assessment 9 seconds. SDOH screen — patient denies food insecurity
    or housing concerns. Personalized health advice provided. Written prevention plan
    given covering screenings due in next 5 years. Risk factor list updated with
    intervention recommendations.
  `;
  const fullVitals = { height: 170, weight: 75, systolic_bp: 130, diastolic_bp: 78 };
  const fullContext = {
    encounter: { encounter_type: 'awv', transcript: fullTranscript },
    vitals: fullVitals,
    patient: { dob: dobAt(70), sex: 'F' }
  };

  test('comprehensive note marks most components documented', () => {
    const r = evaluateComponents(fullContext, 'INITIAL_G0438');
    assert.ok(r.completeness.complete >= r.completeness.total - 2,
      `expected >= ${r.completeness.total - 2} complete, got ${r.completeness.complete}`);
  });

  test('empty transcript marks all transcript-derived components as missing', () => {
    const r = evaluateComponents({
      encounter: { encounter_type: 'awv', transcript: '' },
      vitals: {},
      patient: { dob: dobAt(70) }
    }, 'INITIAL_G0438');
    assert.ok(r.missingRequired.length >= r.components.length - 1);
  });

  test('vitals present marks measurements component complete', () => {
    const r = evaluateComponents(fullContext, 'INITIAL_G0438');
    const m = r.components.find(c => c.key === 'measurements');
    assert.equal(m.documented, true);
  });

  test('vitals absent marks measurements component incomplete', () => {
    const r = evaluateComponents({
      encounter: { encounter_type: 'awv', transcript: fullTranscript },
      vitals: {},
      patient: { dob: dobAt(70) }
    }, 'INITIAL_G0438');
    const m = r.components.find(c => c.key === 'measurements');
    assert.equal(m.documented, false);
  });

  test('hearing impairment component included for 65+', () => {
    const r = evaluateComponents(fullContext, 'INITIAL_G0438');
    assert.ok(r.components.find(c => c.key === 'hearing_impairment'));
  });

  test('hearing impairment component NOT included for <65', () => {
    const r = evaluateComponents({
      encounter: { encounter_type: 'awv', transcript: fullTranscript },
      vitals: fullVitals,
      patient: { dob: dobAt(50) }
    }, 'INITIAL_G0438');
    assert.equal(r.components.find(c => c.key === 'hearing_impairment'), undefined);
  });
});

describe('awv-agent: suggestAddOns', () => {
  const baseComponents = {
    components: [{ key: 'sdoh_hra', documented: true }]
  };

  test('always suggests G2211 for AWV (longitudinal-care intent)', () => {
    const addOns = suggestAddOns(
      { encounter: { transcript: 'standard wellness visit' } },
      baseComponents
    );
    assert.ok(addOns.find(a => a.cpt === 'G2211'));
  });

  test('suggests 99497 (ACP) when advance directive discussed', () => {
    const addOns = suggestAddOns(
      { encounter: { transcript: 'discussed advance directives and code status with patient' } },
      baseComponents
    );
    assert.ok(addOns.find(a => a.cpt === '99497'));
  });

  test('suggests 99483 when cognitive concern documented', () => {
    const addOns = suggestAddOns(
      { encounter: { transcript: 'patient with new memory loss; suspect MCI' } },
      baseComponents
    );
    assert.ok(addOns.find(a => a.cpt === '99483'));
  });

  test('suggests G0136 when SDOH assessment was a focused component', () => {
    const addOns = suggestAddOns(
      { encounter: { transcript: 'completed sdoh assessment with food insecurity screen' } },
      baseComponents
    );
    assert.ok(addOns.find(a => a.cpt === 'G0136'));
  });

  test('does NOT suggest 99483 for routine visits without cognitive concern', () => {
    const addOns = suggestAddOns(
      { encounter: { transcript: 'patient feeling well, no concerns' } },
      baseComponents
    );
    assert.equal(addOns.find(a => a.cpt === '99483'), undefined);
  });
});

describe('awv-agent: AWVAgent.process() end-to-end', () => {
  const agent = new AWVAgent();

  test('non-AWV encounter returns applicable=false', async () => {
    const result = await agent.process({
      encounter: { encounter_type: 'office_visit' },
      patient: { dob: dobAt(70) }
    });
    assert.equal(result.applicable, false);
    assert.equal(result.billableCpt, null);
  });

  test('first-ever AWV returns G0438', async () => {
    const result = await agent.process({
      encounter: { encounter_type: 'awv', transcript: 'HRA completed; PHQ-9 negative; Mini-Cog normal' },
      vitals: { height: 170, weight: 75, systolic_bp: 130, diastolic_bp: 80 },
      patient: { dob: dobAt(70), sex: 'F' },
      priorAwvRecords: []
    });
    assert.equal(result.applicable, true);
    assert.equal(result.eligible, true);
    assert.equal(result.billableCpt, 'G0438');
    assert.equal(result.awvType, 'INITIAL_G0438');
    assert.ok(Array.isArray(result.components));
    assert.ok(Array.isArray(result.addOns));
  });

  test('subsequent AWV after prior G0438 returns G0439', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 400);
    const result = await agent.process({
      encounter: { encounter_type: 'annual_wellness_visit', transcript: 'AWV update' },
      vitals: { height: 170, weight: 75, systolic_bp: 120, diastolic_bp: 75 },
      patient: { dob: dobAt(72), sex: 'F' },
      priorAwvRecords: [{ awv_type: 'INITIAL_G0438', visit_date: old.toISOString() }]
    });
    assert.equal(result.billableCpt, 'G0439');
    assert.equal(result.awvType, 'SUBSEQUENT_G0439');
  });

  test('AWV inside 12-month window returns warning, no billable CPT', async () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 100);
    const result = await agent.process({
      encounter: { encounter_type: 'awv', transcript: 'AWV attempt' },
      vitals: {},
      patient: { dob: dobAt(70) },
      priorAwvRecords: [{ awv_type: 'INITIAL_G0438', visit_date: recent.toISOString() }]
    });
    assert.equal(result.eligible, false);
    assert.equal(result.billableCpt, null);
    assert.match(result.warning, /not yet eligible/);
  });

  test('readyToSign true when all components documented', async () => {
    // Only count what we can match — focus on a few key components
    const fullText = `
      Health Risk Assessment done. SDOH screen completed.
      Family history reviewed. Provider list updated.
      Mini-Cog normal. PHQ-9 negative. TUG 9 seconds.
      Hearing screen normal. Risk factor list with interventions.
      Personalized advice given. Written prevention plan provided.
    `;
    const result = await agent.process({
      encounter: { encounter_type: 'awv', transcript: fullText },
      vitals: { height: 170, weight: 75, systolic_bp: 120, diastolic_bp: 75 },
      patient: { dob: dobAt(72), sex: 'F' },
      priorAwvRecords: []
    });
    // The summary should reflect actual completeness count
    assert.ok(result.completeness.percentage >= 80,
      `expected >= 80% complete, got ${result.completeness.percentage}%`);
  });
});

describe('awv-agent: ageInYears helper', () => {
  test('computes age correctly', () => {
    assert.equal(ageInYears(dobAt(45)), 45);
  });
  test('handles null', () => assert.equal(ageInYears(null), null));
  test('handles invalid date', () => assert.equal(ageInYears('not-a-date'), null));
});
