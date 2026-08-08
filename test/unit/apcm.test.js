'use strict';

// Unit tests for server/coding/apcm.js — Phase 7 of the primary-care deepening plan.
//
// Coverage:
//   1. QPP pathway gate (must report MVP or participate in MSSP/REACH)
//   2. Stacking conflict detection (CCM/PCM/BHI cannot coexist)
//   3. Chronic condition counting
//   4. Level determination: dual-eligible → Level 3, ≥2 chronic → Level 2, ≤1 → Level 1
//   5. High-complexity override → Level 3

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const apcm = require('../../server/coding/apcm');

describe('apcm: QPP pathway gate', () => {
  test('rejects when no QPP pathway provided', () => {
    const r = apcm.determineAPCMLevel({}, [], {});
    assert.equal(r.eligible, false);
    assert.equal(r.missingPrerequisite, 'qpp_pathway');
  });

  test('rejects invalid QPP pathway', () => {
    const r = apcm.determineAPCMLevel({}, [], { qppPathway: 'fee_for_service' });
    assert.equal(r.eligible, false);
  });

  test('accepts Value in Primary Care MVP', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9', status: 'active' }],
      { qppPathway: 'value_in_primary_care_mvp' }
    );
    assert.equal(r.eligible, true);
  });

  test('accepts MSSP', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [],
      { qppPathway: 'mssp' }
    );
    assert.equal(r.eligible, true);
  });
});

describe('apcm: stacking conflict detection', () => {
  test('rejects when CCM 99490 active', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9', status: 'active' }],
      { qppPathway: 'mssp', activeBillingCodes: ['99490'] }
    );
    assert.equal(r.eligible, false);
    assert.deepEqual(r.conflictingCodes, ['99490']);
  });

  test('rejects when BHI 99484 active', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [],
      { qppPathway: 'mssp', activeBillingCodes: ['99484'] }
    );
    assert.equal(r.eligible, false);
  });

  test('rejects when PCM 99424 active', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [],
      { qppPathway: 'mssp', activeBillingCodes: ['99424'] }
    );
    assert.equal(r.eligible, false);
  });

  test('passes when no conflicting codes', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9' }],
      { qppPathway: 'mssp', activeBillingCodes: [] }
    );
    assert.equal(r.eligible, true);
  });

  test('hasActiveConflict utility detects all conflict families', () => {
    assert.equal(apcm.hasActiveConflict(['99490']), true);
    assert.equal(apcm.hasActiveConflict(['99424']), true);
    assert.equal(apcm.hasActiveConflict(['99484']), true);
    assert.equal(apcm.hasActiveConflict(['99213']), false);
  });
});

describe('apcm: chronic condition counting', () => {
  test('counts active chronic problems', () => {
    const c = apcm.countChronicConditions([
      { icd10_code: 'E11.9', status: 'active' },
      { icd10_code: 'I10', status: 'active' },
      { icd10_code: 'F32.9', status: 'active' }
    ]);
    assert.equal(c, 3);
  });

  test('ignores resolved problems', () => {
    const c = apcm.countChronicConditions([
      { icd10_code: 'E11.9', status: 'resolved' }
    ]);
    assert.equal(c, 0);
  });

  test('ignores acute conditions (J06.9 = URI)', () => {
    const c = apcm.countChronicConditions([
      { icd10_code: 'J06.9', status: 'active' }
    ]);
    assert.equal(c, 0);
  });

  test('handles empty/null gracefully', () => {
    assert.equal(apcm.countChronicConditions([]), 0);
    assert.equal(apcm.countChronicConditions(null), 0);
  });
});

describe('apcm: level determination', () => {
  const qpp = { qppPathway: 'mssp' };

  test('dual-eligible → Level 3 (G0558)', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true, medicaid: true } },
      [{ icd10_code: 'E11.9' }],
      qpp
    );
    assert.equal(r.level, 3);
    assert.equal(r.cpt, 'G0558');
    assert.match(r.basis, /Dual-eligible/);
  });

  test('≥2 chronic + high complexity → Level 3 (G0558)', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9' }, { icd10_code: 'I50.9' }],
      { ...qpp, highComplexity: true }
    );
    assert.equal(r.level, 3);
    assert.equal(r.cpt, 'G0558');
  });

  test('≥2 chronic without high complexity → Level 2 (G0557)', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9' }, { icd10_code: 'I50.9' }],
      qpp
    );
    assert.equal(r.level, 2);
    assert.equal(r.cpt, 'G0557');
  });

  test('1 chronic condition → Level 1 (G0556)', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9' }],
      qpp
    );
    assert.equal(r.level, 1);
    assert.equal(r.cpt, 'G0556');
  });

  test('0 chronic conditions → Level 1 (G0556) with warning', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [],
      qpp
    );
    assert.equal(r.level, 1);
    assert.equal(r.cpt, 'G0556');
    assert.ok(r.warnings.some(w => /verify/.test(w)));
  });

  test('result includes basis explanation', () => {
    const r = apcm.determineAPCMLevel(
      { insurance: { medicare: true } },
      [{ icd10_code: 'E11.9' }, { icd10_code: 'I50.9' }],
      qpp
    );
    assert.match(r.basis, /chronic condition/);
  });
});
