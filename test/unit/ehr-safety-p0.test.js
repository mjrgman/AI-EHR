'use strict';

// Safety-critical EHR write-path regressions. Synthetic data only.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDbPath = path.join(os.tmpdir(), `ehr-safety-p0-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDbPath;
process.env.AI_MODE = 'mock';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-production';
delete process.env.PHI_ENCRYPTION_KEY;

const db = require('../../server/database');
const { addEncounterSignatureColumns } = require('../../server/database-migrations');
const cds = require('../../server/cds-engine');

let patientA;
let patientB;
let encounterA;

before(async () => {
  await db.ready;
  await addEncounterSignatureColumns(db);
  const a = await db.createPatient({
    first_name: 'Ada', last_name: 'Safety', dob: '1980-01-15', sex: 'F',
  });
  const b = await db.createPatient({
    first_name: 'Ben', last_name: 'Other', dob: '1975-06-01', sex: 'M',
  });
  patientA = a.id;
  patientB = b.id;
  const enc = await db.createEncounter({
    patient_id: patientA,
    chief_complaint: 'chest pain',
    provider: 'Dr. Test',
  });
  encounterA = enc.id;
});

after(() => {
  try { db.close(); } catch { /* ignore */ }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDbPath + ext); } catch { /* ignore */ }
  }
});

describe('signed encounter attribution and lock columns', () => {
  test('updateEncounter persists signed_by and signed_at', async () => {
    const enc = await db.createEncounter({
      patient_id: patientA,
      chief_complaint: 'follow-up',
      provider: 'Dr. Test',
    });
    await db.updateEncounter(enc.id, {
      soap_note: 'S: well\nO: nl\nA: well\nP: f/u',
      status: 'signed',
      signed_by: 'Dr. Test',
      signed_at: '2026-08-16T12:00:00.000Z',
    });
    const row = await db.getEncounterById(enc.id);
    assert.equal(row.status, 'signed');
    assert.equal(row.signed_by, 'Dr. Test');
    assert.equal(row.signed_at, '2026-08-16T12:00:00.000Z');
  });
});

describe('CDS accept binds the stored patient and does not auto-sign', () => {
  test('create_prescription is stored as draft and uses the suggestion patient', async () => {
    const created = await db.createSuggestion({
      encounter_id: encounterA,
      patient_id: patientA,
      suggestion_type: 'medication',
      title: 'Start Semaglutide',
      description: 'draft only',
      suggested_action: {
        actions: [{
          type: 'create_prescription',
          description: 'Semaglutide 0.25 mg',
          payload: {
            medication_name: 'Semaglutide',
            dose: '0.25 mg',
            route: 'SQ',
            frequency: 'weekly',
          },
        }],
      },
    });

    const result = await cds.executeSuggestion(created.id, encounterA, patientA, 'Dr. Test');
    assert.equal(result.accepted, true);
    assert.equal(result.executed[0].type, 'prescription');
    assert.equal(result.executed[0].status, 'draft');

    const rx = await db.dbGet('SELECT * FROM prescriptions WHERE id = ?', [result.executed[0].id]);
    assert.equal(rx.patient_id, patientA);
    assert.equal(rx.encounter_id, encounterA);
    assert.equal(rx.status, 'draft');

    const suggestion = await db.getSuggestionById(created.id);
    assert.equal(suggestion.status, 'accepted');
  });

  test('caller-supplied patient_id cannot retarget the write', async () => {
    const created = await db.createSuggestion({
      encounter_id: encounterA,
      patient_id: patientA,
      suggestion_type: 'medication',
      title: 'Wrong patient attempt',
      description: 'must fail',
      suggested_action: {
        actions: [{
          type: 'create_prescription',
          description: 'Amoxicillin',
          payload: {
            medication_name: 'Amoxicillin',
            dose: '500 mg',
            route: 'PO',
            frequency: 'BID',
          },
        }],
      },
    });

    await assert.rejects(
      () => cds.executeSuggestion(created.id, encounterA, patientB, 'Dr. Test'),
      (err) => err && err.code === 'PATIENT_MISMATCH'
    );

    const stillPending = await db.getSuggestionById(created.id);
    assert.equal(stillPending.status, 'pending');

    const stolen = await db.dbGet(
      'SELECT COUNT(*) AS n FROM prescriptions WHERE patient_id = ? AND medication_name = ?',
      [patientB, 'Amoxicillin']
    );
    assert.equal(stolen.n, 0);
  });

});

describe('server source contracts for the new sign and bind gates', () => {
  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../../server/server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.resolve(__dirname, '../../src/api/client.js'), 'utf8');
  const reviewSrc = fs.readFileSync(path.resolve(__dirname, '../../src/pages/ReviewPage.jsx'), 'utf8');

  test('PATCH cannot sign; a dedicated sign route exists', () => {
    assert.match(serverSrc, /USE_SIGN_ROUTE/);
    assert.match(serverSrc, /app\.post\('\/api\/encounters\/:id\/sign'/);
    assert.match(serverSrc, /ENCOUNTER_LOCKED/);
    assert.match(clientSrc, /signEncounter:/);
    assert.match(reviewSrc, /signEncounter\(/);
    assert.doesNotMatch(reviewSrc, /status: 'signed'/);
  });

  test('prescription HTTP creates are forced to draft', () => {
    assert.match(serverSrc, /status: 'draft'/);
    assert.doesNotMatch(serverSrc, /status: req\.body\.status \|\| 'signed'/);
    assert.doesNotMatch(serverSrc, /payload\.status = payload\.status \|\| 'signed'/);
  });

  test('CDS accept requires a sign permission and binds encounter to patient', () => {
    assert.match(serverSrc, /requirePermission\('sign', 'prescriptions'\)/);
    assert.match(serverSrc, /requireMatchingEncounterPatient/);
  });
});
