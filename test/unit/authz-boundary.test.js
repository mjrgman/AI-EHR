'use strict';

// ============================================================================
// AUTHZ BOUNDARY TESTS  (Wave 1 SECURITY — written BEFORE the fixes exist)
// ============================================================================
//
// These tests assert the SECURE target behavior for the authorization layer.
// They are EXPECTED TO FAIL against today's vulnerable code — each failure
// documents a live, confirmed vulnerability from ULTRAREVIEW_2026-05-28.md:
//
//   sec-fhir-rbac-idor-01  (P0) — no RBAC/PHI filtering on /fhir/R4; any
//                                  authenticated role reads any chart by ID.
//   sec-smart-scope-noop-02 (P0) — scope-check.js fails OPEN for login tokens
//                                  (no `scope` claim → next() passthrough).
//   sec-fhir-write-unscoped-03 (P0) — FHIR writes have no write-scope gate;
//                                  a read-only/low-priv token can POST/PUT.
//   sec-labcorp-order-ownership-08 (P1) — submit-to-labcorp has no RBAC; any
//                                  role can transmit any order to the lab.
//   sec-portal-weak-verify-05 (P1) — portal /verify has no rate-limit/lockout.
//
// Harness mirrors server.js wiring: auth.requireAuth → fhirRouter (which runs
// smartScopeCheck internally). We mint REAL JWTs via auth.signToken so the
// scope-check sees the real (absent) scope claim and RBAC sees the real role.
//
// The database singleton is stubbed via require.cache (the same technique used
// by scheduling-repository.test.js) so the FHIR router, fhir-write, scope-check
// and patient-voice all resolve against deterministic SYNTHETIC data — no PHI.
//
// Roles per server/security/rbac.js: physician, nurse_practitioner, ma,
// front_desk, billing (admin/system excluded — not clinical front-line roles).
// NOTE: there is no plain "nurse" role in this codebase; nurse_practitioner is
// the tier-3 nursing role. The low-privilege roles (ma/front_desk/billing) are
// the IDOR/over-broad-access surface the matrix below exercises.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

// ----------------------------------------------------------------------------
// JWT secret must be stable BEFORE auth.js is required (it reads it at load).
// ----------------------------------------------------------------------------
process.env.JWT_SECRET = process.env.JWT_SECRET || 'authz-boundary-test-secret-key';
// Ensure no dev bypass leaks in.
delete process.env.ENABLE_DEV_AUTH_BYPASS;

// ----------------------------------------------------------------------------
// SYNTHETIC DATA — two distinct patients. Patient 1 is the "own" chart;
// Patient 5 is the "other patient" used for the IDOR probes. No real PHI.
// ----------------------------------------------------------------------------
const PATIENTS = {
  1: { id: 1, mrn: 'TEST-0001', first_name: 'Ada', last_name: 'Tester', dob: '1980-01-01', sex: 'F', phone: '555-0001' },
  5: { id: 5, mrn: 'TEST-0005', first_name: 'Boris', last_name: 'Sample', dob: '1975-05-05', sex: 'M', phone: '555-0005' },
};
const PROBLEMS = {
  1: [{ id: 11, patient_id: 1, problem_name: 'Hypertension', icd10_code: 'I10', status: 'active', onset_date: '2020-01-01', created_at: '2020-01-01' }],
  5: [{ id: 51, patient_id: 5, problem_name: 'Type 2 Diabetes', icd10_code: 'E11.9', status: 'active', onset_date: '2019-01-01', created_at: '2019-01-01' }],
};
const LABS = {
  5: [{ id: 501, patient_id: 5, test_name: 'A1c', result_value: '8.2', units: '%', reference_range: '<5.7', result_date: '2026-01-01', status: 'final', abnormal_flag: 'H' }],
};

// ----------------------------------------------------------------------------
// Stub the shared database module via require.cache so every
// require('../database') / require('../../database') resolves to this stub.
// We install it BEFORE requiring any server module that pulls the singleton.
// ----------------------------------------------------------------------------
const dbModulePath = path.resolve(__dirname, '../../server/database.js');

let createdRows = []; // capture FHIR write attempts so we can assert they were blocked

