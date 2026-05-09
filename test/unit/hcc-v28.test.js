'use strict';

// Unit tests for server/coding/hcc-v28.js — Phase 1 of the primary-care deepening plan.
//
// Coverage targets:
//   1. lookupHCC: exact match, prefix fallback, unmapped, normalization
//   2. lookupHCC: payment vs non-payment HCC distinction (e.g., I10, N18.3, J45)
//   3. checkMEAT: each element pattern, multi-element satisfied case, empty text
//   4. buildHCCReport: aggregate over multiple codes + MEAT failure surfacing
//
// Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §2.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const hcc = require('../../server/coding/hcc-v28');

describe('hcc-v28: lookupHCC — exact match', () => {
  test('returns the V28 mapping for a known diabetes code', () => {
    const result = hcc.lookupHCC('E11.65');
    assert.ok(result, 'should match');
    assert.equal(result.hcc_v28_number, 36);
    assert.equal(result.is_payment_hcc, true);
    assert.equal(result.match_type, 'exact');
    assert.match(result.hcc_v28_label, /Diabetes/);
  });

  test('returns the V28 mapping for heart failure (I50.21)', () => {
    const result = hcc.lookupHCC('I50.21');
    assert.equal(result.hcc_v28_number, 224);
    assert.equal(result.is_payment_hcc, true);
  });

  test('returns the V28 mapping for COPD with exacerbation (J44.1)', () => {
    const result = hcc.lookupHCC('J44.1');
    assert.equal(result.hcc_v28_number, 280);
    assert.equal(result.is_payment_hcc, true);
  });

  test('case-insensitive lookup', () => {
    const upper = hcc.lookupHCC('E11.65');
    const lower = hcc.lookupHCC('e11.65');
    assert.deepEqual(upper, lower);
  });

  test('whitespace tolerance', () => {
    const padded = hcc.lookupHCC('  E11.65  ');
    assert.equal(padded.hcc_v28_number, 36);
  });
});

describe('hcc-v28: lookupHCC — non-payment HCCs (V28 changes)', () => {
  test('CKD Stage 3 (N18.3) is NOT a payment HCC under V28', () => {
    const result = hcc.lookupHCC('N18.3');
    assert.ok(result, 'should still map (clinical relevance)');
    assert.equal(result.is_payment_hcc, false, 'V28 removed CKD-3 from payment HCCs');
    assert.equal(result.hcc_v28_number, null);
    assert.match(result.hcc_v28_label, /REMOVED/);
  });

  test('Essential hypertension (I10) is NOT a payment HCC', () => {
    const result = hcc.lookupHCC('I10');
    assert.equal(result.is_payment_hcc, false);
    assert.equal(result.hcc_v28_number, null);
  });

  test('CKD Stage 4 (N18.4) IS a payment HCC under V28', () => {
    const result = hcc.lookupHCC('N18.4');
    assert.equal(result.is_payment_hcc, true);
    assert.equal(result.hcc_v28_number, 326);
  });

  test('CKD Stage 5 (N18.5) IS a payment HCC under V28', () => {
    const result = hcc.lookupHCC('N18.5');
    assert.equal(result.is_payment_hcc, true);
    assert.equal(result.hcc_v28_number, 327);
  });
});

describe('hcc-v28: lookupHCC — prefix fallback', () => {
  test('E11.999 (made-up code) falls back to E11 prefix', () => {
    const result = hcc.lookupHCC('E11.999');
    assert.ok(result, 'should match via prefix');
    assert.equal(result.match_type, 'prefix');
    assert.equal(result.prefix_matched, 'E11');
  });

  test('completely unknown code returns null', () => {
    const result = hcc.lookupHCC('Z99.999');
    assert.equal(result, null);
  });

  test('null/undefined input returns null', () => {
    assert.equal(hcc.lookupHCC(null), null);
    assert.equal(hcc.lookupHCC(undefined), null);
    assert.equal(hcc.lookupHCC(''), null);
  });

  test('non-string input returns null', () => {
    assert.equal(hcc.lookupHCC(42), null);
    assert.equal(hcc.lookupHCC({}), null);
  });
});

