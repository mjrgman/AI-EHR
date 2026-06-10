'use strict';

// Regression tests pinning the UltrareView remediation batch executed 2026-06-09
// (owner decisions A2/A4/A5). Functional tests where the unit is cleanly callable
// (rbac matrix, HEART protocol); source-level assertions for JSX / DB-coupled
// logic that cannot be require()'d or invoked without a live server (the same
// pattern used by ui-quick-wins.test.js).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rbac = require('../../server/security/rbac');
const cds = require('../../server/cds-engine');

// ── A4: vitals write policy = allow-physician ───────────────────────────────
describe('A4 — vitals write policy (allow-physician)', () => {
  test('physician may write vitals', () => {
    assert.equal(rbac.canWrite('physician', 'vitals'), true);
  });
  test('nurse_practitioner may write vitals', () => {
    assert.equal(rbac.canWrite('nurse_practitioner', 'vitals'), true);
  });
  test('ma may still write vitals (rooming)', () => {
    assert.equal(rbac.canWrite('ma', 'vitals'), true);
  });
  test('front_desk may NOT write vitals (deny-by-default preserved)', () => {
    assert.equal(rbac.canWrite('front_desk', 'vitals'), false);
  });
});

// ── A5 / UR-003 + UR-004: HEART score priority + lab-order action type ───────
describe('A5 — HEART score protocol (UR-003 priority, UR-004 action type)', () => {
  const highRiskContext = {
    chiefComplaint: 'squeezing chest pressure radiates to left arm with diaphoresis',
    patient: { dob: '1950-01-01' }, // age ≥ 65 → age component 2
    problems: [],
    labs: [{ test_name: 'Troponin I', result: '0.50', reference_range_high: '0.04' }], // > 3×ULN → 2
  };

  test('high-risk HEART score gets top priority (1), never the old hard-coded 5', () => {
    const out = cds.evaluateHeartScoreProtocol(highRiskContext);
    assert.equal(out.length, 1);
    assert.equal(typeof out[0].priority, 'number');
    assert.equal(out[0].priority, 1, 'high-risk must sort above routine priority-1 alerts');
    assert.notEqual(out[0].priority, 5);
  });

  test('serial-troponin actions use create_lab_order (matches executeSuggestion switch)', () => {
    const out = cds.evaluateHeartScoreProtocol(highRiskContext);
    const actions = out[0].suggested_action.actions;
    assert.equal(actions.length, 2);
    for (const a of actions) {
      assert.equal(a.type, 'create_lab_order', 'order_lab would silently no-op on accept');
    }
  });

  test('low-risk HEART score gets a lower priority (dynamic, not constant)', () => {
    const out = cds.evaluateHeartScoreProtocol({
      chiefComplaint: 'sharp pleuritic chest pain reproducible on palpation',
      patient: { dob: '2005-01-01' }, // young → age 0
      problems: [],
      labs: [],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].priority, 4, 'low-risk should be priority 4, proving priority is dynamic');
  });
});

// ── Source-level assertions (UR-005 workflow; UR-002/008/009/011 JSX) ────────
function readSrc(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
}

describe('A5 — UR-005 MA workflow handoff + 403 mapping (source)', () => {
  const wf = readSrc('../../server/workflow-engine.js');
  const server = readSrc('../../server/server.js');

  test('workflow-engine permits an MA to advance into provider-queue handoff states', () => {
    assert.match(wf, /maHandoffStates\s*=\s*\[\s*'vitals-recorded'\s*,\s*'provider-examining'\s*\]/);
    assert.match(wf, /isMaHandoff/);
  });
  test('transition route maps a role denial to 403, not 500', () => {
    assert.match(server, /cannot transition[\s\S]{0,400}res\.status\(403\)/);
  });
});

describe('A5 — UI safety fixes (source)', () => {
  test('UR-008: PatientBanner noon-anchors the DOB', () => {
    const src = readSrc('../../src/components/patient/PatientBanner.jsx');
    assert.match(src, /T12:00:00/);
  });
  test('UR-009: EncounterPage med list filters to active meds', () => {
    const src = readSrc('../../src/pages/EncounterPage.jsx');
    assert.match(src, /filter\(m\s*=>\s*m\.status\s*===\s*'active'\)/);
  });
  test('UR-011: VitalsDisplay flags abnormal respiratory rate', () => {
    const src = readSrc('../../src/components/patient/VitalsDisplay.jsx');
    assert.match(src, /respiratory_rate\s*<\s*10\s*\|\|\s*vitals\.respiratory_rate\s*>\s*20/);
  });
  test('UR-002: EncounterPage renders a distinct CDS-unavailable alert', () => {
    const src = readSrc('../../src/pages/EncounterPage.jsx');
    assert.match(src, /cdsError/);
    assert.match(src, /CDS screening unavailable/);
  });
});

// ── A2: drug-safety screening wired at prescribe time (source) ───────────────
describe('A2 — fullSafetyCheck wired at prescribe time, warn-and-allow (source)', () => {
  const server = readSrc('../../server/server.js');
  test('drug-safety service is imported', () => {
    assert.match(server, /require\('\.\/pharma\/drug-safety-service'\)/);
  });
  test('prescription handlers invoke fullSafetyCheck', () => {
    assert.match(server, /drugSafety\.fullSafetyCheck/);
  });
  test('prescription response carries the safety result', () => {
    assert.match(server, /\.\.\.result,\s*safety/);
  });
});