const dbStub = {
  async dbAll(sql) {
    // Encounter / MedicationRequest queries — return empty (not under test here).
    return [];
  },
  async dbGet(sql, params) {
    // audit_log inserts go through dbRun; dbGet used for users/labs rows etc.
    if (/FROM users/i.test(sql)) return null;
    return null;
  },
  async dbRun() {
    return { lastID: 9999, changes: 1 };
  },
  // Patient accessors used by the FHIR read router + fhir-write
  getAllPatients: async () => Object.values(PATIENTS),
  getPatientById: async (id) => PATIENTS[id] || null,
  getPatientProblems: async (pid) => PROBLEMS[pid] || [],
  getPatientVitals: async () => [],
  getPatientLabs: async (pid) => LABS[pid] || [],
  getPatientAllergies: async () => [],
  getEncounterById: async () => null,
  getAppointmentsByPatient: async () => [],
  // Write paths — if these EVER run, the write was not blocked (a failure).
  createPatient: async (data) => { createdRows.push({ type: 'patient', data }); return { id: 7777 }; },
  addProblem: async (data) => { createdRows.push({ type: 'problem', data }); return { id: 7778 }; },
  addLab: async (data) => { createdRows.push({ type: 'lab', data }); return { id: 7779 }; },
  addVitals: async (data) => { createdRows.push({ type: 'vitals', data }); return { id: 7780 }; },
  addAllergy: async (data) => { createdRows.push({ type: 'allergy', data }); return { id: 7781 }; },
};

const originalDbModule = require.cache[dbModulePath];
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: dbStub,
};

// Require server modules AFTER the stub is installed.
const auth = require('../../server/security/auth');
const fhirRouter = require('../../server/fhir/router');
const { mountLabCorpRoutes } = require('../../server/routes/labcorp-routes');

// ----------------------------------------------------------------------------
// Token + request helpers
// ----------------------------------------------------------------------------
function tokenFor(role, username = `${role}-user`) {
  // Mirrors auth.login(): signs a user object → payload carries {sub,username,
  // role,fullName} and crucially NO `scope` claim (the live vulnerability).
  return auth.signToken({ id: 100, username, role, full_name: `${role} user` });
}

