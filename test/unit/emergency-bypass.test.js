'use strict';

// Unit/integration tests for the EMERGENCY-BYPASS layer on top of the provider
// Decision Queue.
//
// Per AHRQ Emergency Severity Index v4: ESI 1 = patient requires IMMEDIATE
// life-saving intervention; ESI 2 = high-risk situation, the patient cannot
// safely wait. Both are emergent and must BYPASS the routine 4-option
// deliberative decision tree — they get a single one-click "Call 911 / Send to
// ED now" headline action (plus an ED-transfer fallback), and a 911/ED decision
// is recorded as an EMERGENCY ESCALATION that flags the MA close-out.
//
// Three layers:
//   1. triage-service — the pure isEmergency() threshold + emergency option set
//      and the buildDecisionOptions()/mockDecisionOptions() suppression of the
//      routine tree for ESI 1-2 (and the unchanged 4-option set for ESI 3-5).
//   2. DB + serialization-shape — a 911/ED decide records the escalation
//      disposition and the MA close-out worklist exposes it.
//   3. Route/source wiring — server.js exposes is_emergency, emergency_count,
//      emergency_escalated, and the emergency disposition label.
//
// SYNTHETIC DATA ONLY.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Force mock mode before requiring the service (ai-client reads env at load).
delete process.env.ANTHROPIC_API_KEY;
process.env.AI_MODE = 'mock';

const triage = require('../../server/triage-service');

// ----------------------------------------------------------------------------
// Synthetic records spanning the acuity spectrum.
// ----------------------------------------------------------------------------
const ESI1_CRITICAL = {
  first_name: 'Critical', last_name: 'Case', sex: 'M', age: 60,
  chief_complaint: 'Severe shortness of breath',
  vitals: { spo2: 84, systolic_bp: 88, heart_rate: 134, respiratory_rate: 34, temperature: 99.1 },
  problems: [{ problem_name: 'COPD', status: 'chronic' }],
};
const ESI2_HIGH_RISK = {
  first_name: 'Robert', last_name: 'Chen', sex: 'M', age: 70,
  chief_complaint: 'Chest pain radiating to the left arm',
  vitals: { spo2: 96, systolic_bp: 150, heart_rate: 98, respiratory_rate: 18, temperature: 98.6 },
  problems: [{ problem_name: 'Coronary Artery Disease', status: 'chronic' }],
};
const ESI3_URGENT = {
  first_name: 'Sarah', last_name: 'Mitchell', sex: 'F', age: 62,
  chief_complaint: 'Blood sugars running high, increased thirst',
  vitals: { spo2: 98, systolic_bp: 142, heart_rate: 88, respiratory_rate: 16, temperature: 98.6 },
  problems: [{ problem_name: 'Type 2 Diabetes Mellitus', status: 'chronic' }, { problem_name: 'Hypertension', status: 'chronic' }],
};
const ESI4_ROUTINE = {
  first_name: 'Wellness', last_name: 'Visit', sex: 'F', age: 35,
  chief_complaint: 'Annual physical, no complaints',
  vitals: { spo2: 99, systolic_bp: 118, heart_rate: 70, respiratory_rate: 14, temperature: 98.4 },
  problems: [],
};
const ESI5_SELFCARE = { vitals: {}, problems: [], chief_complaint: '' };

const ROUTINE_OPTION_KEYS = new Set([
  'escalate_emergent', 'stat_diagnostics', 'specialist_now', 'reassess_15',
  'treat_and_educate', 'order_workup', 'refer_specialist', 'schedule_followup',
]);

