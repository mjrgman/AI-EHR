'use strict';

// P1-2 (sec-portal-weak-verify-05) — patient-portal mandatory MRN second factor.
//
// Name + DOB are both semi-public (directories, obituaries, public records),
// so they must NEVER establish a portal session on their own. verifyPatient
// requires the MRN as a mandatory non-public third factor in ALL environments,
// and fails closed with a single generic null on any miss (missing factor,
// no matching patient, or wrong MRN) so callers cannot distinguish failure
// modes. These tests pin that behavior at the unit level.
//
// db.getAllPatients() is a property on the cached database module that
// verifyPatient calls at invocation time, so we stub it per-test and restore
// it afterward — no real DB or decryption is exercised here.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database');
const { verifyPatient } = require('../../server/integrations/patient-voice');

const PATIENT = {
  id: 42,
  first_name: 'Sarah',
  last_name: 'Mitchell',
  dob: '1963-01-15',
  mrn: '2018-04792',
};

describe('P1-2 verifyPatient: mandatory MRN second factor', () => {
  let originalGetAllPatients;

  beforeEach(() => {
    originalGetAllPatients = db.getAllPatients;
    db.getAllPatients = async () => [ { ...PATIENT } ];
  });

  afterEach(() => {
    db.getAllPatients = originalGetAllPatients;
  });

  test('name + DOB WITHOUT MRN is denied (returns null)', async () => {
    const result = await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, undefined);
    assert.equal(result, null, 'name+DOB alone must not verify');
  });

  test('name + DOB with EMPTY/blank MRN is denied (returns null)', async () => {
    assert.equal(await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, ''), null);
    assert.equal(await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, '   '), null);
  });

  test('correct name + DOB + MRN verifies and returns the patient', async () => {
    const result = await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, PATIENT.mrn);
    assert.ok(result, 'three-factor match should verify');
    assert.equal(result.id, PATIENT.id);
    assert.equal(result.mrn, PATIENT.mrn);
    assert.equal(result.name, 'Sarah Mitchell');
  });

  test('MRN match is case/whitespace tolerant on the input (trimmed)', async () => {
    const result = await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, '  2018-04792  ');
    assert.ok(result, 'surrounding whitespace on the supplied MRN should not block a match');
    assert.equal(result.id, PATIENT.id);
  });

  test('WRONG MRN with correct name + DOB is denied (returns null)', async () => {
    const result = await verifyPatient(PATIENT.first_name, PATIENT.last_name, PATIENT.dob, 'WRONG-MRN-000000');
    assert.equal(result, null, 'a wrong MRN must fail even when name+DOB are correct');
  });

  test('missing name or DOB is denied even with a correct MRN', async () => {
    assert.equal(await verifyPatient('', PATIENT.last_name, PATIENT.dob, PATIENT.mrn), null);
    assert.equal(await verifyPatient(PATIENT.first_name, '', PATIENT.dob, PATIENT.mrn), null);
    assert.equal(await verifyPatient(PATIENT.first_name, PATIENT.last_name, '', PATIENT.mrn), null);
  });

  test('correct MRN but wrong name/DOB is denied (MRN alone is insufficient)', async () => {
    assert.equal(await verifyPatient('Wrong', PATIENT.last_name, PATIENT.dob, PATIENT.mrn), null);
    assert.equal(await verifyPatient(PATIENT.first_name, PATIENT.last_name, '1900-01-01', PATIENT.mrn), null);
  });

  test('name matching is case-insensitive (existing behavior preserved)', async () => {
    const result = await verifyPatient('sArAh', 'MITCHELL', PATIENT.dob, PATIENT.mrn);
    assert.ok(result, 'name comparison should remain case-insensitive');
    assert.equal(result.id, PATIENT.id);
  });
});