function request(port, method, urlPath, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port, path: urlPath, method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
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

// ============================================================================
// SUITE 1 — FHIR R4 authorization boundary
// ============================================================================
describe('authz-boundary: FHIR R4 RBAC + scope (currently vulnerable)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    // EXACTLY mirrors server.js:231 — auth then the FHIR router.
    app.use('/fhir/R4', auth.requireAuth, fhirRouter);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    port = server.address().port;
  });

  after(() => server && server.close());

  // --- Unauthenticated baseline (this should already pass) ---
  test('unauthenticated read of any chart is rejected (401)', async () => {
    const r = await request(port, 'GET', '/fhir/R4/Patient/5');
    assert.equal(r.status, 401, 'no token must be rejected');
  });

  // --- IDOR / broken function-level auth: low-priv roles reading PHI ---
  // SECURE TARGET: front_desk (demographics-only, no problems/labs access) must
  // be DENIED (403) when reading another patient's clinical resources by ID.
  // TODAY: returns 200 — sec-fhir-rbac-idor-01 / sec-smart-scope-noop-02.
  for (const role of ['front_desk', 'billing', 'ma']) {
    test(`${role} reading another patient's Condition by ID is denied (403, not 200)`, async () => {
      const r = await request(port, 'GET', '/fhir/R4/Condition?patient=5', { token: tokenFor(role) });
      assert.equal(r.status, 403,
        `${role} has no clinical-problem access and must be denied; got ${r.status} (IDOR live if 200)`);
    });
  }

  test('front_desk reading another patient labs (Observation) is denied (403)', async () => {
    const r = await request(port, 'GET', '/fhir/R4/Observation?patient=5&category=laboratory', { token: tokenFor('front_desk') });
    assert.equal(r.status, 403, `front_desk has no labs scope; got ${r.status}`);
  });

  test('billing reading another patient MedicationRequest is denied (403)', async () => {
    const r = await request(port, 'GET', '/fhir/R4/MedicationRequest?patient=5', { token: tokenFor('billing') });
    assert.equal(r.status, 403, `billing has no medications scope; got ${r.status}`);
  });

  // --- Positive control: physician (phiScope ['all']) may read. ---
  test('physician reading a patient Condition is permitted (200)', async () => {
    const r = await request(port, 'GET', '/fhir/R4/Condition?patient=5', { token: tokenFor('physician') });
    assert.equal(r.status, 200, `physician must retain access; got ${r.status}`);
  });

  test('SMART patient scope cannot read outside its launch patient compartment', async () => {
    const token = auth.signToken({
      sub: 20,
      username: 'smart-doc',
      role: 'physician',
      scope: 'patient/Condition.read',
      patient: 5,
    });
    const permitted = await request(port, 'GET', '/fhir/R4/Condition?patient=5', { token });
    const denied = await request(port, 'GET', '/fhir/R4/Condition?patient=6', { token });
    assert.equal(permitted.status, 200);
    assert.equal(denied.status, 403);
  });

  test('SMART patient scope without a launch patient fails closed', async () => {
    const token = auth.signToken({
      sub: 20,
      username: 'smart-doc',
      role: 'physician',
      scope: 'patient/Condition.read',
    });
    const r = await request(port, 'GET', '/fhir/R4/Condition?patient=5', { token });
    assert.equal(r.status, 403);
  });

  // --- Login token carries no scope claim → scope-check must FAIL CLOSED ---
  // SECURE TARGET: a login token (no `scope` claim) hitting an out-of-role
  // resource is denied. TODAY scope-check.js:70 returns next() → passthrough.
  test('login token without scope claim is denied on out-of-role resource (fail-closed)', async () => {
    const tok = tokenFor('front_desk');
    const decoded = auth.verifyToken(tok);
    assert.equal(decoded.scope, undefined, 'precondition: login tokens carry no scope claim');
    const r = await request(port, 'GET', '/fhir/R4/Condition?patient=5', { token: tok });
    assert.equal(r.status, 403, `scope-check must fail closed for scopeless tokens; got ${r.status}`);
  });

  // --- Writes must require WRITE scope, not read scope ---
  // SECURE TARGET: a low-priv role POSTing a new Patient/Observation/Condition
  // is denied (403) AND no row is written. TODAY writes fall back to read scope
  // and there is no RBAC canWrite gate — sec-fhir-write-unscoped-03.
  test('front_desk POST /Patient (create) is denied (403) and writes nothing', async () => {
    createdRows = [];
    const r = await request(port, 'POST', '/fhir/R4/Patient', {
      token: tokenFor('front_desk'),
      body: { resourceType: 'Patient', name: [{ family: 'Hacker', given: ['Eve'] }], gender: 'female', birthDate: '1990-01-01' },
    });
    assert.equal(r.status, 403, `front_desk cannot create patients; got ${r.status}`);
    assert.equal(createdRows.length, 0, 'no patient row may be persisted on a denied write');
  });

  test('ma POST /Condition (create problem) is denied (403) and writes nothing', async () => {
    createdRows = [];
    const r = await request(port, 'POST', '/fhir/R4/Condition', {
      token: tokenFor('ma'),
      body: { resourceType: 'Condition', subject: { reference: 'Patient/5' }, code: { text: 'Injected problem' } },
    });
    assert.equal(r.status, 403, `ma cannot write problems (canWrite.problems=false); got ${r.status}`);
    assert.equal(createdRows.length, 0, 'no problem row may be persisted on a denied write');
  });

  test('billing POST /Observation (create lab) is denied (403) and writes nothing', async () => {
    createdRows = [];
    const r = await request(port, 'POST', '/fhir/R4/Observation', {
      token: tokenFor('billing'),
      body: {
        resourceType: 'Observation',
        category: [{ coding: [{ code: 'laboratory' }] }],
        code: { coding: [{ code: '4548-4', display: 'A1c' }] },
        subject: { reference: 'Patient/5' },
        valueQuantity: { value: 99, unit: '%' },
      },
    });
    assert.equal(r.status, 403, `billing cannot write labs; got ${r.status}`);
    assert.equal(createdRows.length, 0, 'no lab row may be persisted on a denied write');
  });
});