describe('emergency-bypass: isEmergency threshold (AHRQ ESI 1-2)', () => {
  test('ESI 1 => is_emergency true', () => {
    const t = triage.mockTriage(ESI1_CRITICAL);
    assert.equal(t.esi_level, 1);
    assert.equal(triage.isEmergency(t.esi_level), true);
  });

  test('ESI 2 => is_emergency true', () => {
    const t = triage.mockTriage(ESI2_HIGH_RISK);
    assert.equal(t.esi_level, 2);
    assert.equal(triage.isEmergency(t.esi_level), true);
  });

  test('ESI 3 => is_emergency false', () => {
    const t = triage.mockTriage(ESI3_URGENT);
    assert.equal(t.esi_level, 3);
    assert.equal(triage.isEmergency(t.esi_level), false);
  });

  test('ESI 4 => is_emergency false', () => {
    const t = triage.mockTriage(ESI4_ROUTINE);
    assert.equal(t.esi_level, 4);
    assert.equal(triage.isEmergency(t.esi_level), false);
  });

  test('ESI 5 => is_emergency false', () => {
    const t = triage.mockTriage(ESI5_SELFCARE);
    assert.equal(t.esi_level, 5);
    assert.equal(triage.isEmergency(t.esi_level), false);
  });

  test('null/undefined esi => is_emergency false (no false-positive emergencies)', () => {
    assert.equal(triage.isEmergency(null), false);
    assert.equal(triage.isEmergency(undefined), false);
  });
});

describe('emergency-bypass: decision set suppresses the routine 4-option tree for ESI 1-2', () => {
  test('ESI 1 exposes the emergency_911 option and SUPPRESSES all routine keys', () => {
    const t = triage.mockTriage(ESI1_CRITICAL);
    const opts = triage.mockDecisionOptions(ESI1_CRITICAL, t);
    const keys = opts.map(o => o.key);
    assert.ok(keys.includes(triage.EMERGENCY_911_KEY), 'has the one-click 911 action');
    assert.ok(keys.includes(triage.EMERGENCY_ED_TRANSFER_KEY), 'has the ED-transfer fallback');
    // The routine deliberative tree is suppressed — none of its keys appear.
    for (const k of keys) assert.ok(!ROUTINE_OPTION_KEYS.has(k), `routine key ${k} must be suppressed`);
  });

  test('ESI 2 exposes the emergency_911 option and SUPPRESSES all routine keys', () => {
    const t = triage.mockTriage(ESI2_HIGH_RISK);
    const opts = triage.mockDecisionOptions(ESI2_HIGH_RISK, t);
    const keys = opts.map(o => o.key);
    assert.ok(keys.includes(triage.EMERGENCY_911_KEY));
    for (const k of keys) assert.ok(!ROUTINE_OPTION_KEYS.has(k));
  });

  test('the 911 headline option is labeled and a one-click admit action', () => {
    const opts = triage.emergencyDecisionOptions(ESI2_HIGH_RISK, triage.mockTriage(ESI2_HIGH_RISK));
    const headline = opts.find(o => o.key === triage.EMERGENCY_911_KEY);
    assert.ok(headline);
    assert.match(headline.label, /Call 911 \/ Send to ED now/);
    assert.equal(headline.action, 'admit');
  });

  test('buildDecisionOptions returns the emergency set in mode "emergency-bypass" for ESI 1-2', async () => {
    const t = await triage.triagePatient(ESI2_HIGH_RISK);
    assert.equal(t.esi_level, 2);
    const r = await triage.buildDecisionOptions(ESI2_HIGH_RISK, t);
    assert.equal(r.mode, 'emergency-bypass');
    const keys = r.options.map(o => o.key);
    assert.ok(keys.includes(triage.EMERGENCY_911_KEY));
    for (const k of keys) assert.ok(!ROUTINE_OPTION_KEYS.has(k));
  });
});

