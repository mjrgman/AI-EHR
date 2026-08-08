'use strict';

// ULTRAPLAN P0-4 (curated DDI source) + P1-3 (FDA boxed-warning OR query).
//
// P0-4: the retired NLM RxNav /interaction endpoint left DDI screening with no
//   data source. server/pharma/curated-ddi.js provides an interim hand-curated
//   table of well-established high-severity pairs. A pair IN the table returns a
//   real graded interaction; a pair NOT in the table must fall back to the
//   fail-closed "screening unavailable" sentinel — NEVER an empty/clean result.
//
// P1-3: getDrugLabelSafety must query generic_name first, then fall back to a
//   SEPARATE brand_name query (the old AND-ed query almost never matched, so
//   boxed warnings were silently dropped for drugs that carry one).

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('node:events');

const curated = require('../../server/pharma/curated-ddi');
const rxnorm = require('../../server/pharma/rxnorm-service');
const drugSafety = require('../../server/pharma/drug-safety-service');

// ──────────────────────────────────────────
// P0-4 — curated table: pure lookups (network-free)
// ──────────────────────────────────────────

describe('P0-4 curated-ddi: known high-severity pairs flag', () => {
  test('warfarin + ibuprofen (NSAID) → serious interaction', () => {
    const hit = curated.lookupCuratedInteraction('warfarin', 'ibuprofen');
    assert.ok(hit, 'expected a curated hit for warfarin + ibuprofen');
    assert.equal(hit.severity, 'serious');
    assert.equal(hit.curated, true);
    assert.match(hit.source, /Curated DDI/i);
    assert.ok(hit.mechanism.length > 0);
  });

  test('brand alias resolves: Coumadin + Bactrim → serious (warfarin + sulfamethoxazole)', () => {
    const hit = curated.lookupCuratedInteraction('Coumadin', 'Bactrim');
    assert.ok(hit, 'brand names must resolve to canonical ingredients');
    assert.equal(hit.severity, 'serious');
  });

  test('MAOI + SSRI → critical (contraindicated)', () => {
    const hit = curated.lookupCuratedInteraction('phenelzine', 'fluoxetine');
    assert.ok(hit);
    assert.equal(hit.severity, 'critical');
  });

  test('methotrexate + trimethoprim → critical', () => {
    const hit = curated.lookupCuratedInteraction('methotrexate', 'trimethoprim');
    assert.ok(hit);
    assert.equal(hit.severity, 'critical');
  });

  test('ACE-inhibitor + potassium-sparing diuretic → serious', () => {
    const hit = curated.lookupCuratedInteraction('lisinopril', 'spironolactone');
    assert.ok(hit);
    assert.equal(hit.severity, 'serious');
  });

  test('statin + strong CYP3A4 inhibitor → serious', () => {
    const hit = curated.lookupCuratedInteraction('simvastatin', 'clarithromycin');
    assert.ok(hit);
    assert.equal(hit.severity, 'serious');
  });

  test('order-independent: same pair flags regardless of argument order', () => {
    const a = curated.lookupCuratedInteraction('ibuprofen', 'warfarin');
    const b = curated.lookupCuratedInteraction('warfarin', 'ibuprofen');
    assert.deepEqual(a, b);
  });
});

describe('P0-4 curated-ddi: unknown pairs return null (NOT clean)', () => {
  test('an unlisted pair returns null', () => {
    // acetaminophen + amoxicillin is not a curated high-severity pair.
    assert.equal(curated.lookupCuratedInteraction('acetaminophen', 'amoxicillin'), null);
  });

  test('same drug / same class is not a pair', () => {
    assert.equal(curated.lookupCuratedInteraction('warfarin', 'warfarin'), null);
    assert.equal(curated.lookupCuratedInteraction('ibuprofen', 'naproxen'), null); // both NSAID
  });

  test('empty / invalid input returns null', () => {
    assert.equal(curated.lookupCuratedInteraction('', 'warfarin'), null);
    assert.equal(curated.lookupCuratedInteraction('warfarin', null), null);
  });
});

// ──────────────────────────────────────────
// P0-4 — wiring: checkInteractionsAgainstList consults the curated table
// ──────────────────────────────────────────

