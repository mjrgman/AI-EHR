'use strict';

// Unit tests for server/repositories/scheduling-repository.js.
// Uses a stub of the database module so we exercise the repository's SQL
// shape (parameter order, WHERE-clause patient_id guard, status defaulting)
// without spinning up a real SQLite connection. The real DB path is
// covered by the integration suite via the new portal endpoints.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbModulePath = path.resolve(__dirname, '../../server/database.js');
const repoModulePath = path.resolve(__dirname, '../../server/repositories/scheduling-repository.js');

let calls;
let originalDbModule;

beforeEach(() => {
  calls = { dbAll: [], dbRun: [], dbGet: [] };

  // Replace the cached database module with a stub. Any code path that
  // requires('../database') from the repo will now hit the stub.
  originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      async dbAll(sql, params) {
        calls.dbAll.push({ sql, params });
        return calls.dbAll[calls.dbAll.length - 1].mockReturn || [];
      },
      async dbRun(sql, params) {
        calls.dbRun.push({ sql, params });
        return calls.dbRun[calls.dbRun.length - 1].mockReturn || { lastID: 42, changes: 1 };
      },
      async dbGet(sql, params) {
        calls.dbGet.push({ sql, params });
        return calls.dbGet[calls.dbGet.length - 1].mockReturn || null;
      },
    },
  };

  // Drop any cached repo so it re-binds to the new db module
  delete require.cache[repoModulePath];
});

afterEach(() => {
  if (originalDbModule) {
    require.cache[dbModulePath] = originalDbModule;
  } else {
    delete require.cache[dbModulePath];
  }
  delete require.cache[repoModulePath];
});

describe('scheduling-repository: findBookedSlots', () => {
  test('returns empty array when providerName is missing', async () => {
    const repo = require(repoModulePath);
    const rows = await repo.findBookedSlots('', { startDate: '2026-01-01', endDate: '2026-01-31' });
    assert.deepEqual(rows, []);
    assert.equal(calls.dbAll.length, 0, 'must short-circuit before hitting the DB');
  });

  test('queries with provider + date window and excludes cancelled/no-show', async () => {
    const repo = require(repoModulePath);
    await repo.findBookedSlots('Dr. Test Provider', { startDate: '2026-01-01', endDate: '2026-01-31' });
    assert.equal(calls.dbAll.length, 1, 'exactly one query expected');
    const { sql, params } = calls.dbAll[0];
    assert.match(sql, /FROM appointments/);
    assert.match(sql, /provider_name = \?/);
    assert.match(sql, /appointment_date >= \?/);
    assert.match(sql, /appointment_date <= \?/);
    assert.match(sql, /status NOT IN \('cancelled', 'no-show'\)/);
    assert.deepEqual(params, ['Dr. Test Provider', '2026-01-01', '2026-01-31']);
  });
});

describe('scheduling-repository: insertAppointment', () => {
  test('throws when a required field is missing', async () => {
    const repo = require(repoModulePath);
    await assert.rejects(
      () => repo.insertAppointment({
        provider_name: 'Dr. Test Provider',
        appointment_date: '2026-04-27',
        appointment_time: '09:00:00',
        appointment_type: 'follow_up',
      }),
      /missing required field "patient_id"/
    );
  });

  test('inserts with status defaulting to "scheduled" and returns the new id', async () => {
    const repo = require(repoModulePath);
    const result = await repo.insertAppointment({
      patient_id: 999999,
      provider_name: 'Dr. Test Provider',
      appointment_date: '2026-04-27',
      appointment_time: '09:00:00',
      appointment_type: 'follow_up',
    });
    assert.equal(result.id, 42, 'returns the lastID from dbRun');
    assert.equal(calls.dbRun.length, 1);
    const { sql, params } = calls.dbRun[0];
    assert.match(sql, /INSERT INTO appointments/);
    // Status param is the second-to-last positional binding (index 7 of 9).
    assert.equal(params[7], 'scheduled', 'status defaults to "scheduled" when not provided');
    assert.equal(params[0], 999999, 'patient_id passed through');
  });

  test('respects an explicit status override', async () => {
    const repo = require(repoModulePath);
    await repo.insertAppointment({
      patient_id: 999999,
      provider_name: 'Dr. Test Provider',
      appointment_date: '2026-04-27',
      appointment_time: '09:00:00',
      appointment_type: 'follow_up',
      status: 'confirmed',
    });
    assert.equal(calls.dbRun[0].params[7], 'confirmed');
  });
});

describe('scheduling-repository: updateAppointmentStatus', () => {
  test('issues an UPDATE with the new status and returns true when a row changed', async () => {
    const repo = require(repoModulePath);
    const ok = await repo.updateAppointmentStatus(123, 'cancelled');
    assert.equal(ok, true);
    const { sql, params } = calls.dbRun[0];
    assert.match(sql, /UPDATE appointments/);
    assert.match(sql, /SET status = \?/);
    assert.deepEqual(params, ['cancelled', 123]);
  });
});

describe('scheduling-repository: findAppointmentByIdForPatient', () => {
  test('always scopes the query to patient_id (security boundary)', async () => {
    const repo = require(repoModulePath);
    await repo.findAppointmentByIdForPatient(123, 999999);
    const { sql, params } = calls.dbGet[0];
    assert.match(sql, /WHERE id = \? AND patient_id = \?/);
    assert.deepEqual(params, [123, 999999], 'patient_id MUST be in the WHERE clause to prevent cross-patient access');
  });
});

describe('scheduling-repository: rescheduleAppointment', () => {
  test('UPDATEs date/time/duration and forces status="rescheduled" with patient_id guard', async () => {
    const repo = require(repoModulePath);
    const ok = await repo.rescheduleAppointment(123, 999999, {
      date: '2026-05-01',
      time: '10:00:00',
      duration_minutes: 30,
    });
    assert.equal(ok, true);
    const { sql, params } = calls.dbRun[0];
    assert.match(sql, /UPDATE appointments/);
    assert.match(sql, /status = 'rescheduled'/);
    assert.match(sql, /WHERE id = \? AND patient_id = \?/, 'patient_id guard prevents cross-patient reschedule');
    assert.deepEqual(params, ['2026-05-01', '10:00:00', 30, 123, 999999]);
  });
});
