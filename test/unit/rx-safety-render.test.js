'use strict';

// Unit tests for the prescription drug-safety render fix (audit UR-001/A2
// last-mile). The prescription endpoints compute and RETURN a `safety` object
// (drug-interaction alerts, boxed warnings, and an interaction-screening-
// unavailable flag), but before this fix NOTHING in src/ rendered it — the
// drug-safety net was invisible to the prescriber at signing time.
//
// These are deliberate SOURCE-LEVEL assertions, consistent with
// ui-quick-wins.test.js / dashboard-queue-config.test.js: the targets are
// JSX/ESM (React) source files that cannot be require()'d in a node:test
// CommonJS runner (no JSX transform). They parse the relevant region out of the
// source text and fail loudly if the wiring regresses. They assert BOTH
// prescription paths (manual Rx modal + from-speech) consume `safety`, and that
// the critical-finding vs screening-unavailable distinction is preserved.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const encounterPath = path.resolve(__dirname, '../../src/pages/EncounterPage.jsx');
const rxSafetyPath = path.resolve(__dirname, '../../src/components/encounter/RxSafetyAlerts.jsx');
const clientPath = path.resolve(__dirname, '../../src/api/client.js');

const encounterSrc = fs.readFileSync(encounterPath, 'utf8');
const rxSafetySrc = fs.readFileSync(rxSafetyPath, 'utf8');
const clientSrc = fs.readFileSync(clientPath, 'utf8');

describe('rx-safety-render: the server safety object now has real consumers in src/', () => {
  test('EncounterPage imports and renders the RxSafetyAlerts component', () => {
    assert.match(
      encounterSrc,
      /import RxSafetyAlerts from '\.\.\/components\/encounter\/RxSafetyAlerts'/,
      'EncounterPage must import RxSafetyAlerts'
    );
    assert.match(
      encounterSrc,
      /<RxSafetyAlerts\b/,
      'EncounterPage must render <RxSafetyAlerts /> at least once'
    );
  });

  test('the bug premise is fixed: "safety" is now consumed, not just present in comments', () => {
    // Real consumers, not just the word "safety" in a comment.
    assert.match(encounterSrc, /result\?\.safety/, 'manual path must read result.safety from the response');
    assert.match(encounterSrc, /rx\.safety/, 'from-speech path must read each prescription.safety');
  });
});

