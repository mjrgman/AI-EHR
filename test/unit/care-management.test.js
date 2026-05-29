'use strict';

// Unit tests for server/care-management/* — Phase 2 of the primary-care deepening plan.
//
// Covers:
//   1. Code catalog lookups + family enumeration
//   2. Stacking conflict matrix (CCM/TCM/PCM/BHI/CoCM/RPM/RTM/APCM)
//   3. Eligibility checks (chronic count, behavioral health, high-risk single condition, consent)
//   4. Engine — CCM monthly computation across staff/physician minute paths
//   5. Engine — TCM eligibility + day-window-based code selection
//   6. Engine — BHI eligibility
//   7. Engine — APCM short-circuit + suppression of stacked codes

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const codes = require('../../server/care-management/codes');
const stacking = require('../../server/care-management/stacking-rules');
const eligibility = require('../../server/care-management/eligibility');
const engine = require('../../server/care-management/engine');

const recentISO = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

// ============================================================
describe('care-mgmt: code catalog', () => {
  test('CCM family includes 99490, 99439, 99491, 99437, 99487, 99489', () => {
    for (const c of ['99490', '99439', '99491', '99437', '99487', '99489']) {
      assert.ok(codes.getCode(c), `${c} should be in catalog`);
      assert.equal(codes.getCode(c).family, 'CCM');
    }
  });

  test('TCM 99495 = moderate (14-day window), 99496 = high (7-day window)', () => {
    assert.equal(codes.getCode('99495').faceToFaceWithinDaysOfDischarge, 14);
    assert.equal(codes.getCode('99496').faceToFaceWithinDaysOfDischarge, 7);
  });

  test('APCM family includes G0556, G0557, G0558', () => {
    assert.equal(codes.getCode('G0556').family, 'APCM');
    assert.equal(codes.getCode('G0558').family, 'APCM');
  });

  test('getFamilyCodes("BHI") returns 99484, 99492, 99493, 99494', () => {
    const bhi = codes.getFamilyCodes('BHI').map(c => c.cpt);
    assert.deepEqual(bhi.sort(), ['99484', '99492', '99493', '99494']);
  });
});

// ============================================================
describe('care-mgmt: stacking conflicts', () => {
  test('CCM 99490 conflicts with active TCM 99495', () => {
    const r = stacking.checkConflict('99490', ['99495']);
    assert.equal(r.allowed, false);
    assert.equal(r.conflicts[0].conflictingFamily, 'TCM');
  });

  test('CCM 99490 conflicts with active PCM 99424', () => {
    const r = stacking.checkConflict('99490', ['99424']);
    assert.equal(r.allowed, false);
  });

  test('APCM G0557 conflicts with all CCM/PCM/BHI/RPM codes', () => {
    const r = stacking.checkConflict('G0557', ['99490', '99424', '99484', '99457']);
    assert.equal(r.allowed, false);
    assert.ok(r.conflicts.length >= 4);
  });

  test('CCM blocked by TCM-active-service-period flag (no CPT yet billed)', () => {
    const r = stacking.checkConflict('99490', [], { tcmActiveServicePeriod: true });
    assert.equal(r.allowed, false);
    assert.match(r.conflicts[0].reason, /TCM service period/);
  });

  test('RPM 99457 conflicts with RTM 98980', () => {
    const r = stacking.checkConflict('99457', ['98980']);
    assert.equal(r.allowed, false);
  });

  test('TCM does NOT conflict with BHI', () => {
    const r = stacking.checkConflict('99495', ['99484']);
    assert.equal(r.allowed, true);
  });

  test('non-care-management CPT (e.g. 99213) is allowed', () => {
    const r = stacking.checkConflict('99213', ['99490']);
    assert.equal(r.allowed, true);
  });

  test('familyOf returns correct family', () => {
    assert.equal(stacking.familyOf('99490'), 'CCM');
    assert.equal(stacking.familyOf('99492'), 'CoCM');
    assert.equal(stacking.familyOf('99484'), 'BHI_GENERAL');
    assert.equal(stacking.familyOf('G0558'), 'APCM');
    assert.equal(stacking.familyOf('99213'), null);
  });
});