describe('hcc-v28: checkMEAT', () => {
  test('flags all 4 elements satisfied in a comprehensive note', () => {
    const note = 'Patient with diabetes, monitoring A1C trends. Evaluated current therapy. ' +
                 'Assessed as stable on metformin. Continue current treatment plan.';
    const result = hcc.checkMEAT('E11.9', note);
    assert.equal(result.satisfied, true);
    assert.equal(result.satisfiedCount, 4);
    assert.deepEqual(result.missing, []);
    assert.ok(result.elements.Monitored);
    assert.ok(result.elements.Evaluated);
    assert.ok(result.elements.Assessed);
    assert.ok(result.elements.Treated);
  });

  test('flags satisfied with single element (CMS RADV minimum)', () => {
    const note = 'Diabetes management — adjusted insulin dose today.';
    const result = hcc.checkMEAT('E11.9', note);
    assert.equal(result.satisfied, true, 'one element is enough for CMS RADV minimum');
    assert.ok(result.elements.Treated);
  });

  test('flags unsatisfied when documentation lacks all MEAT evidence', () => {
    const note = 'Patient came in.';
    const result = hcc.checkMEAT('E11.9', note);
    assert.equal(result.satisfied, false);
    assert.equal(result.satisfiedCount, 0);
    assert.deepEqual(result.missing, ['Monitored', 'Evaluated', 'Assessed', 'Treated']);
  });

  test('handles empty/null encounter text gracefully', () => {
    const r1 = hcc.checkMEAT('E11.9', '');
    const r2 = hcc.checkMEAT('E11.9', null);
    assert.equal(r1.satisfied, false);
    assert.equal(r2.satisfied, false);
  });

  test('captures evidence text for each matched element', () => {
    const note = 'Monitoring blood pressure quarterly. Continue lisinopril.';
    const result = hcc.checkMEAT('I10', note);
    assert.ok(result.evidence.Monitored, 'should capture monitoring evidence');
    assert.ok(result.evidence.Treated, 'should capture treatment evidence');
  });
});

describe('hcc-v28: buildHCCReport', () => {
  const codes = ['E11.65', 'I50.21', 'I10', 'N18.3', 'Z99.999'];
  const goodNote = 'Diabetes monitored, A1c improving. Heart failure assessed as stable on current therapy. ' +
                   'Hypertension treated with lisinopril. CKD evaluated, no progression.';

  test('separates payment, non-payment, and unmapped codes', () => {
    const report = hcc.buildHCCReport(codes, goodNote);
    assert.ok(report.payment_hccs.length >= 2, 'E11.65 + I50.21 are payment HCCs');
    assert.ok(report.non_payment_hccs.length >= 2, 'I10 + N18.3 are not payment HCCs');
    assert.ok(report.unmapped.includes('Z99.999'), 'Z99.999 should be unmapped');
  });

  test('flags payment HCCs lacking MEAT documentation', () => {
    const report = hcc.buildHCCReport(['E11.65', 'I50.21'], 'Patient came in.');
    assert.equal(report.meat_failures.length, 2);
    assert.equal(report.summary.capture_quality, '2_at_risk');
  });

  test('reports all_supported when MEAT is satisfied for every payment HCC', () => {
    const report = hcc.buildHCCReport(['E11.65'], goodNote);
    assert.equal(report.meat_failures.length, 0);
    assert.equal(report.summary.capture_quality, 'all_supported');
  });

  test('reports no_payment_hccs when input has only non-payment codes', () => {
    const report = hcc.buildHCCReport(['I10', 'N18.3'], goodNote);
    assert.equal(report.payment_hccs.length, 0);
    assert.equal(report.summary.capture_quality, 'no_payment_hccs');
  });

  test('handles empty input array', () => {
    const report = hcc.buildHCCReport([], '');
    assert.equal(report.summary.total_codes_evaluated, 0);
    assert.equal(report.payment_hccs.length, 0);
    assert.equal(report.unmapped.length, 0);
  });

  test('handles non-array input gracefully (defensive)', () => {
    const report = hcc.buildHCCReport(null, '');
    assert.equal(report.summary.total_codes_evaluated, 0);
  });

  test('provides per-failure remediation recommendation', () => {
    const report = hcc.buildHCCReport(['E11.65'], 'Patient came in.');
    assert.equal(report.meat_failures.length, 1);
    assert.match(report.meat_failures[0].recommendation, /MEAT element/);
  });
});

describe('hcc-v28: cache behavior', () => {
  test('repeated lookups use the cached map (smoke test)', () => {
    hcc.clearCache();
    const r1 = hcc.lookupHCC('E11.65');
    const r2 = hcc.lookupHCC('E11.65');
    assert.deepEqual(r1, r2);
  });

  test('clearCache forces a re-load', () => {
    hcc.lookupHCC('E11.65'); // populate cache
    hcc.clearCache();
    // After clearCache, the next call re-reads the JSON. We can't observe this
    // directly, but we can verify the result is still correct.
    const result = hcc.lookupHCC('E11.65');
    assert.equal(result.hcc_v28_number, 36);
  });
});