describe('emergency-bypass: routine (ESI 3-5) items keep exactly 4 options + dictate', () => {
  test('ESI 3 keeps exactly four routine options (dictate is the 5th, rendered client-side)', () => {
    const t = triage.mockTriage(ESI3_URGENT);
    const opts = triage.mockDecisionOptions(ESI3_URGENT, t);
    assert.equal(opts.length, 4, 'routine items expose exactly four one-click options');
    const keys = opts.map(o => o.key);
    assert.ok(!keys.includes(triage.EMERGENCY_911_KEY), 'routine items must NOT expose the 911 action');
    for (const o of opts) {
      assert.ok(o.key && o.label && o.detail && o.action);
    }
  });

  test('ESI 4 keeps exactly four routine options', () => {
    const t = triage.mockTriage(ESI4_ROUTINE);
    const opts = triage.mockDecisionOptions(ESI4_ROUTINE, t);
    assert.equal(opts.length, 4);
    assert.ok(!opts.map(o => o.key).includes(triage.EMERGENCY_911_KEY));
  });

  test('buildDecisionOptions for ESI 3 is NOT emergency-bypass and returns >= 4 options', async () => {
    const t = await triage.triagePatient(ESI3_URGENT);
    const r = await triage.buildDecisionOptions(ESI3_URGENT, t);
    assert.notEqual(r.mode, 'emergency-bypass');
    assert.ok(r.options.length >= 4);
  });
});

