'use strict';

// Wave 1 SECURITY — P0-4 (medivault-ddi-args-02) regression test.
//
// Proves the MediVault red-flag agent's medication-interaction screening now
// ACTUALLY RUNS. The pre-fix code called checkDrugInteractions(medications) —
// the whole name array as the first argument — so activeMeds was undefined,
// the service guard returned [] every time, and a warfarin+ibuprofen pair was
// never flagged. The fix screens each med pairwise against the rest.
//
// Strategy: stub the drug-safety-service module BEFORE requiring the agent, and
// stub the database accessors so no real DB is touched. We assert that:
//   (1) checkDrugInteractions is called with a STRING drug name + an ARRAY of
//       active-med objects (the corrected contract), never an array-as-first-arg.
//   (2) a known interacting pair produces a medication_interaction alert.
//   (3) when screening reports unavailable, a fail-closed warning alert appears.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Resolve module paths the agent will require, so we patch the SAME cached objects.
const dbPath = require.resolve('../../server/database');
const drugSafetyPath = require.resolve('../../server/pharma/drug-safety-service');

// ── Patch the database module BEFORE the agent destructures dbAll/dbGet/dbRun ──
const db = require(dbPath);
let medListRows = [];
db.dbAll = async (sql) => {
  // The agent queries vault_documents for medication_list / lab_report.
  if (/medication_list/.test(sql)) return medListRows;
  return []; // no lab docs
};
db.dbGet = async () => null;   // no care-gap timeline / vault data
db.dbRun = async () => ({});

// ── Patch the drug-safety service the agent will load ──
const drugSafety = require(drugSafetyPath);
let captured = [];
let nextResult = [];
drugSafety.checkDrugInteractions = async (newDrugName, activeMeds) => {
  captured.push({ newDrugName, activeMeds });
  return nextResult;
};

// Now require the agent — its top-level destructure picks up the patched db fns.
const { RedFlagAgent } = require('../../server/medivault/agents/red-flag-agent');

function medListDoc(meds) {
  return [{ id: 99, ocr_text: meds.join('\n'), created_at: '2026-05-01' }];
}

describe('P0-4 MediVault red-flag: interaction screening actually runs', () => {
  test('calls checkDrugInteractions with (string, array) — not array-as-first-arg', async () => {
    captured = [];
    nextResult = [];
    medListRows = medListDoc(['Warfarin', 'Ibuprofen', 'Lisinopril']);

    const agent = new RedFlagAgent();
    await agent._checkMedications(1);

    assert.ok(captured.length > 0, 'screening must be invoked at least once');
    for (const call of captured) {
      assert.equal(typeof call.newDrugName, 'string',
        'first arg must be a single drug NAME string (the old bug passed the whole array)');
      assert.ok(Array.isArray(call.newDrugName) === false);
      assert.ok(Array.isArray(call.activeMeds),
        'second arg must be the active-meds array (was undefined in the old bug)');
      assert.ok(call.activeMeds.every(m => typeof m.medication_name === 'string'),
        'active meds must be {medication_name} objects the service expects');
    }
  });

  test('a known interacting pair produces a medication_interaction alert', async () => {
    captured = [];
    medListRows = medListDoc(['Warfarin', 'Ibuprofen']);
    // Stub the service to flag whenever warfarin is screened against ibuprofen.
    nextResult = [];
    drugSafety.checkDrugInteractions = async (newDrugName, activeMeds) => {
      captured.push({ newDrugName, activeMeds });
      const names = [newDrugName.toLowerCase(), ...activeMeds.map(m => m.medication_name.toLowerCase())];
      if (names.includes('warfarin') && names.includes('ibuprofen')) {
        return [{ drug1: 'Warfarin', drug2: 'Ibuprofen', severity: 'critical', description: 'Increased bleeding risk' }];
      }
      return [];
    };

    const agent = new RedFlagAgent();
    const alerts = await agent._checkMedications(1);

    const ddi = alerts.find(a => a.type === 'medication_interaction');
    assert.ok(ddi, 'a medication_interaction alert MUST be raised for warfarin+ibuprofen');
    assert.equal(ddi.severity, 'critical');
    assert.match(ddi.description, /Warfarin/i);
    assert.match(ddi.description, /Ibuprofen/i);
  });

  test('fails closed: unavailable screening surfaces a warning alert', async () => {
    captured = [];
    medListRows = medListDoc(['Warfarin', 'Aspirin']);
    drugSafety.checkDrugInteractions = async () => [{
      drug1: 'Warfarin', drug2: null, unavailable: true, status: 'unavailable',
      severity: 'unknown', description: 'Drug interaction check unavailable — verify manually.'
    }];

    const agent = new RedFlagAgent();
    const alerts = await agent._checkMedications(1);

    const warn = alerts.find(a => a.type === 'medication_interaction_unavailable');
    assert.ok(warn, 'unavailable screening must surface an explicit warning (fail closed)');
    assert.equal(warn.details.unavailable, true);
    // Must NOT be silently treated as "no interactions" (zero alerts).
    assert.ok(alerts.length > 0);
  });
});