describe('P0-4 rxnorm wiring: curated hit vs fail-closed miss', () => {
  test('known curated pair flags through checkInteractionsAgainstList (no network)', async () => {
    const out = await rxnorm.checkInteractionsAgainstList(
      'warfarin',
      [{ medication_name: 'ibuprofen' }]
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].drug1, 'warfarin');
    assert.equal(out[0].drug2, 'ibuprofen');
    assert.equal(out[0].curated, true);
    assert.equal(out[0].severity, 'serious');
    // A curated hit is NOT the unavailable sentinel.
    assert.notEqual(out[0].status, rxnorm.SCREENING_UNAVAILABLE);
    assert.equal(rxnorm.isScreeningUnavailable(out), false);
  });

  test('unknown pair (no curated entry, source dead) → UNAVAILABLE, not clean', async () => {
    // No curated entry for this pair AND no rxnorm_cui supplied AND the live
    // lookup API is unreachable in test → must fail closed.
    const out = await rxnorm.checkInteractionsAgainstList(
      'acetaminophen',
      [{ medication_name: 'amoxicillin' }]
    );
    assert.ok(out.length >= 1, 'must not be an empty (falsely-clean) list');
    assert.equal(rxnorm.isScreeningUnavailable(out), true);
    assert.equal(out[0].drug2, 'amoxicillin');
  });

  test('getInteractions with names returns curated hit', async () => {
    const out = await rxnorm.getInteractions('111', '222', 'methotrexate', 'trimethoprim');
    assert.equal(out.length, 1);
    assert.equal(out[0].curated, true);
    assert.equal(out[0].severity, 'critical');
  });
});

// ──────────────────────────────────────────
// P0-4 — drug-safety-service preserves curated severity verbatim
// ──────────────────────────────────────────

describe('P0-4 drug-safety: curated severity preserved (not re-classified)', () => {
  test('curated "serious" stays "serious" (not upgraded to critical)', async () => {
    const out = await drugSafety.checkDrugInteractions(
      'warfarin',
      [{ medication_name: 'ibuprofen' }]
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].curated, true);
    assert.equal(out[0].severity, 'serious'); // verbatim, NOT classifySeverity('serious') → 'critical'
  });

  test('curated screen is not flagged unavailable', async () => {
    const out = await drugSafety.checkDrugInteractions(
      'phenelzine',
      [{ medication_name: 'sertraline' }]
    );
    assert.equal(out[0].severity, 'critical');
    assert.equal(drugSafety.isScreeningUnavailable(out), false);
  });
});

// ──────────────────────────────────────────
// P1-3 — FDA boxed-warning generic-first / brand-fallback OR query
// ──────────────────────────────────────────

describe('P1-3 drug-safety: boxed-warning OR query (generic then brand)', () => {
  let originalGet;

  function makeResponse(jsonBody) {
    const res = new EventEmitter();
    process.nextTick(() => {
      res.emit('data', JSON.stringify(jsonBody));
      res.emit('end');
    });
    return res;
  }

  function stubHttps(handler) {
    originalGet = https.get;
    https.get = (url, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const req = new EventEmitter();
      req.destroy = () => {};
      // handler decides the body based on the requested URL
      const body = handler(url);
      callback(makeResponse(body));
      return req;
    };
  }

  beforeEach(() => { originalGet = null; });
  afterEach(() => { if (originalGet) https.get = originalGet; });

  test('boxed warning found via generic_name query → hasBoxedWarning:true', async () => {
    const seen = [];
    stubHttps((url) => {
      seen.push(url);
      if (url.includes('generic_name')) {
        return { results: [{ boxed_warning: ['WARNING: fatal bleeding risk.'] }] };
      }
      return { results: [] };
    });

    const out = await drugSafety.checkBoxedWarning('warfarin');
    assert.equal(out.hasBoxedWarning, true);
    assert.match(out.warning, /bleeding/i);
    // Generic query must be issued first and must NOT AND brand+generic together.
    assert.ok(seen[0].includes('generic_name'));
    assert.ok(!seen[0].includes('brand_name'),
      'generic query must be a SEPARATE query, not AND-ed with brand_name');
  });

  test('falls back to a SEPARATE brand_name query when generic misses', async () => {
    const seen = [];
    stubHttps((url) => {
      seen.push(url);
      if (url.includes('generic_name')) return { results: [] }; // generic miss
      if (url.includes('brand_name')) {
        return { results: [{ boxed_warning: ['WARNING: hepatotoxicity.'] }] };
      }
      return { results: [] };
    });

    const out = await drugSafety.checkBoxedWarning('SomeBrand');
    assert.equal(out.hasBoxedWarning, true);
    assert.match(out.warning, /hepatotoxicity/i);
    // Two separate queries were issued, generic first then brand.
    assert.equal(seen.length, 2);
    assert.ok(seen[0].includes('generic_name') && !seen[0].includes('brand_name'));
    assert.ok(seen[1].includes('brand_name') && !seen[1].includes('generic_name'));
  });

  test('no label anywhere → hasBoxedWarning:false', async () => {
    stubHttps(() => ({ results: [] }));
    const out = await drugSafety.checkBoxedWarning('nonexistentdrug');
    assert.equal(out.hasBoxedWarning, false);
    assert.equal(out.warning, null);
  });
});