// ============================================================================
// SUITE 2 — LabCorp submit endpoint requires an authorized clinical role
// ============================================================================
describe('authz-boundary: LabCorp submit RBAC (currently vulnerable)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', auth.requireAuth); // mirrors server.js: /api gated by auth
    // labcorp routes mount their own router under /api
    mountLabCorpRoutes(app, {
      db: {
        ...dbStub,
        // a lab order owned by patient 5 so the handler reaches submission
        dbGet: async (sql, params) => {
          if (/FROM lab_orders/i.test(sql)) {
            return { id: 42, patient_id: 5, test_name: 'CBC', indication: 'fatigue', priority: 'routine', fasting_required: 0 };
          }
          return null;
        },
        dbRun: async () => ({ lastID: 1, changes: 1 }),
      },
    });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    port = server.address().port;
  });

  after(() => server && server.close());

  // SECURE TARGET: a non-clinical role (front_desk/billing) is DENIED (403).
  // TODAY the route only checks req.user.sub exists, so it proceeds past authz
  // and returns 404/502/200 depending on order/transport — never 403.
  for (const role of ['front_desk', 'billing']) {
    test(`${role} cannot submit a lab order to LabCorp (403)`, async () => {
      const r = await request(port, 'POST', '/api/orders/42/submit-to-labcorp', { token: tokenFor(role) });
      assert.equal(r.status, 403,
        `${role} lacks lab_orders write authority and must be denied; got ${r.status}`);
    });
  }
});

// ============================================================================
// SUITE 3 — Patient-portal /verify rate-limiting / lockout
// ============================================================================
describe('authz-boundary: portal /verify lockout (currently vulnerable)', () => {
  let server, port;
  const portalModulePath = path.resolve(__dirname, '../../server/routes/patient-portal.js');
  const patientVoicePath = path.resolve(__dirname, '../../server/integrations/patient-voice.js');
  let savedPortal, savedVoice;

  before(async () => {
    // Force REQUIRE_MRN off so name+DOB-only attempts are evaluated (the weak path).
    process.env.PATIENT_PORTAL_REQUIRE_MRN = 'false';

    // Stub patient-voice.verifyPatient so /verify never matches (every attempt
    // is a "failed" attempt). The lockout must trigger on repeated FAILURES,
    // independent of whether the identity exists.
    savedVoice = require.cache[patientVoicePath];
    require.cache[patientVoicePath] = {
      id: patientVoicePath, filename: patientVoicePath, loaded: true,
      exports: {
        verifyPatient: async () => null,            // always fail to verify
        processVoiceIntent: async () => ({}),
      },
    };
    // Drop cached portal so it re-binds to the stubbed patient-voice.
    savedPortal = require.cache[portalModulePath];
    delete require.cache[portalModulePath];
    const portalRouter = require(portalModulePath);

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/patient-portal', portalRouter); // mirrors server.js:243 (public)
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    port = server.address().port;
  });

  after(() => {
    if (server) server.close();
    // restore module cache
    if (savedVoice) require.cache[patientVoicePath] = savedVoice; else delete require.cache[patientVoicePath];
    delete require.cache[portalModulePath];
    if (savedPortal) require.cache[portalModulePath] = savedPortal;
    delete process.env.PATIENT_PORTAL_REQUIRE_MRN;
  });

  // SECURE TARGET: after N failed name+DOB attempts, the endpoint locks out
  // (429 Too Many Requests, or 403) instead of perpetually returning 401.
  // TODAY there is no rate-limiting in any env — every attempt returns 401.
  test('repeated failed verify attempts trigger lockout (429/403, not endless 401)', async () => {
    const attempt = () => request(port, 'POST', '/api/patient-portal/verify', {
      body: { first_name: 'Eve', last_name: 'Attacker', dob: '1990-01-01' },
      headers: { 'X-Forwarded-For': '203.0.113.7' },
    });

    let lockedOut = false;
    let lastStatus = null;
    for (let i = 0; i < 8; i++) {
      const r = await attempt();
      lastStatus = r.status;
      if (r.status === 429 || r.status === 403) { lockedOut = true; break; }
    }
    assert.ok(lockedOut,
      `after repeated failures, /verify must lock out (429/403); never locked (last status ${lastStatus})`);
  });
});

// ----------------------------------------------------------------------------
// Restore the real database module on teardown so we don't leak the stub into
// other files if the runner shares a process.
// ----------------------------------------------------------------------------
after(() => {
  if (originalDbModule) require.cache[dbModulePath] = originalDbModule;
  else delete require.cache[dbModulePath];
});
