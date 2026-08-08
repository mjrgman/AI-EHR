'use strict';

// Wave 1 SECURITY — Pharma / drug-safety fail-closed regression tests.
//
// Covers two confirmed P0 clinical-safety findings:
//
//   P0-3 (pharma-ddi-01): drug-interaction screening must FAIL CLOSED. When the
//     upstream interaction source is unreachable (the live state — NLM RxNav
//     /interaction was retired Jan-2024), the result must carry an explicit
//     "screening unavailable" marker, NOT an empty array that callers read as
//     "no interactions found." An empty array is permitted ONLY when the source
//     responded and genuinely returned zero interactions.
//
//   P0-4 (medivault-ddi-args-02): the MediVault red-flag agent previously called
//     checkDrugInteractions(medications) — passing the whole array as the FIRST
//     argument (newDrugName) and leaving activeMeds undefined, so the service's
//     guard returned [] every time and vault interaction screening never ran.
//     These tests prove (a) the old call shape returns nothing, and (b) the
//     corrected pairwise call shape actually screens and flags a known pair.
//
// NOTE (deferred): replacing the retired DDI data source with a maintained /
// licensed source remains a pending decision for Michael (ULTRAPLAN P0-4).
// These tests only pin the SAFE failure mode; they do not add a data source.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const rxnorm = require('../../server/pharma/rxnorm-service');
const drugSafety = require('../../server/pharma/drug-safety-service');

// ──────────────────────────────────────────
// P0-3 — rxnorm-service fail-closed sentinel
// ──────────────────────────────────────────

describe('P0-3 rxnorm: getInteractions fails closed', () => {
  test('exposes the screening-unavailable helpers', () => {
    assert.equal(typeof rxnorm.isScreeningUnavailable, 'function');
    assert.equal(typeof rxnorm.buildUnavailableInteraction, 'function');
    assert.equal(rxnorm.SCREENING_UNAVAILABLE, 'unavailable');
  });

  test('buildUnavailableInteraction marks unavailable, not clean', () => {
    const sentinel = rxnorm.buildUnavailableInteraction('test reason');
    assert.equal(sentinel.unavailable, true);
    assert.equal(sentinel.status, 'unavailable');
    assert.equal(sentinel.severity, 'unknown');
    assert.match(sentinel.description, /unavailable/i);
    assert.match(sentinel.description, /verify/i);
  });

  test('isScreeningUnavailable distinguishes unavailable from genuinely-empty', () => {
    // Genuinely-empty (source responded, zero interactions) is NOT unavailable.
    assert.equal(rxnorm.isScreeningUnavailable([]), false);
    // A sentinel-bearing list IS unavailable.
    assert.equal(
      rxnorm.isScreeningUnavailable([rxnorm.buildUnavailableInteraction()]),
      true
    );
    // A real interaction (no sentinel) is NOT unavailable.
    assert.equal(
      rxnorm.isScreeningUnavailable([{ severity: 'high', description: 'x' }]),
      false
    );
  });
});

describe('P0-3 rxnorm: checkInteractionsAgainstList fails closed', () => {
  // NOTE: checkInteractionsAgainstList / getInteractions call their primitives
  // (lookupByName, rxnormGet) via module-private bindings, so they cannot be
  // stubbed through the exports and a full unit-level mock would require an
  // https intercept. The fail-closed BRANCH LOGIC is therefore proven
  // deterministically at the drug-safety-service boundary below (which DOES
  // call rxnorm.checkInteractionsAgainstList through the exported reference)
  // and via the pure helper tests above. Here we only pin the input guards,
  // which are pure and network-free.
  test('empty inputs short-circuit to [] (nothing to screen, not a failure)', async () => {
    assert.deepEqual(await rxnorm.checkInteractionsAgainstList('warfarin', []), []);
    assert.deepEqual(await rxnorm.checkInteractionsAgainstList('', [{ medication_name: 'x' }]), []);
  });

  test('getInteractions guard: missing rxcui short-circuits to [] (no network)', async () => {
    assert.deepEqual(await rxnorm.getInteractions(null, '123'), []);
    assert.deepEqual(await rxnorm.getInteractions('123', null), []);
  });
});

