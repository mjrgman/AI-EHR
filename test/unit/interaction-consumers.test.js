'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../helpers/synthetic-module-loader');

function contextDb(medications) {
  return {
    getPatientById: async () => ({ id: 1, dob: '1980-01-01', sex: 'M' }),
    getPatientProblems: async () => [], getPatientMedications: async () => medications,
    getPatientAllergies: async () => [], getPatientLabs: async () => [],
    getPatientVitals: async () => [], getEncounterById: async () => ({ id: 1 })
  };
}

async function buildContext(loader, medications) {
  const names = ['orchestrator', 'phone-triage-agent', 'front-desk-agent', 'ma-agent',
    'physician-agent', 'scribe-agent', 'domain-logic-agent', 'orders-agent',
    'coding-agent', 'quality-agent'];
  const contextLoader = createLoader({ overrides: Object.fromEntries(names.map(name =>
    ['server/agents/' + name + '.js', {}])) });
  const context = await contextLoader.load('server/agents/index.js').buildContext(1, 1, contextDb(medications));
  const { CDSAgent } = loader.load('server/agents/cds-agent.js');
  return { context, result: await new CDSAgent().process(context) };
}

for (const medications of [undefined, null, {}, [null], [],
  [{ medication_name: 'warfarin', status: 'active' }, { medication_name: 'ibuprofen', status: 'active' }, null]]) {
  test(`context → CDS preserves completeness and findings: ${JSON.stringify(medications)}`, async () => {
    const loader = createLoader();
    const { context, result } = await buildContext(loader, medications);
    assert.equal(context.medications, medications);
    const empty = Array.isArray(medications) && medications.length === 0;
    const warnings = result.suggestions.filter(s => s.suggestion_type === 'interaction_screening_unavailable');
    assert.equal(warnings.length, empty ? 0 : 1);
    if (medications?.length === 3) {
      assert.ok(result.suggestions.some(s => s.source === 'curated_ddi'));
    }
    assert.equal(loader.requests.length, 0);
  });
}

test('CDS emits a warning alongside positive-only curated results', async () => {
  const { result } = await buildContext(createLoader(), [
    { medication_name: 'warfarin', status: 'active' },
    { medication_name: 'ibuprofen', status: 'active' }
  ]);
  assert.ok(result.suggestions.some(s => s.source === 'curated_ddi'));
  assert.ok(result.suggestions.some(s => s.source === 'interaction_screening'));
});

test('MediVault actual agent retains curated findings and incomplete warning', async () => {
  const loader = createLoader({ database: {
    dbAll: async () => [{ id: 99, ocr_text: 'Warfarin\nIbuprofen' }]
  } });
  const { RedFlagAgent } = loader.load('server/medivault/agents/red-flag-agent.js');
  const alerts = await new RedFlagAgent()._checkMedications(1);
  assert.equal(alerts.filter(a => a.type === 'medication_interaction').length, 1);
  assert.ok(alerts.some(a => a.type === 'medication_interaction_unavailable'));
  assert.equal(loader.requests.length, 0);
});

for (const documents of [[], [{ id: 99, ocr_text: '' }], [{ id: 99, ocr_text: '   ' }],
  [{ id: 99, ocr_text: '123\n???' }], [{ id: 99, ocr_text: 'Warfarin\nIbuprofen\n???' }]]) {
  test('MediVault missing/malformed history stays incomplete: ' + JSON.stringify(documents), async () => {
    const loader = createLoader({ database: { dbAll: async () => documents } });
    const { RedFlagAgent } = loader.load('server/medivault/agents/red-flag-agent.js');
    const alerts = await new RedFlagAgent()._checkMedications(1);
    const warning = alerts.find(a => a.type === 'medication_interaction_unavailable');
    assert.equal(warning?.details.unavailable, true);
    assert.equal(warning?.details.inputComplete, false);
    if (documents[0]?.ocr_text.includes('Ibuprofen')) {
      assert.equal(alerts.filter(a => a.type === 'medication_interaction').length, 1);
    }
  });
}