// ============================================================
describe('care-mgmt: eligibility', () => {
  const goodConsent = { consent_date: recentISO(30) };
  const expiredConsent = { consent_date: recentISO(400) };

  test('CCM requires ≥2 chronic conditions', () => {
    const oneCond = eligibility.checkCCMEligibility(
      {}, [{ icd10_code: 'E11.9', status: 'active' }], goodConsent
    );
    assert.equal(oneCond.eligible, false);

    const twoCond = eligibility.checkCCMEligibility(
      {},
      [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      goodConsent
    );
    assert.equal(twoCond.eligible, true);
  });

  test('CCM rejects expired consent', () => {
    const r = eligibility.checkCCMEligibility(
      {},
      [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      expiredConsent
    );
    assert.equal(r.eligible, false);
    assert.match(r.reason, /annual renewal/);
  });

  test('PCM requires high-risk single condition', () => {
    const lowRisk = eligibility.checkPCMEligibility(
      {}, [{ icd10_code: 'E11.9', status: 'active' }], goodConsent
    );
    assert.equal(lowRisk.eligible, false);

    const highRisk = eligibility.checkPCMEligibility(
      {}, [{ icd10_code: 'I50.9', status: 'active' }], goodConsent  // Heart failure
    );
    assert.equal(highRisk.eligible, true);
  });

  test('TCM requires recent discharge within 30 days', () => {
    const tooOld = eligibility.checkTCMEligibility({}, { discharge_date: recentISO(45) });
    assert.equal(tooOld.eligible, false);

    const recent = eligibility.checkTCMEligibility({}, { discharge_date: recentISO(10) });
    assert.equal(recent.eligible, true);
  });

  test('BHI requires F-code diagnosis', () => {
    const noBh = eligibility.checkBHIEligibility(
      {}, [{ icd10_code: 'E11.9', status: 'active' }], goodConsent
    );
    assert.equal(noBh.eligible, false);

    const withDepression = eligibility.checkBHIEligibility(
      {}, [{ icd10_code: 'F32.9', status: 'active' }], goodConsent
    );
    assert.equal(withDepression.eligible, true);
  });

  test('RPM requires ≥16 days of device data', () => {
    const insufficient = eligibility.checkRPMEligibility(
      {}, [], goodConsent, { daysOfData: 10 }
    );
    assert.equal(insufficient.eligible, false);

    const sufficient = eligibility.checkRPMEligibility(
      {}, [], goodConsent, { daysOfData: 22 }
    );
    assert.equal(sufficient.eligible, true);
  });
});

// ============================================================
describe('care-mgmt: engine — CCM monthly computation', () => {
  const goodConsent = { consent_date: recentISO(30) };

  test('20 min staff time → 99490 alone', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'CCM', consent: goodConsent },
      timeLog: [{ minutes: 20, staff_role: 'rn' }]
    });
    assert.equal(r.codes.length, 1);
    assert.equal(r.codes[0].cpt, '99490');
  });

  test('60 min staff time + non-complex MDM → 99490 + 99439 x2 (capped)', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'CCM', consent: goodConsent, mdm_complexity: 'low' },
      timeLog: [{ minutes: 60, staff_role: 'rn' }]
    });
    const cpts = r.codes.map(c => c.cpt);
    assert.ok(cpts.includes('99490'));
    assert.ok(cpts.includes('99439'));
    const addOn = r.codes.find(c => c.cpt === '99439');
    assert.equal(addOn.units, 2, 'add-on should cap at 2 units');
  });

  test('60 min staff time + MODERATE MDM → 99487 (complex)', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'CCM', consent: goodConsent, mdm_complexity: 'moderate' },
      timeLog: [{ minutes: 60, staff_role: 'rn' }]
    });
    const cpts = r.codes.map(c => c.cpt);
    assert.ok(cpts.includes('99487'), 'should choose complex CCM with moderate MDM');
  });

  test('30 min physician personal → 99491 (in addition to staff codes if any)', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'CCM', consent: goodConsent },
      timeLog: [{ minutes: 30, staff_role: 'physician' }]
    });
    const cpts = r.codes.map(c => c.cpt);
    assert.ok(cpts.includes('99491'));
  });

  test('only 10 min staff time → no CCM codes', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9' }, { icd10_code: 'I50.9' }],
      enrollment: { program_type: 'CCM', consent: goodConsent },
      timeLog: [{ minutes: 10, staff_role: 'rn' }]
    });
    assert.equal(r.codes.length, 0);
  });

  test('CCM suppressed when TCM 99495 already active for the patient', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: [{ icd10_code: 'E11.9' }, { icd10_code: 'I50.9' }],
      enrollment: { program_type: 'CCM', consent: goodConsent },
      timeLog: [{ minutes: 30, staff_role: 'rn' }],
      activeBillingCpts: ['99495']
    });
    assert.equal(r.codes.length, 0);
    assert.ok(r.suppressed.length >= 1);
  });
});

