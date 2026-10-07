'use strict';

// Port of the eight handoff acceptance/control cases, extended to use the
// application's sqlite3 adapter, migration sequence, HTTP route and middleware.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { mock } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ehr-medication-repairs-'));
process.env.DATABASE_PATH = path.join(directory, 'demo.db');
process.env.AI_MODE = 'mock';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ci-test-secret-not-for-production';
process.env.PHI_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
delete process.env.ENABLE_DEV_AUTH_BYPASS;

// Label lookups are isolated synthetic fixtures; no external service is used.
mock.method(https, 'get', (_url, _options, callback) => {
  const res = new EventEmitter();
  const req = new EventEmitter();
  req.destroy = () => {};
  callback(res);
  queueMicrotask(() => { res.emit('data', '{"results":[]}'); res.emit('end'); });
  return req;
});
const db = require('../../server/database');
const migrations = require('../../server/database-migrations');
const cds = require('../../server/cds-engine');
const { CDSAgent } = require('../../server/agents/cds-agent');
const ai = require('../../server/ai-client');
const safetyService = require('../../server/pharma/drug-safety-service');
const { selectActiveMedications } = require('../../server/pharma/medication-history');
const { app, initializeServerState } = require('../../server/server');
const auth = require('../../server/security/auth');
let server, base, patientId, encounterId, token;
const warningType = 'interaction_screening_unavailable';
const minimal = type => ({ encounter_id: encounterId, patient_id: patientId,
  suggestion_type: type, title: 'SYNTHETIC ' + type, description: 'Synthetic test only',
  source: 'interaction_screening', suggested_action: [] });
const context = medications => ({ patient: { id: patientId }, encounter: { id: encounterId },
  vitals: {}, labs: [], allergies: [], problems: [], medications });
const pair = [{ medication_name: 'warfarin', status: 'active' },
  { medication_name: 'ibuprofen', status: 'active' }];

before(async () => {
  await db.ready;
  patientId = (await db.createPatient({ first_name: 'Synthetic', last_name: 'Repair',
    dob: '1980-01-01', sex: 'M' })).id;
  encounterId = (await db.createEncounter({ patient_id: patientId, provider: 'Synthetic Test' })).id;
  // Fresh-install acceptance, before any upgrade migration is run.
  const fresh = await db.createSuggestion(minimal(warningType));
  assert.equal((await db.getSuggestionById(fresh.id)).suggestion_type, warningType);
  await initializeServerState();
  token = auth.signToken({ id: 9001, username: 'synthetic-physician', role: 'physician' });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await new Promise((resolve, reject) => db.db.close(err => err ? reject(err) : resolve()));
  mock.restoreAll();
  // Only this test's disposable directory is removed; no project DB is touched.
  fs.rmSync(directory, { recursive: true, force: true });
});

