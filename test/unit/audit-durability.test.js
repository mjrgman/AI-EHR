/**
 * Durable audit for high-consequence operations.
 *
 * The ordinary audit path writes inside `res.on('finish')` as fire-and-forget.
 * For a routine read that is the right trade -- losing a row costs detail. For
 * an operation that hands over a patient's whole record, it is the wrong one:
 * the caller already has the data, and nothing records that the disclosure
 * happened.
 *
 * For actions in DURABLE_AUDIT_ACTIONS the audit row is written BEFORE the
 * handler runs. If that write fails the operation is refused with 503 and no
 * data is disclosed. The row carries outcome_recorded = 0 until the response
 * completes, so a response that finishes without closing out its audit row is a
 * *detectable* gap rather than an absence.
 *
 * These tests drive the real middleware over HTTP.
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-production';
process.env.PHI_ENCRYPTION_KEY = process.env.PHI_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');

// Stub the database module before audit-logger resolves it.
const dbModulePath = require.resolve('../../server/database.js');
const originalDbModule = require.cache[dbModulePath];

const rows = [];
let failInserts = false;
let failUpdates = false;

const dbStub = {
  async dbRun(sql, params) {
    if (/INSERT INTO audit_log/i.test(sql)) {
      if (failInserts) throw new Error('simulated audit insert failure');
      const row = {
        id: rows.length + 1,
        request_method: params[7],
        request_path: params[8],
        response_status: params[10],
        phi_accessed: params[11],
        patient_id: params[13],
        duration_ms: params[16],
        receipt_id: params[18],
        outcome_recorded: params[19],
      };
      rows.push(row);
      return { lastID: row.id, changes: 1 };
    }
    if (/UPDATE audit_log/i.test(sql)) {
      if (failUpdates) throw new Error('simulated audit update failure');
      const receipt = params[3];
      const row = rows.find((r) => r.receipt_id === receipt);
      if (row) {
        row.response_status = params[0];
        row.duration_ms = params[1];
        row.outcome_recorded = 1;
      }
      return { changes: row ? 1 : 0 };
    }
    return { lastID: 1, changes: 1 };
  },
  async dbGet() { return null; },
  async dbAll(sql, params) {
    if (/outcome_recorded = 0/i.test(sql)) {
      return rows.filter((r) => r.outcome_recorded === 0);
    }
    return [];
  },
};

require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: dbStub };

const auditLogger = require('../../server/audit-logger.js');

let server;
let port;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(auditLogger.auditMiddleware());
  // A route classified with action EXPORT -> durable path.
  app.get('/api/medivault/export/:patientId', (req, res) => {
    res.json({ resourceType: 'Bundle', entry: [] });
  });
  // A route classified with action READ -> ordinary fire-and-forget path.
  app.get('/api/patients', (req, res) => res.json({ patients: [] }));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (originalDbModule) require.cache[dbModulePath] = originalDbModule;
  else delete require.cache[dbModulePath];
});

function request(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: data }));
    }).on('error', reject);
  });
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('the durable action set is deliberate', () => {
  test('EXPORT, SIGN and PRESCRIBE are durable; READ is not', () => {
    const s = auditLogger.DURABLE_AUDIT_ACTIONS;
    assert.ok(s.has('EXPORT'));
    assert.ok(s.has('SIGN'));
    assert.ok(s.has('PRESCRIBE'));
    assert.ok(!s.has('READ'),
      'making every read block on a synchronous audit write trades a silent gap for an availability failure');
  });
});

describe('a high-consequence operation is audited before it completes', () => {
  test('a successful export returns a receipt and a closed-out row', async () => {
    rows.length = 0; failInserts = false; failUpdates = false;

    const res = await request('/api/medivault/export/42');
    assert.equal(res.status, 200);

    const receipt = res.headers['x-audit-receipt'];
    assert.ok(receipt, 'the caller must get a receipt it can quote');

    // The row must exist by the time the response is delivered.
    const row = rows.find((r) => r.receipt_id === receipt);
    assert.ok(row, 'the audit row must be written before the response');
    assert.equal(row.patient_id, 42, 'the disclosure must be attributed to the patient');
    assert.equal(row.phi_accessed, 1);

    await settle();
    assert.equal(row.outcome_recorded, 1, 'the outcome must be recorded after the response');
    assert.equal(row.response_status, 200);
  });
});

describe('the operation fails closed when it cannot be audited', () => {
  test('an unwritable audit refuses the export with 503 and discloses nothing', async () => {
    rows.length = 0; failInserts = true; failUpdates = false;

    const res = await request('/api/medivault/export/42');

    assert.equal(res.status, 503, 'PHI must not be handed over unrecorded');
    assert.equal(rows.length, 0);
    assert.ok(!/Bundle/.test(res.raw), 'no bundle may appear in the body');
    assert.ok(!res.headers['x-audit-receipt'], 'no receipt may be issued for a refused operation');

    const body = JSON.parse(res.raw);
    assert.equal(body.error, 'audit_unavailable');
    assert.match(body.error_description, /No data was disclosed/i,
      'the caller must be told plainly that nothing was released');

    failInserts = false;
  });

  test('a routine read still succeeds when the audit write fails', async () => {
    // The fix must not turn every audit hiccup into an outage.
    rows.length = 0; failInserts = true;

    const res = await request('/api/patients');
    assert.equal(res.status, 200, 'a READ must not be blocked by an audit failure');

    failInserts = false;
  });
});

describe('a lost outcome is detectable, not silent', () => {
  test('an un-recorded outcome leaves an orphan the operator can find', async () => {
    rows.length = 0; failInserts = false; failUpdates = true;

    const res = await request('/api/medivault/export/7');
    assert.equal(res.status, 200, 'the disclosure itself is already recorded, so it proceeds');

    await settle();
    const row = rows.find((r) => r.receipt_id === res.headers['x-audit-receipt']);
    assert.ok(row);
    assert.equal(row.outcome_recorded, 0,
      'an outcome that was never recorded must remain visible as an orphan');

    const orphans = await auditLogger.findOrphanedAuditIntents({ olderThanMinutes: 0 });
    assert.ok(orphans.length >= 1, 'findOrphanedAuditIntents must surface it');

    failUpdates = false;
  });
});