// ----------------------------------------------------------------------------
// DB layer — real isolated SQLite. The emergency decide path records the
// escalation disposition; the MA close-out worklist surfaces it.
// ----------------------------------------------------------------------------
const tmpDbPath = path.join(os.tmpdir(), `eb-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDbPath;
delete process.env.PHI_ENCRYPTION_KEY; // store plaintext synthetic data

const db = require('../../server/database');
const { createDecisionQueueTable } = require('../../server/database-migrations');

// Mirror of server.js serializeDecisionItem's emergency derivation, so the test
// asserts the exact contract the API exposes (is_emergency / emergency_escalated).
function deriveEmergencyFlags(row) {
  const is_emergency = triage.isEmergency(row.esi_level);
  const emergency_escalated =
    triage.EMERGENCY_DECISION_KEYS.includes(row.decision_key) ||
    (is_emergency && row.status !== 'pending');
  return { is_emergency, emergency_escalated };
}

let emergencyEnc, routineEnc, patientId;

describe('emergency-bypass: decide path records escalation + flags MA close-out', () => {
  before(async () => {
    await db.ready;
    await createDecisionQueueTable(db);

    const p = await db.dbGet("SELECT id FROM patients WHERE mrn = '2020-18834'");
    patientId = p ? p.id : (await db.dbGet('SELECT id FROM patients ORDER BY id LIMIT 1')).id;

    const e1 = await db.createEncounter({ patient_id: patientId, chief_complaint: 'Severe SOB', provider: 'Dr. Test' });
    const e2 = await db.createEncounter({ patient_id: patientId, chief_complaint: 'Routine follow-up', provider: 'Dr. Test' });
    emergencyEnc = e1.id; routineEnc = e2.id;

    // Emergency item (ESI 2) with the emergency-bypass option set cached.
    await db.createDecisionQueueItem({ encounter_id: emergencyEnc, patient_id: patientId });
    const emItem = await db.getDecisionQueueItemByEncounter(emergencyEnc);
    await db.updateDecisionQueueAI(emItem.id, {
      esi_level: 2, level_of_care: 'Emergent', triage_rationale: '[ESI 2] high-risk', triage_model: triage.MODEL_TOP,
      ai_summary: 'Emergent patient.', summary_model: triage.MODEL_MID,
      decision_options: triage.emergencyDecisionOptions({ chief_complaint: 'Severe SOB' }, { esi_level: 2, level_of_care: 'Emergent' }),
      decision_model: triage.MODEL_TOP,
    });

    // Routine item (ESI 4).
    await db.createDecisionQueueItem({ encounter_id: routineEnc, patient_id: patientId });
    const rtItem = await db.getDecisionQueueItemByEncounter(routineEnc);
    await db.updateDecisionQueueAI(rtItem.id, {
      esi_level: 4, level_of_care: 'Routine', triage_rationale: 'routine', triage_model: triage.MODEL_TOP,
      ai_summary: 'routine', summary_model: triage.MODEL_MID,
      decision_options: triage.mockDecisionOptions(ESI4_ROUTINE, { esi_level: 4 }),
      decision_model: triage.MODEL_TOP,
    });
  });

  after(() => {
    try { db.close(); } catch { /* ignore */ }
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + ext); } catch { /* ignore */ }
    }
  });

  test('a pending emergency item flags is_emergency true and not-yet-escalated', async () => {
    const row = await db.getDecisionQueueItemByEncounter(emergencyEnc);
    const flags = deriveEmergencyFlags(row);
    assert.equal(flags.is_emergency, true);
    assert.equal(flags.emergency_escalated, false, 'pending => not yet escalated');
  });

  test('deciding the emergency_911 action records the escalation disposition', async () => {
    const item = await db.getDecisionQueueItemByEncounter(emergencyEnc);
    const r = await db.recordDecision(item.id, {
      decision_key: triage.EMERGENCY_911_KEY,
      decision_label: '911 activated / ED transfer',
      decision_text: null,
      decided_by: 'Dr. Test',
    });
    assert.equal(r.changes, 1);

    const reloaded = await db.getDecisionQueueItemById(item.id);
    assert.equal(reloaded.status, 'decided');
    assert.equal(reloaded.decision_key, triage.EMERGENCY_911_KEY);
    assert.match(reloaded.decision_label, /911 activated \/ ED transfer/);

    const flags = deriveEmergencyFlags(reloaded);
    assert.equal(flags.is_emergency, true);
    assert.equal(flags.emergency_escalated, true, 'a recorded 911 action is an emergency escalation');
  });

  test('the escalated emergency item appears in the MA close-out worklist flagged as emergency', async () => {
    const closeouts = await db.getMaCloseouts();
    const item = await db.getDecisionQueueItemByEncounter(emergencyEnc);
    const co = closeouts.find(c => c.id === item.id);
    assert.ok(co, 'escalated emergency item is in the MA close-out worklist');
    const flags = deriveEmergencyFlags(co);
    assert.equal(flags.is_emergency, true);
    assert.equal(flags.emergency_escalated, true);
  });

  test('a routine decided item is NOT flagged as an emergency escalation', async () => {
    const item = await db.getDecisionQueueItemByEncounter(routineEnc);
    await db.recordDecision(item.id, {
      decision_key: 'schedule_followup',
      decision_label: 'Schedule follow-up and monitor',
      decision_text: null,
      decided_by: 'Dr. Test',
    });
    const reloaded = await db.getDecisionQueueItemById(item.id);
    const flags = deriveEmergencyFlags(reloaded);
    assert.equal(flags.is_emergency, false);
    assert.equal(flags.emergency_escalated, false);
  });
});

// ----------------------------------------------------------------------------
// Route/source wiring — assert server.js exposes the emergency-bypass contract.
// (Mirrors the source-assertion convention in decision-queue.test.js.)
// ----------------------------------------------------------------------------
describe('emergency-bypass: server.js wiring', () => {
  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../../server/server.js'), 'utf8');

  test('GET /api/decisions response includes an emergency_count', () => {
    assert.match(serverSrc, /emergency_count/);
  });

  test('serialized item exposes is_emergency derived from triage.isEmergency', () => {
    assert.match(serverSrc, /is_emergency\s*=\s*triage\.isEmergency\(/);
  });

  test('serialized item exposes emergency_escalated keyed off EMERGENCY_DECISION_KEYS', () => {
    assert.match(serverSrc, /emergency_escalated/);
    assert.match(serverSrc, /triage\.EMERGENCY_DECISION_KEYS\.includes\(/);
  });

  test('decide path records the explicit emergency disposition label for 911/ED actions', () => {
    assert.match(serverSrc, /911 activated \/ ED transfer/);
  });
});
