'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../helpers/synthetic-module-loader');
const { selectActiveMedications } = require('../../server/pharma/medication-history');

function unavailable(rx, result) {
  assert.equal(rx.isScreeningUnavailable(result), true);
  assert.ok(result.some(row => row.unavailable && row.severity === 'unknown'));
}

for (const live of ['false', 'true']) {
  for (const interaction of ['false', 'true']) {
    test(`legacy interaction path/cache quarantined: live=${live}, interaction=${interaction}`, async () => {
      let cacheReads = 0;
      const loader = createLoader({
        env: { RXNORM_LIVE_ENABLED: live, RXNORM_INTERACTION_ENABLED: interaction },
        database: { dbGet: async () => { cacheReads++; return { response_json: '[]' }; } }
      });
      const rx = loader.load('server/pharma/rxnorm-service.js');
      unavailable(rx, await rx.getInteractions('123', '456', 'synthetic-a', 'synthetic-b'));
      assert.equal(cacheReads, 0);
      assert.equal(loader.requests.length, 0);
    });
  }
}

for (const args of [[null, '123'], ['123', null], [null, null]]) {
  test(`missing pair identifier fails closed: ${JSON.stringify(args)}`, async () => {
    const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
    unavailable(rx, await rx.getInteractions(...args));
  });
}

test('actual curated table is consulted without identifiers', async () => {
  const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
  const out = await rx.getInteractions(null, null, 'warfarin', 'ibuprofen');
  assert.equal(out[0].curated, true);
  assert.equal(out[0].limitedCoverage, true);
  assert.equal(out[0].severity, 'serious');
});

for (const name of [undefined, null, '', '  ', 123, ['warfarin']]) {
  test(`invalid new-drug input fails closed: ${JSON.stringify(name)}`, async () => {
    const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
    unavailable(rx, await rx.checkInteractionsAgainstList(name, []));
  });
}
for (const history of [undefined, null, {}, 'invalid', 12]) {
  test(`invalid history fails closed: ${JSON.stringify(history)}`, async () => {
    const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
    unavailable(rx, await rx.checkInteractionsAgainstList('warfarin', history));
  });
}
for (const row of [null, undefined, {}, [], 12, { medication_name: ' ' }]) {
  test(`invalid row preserves an independent curated finding: ${JSON.stringify(row)}`, async () => {
    const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
    const out = await rx.checkInteractionsAgainstList('warfarin', [row, { medication_name: 'ibuprofen' }]);
    unavailable(rx, out);
    assert.ok(out.some(i => i.curated && i.drug2 === 'ibuprofen'));
  });
}

test('empty supplied history has no pairwise comparisons', async () => {
  const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
  assert.equal((await rx.checkInteractionsAgainstList('warfarin', [])).length, 0);
});

test('matching identifiers do not suppress unresolved pairs', async () => {
  const { load } = createLoader(); const rx = load('server/pharma/rxnorm-service.js');
  unavailable(rx, await rx.getInteractions('123', '123', 'synthetic-a', 'synthetic-b'));
});

test('active-history selection preserves missing and invalid entries', () => {
  assert.equal(selectActiveMedications(undefined), undefined);
  assert.equal(selectActiveMedications(null), null);
  assert.deepEqual(selectActiveMedications([]), []);
  const selected = selectActiveMedications([null, { medication_name: 'ibuprofen', status: 'active' },
    { medication_name: 'synthetic-a', status: 'completed' }, { medication_name: 'synthetic-b' }]);
  assert.equal(selected.filter(x => x === null).length, 2);
  assert.ok(selected.some(x => x?.medication_name === 'ibuprofen'));
  assert.ok(selected.some(x => x?.medication_name === 'synthetic-b'));
});

for (const history of [undefined, null, [null], [{ medication_name: 'ibuprofen' }], []]) {
  test(`fullSafetyCheck propagates completeness: ${JSON.stringify(history)}`, async () => {
    const { load } = createLoader(); const safety = load('server/pharma/drug-safety-service.js');
    const out = await safety.fullSafetyCheck('warfarin', history, []);
    const empty = Array.isArray(history) && history.length === 0;
    assert.equal(out.interactionScreening.status, empty ? 'not_applicable' : 'incomplete');
    assert.equal(out.interactionScreeningUnavailable, !empty);
    if (!empty) assert.ok(out.alerts.some(a => a.unavailable));
    if (history?.[0]?.medication_name) {
      assert.ok(out.interactionScreening.findings.some(i => i.curated));
      assert.equal(out.alerts[0].type, 'drug_interaction');
    }
  });
}

test('FDA generic then brand lookup retains a synthetic boxed warning', async () => {
  const loader = createLoader({ labels: url => url.includes('brand_name')
    ? { results: [{ boxed_warning: ['SYNTHETIC WARNING'] }] } : { error: 'not found' } });
  const safety = loader.load('server/pharma/drug-safety-service.js');
  const out = await safety.fullSafetyCheck('synthetic-brand', undefined, []);
  assert.equal(out.boxedWarning.warning, 'SYNTHETIC WARNING');
  assert.equal(out.alerts[0].type, 'boxed_warning');
  assert.ok(out.alerts.some(a => a.unavailable));
  assert.equal(loader.requests.length, 2);
});

test('default master gate still blocks identification/form lookups', async () => {
  const loader = createLoader(); const rx = loader.load('server/pharma/rxnorm-service.js');
  await rx.lookupByName('synthetic-drug');
  await rx.getAllForms('123');
  assert.equal(loader.requests.length, 0);
});