async function post(route, body, bearer = token) {
  const response = await fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const speech = (transcript = 'Start warfarin 5mg oral daily. Start ibuprofen 200mg oral daily.') =>
  post('/api/prescriptions/from-speech', { patient_id: patientId, encounter_id: encounterId, transcript });

async function installOldSchema() {
  await db.dbRun('DROP TABLE IF EXISTS migration_child');
  await db.dbRun('DROP TABLE IF EXISTS migration_probe');
  await db.dbRun('DROP TABLE cds_suggestions');
  const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/old-cds-schema.sql'), 'utf8');
  await db.dbRun(fixture);
  await db.dbRun('CREATE TABLE migration_child (id INTEGER PRIMARY KEY, suggestion_id INTEGER REFERENCES cds_suggestions(id))');
  await db.dbRun('CREATE TABLE migration_probe (id INTEGER)');
  await db.dbRun('CREATE INDEX idx_legacy_suggestion_title ON cds_suggestions(title)');
  await db.dbRun('CREATE TRIGGER legacy_suggestion_probe AFTER INSERT ON cds_suggestions BEGIN INSERT INTO migration_probe VALUES(NEW.id); END');
  const row = await db.createSuggestion(minimal('interaction_alert'));
  await db.dbRun('INSERT INTO migration_child VALUES(1, ?)', [row.id]);
  await db.dbRun("INSERT INTO cds_suggestions(id,encounter_id,patient_id,suggestion_type,title,description) VALUES(999,?,?,'interaction_alert','high water','synthetic')", [encounterId, patientId]);
  await db.dbRun('DELETE FROM cds_suggestions WHERE id=999');
  return { row: await db.getSuggestionById(row.id), fixture };
}

test('R1 fresh initialization admits the distinct operational warning', async () => {
  assert.ok((await db.dbGet("SELECT sql FROM sqlite_master WHERE name='cds_suggestions'")).sql.includes(warningType));
  assert.equal((await db.dbGet('PRAGMA foreign_keys')).foreign_keys, 1);
});

test('CONTROL old schema accepts interaction_alert and rejects the new warning', async () => {
  await installOldSchema();
  assert.ok((await db.createSuggestion(minimal('interaction_alert'))).id);
  await assert.rejects(db.createSuggestion(minimal(warningType)), /CHECK constraint failed/);
  await migrations.runMigrations(db);
});

test('R1 actual full upgrade/repeat preserves records, relationships, indexes, triggers and sequence', async () => {
  const { row } = await installOldSchema();
  const objects = await db.dbAll("SELECT name,sql FROM sqlite_master WHERE tbl_name='cds_suggestions' AND type IN ('index','trigger') ORDER BY name");
  await migrations.runMigrations(db);
  assert.deepEqual(await db.getSuggestionById(row.id), row);
  assert.equal((await db.dbGet('SELECT suggestion_id FROM migration_child')).suggestion_id, row.id);
  assert.deepEqual(await db.dbAll("SELECT name,sql FROM sqlite_master WHERE tbl_name='cds_suggestions' AND type IN ('index','trigger') ORDER BY name"), objects);
  assert.deepEqual(await db.dbAll('PRAGMA foreign_key_check'), []);
  const saved = await db.createSuggestion(minimal(warningType));
  assert.ok(saved.id > 999);
  assert.ok(await db.dbGet('SELECT * FROM migration_probe WHERE id=?', [saved.id]));
  const schema = await db.dbGet("SELECT sql FROM sqlite_master WHERE name='cds_suggestions'");
  await migrations.runMigrations(db);
  assert.deepEqual(await db.dbGet("SELECT sql FROM sqlite_master WHERE name='cds_suggestions'"), schema);
  assert.equal((await db.dbGet('PRAGMA foreign_keys')).foreign_keys, 1);
});

for (const foreignKeys of [0, 1]) {
  test(`R1 DDL failure rolls back the actual adapter and restores foreign_keys=${foreignKeys}`, async t => {
    const { row } = await installOldSchema();
    await db.dbRun('PRAGMA foreign_keys=' + foreignKeys);
    const beforeSchema = await db.dbGet("SELECT sql FROM sqlite_master WHERE name='cds_suggestions'");
    const run = db.dbRun;
    const injection = t.mock.method(db, 'dbRun', async (sql, params) => {
      if (sql.startsWith('CREATE INDEX idx_legacy')) throw new Error('synthetic index rebuild failure');
      return run(sql, params);
    });
    await assert.rejects(migrations.runMigrations(db), /synthetic index rebuild failure/);
    injection.mock.restore();
    assert.deepEqual(await db.dbGet("SELECT sql FROM sqlite_master WHERE name='cds_suggestions'"), beforeSchema);
    assert.deepEqual(await db.getSuggestionById(row.id), row);
    assert.deepEqual(await db.dbAll('PRAGMA foreign_key_check'), []);
    assert.equal((await db.dbGet('PRAGMA foreign_keys')).foreign_keys, foreignKeys);
    assert.equal(await db.dbGet("SELECT name FROM sqlite_master WHERE name='cds_suggestions_new'"), undefined);
    await migrations.runMigrations(db);
    assert.equal((await db.dbGet('PRAGMA foreign_keys')).foreign_keys, foreignKeys);
    await db.dbRun('PRAGMA foreign_keys=ON');
  });
}

test('R1 missing-history warning survives the real CDS agent/storage', async () => {
  const result = await new CDSAgent().process(context(undefined));
  const warning = result.suggestions.find(s => s.suggestion_type === warningType);
  assert.ok(warning?.id);
  assert.equal(warning.persistence.status, 'saved');
  assert.equal((await db.getSuggestionById(warning.id)).suggestion_type, warningType);
});

test('R1 later warning insert failure retains the independently saved curated finding', async t => {
  await db.dbRun('DELETE FROM migration_child');
  await db.dbRun('DELETE FROM cds_suggestions');
  await db.dbRun(`CREATE TRIGGER fail_warning BEFORE INSERT ON cds_suggestions WHEN NEW.suggestion_type='${warningType}' BEGIN SELECT RAISE(ABORT,'synthetic warning save failure'); END`);
  t.after(() => db.dbRun('DROP TRIGGER fail_warning'));
  const result = await new CDSAgent().process(context(pair));
  const finding = result.suggestions.find(s => s.source === 'curated_ddi');
  assert.ok(finding?.id);
  assert.ok(await db.getSuggestionById(finding.id));
  const failed = result.suggestions.find(s => s.suggestion_type === warningType);
  assert.equal(failed.persistence.status, 'failed');
  assert.equal(failed.status, 'unsaved');
  assert.equal(failed.approvable, false);
  assert.equal(Object.hasOwn(failed, 'id'), false);
  assert.equal(result.persistenceFailures, 1);
});

test('R1 failed finding insert remains explicit while the independent warning is saved', async t => {
  await db.dbRun('DELETE FROM cds_suggestions');
  await db.dbRun("CREATE TRIGGER fail_finding BEFORE INSERT ON cds_suggestions WHEN NEW.source='curated_ddi' BEGIN SELECT RAISE(ABORT,'synthetic finding save failure'); END");
  t.after(() => db.dbRun('DROP TRIGGER fail_finding'));
  const result = await new CDSAgent().process(context(pair));
  const failed = result.suggestions.find(s => s.source === 'curated_ddi');
  assert.equal(failed.persistence.status, 'failed');
  assert.equal(failed.approvable, false);
  assert.equal(Object.hasOwn(failed, 'id'), false);
  assert.ok(result.suggestions.find(s => s.suggestion_type === warningType)?.id);
});

test('R1 real CDS HTTP response retains findings when a later provider save fails', async t => {
  await db.dbRun('DELETE FROM cds_suggestions');
  for (const med of pair) await db.addMedication({ ...med, patient_id: patientId });
  const problem = await db.addProblem({ patient_id: patientId,
    problem_name: 'SYNTHETIC PREFERENCE FIXTURE', icd10_code: 'TEST_ONLY', status: 'active' });
  await db.dbRun(`INSERT INTO provider_preferences(provider_name,condition_code,condition_name,action_type,action_detail,confidence)
    VALUES('Synthetic Test','TEST_ONLY','SYNTHETIC PREFERENCE FIXTURE','lab_order','{"test_name":"SYNTHETIC TEST"}',0.9)`);
  await db.dbRun("CREATE TRIGGER fail_provider BEFORE INSERT ON cds_suggestions WHEN NEW.source='provider_learning' BEGIN SELECT RAISE(ABORT,'synthetic provider save failure'); END");
  t.after(async () => {
    await db.dbRun('DROP TRIGGER fail_provider');
    await db.dbRun('DELETE FROM medications WHERE patient_id=?', [patientId]);
    await db.dbRun('DELETE FROM problems WHERE id=?', [problem.id]);
    await db.dbRun("DELETE FROM provider_preferences WHERE condition_code='TEST_ONLY'");
  });
  const response = await post('/api/cds/evaluate', { patient_id: patientId, encounter_id: encounterId });
  assert.equal(response.status, 200);
  assert.ok(response.body.suggestions.some(s => s.source === 'curated_ddi' && s.id));
  assert.ok(response.body.suggestions.some(s => s.suggestion_type === warningType && s.id));
  const failed = response.body.suggestions.find(s => s.source === 'provider_learning');
  assert.equal(failed?.persistence.status, 'failed');
  assert.equal(failed.approvable, false);
  assert.equal(Object.hasOwn(failed, 'id'), false);
  assert.equal(response.body.persistenceFailures, 1);
  assert.equal((await post('/api/cds/suggestions/undefined/accept', {
    patient_id: patientId, encounter_id: encounterId })).status, 400);
});

for (const status of ['completed', 'discontinued']) {
  test(`R2 exact handoff regression: lone malformed ${status} row is incomplete`, async () => {
    const selected = selectActiveMedications([{ medication_name: '   ', status }]);
    assert.ok(selected.length > 0);
    const result = await safetyService.fullSafetyCheck('synthetic-drug', selected, []);
    assert.equal(result.interactionScreening.status, 'incomplete');
    assert.equal(result.interactionScreening.inputComplete, false);
  });
}

for (const status of ['completed', 'discontinued']) {
  for (const row of [null, 3, [], {}, { medication_name: 5 }, { medication_name: '' }, { medication_name: '   ' }]) {
    test(`R2 malformed ${status} record ${JSON.stringify(row)} stays incomplete through CDS and HTTP`, async t => {
      const malformed = row && typeof row === 'object' && !Array.isArray(row) ? { ...row, status } : row;
      const history = [...pair, malformed];
      const selected = selectActiveMedications(history);
      assert.ok(selected.includes(null));
      const result = await safetyService.fullSafetyCheck('warfarin', selected, []);
      assert.equal(result.interactionScreening.status, 'incomplete');
      assert.equal(result.interactionScreening.inputComplete, false);
      assert.ok(result.interactionScreening.findings.some(s => s.curated));
      const agent = await new CDSAgent().process(context(history));
      assert.ok(agent.suggestions.some(s => s.source === 'curated_ddi'));
      assert.ok(agent.suggestions.some(s => s.suggestion_type === warningType));
      t.mock.method(db, 'getPatientMedications', async () => history);
      const response = await post('/api/prescriptions', { patient_id: patientId, encounter_id: encounterId,
        medication_name: 'warfarin', dose: 'synthetic', route: 'oral', frequency: 'daily' });
      assert.equal(response.status, 201);
      assert.equal(response.body.safety.interactionScreening.inputComplete, false);
      assert.ok(response.body.safety.interactionScreening.findings.some(s => s.curated));
      const batch = await speech();
      assert.equal(batch.status, 200);
      assert.ok(batch.body.prescriptions.every(rx => rx.safety.interactionScreening.inputComplete === false));
    });
  }
  test(`CONTROL valid ${status} row may be excluded without a new lookback policy`, async () => {
    assert.deepEqual(selectActiveMedications([{ medication_name: 'synthetic-drug', status }]), []);
  });
}

for (const history of [undefined, null, {}, [], [null],
  [{ medication_name: 'ibuprofen', status: 'active' }], [{ medication_name: 'ibuprofen' }]]) {
  test(`retained prescription consumer control: ${JSON.stringify(history)}`, async t => {
    t.mock.method(db, 'getPatientMedications', async () => history);
    const result = await post('/api/prescriptions', { patient_id: patientId, medication_name: 'warfarin',
      dose: 'synthetic', route: 'oral', frequency: 'daily' });
    assert.equal(result.status, 201);
    assert.equal(result.body.safety.interactionScreening.status,
      Array.isArray(history) && history.length === 0 ? 'not_applicable' : 'incomplete');
    if (history?.[0]?.medication_name) assert.ok(result.body.safety.alerts.some(a => a.type === 'drug_interaction'));
  });
}

for (const history of [undefined, null, [], [null],
  [{ medication_name: 'ibuprofen', status: 'active' }], [{ medication_name: 'ibuprofen' }]]) {
  test(`retained single speech-prescription consumer control: ${JSON.stringify(history)}`, async t => {
    t.mock.method(db, 'getPatientMedications', async () => history);
    const response = await speech('Start warfarin 5mg oral daily.');
    assert.equal(response.status, 200);
    assert.equal(response.body.prescriptions.length, 1);
    const safety = response.body.prescriptions[0].safety;
    const empty = Array.isArray(history) && history.length === 0;
    assert.equal(safety.interactionScreening.status, empty ? 'not_applicable' : 'incomplete');
    assert.equal(safety.interactionScreeningUnavailable, !empty);
    if (history?.[0]?.medication_name) assert.ok(safety.alerts.some(a => a.type === 'drug_interaction'));
    if (!empty) assert.ok(safety.alerts.some(a => a.unavailable));
  });
}

for (const transcript of ['Start warfarin 5mg oral daily. Start ibuprofen 200mg oral daily.',
  'Start ibuprofen 200mg oral daily. Start warfarin 5mg oral daily.']) {
  test('R3 two-new-drug curated fixture and reversed ordering use the real speech route: ' + transcript, async () => {
    const response = await speech(transcript);
    assert.equal(response.status, 200);
    assert.equal(response.body.prescriptions.length, 2);
    assert.equal(response.body.findings.length, 1);
    for (const rx of response.body.prescriptions) {
      assert.equal(rx.status, 'draft');
      assert.equal(rx.review.status, 'required');
      assert.equal(rx.safety.interactionScreening.status, 'incomplete');
      assert.ok(rx.safety.alerts.some(a => a.type === 'drug_interaction'));
      assert.ok(rx.safety.alerts.some(a => a.unavailable));
      assert.equal(rx.safety.interactionScreening.findings.length, 1);
      assert.equal((await db.dbGet('SELECT status FROM prescriptions WHERE id=?', [rx.id])).status, 'draft');
    }
  });
}

test('R3 existing-to-proposed and proposed-to-proposed findings retain record identities', async t => {
  t.mock.method(db, 'getPatientMedications', async () => [{ id: 456, medication_name: 'ibuprofen', status: 'active' }]);
  const response = await speech();
  assert.equal(response.status, 200);
  assert.equal(response.body.findings.length, 2);
  assert.ok(response.body.findings.some(f => f.pair.includes('stored:0:456')));
  assert.ok(response.body.findings.some(f => f.pair.every(id => id.startsWith('proposed:'))));
  assert.ok(response.body.prescriptions.find(rx => rx.medication_name.toLowerCase() === 'ibuprofen')
    .safety.alerts.some(a => a.type === 'duplicate_therapy'));
});

test('R3 duplicate entries and distinct doses stay separate with duplicate-therapy review', async t => {
  t.mock.method(ai, 'extractMedications', () => [
    { name: 'warfarin', dose: '5mg', route: 'oral', frequency: 'daily' },
    { name: 'warfarin', dose: '2mg', route: 'oral', frequency: 'daily' },
    { name: 'ibuprofen', dose: '200mg', route: 'oral', frequency: 'daily' }
  ]);
  const response = await speech();
  assert.equal(response.status, 200);
  assert.equal(response.body.prescriptions.length, 3);
  assert.equal(new Set(response.body.prescriptions.map(rx => rx.id)).size, 3);
  assert.equal(response.body.findings.length, 2);
  assert.notDeepEqual(response.body.findings[0].pair, response.body.findings[1].pair);
  assert.ok(response.body.prescriptions.slice(0, 2).every(rx => rx.safety.alerts.some(a => a.type === 'duplicate_therapy')));
  assert.ok(response.body.findings.every(f => f.pair[0] !== f.pair[1]));
});

test('R3 unknown stored history stays incomplete alongside a new-to-new finding', async t => {
  t.mock.method(db, 'getPatientMedications', async () => undefined);
  const response = await speech();
  assert.equal(response.status, 200);
  assert.equal(response.body.findings.length, 1);
  assert.ok(response.body.prescriptions.every(rx => rx.safety.interactionScreening.findings.length === 1));
  assert.ok(response.body.prescriptions.every(rx => rx.safety.interactionScreening.inputComplete === false));
  assert.ok(response.body.prescriptions.every(rx => rx.safety.alerts.some(a => a.unavailable)));
});

for (const invalid of [null, 1, [], {}, { name: ' ' }, { name: 5 },
  { name: 'warfarin', dose: '', route: 'oral', frequency: 'daily' }]) {
test('R3 validates the entire extracted batch before any persistence: ' + JSON.stringify(invalid), async t => {
  const count = await db.dbGet('SELECT COUNT(*) AS n FROM prescriptions');
  t.mock.method(ai, 'extractMedications', () => [{ name: 'warfarin', dose: '5mg', route: 'oral', frequency: 'daily' }, invalid]);
  const response = await speech();
  assert.equal(response.status, 422);
  assert.equal(response.body.code, 'INVALID_PROPOSED_MEDICATIONS');
  assert.deepEqual(await db.dbGet('SELECT COUNT(*) AS n FROM prescriptions'), count);
});
}

test('R3 checker failure is explicit and preserves the other draft finding', async t => {
  const original = safetyService.fullSafetyCheck;
  t.mock.method(safetyService, 'fullSafetyCheck', async (...args) => {
    if (args[0].toLowerCase() === 'warfarin') throw new Error('synthetic checker failure');
    return original(...args);
  });
  const response = await speech();
  assert.equal(response.status, 200);
  assert.equal(response.body.prescriptions.find(rx => rx.medication_name.toLowerCase() === 'warfarin')
    .safety.interactionScreening.reason, 'safety_check_failed');
  assert.ok(response.body.prescriptions.find(rx => rx.medication_name.toLowerCase() === 'ibuprofen')
    .safety.alerts.some(a => a.type === 'drug_interaction'));
  assert.equal(response.body.findings.length, 1);
  assert.ok(response.body.prescriptions.every(rx => rx.safety.alerts.some(a => a.type === 'drug_interaction')));
});

for (const malformed of [null, {},
  { alerts: [], interactionScreening: { findings: [], inputComplete: true } },
  { alerts: [null], interactionScreeningUnavailable: true,
    interactionScreening: { status: 'incomplete', findings: [], inputComplete: true } },
  { alerts: [], interactionScreeningUnavailable: false,
    interactionScreening: { status: 'not_applicable', findings: [], inputComplete: true } },
  { alerts: [], interactionScreening: { findings: [null], inputComplete: true } }]) {
  test('R3 resolved malformed checker response preserves independent draft findings: ' + JSON.stringify(malformed), async t => {
    const original = safetyService.fullSafetyCheck;
    t.mock.method(safetyService, 'fullSafetyCheck', async (...args) =>
      args[0].toLowerCase() === 'warfarin' ? malformed : original(...args));
    const response = await speech();
    assert.equal(response.status, 200);
    assert.equal(response.body.prescriptions.find(rx => rx.medication_name.toLowerCase() === 'warfarin')
      .safety.interactionScreening.reason, 'safety_check_failed');
    assert.equal(response.body.findings.length, 1);
    assert.ok(response.body.prescriptions.every(rx => rx.safety.interactionScreening.findings.length === 1));
    assert.ok(response.body.prescriptions.find(rx => rx.medication_name.toLowerCase() === 'ibuprofen')
      .safety.alerts.some(a => a.type === 'drug_interaction'));
  });
}

test('retained manual prescription consumer checker failure stays incomplete', async t => {
  t.mock.method(safetyService, 'fullSafetyCheck', async () => { throw new Error('synthetic checker failure'); });
  const response = await post('/api/prescriptions', { patient_id: patientId, medication_name: 'warfarin',
    dose: 'synthetic', route: 'oral', frequency: 'daily' });
  assert.equal(response.status, 201);
  assert.equal(response.body.safety.interactionScreening.status, 'incomplete');
  assert.equal(response.body.safety.interactionScreeningUnavailable, true);
});

test('R3 actual partial INSERT failure reports saved IDs and unattempted drafts without retry', async t => {
  t.mock.method(ai, 'extractMedications', () => [
    { name: 'warfarin', dose: '5mg', route: 'oral', frequency: 'daily' },
    { name: 'ibuprofen', dose: '200mg', route: 'oral', frequency: 'daily' },
    { name: 'warfarin', dose: '2mg', route: 'oral', frequency: 'daily' }
  ]);
  await db.dbRun("CREATE TRIGGER fail_rx BEFORE INSERT ON prescriptions WHEN lower(NEW.medication_name)='ibuprofen' BEGIN SELECT RAISE(ABORT,'synthetic prescription save failure'); END");
  t.after(() => db.dbRun('DROP TRIGGER fail_rx'));
  const beforeCount = (await db.dbGet('SELECT COUNT(*) AS n FROM prescriptions')).n;
  const response = await speech();
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'BATCH_PERSISTENCE_FAILED');
  assert.equal(response.body.retrySafe, false);
  assert.equal(response.body.prescriptions.length, 1);
  assert.ok(await db.dbGet('SELECT id FROM prescriptions WHERE id=?', [response.body.prescriptions[0].id]));
  assert.equal(response.body.unsavedPrescriptions[0].persistence.status, 'failed');
  assert.equal(response.body.unsavedPrescriptions[1].persistence.status, 'not_attempted');
  assert.ok(response.body.unsavedPrescriptions.every(rx => !Object.hasOwn(rx, 'id')));
  assert.equal((await db.dbGet('SELECT COUNT(*) AS n FROM prescriptions')).n, beforeCount + 1);
  assert.equal(response.body.findings.length, 2);
});