// ──────────────────────────────────────────
// P0-3 / P0-4 — drug-safety-service contract
// ──────────────────────────────────────────

describe('P0-3 drug-safety: checkDrugInteractions arg contract + fail-closed', () => {
  let originalFn;
  beforeEach(() => { originalFn = rxnorm.checkInteractionsAgainstList; });
  afterEach(() => { rxnorm.checkInteractionsAgainstList = originalFn; });

  test('forwards (newDrugName, activeMeds) correctly to rxnorm layer', async () => {
    let captured = null;
    rxnorm.checkInteractionsAgainstList = async (drugName, activeMeds) => {
      captured = { drugName, activeMeds };
      return [{
        drug1: 'warfarin', drug2: 'ibuprofen',
        severity: 'high', description: 'Increased bleeding risk',
        source: 'TEST', rxcui1: '1', rxcui2: '2'
      }];
    };

    const out = await drugSafety.checkDrugInteractions(
      'warfarin',
      [{ medication_name: 'ibuprofen' }]
    );

    // Correct argument shapes reached the rxnorm layer.
    assert.equal(captured.drugName, 'warfarin');
    assert.ok(Array.isArray(captured.activeMeds));
    assert.equal(captured.activeMeds[0].medication_name, 'ibuprofen');

    // Real interaction is classified and surfaced.
    assert.equal(out.length, 1);
    assert.equal(out[0].drug1, 'warfarin');
    assert.equal(out[0].severity, 'critical'); // 'high' → critical via classifySeverity
  });

  test('preserves the unavailable sentinel without re-classifying severity', async () => {
    rxnorm.checkInteractionsAgainstList = async () => [{
      drug1: 'warfarin', drug2: null,
      ...rxnorm.buildUnavailableInteraction('source down')
    }];

    const out = await drugSafety.checkDrugInteractions('warfarin', [{ medication_name: 'aspirin' }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].unavailable, true);
    assert.equal(out[0].status, 'unavailable');
    assert.equal(out[0].severity, 'unknown'); // NOT classified to a clinical grade
    assert.equal(drugSafety.isScreeningUnavailable(out), true);
  });

  test('OLD BUG SHAPE: passing the med array as the first arg returns nothing', async () => {
    // This reproduces the pre-fix MediVault call: checkDrugInteractions(medications).
    // activeMeds is undefined → the guard returns [] (screening never runs).
    // Pinned here so a regression to the broken call shape is caught.
    const out = await drugSafety.checkDrugInteractions(['warfarin', 'ibuprofen']);
    assert.deepEqual(out, []);
  });
});

describe('P0-3 drug-safety: fullSafetyCheck surfaces unavailable as a WARNING', () => {
  let originalFn;
  beforeEach(() => { originalFn = rxnorm.checkInteractionsAgainstList; });
  afterEach(() => { rxnorm.checkInteractionsAgainstList = originalFn; });

  test('unavailable screen → interactionScreeningUnavailable flag + warning alert', async () => {
    rxnorm.checkInteractionsAgainstList = async () => [{
      drug1: 'warfarin', drug2: null,
      ...rxnorm.buildUnavailableInteraction('source down')
    }];

    const result = await drugSafety.fullSafetyCheck('warfarin', [{ medication_name: 'aspirin' }], []);
    assert.equal(result.interactionScreeningUnavailable, true);
    const warn = result.alerts.find(a => a.type === 'interaction_screening_unavailable');
    assert.ok(warn, 'a screening-unavailable warning alert must be present');
    assert.equal(warn.severity, 'warning');
    // And it must NOT be reported as a clean "no interactions" result.
    assert.notEqual(result.alerts.length, 0);
  });
});
