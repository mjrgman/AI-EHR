'use strict';

// Unit/integration tests for the provider Decision Queue persistence + routing.
//
// Two layers:
//   1. DB layer — exercises the decision_queue migration + CRUD helpers
//      (createDecisionQueueItem, updateDecisionQueueAI, recordDecision,
//      closeDecision, getProviderDecisionQueue, getMaCloseouts) against a REAL
//      isolated SQLite database (temp DATABASE_PATH), proving the full
//      pending -> decided -> closed lifecycle and the sickest-first ordering.
//   2. Route-wiring layer — source assertions on server.js confirming the four
//      endpoints exist with the correct RBAC role gates (provider-only decide,
//      ma+provider close-out) and that the decision routes the encounter
//      workflow to the MA-actionable 'orders-pending' state. This mirrors the
//      source-level convention used by dashboard-queue-config.test.js for
//      assertions that cannot be require()'d in isolation.
//
// SYNTHETIC DATA ONLY.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ----------------------------------------------------------------------------
// Layer 1 — real isolated DB. Set DATABASE_PATH BEFORE requiring database.js
// so the singleton opens our throwaway file, not the demo DB.
// ----------------------------------------------------------------------------
const tmpDbPath = path.join(os.tmpdir(), `dq-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDbPath;
process.env.AI_MODE = 'mock';
delete process.env.PHI_ENCRYPTION_KEY; // store plaintext synthetic data

const db = require('../../server/database');
const { createDecisionQueueTable } = require('../../server/database-migrations');

let encA, encB, patientId;

before(async () => {
  await db.ready; // demo schema + demo patients loaded
  await createDecisionQueueTable(db);

  // Use a demo patient (Robert Chen) seeded by loadDemoData.
  const p = await db.dbGet("SELECT id FROM patients WHERE mrn = '2020-18834'");
  patientId = p ? p.id : (await db.dbGet('SELECT id FROM patients ORDER BY id LIMIT 1')).id;

  // Two synthetic encounters with different acuity, so ordering is testable.
  const e1 = await db.createEncounter({ patient_id: patientId, chief_complaint: 'Chest pain', provider: 'Dr. Test' });
  const e2 = await db.createEncounter({ patient_id: patientId, chief_complaint: 'Routine follow-up', provider: 'Dr. Test' });
  encA = e1.id; encB = e2.id;
});

after(() => {
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDbPath + ext); } catch { /* ignore */ }
  }
});

describe('decision_queue: DB lifecycle', () => {
  test('createDecisionQueueItem creates a pending row (idempotent on encounter)', async () => {
    const a = await db.createDecisionQueueItem({ encounter_id: encA, patient_id: patientId });
    assert.equal(a.status, 'pending');
    assert.equal(a.encounter_id, encA);
    // Second call must NOT create a duplicate (UNIQUE encounter_id).
    const again = await db.createDecisionQueueItem({ encounter_id: encA, patient_id: patientId });
    assert.equal(again.id, a.id);
  });

  test('updateDecisionQueueAI persists triage/summary/options + model tiers', async () => {
    const item = await db.getDecisionQueueItemByEncounter(encA);
    await db.updateDecisionQueueAI(item.id, {
      esi_level: 2,
      level_of_care: 'Emergent',
      triage_rationale: '[ESI 2 — AHRQ] high-risk chest pain',
      triage_model: 'claude-sonnet-4-6',
      ai_summary: 'A patient with chest pain.',
      summary_model: 'claude-haiku-4-5-20251001',
      decision_options: [
        { key: 'escalate_emergent', label: 'Escalate', detail: 'x', action: 'admit' },
        { key: 'stat_diagnostics', label: 'Stat EKG', detail: 'x', action: 'lab_order' },
        { key: 'specialist_now', label: 'Consult', detail: 'x', action: 'referral' },
        { key: 'reassess_15', label: 'Reassess', detail: 'x', action: 'follow_up' },
      ],
      decision_model: 'claude-sonnet-4-6',
    });
    const reloaded = await db.getDecisionQueueItemById(item.id);
    assert.equal(reloaded.esi_level, 2);
    assert.equal(reloaded.summary_model, 'claude-haiku-4-5-20251001');
    assert.equal(reloaded.decision_model, 'claude-sonnet-4-6');
    const opts = JSON.parse(reloaded.decision_options);
    assert.equal(opts.length, 4);
  });

  test('getProviderDecisionQueue returns sickest-first (lower ESI first)', async () => {
    await db.createDecisionQueueItem({ encounter_id: encB, patient_id: patientId });
    const itemB = await db.getDecisionQueueItemByEncounter(encB);
    await db.updateDecisionQueueAI(itemB.id, {
      esi_level: 4, level_of_care: 'Routine', triage_rationale: 'routine', triage_model: 'claude-sonnet-4-6',
      ai_summary: 'routine', summary_model: 'claude-haiku-4-5-20251001', decision_options: [], decision_model: 'claude-sonnet-4-6',
    });

    const queue = await db.getProviderDecisionQueue();
    const esiOrder = queue.filter(r => [encA, encB].includes(r.encounter_id)).map(r => r.esi_level);
    // ESI 2 (encA) must come before ESI 4 (encB).
    assert.deepEqual(esiOrder, [2, 4]);
    // Joined patient fields are present for the UI.
    assert.ok(queue[0].first_name);
    assert.ok(queue[0].chief_complaint);
  });

  test('recordDecision (one-click) marks decided + awaiting; appears in MA close-outs', async () => {
    const item = await db.getDecisionQueueItemByEncounter(encA);
    const r = await db.recordDecision(item.id, {
      decision_key: 'stat_diagnostics',
      decision_label: 'Stat EKG',
      decision_text: null,
      decided_by: 'Dr. Test',
    });
    assert.equal(r.changes, 1);

    const reloaded = await db.getDecisionQueueItemById(item.id);
    assert.equal(reloaded.status, 'decided');
    assert.equal(reloaded.ma_status, 'awaiting');
    assert.equal(reloaded.decision_key, 'stat_diagnostics');

    const closeouts = await db.getMaCloseouts();
    assert.ok(closeouts.some(c => c.id === item.id), 'decided item appears in MA close-out worklist');
  });

  test('recordDecision (dictated free text) persists decision_text', async () => {
    const item = await db.getDecisionQueueItemByEncounter(encB);
    const r = await db.recordDecision(item.id, {
      decision_key: null,
      decision_label: 'Dictated decision',
      decision_text: 'Start metformin 500mg BID and recheck A1c in 3 months.',
      decided_by: 'Dr. Test',
    });
    assert.equal(r.changes, 1);
    const reloaded = await db.getDecisionQueueItemById(item.id);
    assert.equal(reloaded.status, 'decided');
    assert.match(reloaded.decision_text, /metformin/);
  });

  test('recordDecision is a no-op once already decided (cannot double-decide)', async () => {
    const item = await db.getDecisionQueueItemByEncounter(encA);
    const r = await db.recordDecision(item.id, { decision_key: 'reassess_15', decided_by: 'Dr. Test' });
    assert.equal(r.changes, 0);
  });

  test('closeDecision marks closed + removes from MA close-out worklist', async () => {
    const item = await db.getDecisionQueueItemByEncounter(encA);
    const r = await db.closeDecision(item.id, { closed_by: 'Demo MA' });
    assert.equal(r.changes, 1);

    const reloaded = await db.getDecisionQueueItemById(item.id);
    assert.equal(reloaded.status, 'closed');
    assert.equal(reloaded.ma_status, 'closed');
    assert.equal(reloaded.closed_by, 'Demo MA');

    const closeouts = await db.getMaCloseouts();
    assert.ok(!closeouts.some(c => c.id === item.id), 'closed item no longer in MA worklist');
  });

  test('closeDecision is a no-op on a pending (undecided) item', async () => {
    const e3 = await db.createEncounter({ patient_id: patientId, chief_complaint: 'Cough', provider: 'Dr. Test' });
    const item = await db.createDecisionQueueItem({ encounter_id: e3.id, patient_id: patientId });
    const r = await db.closeDecision(item.id, { closed_by: 'Demo MA' });
    assert.equal(r.changes, 0, 'cannot close a pending item');
  });
});

// ----------------------------------------------------------------------------
// Layer 2 — route-wiring source assertions on server.js.
// ----------------------------------------------------------------------------
describe('decision-queue: server route wiring + RBAC gates', () => {
  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../../server/server.js'), 'utf8');

  test('GET /api/decisions is provider-only', () => {
    assert.match(serverSrc, /app\.get\('\/api\/decisions',\s*rbac\.requireRole\(\.\.\.PROVIDER_DECISION_ROLES\)/);
  });

  test('POST /api/decisions/:id/decide is provider-only', () => {
    assert.match(serverSrc, /app\.post\('\/api\/decisions\/:id\/decide',\s*rbac\.requireRole\(\.\.\.PROVIDER_DECISION_ROLES\)/);
  });

  test('GET /api/decisions/ma/closeouts is gated to ma + provider', () => {
    assert.match(serverSrc, /app\.get\('\/api\/decisions\/ma\/closeouts',\s*rbac\.requireRole\(\.\.\.MA_CLOSEOUT_ROLES\)/);
  });

  test('POST /api/decisions/:id/close is gated to ma + provider', () => {
    assert.match(serverSrc, /app\.post\('\/api\/decisions\/:id\/close',\s*rbac\.requireRole\(\.\.\.MA_CLOSEOUT_ROLES\)/);
  });

  test('provider role set is physician + nurse_practitioner only', () => {
    assert.match(serverSrc, /const PROVIDER_DECISION_ROLES = \['physician', 'nurse_practitioner'\];/);
  });

  test('MA close-out role set includes ma + both providers', () => {
    assert.match(serverSrc, /const MA_CLOSEOUT_ROLES = \['ma', 'physician', 'nurse_practitioner'\];/);
  });

  test('deciding routes the encounter to the MA-actionable orders-pending state', () => {
    assert.match(serverSrc, /transitionState\(item\.encounter_id, 'orders-pending'/);
  });
});