// ============================================================
describe('care-mgmt: intra-CCM mutual exclusion (P1-4)', () => {
  const goodConsent = { consent_date: recentISO(30) };
  const twoChronic = [
    { icd10_code: 'E11.9', status: 'active' },
    { icd10_code: 'I50.9', status: 'active' }
  ];

  test('selectSingleCCMPath: 99490 + 99491 → keep higher-value 99491, drop 99490', () => {
    const r = stacking.selectSingleCCMPath([
      { cpt: '99490', units: 1 },
      { cpt: '99491', units: 1 }
    ]);
    const kept = r.selected.map(c => c.cpt);
    assert.deepEqual(kept, ['99491']);
    assert.deepEqual(r.dropped.map(c => c.cpt), ['99490']);
    assert.match(r.rationale, /mutual exclusion/);
  });

  test('selectSingleCCMPath: complex 99487 outranks physician 99491', () => {
    const r = stacking.selectSingleCCMPath([
      { cpt: '99487', units: 1 },
      { cpt: '99491', units: 1 }
    ]);
    assert.deepEqual(r.selected.map(c => c.cpt), ['99487']);
    assert.deepEqual(r.dropped.map(c => c.cpt), ['99491']);
  });

  test('selectSingleCCMPath: drops add-ons that hang off the losing base', () => {
    // 99490 + 99439 (staff path) vs 99491 (physician path): physician wins,
    // so 99490 AND its 99439 add-on are dropped.
    const r = stacking.selectSingleCCMPath([
      { cpt: '99490', units: 1 },
      { cpt: '99439', units: 2 },
      { cpt: '99491', units: 1 }
    ]);
    assert.deepEqual(r.selected.map(c => c.cpt).sort(), ['99491']);
    assert.deepEqual(r.dropped.map(c => c.cpt).sort(), ['99439', '99490']);
  });

  test('selectSingleCCMPath: single base path passes through unchanged', () => {
    const input = [{ cpt: '99490', units: 1 }, { cpt: '99439', units: 1 }];
    const r = stacking.selectSingleCCMPath(input);
    assert.deepEqual(r.selected.map(c => c.cpt), ['99490', '99439']);
    assert.equal(r.dropped.length, 0);
    assert.equal(r.rationale, null);
  });

  test('selectSingleCCMPath: leaves non-CCM codes untouched', () => {
    const r = stacking.selectSingleCCMPath([
      { cpt: '99490', units: 1 },
      { cpt: '99491', units: 1 },
      { cpt: '99213', units: 1 }
    ]);
    assert.ok(r.selected.map(c => c.cpt).includes('99213'));
  });

  test('engine: staff≥20min AND physician≥30min → exactly ONE CCM code (higher-value)', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: twoChronic,
      enrollment: { program_type: 'CCM', consent: goodConsent, mdm_complexity: 'low' },
      timeLog: [
        { minutes: 25, staff_role: 'rn' },        // staff ≥20 → would emit 99490
        { minutes: 35, staff_role: 'physician' }  // physician ≥30 → would emit 99491
      ]
    });
    const ccmCodes = r.codes.filter(c => stacking.familyOf(c.cpt) === 'CCM');
    assert.equal(ccmCodes.length, 1, 'exactly one CCM code emitted');
    assert.equal(ccmCodes[0].cpt, '99491', 'higher-value physician base selected');
    // the staff base is recorded as suppressed, not billed
    assert.ok(r.suppressed.some(s => s.cpt === '99490'));
  });

  test('engine: complex staff (99487) + physician (99491) both meet → only 99487', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: twoChronic,
      enrollment: { program_type: 'CCM', consent: goodConsent, mdm_complexity: 'high' },
      timeLog: [
        { minutes: 60, staff_role: 'rn' },        // complex staff → 99487
        { minutes: 40, staff_role: 'physician' }  // physician ≥30 → 99491
      ]
    });
    const ccmCodes = r.codes.filter(c => stacking.familyOf(c.cpt) === 'CCM');
    const cpts = ccmCodes.map(c => c.cpt);
    assert.ok(cpts.includes('99487'), 'complex base billed');
    assert.ok(!cpts.includes('99491'), 'physician base suppressed');
    // no staff base AND physician base co-occur
    const baseCount = cpts.filter(c => ['99490', '99487', '99491'].includes(c)).length;
    assert.equal(baseCount, 1, 'exactly one CCM base code');
  });

  test('engine: physician-only month still emits 99491 (no false suppression)', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      problems: twoChronic,
      enrollment: { program_type: 'CCM', consent: goodConsent },
      timeLog: [{ minutes: 30, staff_role: 'physician' }]
    });
    const ccmCodes = r.codes.filter(c => stacking.familyOf(c.cpt) === 'CCM');
    assert.deepEqual(ccmCodes.map(c => c.cpt), ['99491']);
    assert.equal(r.suppressed.length, 0);
  });
});

