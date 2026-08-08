/**
 * Audit route-coverage guard.
 *
 * The central audit middleware classifies a request by looking it up in
 * PHI_ROUTES. A route that is absent is still logged, but as
 * resource_type='unknown' with phi_accessed=false and no patient ID -- so a
 * PHI disclosure records as a non-PHI event. Nothing detected that drift: the
 * table was maintained by hand and fell behind every time a route was added.
 *
 * This test enumerates the routes Express has ACTUALLY registered, by walking
 * the router stack of the real app, and fails if any of them is in neither
 * PHI_ROUTES nor NON_PHI_ROUTES. Adding a route now forces a decision about
 * whether it can disclose patient data.
 *
 * Walking the live stack rather than grepping source matters: route modules
 * declare relative paths and are mounted under a prefix, so static extraction
 * reports "/Patient" where the app really serves "/fhir/R4/Patient".
 */

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-production';
process.env.PHI_ENCRYPTION_KEY = process.env.PHI_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_PATH = process.env.DATABASE_PATH || ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const { app } = require('../../server/server.js');
const {
  PHI_ROUTES,
  NON_PHI_ROUTES,
  PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION,
} = require('../../server/audit-logger.js');

// Paths the audit middleware inspects at all (server/audit-logger.js).
const AUDITED_PREFIXES = ['/api/', '/fhir/R4/'];

/** Recover a router's mount path from its layer regexp. */
function mountPathOf(layer) {
  const src = layer.regexp && layer.regexp.source;
  if (!src || src === '^\\/?(?=\\/|$)') return '';
  return src
    .replace(/^\^\\\//, '/')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:\\\/\(\?=\$\)\)\?/g, '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');
}

function collectRoutes(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) out.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      collectRoutes(layer.handle.stack, prefix + mountPathOf(layer), out);
    }
  }
}

function registeredRoutes() {
  const out = [];
  collectRoutes(app._router.stack, '', out);
  return [...new Set(out)].sort();
}

/** Same param-tolerant matching the middleware uses. */
function lookup(table, method, path) {
  if (table[`${method} ${path}`]) return true;
  for (const pattern of Object.keys(table)) {
    const space = pattern.indexOf(' ');
    const pm = pattern.slice(0, space);
    const pp = pattern.slice(space + 1);
    if (pm !== method) continue;
    const a = pp.split('/');
    const b = path.split('/');
    if (a.length !== b.length) continue;
    if (a.every((seg, i) => seg.startsWith(':') || seg === b[i])) return true;
  }
  return false;
}

const inAuditScope = (p) => AUDITED_PREFIXES.some((pre) => p.startsWith(pre));

test('the app registers routes and they can be enumerated', () => {
  const routes = registeredRoutes();
  assert.ok(routes.length > 50, `expected the full route surface; got ${routes.length}`);
  assert.ok(
    routes.some((r) => r === 'GET /fhir/R4/Patient'),
    'mount prefixes must be resolved -- "/Patient" alone means the walk is wrong'
  );
});

test('every audited route is classified as either PHI or explicitly non-PHI', () => {
  const unclassified = registeredRoutes().filter((route) => {
    const space = route.indexOf(' ');
    const method = route.slice(0, space);
    const path = route.slice(space + 1);
    if (!inAuditScope(path)) return false;
    return !lookup(PHI_ROUTES, method, path) && !lookup(NON_PHI_ROUTES, method, path);
  });

  assert.deepEqual(
    unclassified, [],
    'These routes are under the audit middleware but classified nowhere. Each will\n' +
    "log as resource_type='unknown' with no patient ID. Add each to PHI_ROUTES in\n" +
    'server/audit-logger.js, or to NON_PHI_ROUTES with a reason it cannot disclose\n' +
    'patient data:\n  ' + unclassified.join('\n  ')
  );
});

test('no route is classified in both tables', () => {
  const both = Object.keys(PHI_ROUTES).filter((k) => Object.prototype.hasOwnProperty.call(NON_PHI_ROUTES, k));
  assert.deepEqual(both, [], `contradictory classification: ${both.join(', ')}`);
});

test('every NON_PHI_ROUTES entry states a reason', () => {
  for (const [route, reason] of Object.entries(NON_PHI_ROUTES)) {
    assert.ok(
      typeof reason === 'string' && reason.trim().length >= 10,
      `${route} is claimed non-PHI without a substantive reason`
    );
  }
});

