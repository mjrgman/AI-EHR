'use strict';

// Integration tests for server/routes/hedis-routes.js — Iter 2 of autobetter.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { mountHedisRoutes } = require('../../server/routes/hedis-routes');

function startServer() {
  const app = express();
  app.use(express.json());
  mountHedisRoutes(app, { db: {} });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
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
          resolve({ status: res.statusCode, body: json });
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

const dobAt = (years) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

const monthsAgoISO = (m) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString();
};

// ============================================================
describe('hedis-routes: GET /api/quality/hedis/measures', () => {
  test('returns list of measures', async () => {
    const r = await request(port, 'GET', '/api/quality/hedis/measures');
    assert.equal(r.status, 200);
    assert.ok(r.body.measures.includes('BCS-E'));
    assert.ok(r.body.measures.includes('CBP'));
    assert.ok(typeof r.body.measurement_year_default === 'number');
  });

  test('denies front-desk role at the route boundary', async () => {
    const r = await request(port, 'GET', '/api/quality/hedis/measures', null, {
      'x-user-id': 'frontdesk@example.test',
      'x-user-role': 'front_desk'
    });
    assert.equal(r.status, 403);
  });

  test('allows MA role at the route boundary', async () => {
    const r = await request(port, 'GET', '/api/quality/hedis/measures', null, {
      'x-user-id': 'ma@example.test',
      'x-user-role': 'ma'
    });
    assert.equal(r.status, 200);
  });
});

describe('hedis-routes: POST /api/quality/hedis/evaluate/:measureId', () => {
  test('400 when patient.id missing', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/BCS-E', {});
    assert.equal(r.status, 400);
  });

  test('404 for unknown measure', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/NOPE', {
      patient: { id: 1, dob: dobAt(60), sex: 'F' }
    });
    assert.equal(r.status, 404);
    assert.match(r.body.error, /Unknown/);
  });

  test('BCS-E for 60yo woman with recent mammogram → met', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/BCS-E', {
      patient: { id: 1, dob: dobAt(60), sex: 'F' },
      procedures: [{ cpt_code: '77067', performed_date: monthsAgoISO(6) }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'met');
  });

  test('CBP for 50yo with HTN + BP 125/75 → met both rates', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/CBP', {
      patient: { id: 2, dob: dobAt(50) },
      problems: [{ icd10_code: 'I10', status: 'active' }],
      bp_observations: [{ systolic_bp: 125, diastolic_bp: 75, observed_date: monthsAgoISO(1) }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.in_numerator_rate1, true);
    assert.equal(r.body.in_numerator_rate2, true);
  });

  test('measureId is case-insensitive', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/evaluate/bcs-e', {
      patient: { id: 1, dob: dobAt(60), sex: 'F' }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.measure_id, 'BCS-E');
  });
});

describe('hedis-routes: POST /api/quality/hedis/all', () => {
  test('400 when patient.id missing', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/all', {});
    assert.equal(r.status, 400);
  });

  test('returns all measures for valid patient', async () => {
    const r = await request(port, 'POST', '/api/quality/hedis/all', {
      patient: { id: 1, dob: dobAt(60), sex: 'F' },
      problems: [{ icd10_code: 'I10', status: 'active' }],
      bp_observations: [{ systolic_bp: 130, diastolic_bp: 82, observed_date: new Date().toISOString() }],
      procedures: [{ cpt_code: '77067', performed_date: monthsAgoISO(6) }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.patient_id, 1);
    assert.equal(r.body.results.length, 2);
    const bcsE = r.body.results.find(x => x.measure_id === 'BCS-E');
    const cbp = r.body.results.find(x => x.measure_id === 'CBP');
    assert.equal(bcsE.status, 'met');
    assert.equal(cbp.in_numerator_rate1, true);
  });
});

describe('hedis-routes: defensive', () => {
  test('mountHedisRoutes throws when app missing', () => {
    assert.throws(() => mountHedisRoutes(null), /app is required/);
  });
});
