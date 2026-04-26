'use strict';

// Unit tests for server/security/rbac.js.
// Covers filterPHI per role, requireResourceAccess middleware behavior,
// hasAuthority ordering, and the canAccess/canWrite/authorize matrix.
// The recently-hardened PHI scope filter (commit b8864c1) is the load-bearing
// surface — these tests pin its current behavior so future changes are visible.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const rbac = require('../../server/security/rbac');

// Mock req/res helpers — kept inline so each test is self-contained.
//
// 2026-04-26: post-security-hotfix (commit 9e939e48), rbac.js no longer
// reads `req.headers['x-user-role']` — the header-trust model was removed.
// Identity now flows through `req.session.userRole` (populated by auth
// middleware from the verified JWT) or `req.user.role`. mockReq populates
// both `headers` (back-compat for any test that still inspects them) AND
// a synthesized `session` so RBAC middleware sees the role under the
// post-hotfix identity model. Pass `session: null` explicitly to test
// missing-session behavior; pass a custom session object to override.
function mockReq({ role = 'guest', method = 'GET', headers = {}, session = undefined } = {}) {
  const effectiveSession = session === undefined
    ? { userRole: role, userId: 'test-user' }
    : session;
  return {
    method,
    path: '/api/test',
    headers: { 'x-user-role': role, 'x-user-id': 'test-user', ...headers },
    session: effectiveSession,
  };
}
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

describe('rbac: role registry sanity', () => {
  test('all expected roles are registered', () => {
    const expected = ['physician', 'nurse_practitioner', 'ma', 'front_desk', 'billing', 'admin', 'system'];
    for (const role of expected) {
      assert.ok(rbac.ROLES[role], `role ${role} must be registered`);
    }
  });

  test('physician and nurse_practitioner have phiScope: ["all"]', () => {
    assert.deepEqual(rbac.ROLES.physician.phiScope, ['all']);
    assert.deepEqual(rbac.ROLES.nurse_practitioner.phiScope, ['all']);
  });

  test('front_desk is restricted to demographics only', () => {
    assert.deepEqual(rbac.ROLES.front_desk.phiScope, ['demographics']);
  });

  test('admin role has empty phiScope (no direct PHI access)', () => {
    assert.deepEqual(rbac.ROLES.admin.phiScope, []);
  });
});

describe('rbac: filterPHI', () => {
  const fullPatient = {
    id: 999999,
    mrn: 'TEST-MRN-1',
    first_name: 'Test',
    last_name: 'Patient',
    dob: '1990-01-01',
    phone: '555-0100',
    email: 'test@example.invalid',
    medications: [{ medication_name: 'Test Med', dosage: '10mg' }],
    allergies: [{ allergy_name: 'penicillin', reaction: 'rash' }],
    icd10_code: 'Z00.00',
    cpt_code: '99213',
    problem_description: 'Test diagnosis description',
  };

  test('physician sees the full patient (all-scope)', () => {
    const filtered = rbac.filterPHI('physician', fullPatient);
    assert.equal(filtered, fullPatient, 'all-scope must short-circuit and return the same object');
  });

  test('front_desk sees demographics but NOT medications/allergies/diagnosis', () => {
    const filtered = rbac.filterPHI('front_desk', fullPatient);
    assert.equal(filtered.first_name, fullPatient.first_name, 'first_name is demographics — kept');
    assert.equal(filtered.dob, fullPatient.dob, 'dob is demographics — kept');
    assert.equal(filtered.medications, undefined, 'medications must be stripped from front_desk view');
    assert.equal(filtered.allergies, undefined, 'allergies must be stripped from front_desk view');
    assert.equal(filtered.diagnosis, undefined, 'diagnosis must be stripped from front_desk view');
  });

  test('billing sees demographics + diagnosis-coding fields but NOT medications', () => {
    // billing's phiScope is ['demographics', 'diagnosis', 'icd10_code', 'cpt_code'].
    // The 'diagnosis' scope grants icd10_code, diagnosis_code, cpt_code, snomed_code,
    // problem_description — there is no literal 'diagnosis' field in the scope map.
    const filtered = rbac.filterPHI('billing', fullPatient);
    assert.equal(filtered.first_name, fullPatient.first_name);
    assert.equal(filtered.icd10_code, fullPatient.icd10_code, 'billing needs icd10_code for coding');
    assert.equal(filtered.cpt_code, fullPatient.cpt_code, 'billing needs cpt_code for coding');
    assert.equal(filtered.problem_description, fullPatient.problem_description);
    assert.equal(filtered.medications, undefined, 'billing must NOT see medications');
    assert.equal(filtered.allergies, undefined, 'billing must NOT see allergies');
  });

  test('ma sees demographics + medications + allergies but NOT coding fields', () => {
    const filtered = rbac.filterPHI('ma', fullPatient);
    assert.equal(filtered.first_name, fullPatient.first_name);
    assert.deepEqual(filtered.medications, fullPatient.medications, 'ma sees medications');
    assert.deepEqual(filtered.allergies, fullPatient.allergies, 'ma sees allergies');
    assert.equal(filtered.icd10_code, undefined, 'ma scope does not include diagnosis-coding fields');
    assert.equal(filtered.cpt_code, undefined);
  });

  test('admin (empty phiScope) sees only structural fields', () => {
    const filtered = rbac.filterPHI('admin', fullPatient);
    assert.equal(filtered.id, fullPatient.id, 'id is always kept (structural)');
    assert.equal(filtered.first_name, undefined, 'admin sees no demographics');
    assert.equal(filtered.medications, undefined);
  });

  test('unknown role returns null (deny-by-default)', () => {
    assert.equal(rbac.filterPHI('not-a-real-role', fullPatient), null);
  });
});

