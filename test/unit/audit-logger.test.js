'use strict';

// Unit tests for server/audit-logger.js — focused on the pure surface
// (matchRoute + PHI_ROUTES coverage). The DB-write side of the middleware is
// covered by the integration suite. These tests prevent regressions in route
// classification: a route that drops out of PHI_ROUTES silently stops being
// audited, which is a HIPAA gap that's invisible at runtime.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const auditLogger = require('../../server/audit-logger');

describe('audit-logger: matchRoute on exact paths', () => {
  test('matches an exact known patient endpoint', () => {
    const m = auditLogger.matchRoute('GET', '/api/patients');
    assert.ok(m, 'GET /api/patients must match');
    assert.equal(m.config.resource_type, 'patient');
    assert.equal(m.config.phi, true);
  });

  test('matches health endpoint as non-PHI system route', () => {
    const m = auditLogger.matchRoute('GET', '/api/health');
    assert.ok(m, 'GET /api/health must match');
    assert.equal(m.config.phi, false);
  });

  test('returns null for an unknown path', () => {
    assert.equal(auditLogger.matchRoute('GET', '/api/totally-unknown-endpoint'), null);
  });

  test('returns null when method does not match a known path', () => {
    // /api/patients exists for GET, but DELETE is not in the table.
    assert.equal(auditLogger.matchRoute('DELETE', '/api/patients'), null);
  });
});

describe('audit-logger: matchRoute on parameterized paths', () => {
  test('matches /api/patients/:id and routes via the right config', () => {
    const m = auditLogger.matchRoute('GET', '/api/patients/12345');
    assert.ok(m, 'parameterized path must match');
    assert.equal(m.config.resource_type, 'patient');
    assert.equal(m.config.phi, true);
  });

  test('extractPatientId pulls the id from req.params for parameterized routes', () => {
    const m = auditLogger.matchRoute('GET', '/api/patients/12345/medications');
    assert.ok(m);
    assert.equal(typeof m.config.extractPatientId, 'function');
    const fakeReq = { params: { id: '12345' } };
    assert.equal(m.config.extractPatientId(fakeReq), '12345');
  });

  test('strips query string before matching', () => {
    const m = auditLogger.matchRoute('GET', '/api/patients/12345?include=meds');
    assert.ok(m, 'matchRoute must ignore query strings');
    assert.equal(m.config.resource_type, 'patient');
  });

  test('strips trailing slash before matching', () => {
    const m = auditLogger.matchRoute('GET', '/api/patients/');
    assert.ok(m, 'matchRoute must tolerate trailing slashes');
    assert.equal(m.config.resource_type, 'patient');
  });
});

describe('audit-logger: PHI_ROUTES coverage', () => {
  test('every classified PHI route declares phiFields', () => {
    for (const [routeKey, config] of Object.entries(auditLogger.PHI_ROUTES)) {
      if (config.phi) {
        assert.ok(
          Array.isArray(config.phiFields) && config.phiFields.length > 0,
          `PHI route ${routeKey} must declare which phiFields it touches (HIPAA traceability)`
        );
      }
    }
  });

  test('every parameterized PHI route on a patient resource declares extractPatientId', () => {
    for (const [routeKey, config] of Object.entries(auditLogger.PHI_ROUTES)) {
      if (!config.phi) continue;
      // Routes that should have extractPatientId: anything mentioning :id, :patientId, or
      // resource types that are patient-scoped (medication, lab_result, allergy, etc.)
      const isParameterized = /:(id|patientId)\b/.test(routeKey);
      const isPatientScoped = ['medication', 'allergy', 'lab_result', 'vitals', 'problem'].includes(config.resource_type);
      if (isParameterized && isPatientScoped) {
        assert.equal(
          typeof config.extractPatientId,
          'function',
          `PHI route ${routeKey} touches patient-scoped data and must declare extractPatientId`
        );
      }
    }
  });

  test('non-PHI routes (e.g. cds suggestion accept/reject) do not falsely declare phiFields', () => {
    const cdsAccept = auditLogger.matchRoute('POST', '/api/cds/suggestions/abc123/accept');
    assert.ok(cdsAccept);
    assert.equal(cdsAccept.config.phi, false);
    // Defensive: phiFields shouldn't be set on non-PHI routes.
    assert.equal(cdsAccept.config.phiFields, undefined);
  });

  test('portal message and triage routes are classified as patient-scoped PHI', () => {
    const message = auditLogger.matchRoute('POST', '/api/patient-portal/message');
    const triage = auditLogger.matchRoute('POST', '/api/patient-portal/symptom-triage');
    assert.ok(message);
    assert.ok(triage);
    assert.equal(message.config.phi, true);
    assert.equal(triage.config.phi, true);
    assert.equal(message.config.extractPatientId({ portalPatient: { id: 42 } }), 42);
    assert.equal(triage.config.extractPatientId({ portalPatient: { id: 42 } }), 42);
  });

  test('portal medication and lab reads are classified as patient-scoped PHI', () => {
    const meds = auditLogger.matchRoute('GET', '/api/patient-portal/medications');
    const labs = auditLogger.matchRoute('GET', '/api/patient-portal/labs');
    assert.ok(meds);
    assert.ok(labs);
    assert.equal(meds.config.phi, true);
    assert.equal(labs.config.phi, true);
    assert.equal(meds.config.extractPatientId({ portalPatient: { id: 7 } }), 7);
    assert.equal(labs.config.extractPatientId({ portalPatient: { id: 7 } }), 7);
  });
});

describe('audit-logger: SESSION_HEADER constant', () => {
  test('exports the expected header name', () => {
    assert.equal(auditLogger.SESSION_HEADER, 'x-audit-session-id');
  });
});

describe('audit-logger: identity resolution ignores spoofable audit headers', () => {
  test('uses authenticated JWT identity over x-audit-* headers', () => {
    const identity = auditLogger.resolveAuditIdentity({
      user: { username: 'dr.renner', role: 'physician' },
      headers: { 'x-audit-user': 'forged-admin', 'x-audit-role': 'admin' },
    });
    assert.deepEqual(identity, { userIdentity: 'dr.renner', userRole: 'physician' });
  });

  test('uses portal patient identity for portal-session requests', () => {
    const identity = auditLogger.resolveAuditIdentity({
      portalPatient: { id: 123 },
      headers: { 'x-audit-user': 'forged-admin', 'x-audit-role': 'admin' },
    });
    assert.deepEqual(identity, { userIdentity: 'portal-patient:123', userRole: 'patient_portal' });
  });
});