test('every phi:true route either resolves a patient or is a registered known gap', () => {
  // A PHI row with no patient ID cannot answer "who accessed THIS patient's
  // record". Some routes genuinely cannot -- a collection endpoint has no
  // single subject -- so the requirement is not "always attribute" but
  // "attribute, or say in writing why you cannot".
  const unaccounted = Object.entries(PHI_ROUTES)
    .filter(([route, cfg]) => cfg.phi === true
      && typeof cfg.extractPatientId !== 'function'
      && !PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION[route])
    .map(([route]) => route);

  assert.deepEqual(
    unaccounted, [],
    'These PHI routes cannot attribute an access and are not registered as known\n' +
    'gaps. Add extractPatientId, or add an entry with a reason to\n' +
    'PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION:\n  ' + unaccounted.join('\n  ')
  );
});

test('the known-attribution-gap register stays honest', () => {
  for (const [route, reason] of Object.entries(PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION)) {
    assert.ok(PHI_ROUTES[route], `${route} is registered as a gap but is not a PHI route`);
    assert.ok(
      typeof reason === 'string' && reason.trim().length >= 10,
      `${route} is registered as a gap without a substantive reason`
    );
    // A route that DOES resolve a patient must not linger in the gap list --
    // otherwise the register overstates the problem and stops being trusted.
    assert.ok(
      typeof PHI_ROUTES[route].extractPatientId !== 'function',
      `${route} now resolves a patient; remove it from the gap register`
    );
  }
});

test('the six previously-unresolved routes now attribute a patient', () => {
  // These were registered as UNRESOLVED gaps: the patient was available and
  // simply was not extracted, so a PHI access recorded with no subject.
  const resolved = [
    'POST /api/patients',
    'POST /api/ai/generate-note',
    'POST /api/cds/evaluate',
    'GET /api/encounters/:id',
    'PATCH /api/encounters/:id',
    'GET /api/encounters/:id/orders',
  ];
  for (const route of resolved) {
    assert.ok(PHI_ROUTES[route], `${route} must still be classified`);
    assert.equal(typeof PHI_ROUTES[route].extractPatientId, 'function',
      `${route} must now resolve a patient`);
    assert.ok(!PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION[route],
      `${route} must no longer be registered as a gap`);
  }
});

test('no UNRESOLVED entries remain in the attribution gap register', () => {
  // The remaining entries are collection endpoints with no single subject.
  // An UNRESOLVED marker means the patient IS available and just is not read,
  // which is a defect rather than a limit.
  const unresolved = Object.entries(PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION)
    .filter(([, reason]) => /UNRESOLVED/i.test(reason))
    .map(([route]) => route);
  assert.deepEqual(unresolved, [],
    `these are fixable and should not sit in the register: ${unresolved.join(', ')}`);
});

test('patient attribution reads handler context first, then the body', () => {
  const extract = PHI_ROUTES['POST /api/cds/evaluate'].extractPatientId;

  // 1. handler-supplied context wins -- the only source available for a route
  //    whose path carries an encounter id, or a create whose id post-dates the insert
  assert.equal(extract({ auditPatientId: 99, body: { patient_id: 1 } }), 99);

  // 2. body patient_id
  assert.equal(extract({ body: { patient_id: 7 } }), 7);

  // 3. nested patient object
  assert.equal(extract({ body: { patient: { id: 12 } } }), 12);

  // 4. nothing to go on -> null rather than a wrong id
  assert.equal(extract({ body: {} }), null);
  assert.equal(extract({}), null);
});

test('the audit read surface is itself audited', () => {
  // Reading the audit trail discloses who accessed which patient. Exempting it
  // would leave the one surface that reveals everyone else unlogged.
  for (const route of ['GET /api/audit/logs', 'GET /api/audit/patient/:id', 'GET /api/audit/export']) {
    assert.ok(PHI_ROUTES[route], `${route} must be audited`);
    assert.equal(PHI_ROUTES[route].phi, true, `${route} must be marked PHI`);
  }
});

test('FHIR writes are classified, not just reads', () => {
  for (const route of [
    'POST /fhir/R4/Patient',
    'PUT /fhir/R4/Patient/:id',
    'POST /fhir/R4/Condition',
    'POST /fhir/R4/Observation',
    'POST /fhir/R4/Bundle',
  ]) {
    assert.ok(PHI_ROUTES[route], `${route} must be classified`);
    assert.equal(PHI_ROUTES[route].phi, true);
  }
});
