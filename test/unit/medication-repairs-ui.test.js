'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = Module.createRequire(require.resolve('vite/package.json'))('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// In-memory JSX transform using the project's installed build tool; no HTML
// artifact or browser is created. Exercise the actual React components.
const previousLoader = require.extensions['.jsx'];
const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true } });
require.extensions['.jsx'] = (module, filename) => {
  module._compile(esbuild.transformSync(fs.readFileSync(filename, 'utf8'),
    { loader: 'jsx', format: 'cjs' }).code, filename);
};
after(() => {
  if (previousLoader) require.extensions['.jsx'] = previousLoader;
  else delete require.extensions['.jsx'];
  if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
  else delete global.navigator;
});
const RxSafetyAlerts = require('../../src/components/encounter/RxSafetyAlerts.jsx').default;
const CDSSuggestionList = require('../../src/components/encounter/CDSSuggestionList.jsx').default;
const SpeechSafety = require('../../src/components/encounter/SpeechPrescriptionSafety.jsx').default;

function loadClient() {
  const filename = path.resolve(__dirname, '../../src/api/client.js');
  const module = new Module(filename, moduleParent());
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  module._compile(esbuild.transformSync(fs.readFileSync(filename, 'utf8'),
    { loader: 'js', format: 'cjs' }).code, filename);
  return module.exports.default;
}
function moduleParent() { return module; }
const incomplete = { alerts: [{ type: 'drug_interaction', severity: 'serious',
  title: 'SYNTHETIC CURATED FINDING', description: 'Synthetic pair only' }],
  interactionScreening: { status: 'incomplete' } };

test('actual warning component displays independent finding and incomplete marker together', () => {
  const markup = renderToStaticMarkup(React.createElement(RxSafetyAlerts, { safety: incomplete }));
  assert.match(markup, /SYNTHETIC CURATED FINDING/);
  assert.match(markup, /Verify manually/);
  assert.match(markup, /could not be completed/);
  assert.ok(markup.indexOf('SYNTHETIC CURATED FINDING') < markup.indexOf('Verify manually'));
});

test('actual CDS list keeps failed persistence visible with disabled approval controls', () => {
  const markup = renderToStaticMarkup(React.createElement(CDSSuggestionList, { suggestions: [
    { id: 12, suggestion_type: 'interaction_alert', title: 'SAVED FINDING', status: 'pending' },
    { suggestion_type: 'interaction_screening_unavailable', title: 'UNSAVED WARNING',
      status: 'unsaved', approvable: false, persistence: { status: 'failed' } }
  ] }));
  assert.match(markup, /SAVED FINDING/);
  assert.match(markup, /UNSAVED WARNING/);
  assert.match(markup, /Not saved. Re-evaluate before approval/);
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
});

test('actual partial-batch component renders saved/failed/unattempted drafts and their safety', () => {
  const markup = renderToStaticMarkup(React.createElement(SpeechSafety, { failure: 'Do not repeat the batch',
    prescriptions: [
      { id: 1, medication_name: 'warfarin', safety: incomplete, persistence: { status: 'saved' } },
      { medication_name: 'ibuprofen', safety: incomplete, persistence: { status: 'failed' } },
      { medication_name: 'synthetic-drug', safety: incomplete, persistence: { status: 'not_attempted' } }
    ] }));
  assert.match(markup, /Do not repeat the batch/);
  assert.match(markup, /Draft saved; review required/);
  assert.match(markup, /Not saved/);
  assert.match(markup, /Not attempted/);
  assert.equal((markup.match(/SYNTHETIC CURATED FINDING/g) || []).length, 3);
  assert.equal((markup.match(/Verify manually/g) || []).length, 3);
});

test('actual speech client never retries a non-idempotent POST on network uncertainty', async t => {
  const client = loadClient();
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('synthetic response lost'); });
  await assert.rejects(client.generatePrescriptionsFromSpeech({ transcript: 'synthetic' }), /synthetic response lost/);
  assert.equal(calls, 1);
});

test('actual speech client preserves the full partial-persistence error contract', async t => {
  const client = loadClient();
  const details = { error: 'Batch was not fully saved', code: 'BATCH_PERSISTENCE_FAILED',
    retrySafe: false, prescriptions: [{ id: 9, safety: incomplete }],
    unsavedPrescriptions: [{ medication_name: 'ibuprofen', safety: incomplete,
      persistence: { status: 'failed' } }] };
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return new Response(JSON.stringify(details),
    { status: 500, headers: { 'Content-Type': 'application/json' } }); });
  await assert.rejects(client.generatePrescriptionsFromSpeech({ transcript: 'synthetic' }), err => {
    assert.equal(err.status, 500);
    assert.equal(err.code, 'BATCH_PERSISTENCE_FAILED');
    assert.equal(err.retrySafe, false);
    assert.deepEqual(err.details, details);
    return true;
  });
  assert.equal(calls, 1);
});

test('CDS polling retains unsaved findings alongside historical accepted/rejected titles', async () => {
  const filename = path.resolve(__dirname, '../../src/hooks/useCDS.js');
  const compiled = new Module(filename, module);
  const states = [];
  let stateIndex = 0;
  let stored = [];
  const failed = { title: 'SYNTHETIC WARNING', encounter_id: 44, status: 'unsaved',
    persistence: { status: 'failed' } };
  const api = { evaluateCDS: async () => ({ suggestions: [failed] }), getSuggestions: async () => stored };
  compiled.require = name => name === 'react' ? {
    useState(initial) { const index = stateIndex++; states[index] = initial;
      return [initial, value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useCallback: fn => fn, useEffect() {}
  } : { __esModule: true, default: api };
  compiled._compile(esbuild.transformSync(fs.readFileSync(filename, 'utf8'),
    { format: 'cjs', loader: 'js' }).code, filename);
  const hook = compiled.exports.useCDS(44, 1, { pollInterval: 0 });
  await hook.evaluate();
  for (const status of ['accepted', 'rejected', 'deferred', 'expired']) {
    stored = [{ id: 5, title: failed.title, status }];
    await hook.refresh();
    assert.ok(states[0].includes(failed), status + ' history must not erase unsaved warning');
  }
  stored = [{ id: 6, title: failed.title, status: 'pending' }];
  await hook.refresh();
  assert.deepEqual(states[0], stored);
});