describe('rx-safety-render: MANUAL Rx modal path surfaces safety at sign time', () => {
  test('handleCreateRx captures the response and stores its safety object', () => {
    // The server returns { ...result, safety }; the handler must keep it.
    assert.match(
      encounterSrc,
      /const result = await api\.createPrescription\(/,
      'handleCreateRx must capture the createPrescription response (not discard it)'
    );
    assert.match(
      encounterSrc,
      /setRxSafety\(/,
      'handleCreateRx must store the returned safety object in state'
    );
    assert.match(
      encounterSrc,
      /const \[rxSafety, setRxSafety\] = useState\(/,
      'a rxSafety state slot must exist for the manual path'
    );
  });

  test('manual-path safety renders via RxSafetyAlerts', () => {
    assert.match(
      encounterSrc,
      /rxSafety && \(\s*<RxSafetyAlerts safety=\{rxSafety\.safety\}/,
      'rxSafety must render through RxSafetyAlerts'
    );
  });
});

describe('rx-safety-render: FROM-SPEECH path is wired and surfaces safety at sign time', () => {
  test('api client exposes a from-speech prescription method', () => {
    assert.match(
      clientSrc,
      /generatePrescriptionsFromSpeech:\s*\(data\)\s*=>\s*request\('\/prescriptions\/from-speech'/,
      'client must call POST /prescriptions/from-speech'
    );
  });

  test('EncounterPage has a from-speech handler that keeps each safety object', () => {
    assert.match(
      encounterSrc,
      /async function handleGenerateRxFromSpeech\(/,
      'a from-speech handler must exist'
    );
    assert.match(
      encounterSrc,
      /api\.generatePrescriptionsFromSpeech\(/,
      'the handler must call the from-speech client method'
    );
    // Server returns { prescriptions: [{ ...rxData, id, safety }] }; keep them all.
    assert.match(
      encounterSrc,
      /result\?\.prescriptions/,
      'the handler must read the prescriptions array from the response'
    );
    assert.match(
      encounterSrc,
      /setSpeechRxSafety\(/,
      'the handler must store per-prescription safety in state'
    );
    assert.match(
      encounterSrc,
      /const \[speechRxSafety, setSpeechRxSafety\] = useState\(/,
      'a speechRxSafety state slot must exist for the from-speech path'
    );
  });

  test('from-speech safety renders one RxSafetyAlerts per created prescription', () => {
    assert.match(
      encounterSrc,
      /speechRxSafety\.map\(\(rx, i\) => \(\s*<RxSafetyAlerts[^]*?safety=\{rx\.safety\}/,
      'each from-speech prescription must render through RxSafetyAlerts'
    );
  });

  test('there is a UI trigger for the from-speech path', () => {
    assert.match(
      encounterSrc,
      /onClick=\{handleGenerateRxFromSpeech\}/,
      'a control must invoke the from-speech handler'
    );
  });
});

describe('rx-safety-render: critical vs screening-unavailable distinction is preserved', () => {
  test('RxSafetyAlerts consumes the documented server safety shape', () => {
    assert.match(rxSafetySrc, /safety\.alerts/, 'must read safety.alerts');
    assert.match(rxSafetySrc, /interactionScreeningUnavailable/, 'must honor the fail-closed flag');
  });

  test('screening-unavailable is detected by type/flag/severity', () => {
    assert.match(rxSafetySrc, /interaction_screening_unavailable/);
    assert.match(rxSafetySrc, /\.unavailable === true/);
    assert.match(rxSafetySrc, /severity === 'warning'/);
  });

  test('critical findings (interactions / boxed warnings / contraindications) get danger treatment', () => {
    // Critical/serious clinical findings ride the red danger variant + surface.
    assert.match(rxSafetySrc, /severity === 'critical'/);
    assert.match(rxSafetySrc, /severity === 'serious'/);
    assert.match(rxSafetySrc, /return 'danger'/, 'critical/serious must map to the danger Badge variant');
    assert.match(rxSafetySrc, /bg-danger-50 ring-1 ring-danger-200/, 'critical alerts use the danger surface');
  });

  test('screening-unavailable is a WARNING (warn-and-allow), not a danger/hard block', () => {
    assert.match(rxSafetySrc, /return 'warning'/, 'screening-unavailable maps to the gold warning Badge variant');
    assert.match(rxSafetySrc, /bg-gold-50 ring-1 ring-gold-200/, 'screening-unavailable uses the gold warning surface');
    assert.match(rxSafetySrc, /Verify manually/, 'screening-unavailable must read as a manual-verify warning');
  });

  test('the two tiers are split before render (critical first, then unavailable)', () => {
    assert.match(rxSafetySrc, /const critical = alerts\.filter\(a => !isScreeningUnavailableAlert\(a\)\)/);
    assert.match(rxSafetySrc, /const unavailable = alerts\.filter\(isScreeningUnavailableAlert\)/);
  });

  test('a clean screen (no findings, screening available) renders nothing', () => {
    assert.match(
      rxSafetySrc,
      /if \(critical\.length === 0 && !showScreeningWarning\) return null/,
      'no alert surface when there is genuinely nothing to warn about'
    );
  });
});

describe('rx-safety-render: accessibility + Measured Canon idiom reuse (matches cdsError)', () => {
  test('alert rows use role="alert" + aria-live, like the wave-1 cdsError badge', () => {
    assert.match(rxSafetySrc, /role="alert"/);
    assert.match(rxSafetySrc, /aria-live="assertive"/);
  });

  test('reuses the common Badge component rather than ad-hoc pills', () => {
    assert.match(rxSafetySrc, /import Badge from '\.\.\/common\/Badge'/);
  });
});

describe('UR-010: autosave failure is a visible, persistent, retryable state (not silently blanked)', () => {
  test('the autosave catch no longer silently blanks the indicator', () => {
    // The old code did setAutoSaveStatus('') in the catch — that silent blank
    // made unsaved work look saved. It must now set a visible 'failed' state.
    assert.match(
      encounterSrc,
      /setAutoSaveStatus\('failed'\)/,
      "autosave failure must set a persistent 'failed' state"
    );
    assert.ok(
      !/catch \(e\) \{\s*safeLog\.error\('Auto-save failed:', e\);\s*setAutoSaveStatus\(''\);/.test(encounterSrc),
      'the silent setAutoSaveStatus(\'\') on autosave failure must be gone'
    );
  });

  test("a visible 'Save failed' affordance with a Retry control is rendered", () => {
    assert.match(encounterSrc, /autoSaveStatus === 'failed'/, "render must branch on the 'failed' state");
    assert.match(encounterSrc, /Save failed/);
    assert.match(encounterSrc, /onClick=\{persistTranscript\}/, 'Retry must re-run the persistence call');
  });

  test("unsaved-work protection treats 'failed' as unsaved", () => {
    assert.match(
      encounterSrc,
      /autoSaveStatus === 'saving' \|\| autoSaveStatus === 'failed'/,
      "hasUnsavedChanges must include the 'failed' state"
    );
  });
});