describe('rbac: canAccess / canWrite / authorize matrix', () => {
  test('physician canAccess clinical resources', () => {
    assert.equal(rbac.canAccess('physician', 'patients'), true);
    assert.equal(rbac.canAccess('physician', 'medications'), true);
    assert.equal(rbac.canAccess('physician', 'audit_logs'), false, 'physician must NOT see audit logs');
  });

  test('front_desk cannot access clinical notes or medications', () => {
    assert.equal(rbac.canAccess('front_desk', 'notes'), false);
    assert.equal(rbac.canAccess('front_desk', 'medications'), false);
    assert.equal(rbac.canAccess('front_desk', 'patients'), true, 'front_desk gets patient demographics');
  });

  test('ma cannot access clinical notes', () => {
    assert.equal(rbac.canAccess('ma', 'notes'), false);
    assert.equal(rbac.canAccess('ma', 'medications'), true, 'ma can view meds for refill routing');
  });

  test('billing cannot access notes or medications', () => {
    assert.equal(rbac.canAccess('billing', 'notes'), false);
    assert.equal(rbac.canAccess('billing', 'medications'), false);
  });

  test('admin can access audit logs but not patient data', () => {
    assert.equal(rbac.canAccess('admin', 'audit_logs'), true);
    assert.equal(rbac.canAccess('admin', 'patients'), false);
  });

  test('authorize honours the canSign matrix for sign actions', () => {
    assert.equal(rbac.authorize('physician', 'prescriptions', 'sign'), true);
    assert.equal(rbac.authorize('ma', 'prescriptions', 'sign'), false);
  });

  test('unknown role denies everything', () => {
    assert.equal(rbac.authorize('not-a-role', 'patients', 'access'), false);
  });
});

describe('rbac: requireResourceAccess middleware', () => {
  test('returns 403 when role lacks access to the resource', (t, done) => {
    const middleware = rbac.requireResourceAccess('notes');
    const req = mockReq({ role: 'front_desk', method: 'GET' });
    const res = mockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'next() must NOT be called on denial');
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Cannot access notes/);
    done();
  });

  test('calls next() when role has access', (t, done) => {
    const middleware = rbac.requireResourceAccess('patients');
    const req = mockReq({ role: 'physician', method: 'GET' });
    const res = mockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'next() must be called when access is granted');
    assert.equal(res.statusCode, 200, 'no 403 status when access is granted');
    done();
  });

  test('maps HTTP methods to action verbs (POST -> create)', (t, done) => {
    const middleware = rbac.requireResourceAccess('prescriptions');
    // billing cannot create prescriptions (canWrite=false)
    const req = mockReq({ role: 'billing', method: 'POST' });
    const res = mockRes();
    middleware(req, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Cannot create prescriptions/);
    done();
  });
});

describe('rbac: hasAuthority', () => {
  test('physician has authority over ma (tier 3 >= tier 1)', () => {
    assert.equal(rbac.hasAuthority('physician', 'ma'), true);
  });

  test('ma does NOT have authority over physician', () => {
    assert.equal(rbac.hasAuthority('ma', 'physician'), false);
  });

  test('same-tier roles have authority over each other (>=)', () => {
    assert.equal(rbac.hasAuthority('physician', 'nurse_practitioner'), true);
    assert.equal(rbac.hasAuthority('nurse_practitioner', 'physician'), true);
  });

  test('unknown role returns false', () => {
    assert.equal(rbac.hasAuthority('not-a-role', 'physician'), false);
    assert.equal(rbac.hasAuthority('physician', 'not-a-role'), false);
  });
});