// ============================================================
describe('care-mgmt: engine — TCM', () => {
  test('high-MDM F2F at day 5 → 99496', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      enrollment: { program_type: 'TCM' },
      recentDischarge: { discharge_date: recentISO(7) },
      tcmContext: {
        faceToFaceCompletedDate: recentISO(2),
        mdmComplexity: 'high'
      }
    });
    assert.ok(r.codes.find(c => c.cpt === '99496'));
  });

  test('moderate-MDM F2F at day 12 → 99495', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      enrollment: { program_type: 'TCM' },
      recentDischarge: { discharge_date: recentISO(15) },
      tcmContext: {
        faceToFaceCompletedDate: recentISO(3),
        mdmComplexity: 'moderate'
      }
    });
    assert.ok(r.codes.find(c => c.cpt === '99495'));
  });

  test('discharge >30 days ago → not eligible', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: {},
      enrollment: { program_type: 'TCM' },
      recentDischarge: { discharge_date: recentISO(45) },
      tcmContext: { faceToFaceCompletedDate: recentISO(35), mdmComplexity: 'moderate' }
    });
    assert.equal(r.codes.length, 0);
  });
});

// ============================================================
describe('care-mgmt: engine — APCM short-circuit', () => {
  const goodConsent = { consent_date: recentISO(30) };

  test('APCM Level 2 chosen for 2 chronic conditions + MSSP pathway', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: { insurance: { medicare: true } },
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'APCM', consent: goodConsent },
      apcmOptions: { qppPathway: 'mssp' }
    });
    assert.ok(r.codes.find(c => c.cpt === 'G0557'));
  });

  test('APCM rejects when CCM 99490 is already in active billing', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: { insurance: { medicare: true } },
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'APCM', consent: goodConsent },
      activeBillingCpts: ['99490'],
      apcmOptions: { qppPathway: 'mssp' }
    });
    assert.equal(r.codes.length, 0);
    assert.match(r.rationale.join(' '), /APCM not eligible/);
  });

  test('APCM requires apcmOptions.qppPathway', () => {
    const r = engine.computeMonthlyBillableCodes({
      patient: { insurance: { medicare: true } },
      problems: [{ icd10_code: 'E11.9' }],
      enrollment: { program_type: 'APCM', consent: goodConsent }
    });
    assert.equal(r.codes.length, 0);
  });
});