test('R3 a changed batch requires fresh review, regardless of caller review fields', async () => {
  const first = await speech();
  const changed = await post('/api/prescriptions/from-speech', { patient_id: patientId,
    encounter_id: encounterId, transcript: 'Start warfarin 2mg oral daily. Start ibuprofen 200mg oral daily.',
    status: 'signed', reviewed: true, review: { ...first.body.review, status: 'approved' } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.body.review.batchFingerprint, first.body.review.batchFingerprint);
  assert.equal(changed.body.review.status, 'required');
  assert.ok(changed.body.prescriptions.every(rx => rx.status === 'draft' && rx.review.status === 'required'));
});

test('real speech middleware enforces authentication, RBAC and encounter binding', async () => {
  assert.equal((await post('/api/prescriptions/from-speech', { patient_id: patientId, transcript: 'start warfarin' }, null)).status, 401);
  const frontDesk = auth.signToken({ id: 9002, username: 'synthetic-frontdesk', role: 'front_desk' });
  assert.equal((await post('/api/prescriptions/from-speech', { patient_id: patientId, transcript: 'start warfarin' }, frontDesk)).status, 403);
  const other = (await db.createPatient({ first_name: 'Synthetic', last_name: 'Other', dob: '1980-01-01', sex: 'F' })).id;
  const mismatch = await post('/api/prescriptions/from-speech', { patient_id: other, encounter_id: encounterId, transcript: 'start warfarin' });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'PATIENT_ENCOUNTER_MISMATCH');
});
