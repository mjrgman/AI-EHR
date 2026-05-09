'use strict';

// Integration tests for server/routes/care-management-routes.js.
// Mounts on a bare Express app and exercises each route via Node's http module.
//
// Pattern follows the existing route-test convention: real Express, real
// request/response cycle, no supertest dependency.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { mountCareManagementRoutes } = require('../../server/routes/care-management-routes');

function startServer() {
  const app = express();
  app.use(express.json());
  mountCareManagementRoutes(app, { db: {} });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
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
  const started = await startServer();
  port = started.port;
  server = started.server;
});
after(() => server && server.close());

const recentISO = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

// ============================================================
describe('care-mgmt-routes: GET /api/care-management/codes', () => {
  test('returns full code catalog', async () => {
    const r = await request(port, 'GET', '/api/care-management/codes');
    assert.equal(r.status, 200);
    assert.ok(r.body.total > 20, 'should have at least 20 codes');
    assert.ok(r.body.families.CCM.includes('99490'));
    assert.ok(r.body.codes['G0556']);
  });

  test('denies front-desk role at the route boundary', async () => {
    const r = await request(port, 'GET', '/api/care-management/codes', null, {
      'x-user-id': 'frontdesk@example.test',
      'x-user-role': 'front_desk'
    });
    assert.equal(r.status, 403);
  });

  test('allows billing role at the route boundary', async () => {
    const r = await request(port, 'GET', '/api/care-management/codes', null, {
      'x-user-id': 'billing@example.test',
      'x-user-role': 'billing'
    });
    assert.equal(r.status, 200);
  });
});

describe('care-mgmt-routes: POST /api/care-management/eligibility', () => {
  test('400 when patient.id missing', async () => {
    const r = await request(port, 'POST', '/api/care-management/eligibility', { patient: {} });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /patient\.id/);
  });

  test('returns per-program eligibility for valid patient', async () => {
    const r = await request(port, 'POST', '/api/care-management/eligibility', {
      patient: { id: 1, dob: '1960-01-01' },
      problems: [
        { icd10_code: 'E11.9', status: 'active' },
        { icd10_code: 'I50.9', status: 'active' }
      ],
      consent: { consent_date: recentISO(30) }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.patient_id, 1);
    assert.equal(r.body.ccm.eligible, true);
    assert.equal(r.body.bhi.eligible, false, 'no F-code dx');
    assert.equal(r.body.pcm.eligible, true, 'I50.9 is high-risk');
  });
});

describe('care-mgmt-routes: POST /api/care-management/billable', () => {
  test('400 when patient.id missing', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      enrollment: { program_type: 'CCM' }
    });
    assert.equal(r.status, 400);
  });

  test('400 when program_type missing', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1 }
    });
    assert.equal(r.status, 400);
  });

  test('CCM with 30 min staff time → returns 99490', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1, dob: '1960-01-01' },
      problems: [
        { icd10_code: 'E11.9', status: 'active' },
        { icd10_code: 'I50.9', status: 'active' }
      ],
      enrollment: {
        program_type: 'CCM',
        consent: { consent_date: recentISO(30) }
      },
      timeLog: [{ minutes: 30, staff_role: 'rn' }]
    });
    assert.equal(r.status, 200);
    const cpts = r.body.codes.map(c => c.cpt);
    assert.ok(cpts.includes('99490'));
  });

  test('APCM with conflicting CCM in active codes → suppressed', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', {
      patient: { id: 1, insurance: { medicare: true } },
      problems: [
        { icd10_code: 'E11.9', status: 'active' },
        { icd10_code: 'I50.9', status: 'active' }
      ],
      enrollment: {
        program_type: 'APCM',
        consent: { consent_date: recentISO(30) }
      },
      activeBillingCpts: ['99490'],
      apcmOptions: { qppPathway: 'mssp' }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.codes.length, 0);
    assert.match(r.body.rationale.join(' '), /APCM not eligible/);
  });
});

describe('care-mgmt-routes: POST /api/care-management/conflict-check', () => {
  test('400 when proposedCpt missing', async () => {
    const r = await request(port, 'POST', '/api/care-management/conflict-check', {});
    assert.equal(r.status, 400);
  });

  test('CCM 99490 + active TCM 99495 → blocked', async () => {
    const r = await request(port, 'POST', '/api/care-management/conflict-check', {
      proposedCpt: '99490',
      activeCpts: ['99495']
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.allowed, false);
  });

  test('99213 office E/M → no care-mgmt conflict', async () => {
    const r = await request(port, 'POST', '/api/care-management/conflict-check', {
      proposedCpt: '99213',
      activeCpts: ['99490']
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.allowed, true);
  });
});

describe('care-mgmt-routes: defensive', () => {
  test('mountCareManagementRoutes throws when app missing', () => {
    assert.throws(() => mountCareManagementRoutes(null), /app is required/);
  });

  test('handles empty body gracefully (POST /billable)', async () => {
    const r = await request(port, 'POST', '/api/care-management/billable', null);
    assert.equal(r.status, 400);
  });
});
