'use strict';

// Iter 3 — Auth + RBAC + injection boundary tests for the NEW routes
// (care-management + HEDIS) added by the autobetter loop.
//
// These tests focus on the route handlers themselves, not the auth wiring
// (which is centralized in server.js). They verify:
//   - Defensive input validation on patient/measure ID
//   - Type coercion safety (no SQL injection vector — care-mgmt is pure-function,
//     but the patient.id field reaches handlers and could be misused downstream)
//   - Large-payload rejection via Express body limit (handled by server.js, but
//     we verify our handlers don't crash on adversarial inputs)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { mountCareManagementRoutes } = require('../../server/routes/care-management-routes');
const { mountHedisRoutes } = require('../../server/routes/hedis-routes');

function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountCareManagementRoutes(app, { db: {} });
  mountHedisRoutes(app, { db: {} });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, body: json, raw: text });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let port, server;
before(async () => {
  const s = await startServer();
  port = s.port; server = s.server;
});
after(() => server && server.close());

// ============================================================
describe('boundaries: defensive validation', () => {
  test('care-mgmt /eligibility rejects null patient', async () => {
    const r = await request(port, 'POST', '/api/care-management/eligibility', { patient: null });
    assert.equal(r.status, 400);
  });

  test('care-mgmt /billable rejects empty enrollment', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1 }, enrollment: null
    });
    assert.equal(r.status, 400);
  });

  test('care-mgmt /billable handles missing optional arrays gracefully', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1 },
      enrollment: { program_type: 'CCM', consent: { consent_date: new Date().toISOString() } }
      // no problems, no timeLog — should NOT crash; rationale should explain
    });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.codes));
  });

  test('hedis /evaluate handles unknown measureId case-insensitively (404)', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/INJECT', {
      patient: { id: 1, dob: '1960-01-01' }
    });
    assert.equal(r.status, 404);
  });

  test('hedis /all rejects when patient missing dob (BCS-E returns not-in-denom)', async () => {
    // Should not crash; should gracefully return result with in_denominator: false
    const r = await request(port, 'POST', '/api/quality/hedis/all', {
      patient: { id: 1, sex: 'F' }  // no dob
    });
    assert.equal(r.status, 200);
    const bcsE = r.body.results.find(x => x.measure_id === 'BCS-E');
    assert.equal(bcsE.in_denominator, false);
  });
});

describe('boundaries: type coercion / injection safety', () => {
  test('care-mgmt /billable rejects when patient.id is null/undefined', async () => {
    for (const id of [null, undefined, '']) {
      const r = await request(port, 'POST', '/api/care-management/billable', {
        patient: { id },
        enrollment: { program_type: 'CCM' }
      });
      assert.equal(r.status, 400, `id=${id} should 400`);
    }
  });

  test('care-mgmt /billable accepts both numeric and string patient.id', async () => {
    const r1 = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1 },
      enrollment: { program_type: 'CCM', consent: { consent_date: new Date().toISOString() } }
    });
    const r2 = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 'patient-1' },  // string ID
      enrollment: { program_type: 'CCM', consent: { consent_date: new Date().toISOString() } }
    });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  });

  test('care-mgmt /conflict-check ignores invalid CPTs gracefully', async () => {
    const r = await request(port, 'POST', '/api/care-management/conflict-check', {
      proposedCpt: 'NOT_A_CPT',
      activeCpts: [null, undefined, '<script>', 12345]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.allowed, true);  // not a care-mgmt code = no conflict
  });

  test('hedis /evaluate measureId path param does not break on special chars', async () => {
    // Express decodes URL params; our handler uppercases + lookups against a
    // known set, so '../etc/passwd' or similar lands as an unknown measure (404).
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/%2E%2E%2Fbcs', {
      patient: { id: 1, dob: '1960-01-01', sex: 'F' }
    });
    assert.equal(r.status, 404);
  });
});

describe('boundaries: large payload behavior', () => {
  test('care-mgmt /billable handles 100-entry timeLog without crashing', async () => {
    const timeLog = Array.from({ length: 100 }, (_, i) => ({
      minutes: 5,
      staff_role: 'rn',
      service_date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`
    }));
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1 },
      problems: [{ icd10_code: 'E11.9', status: 'active' }, { icd10_code: 'I50.9', status: 'active' }],
      enrollment: { program_type: 'CCM', consent: { consent_date: new Date().toISOString() } },
      timeLog
    });
    assert.equal(r.status, 200);
    // 500 minutes total → 99490 + capped 99439 add-ons + likely 99491 if any physician role
    assert.ok(r.body.codes.length >= 1);
  });

  test('hedis /all handles 50 BP observations', async () => {
    const bp = Array.from({ length: 50 }, (_, i) => ({
      systolic_bp: 130 + i,
      diastolic_bp: 80 + (i % 10),
      observed_date: new Date(Date.now() - i * 86400000).toISOString()
    }));
    const r = await request(port, 'POST', '/api/quality/hedis/all', {
      patient: { id: 1, dob: '1970-01-01' },
      problems: [{ icd10_code: 'I10', status: 'active' }],
      bp_observations: bp
    });
    assert.equal(r.status, 200);
    const cbp = r.body.results.find(x => x.measure_id === 'CBP');
    assert.ok(cbp.most_recent_bp);
    // Most recent should be index 0 (today) → systolic 130
    assert.equal(cbp.most_recent_bp.systolic, 130);
  });
});
