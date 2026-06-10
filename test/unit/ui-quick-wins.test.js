'use strict';

// Unit tests for the UI QUICK-WINS group (findings ui-badge-danger-01,
// ui-icon-entity-01, ui-schedule-sort-mutate-01, ui-audit-noshape-01 /
// ULTRAPLAN Wave 4d).
//
// All four targets are JSX/ESM (React) source files that cannot be require()'d
// in a node:test CommonJS runner (no JSX transform). Following the established
// pattern in dashboard-queue-config.test.js, these are deliberate source-level
// assertions: they parse the relevant region out of the source text and fail
// loudly if the fix regresses. Browser/Playwright render verification is the
// companion check for the two visible items (icon + badge color).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const badgePath = path.resolve(__dirname, '../../src/components/common/Badge.jsx');
const touchButtonPath = path.resolve(__dirname, '../../src/components/common/TouchButton.jsx');
const maPath = path.resolve(__dirname, '../../src/pages/MAPage.jsx');
const schedulePath = path.resolve(__dirname, '../../src/pages/SchedulePage.jsx');
const auditPath = path.resolve(__dirname, '../../src/pages/AuditPage.jsx');
const clientPath = path.resolve(__dirname, '../../src/api/client.js');
const appShellPath = path.resolve(__dirname, '../../src/components/layout/AppShell.jsx');
const dashboardPath = path.resolve(__dirname, '../../src/pages/DashboardPage.jsx');
const encounterPath = path.resolve(__dirname, '../../src/pages/EncounterPage.jsx');
const loginPath = path.resolve(__dirname, '../../src/pages/LoginPage.jsx');
const portalPath = path.resolve(__dirname, '../../src/pages/PatientPortal.jsx');

// Extract a `const NAME = { ... };` object literal's key -> value (string) map.
function extractVariantMap(source, constName) {
  const start = source.indexOf(`const ${constName}`);
  assert.ok(start !== -1, `expected const ${constName}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  assert.ok(open !== -1 && close !== -1, `${constName} object literal not found`);
  const body = source.slice(open + 1, close);
  const map = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

describe('ui-badge-danger-01: Badge has a danger variant aligned with the palette', () => {
  const badgeSrc = fs.readFileSync(badgePath, 'utf8');
  const touchSrc = fs.readFileSync(touchButtonPath, 'utf8');
  const badgeVariants = extractVariantMap(badgeSrc, 'VARIANTS');
  const touchVariants = extractVariantMap(touchSrc, 'VARIANTS');

  test('Badge.VARIANTS defines a danger variant', () => {
    assert.ok('danger' in badgeVariants, 'Badge must define a "danger" variant');
  });

  test('danger variant is red (No-Show state renders red, not uncolored)', () => {
    assert.match(badgeVariants.danger, /bg-red-/, 'danger must use a red background');
    assert.match(badgeVariants.danger, /text-red-/, 'danger must use red text');
  });

  test('TouchButton also defines danger as red (shared palette intent)', () => {
    assert.ok('danger' in touchVariants);
    assert.match(touchVariants.danger, /red/);
  });

  test('SchedulePage no-show status maps to the danger variant', () => {
    const schedSrc = fs.readFileSync(schedulePath, 'utf8');
    // STATUS_LABELS line for 'no-show'
    assert.match(
      schedSrc,
      /'no-show':\s*\{\s*label:\s*'No-Show',\s*variant:\s*'danger'\s*\}/,
      'no-show must use variant: danger, which must now resolve to a styled pill'
    );
  });
});

describe('ui-icon-entity-01: MAPage uses literal Unicode glyphs, not entity strings', () => {
  const maSrc = fs.readFileSync(maPath, 'utf8');

  test('no raw HTML-entity string literal remains for the mic/stop icon', () => {
    assert.ok(!maSrc.includes('&#x1F3A4;'), 'raw mic entity string must be gone');
    assert.ok(!maSrc.includes('&#x23F9;'), 'raw stop entity string must be gone');
  });

  test('literal mic + stop glyphs are present', () => {
    assert.ok(maSrc.includes('🎤'), 'literal microphone glyph expected');
    assert.ok(maSrc.includes('⏹'), 'literal stop glyph expected');
  });
});

describe('ui-schedule-sort-mutate-01: SchedulePage copies before sort', () => {
  const schedSrc = fs.readFileSync(schedulePath, 'utf8');

  test('appointments are spread-copied before .sort() in render', () => {
    assert.match(
      schedSrc,
      /\[\.\.\.appointments\]\s*\.sort\(/,
      'must use [...appointments].sort() to avoid mutating state in render'
    );
  });

  test('the mutating appointments.sort() pattern is gone', () => {
    assert.ok(
      !/\bappointments\s*\n?\s*\.sort\(/.test(schedSrc),
      'direct appointments.sort() (state mutation) must not remain'
    );
  });
});

describe('ui-audit-noshape-01: AuditPage tolerates a malformed/empty response', () => {
  const auditSrc = fs.readFileSync(auditPath, 'utf8');

  test('logs setter guards against a non-array shape', () => {
    assert.match(
      auditSrc,
      /setLogs\(Array\.isArray\(logsResult\?\.logs\)\s*\?\s*logsResult\.logs\s*:\s*\[\]\)/,
      'setLogs must default to [] when logs is missing/not an array'
    );
  });

  test('totalPages / total fall back to safe numbers', () => {
    assert.match(auditSrc, /setTotalPages\(Number\(logsResult\?\.totalPages\)\s*\|\|\s*1\)/);
    assert.match(auditSrc, /setTotal\(Number\(logsResult\?\.total\)\s*\|\|\s*0\)/);
  });

  test('header total.toLocaleString() is guarded against non-numbers', () => {
    assert.match(
      auditSrc,
      /\(Number\(total\)\s*\|\|\s*0\)\.toLocaleString\(\)/,
      'header must coerce total to a number before .toLocaleString()'
    );
  });

  test('unguarded total.toLocaleString() in the header is gone', () => {
    assert.ok(
      !auditSrc.includes('{total.toLocaleString()} entries'),
      'the raw total.toLocaleString() header must be replaced with a guarded form'
    );
  });
});

describe('audit authorization UX: forbidden audit access does not destroy the session', () => {
  const auditSrc = fs.readFileSync(auditPath, 'utf8');
  const appShellSrc = fs.readFileSync(appShellPath, 'utf8');
  const clientSrc = fs.readFileSync(clientPath, 'utf8');
  const loginSrc = fs.readFileSync(loginPath, 'utf8');

  test('client treats 401 and 403 differently', () => {
    assert.ok(
      !clientSrc.includes('res.status === 401 || res.status === 403'),
      '403 must not flow through the session-clearing unauthorized handler'
    );
    assert.match(clientSrc, /if \(res\.status === 401\)/);
    assert.match(clientSrc, /if \(res\.status === 403\)/);
    assert.match(clientSrc, /error\.status = res\.status/);
  });

  test('Audit Log nav item is admin-only', () => {
    assert.match(appShellSrc, /\{ path: '\/audit', label: 'Audit Log', roles: \['admin'\] \}/);
    assert.match(appShellSrc, /visibleNavItems = NAV_ITEMS\.filter/);
    assert.match(appShellSrc, /visibleNavItems\.map/);
    assert.match(appShellSrc, /const defaultNavPath = visibleNavItems\[0\]\?\.path \|\| '\/'/);
    assert.match(appShellSrc, /navigate\(defaultNavPath\)/);
  });

  test('direct forbidden AuditPage route renders access denied instead of an empty table', () => {
    assert.match(auditSrc, /const \[accessDenied, setAccessDenied\] = useState\(false\)/);
    assert.match(auditSrc, /err\?\.status === 403/);
    assert.match(auditSrc, /Audit access denied/);
    assert.match(auditSrc, /Back to Dashboard/);
  });

  test('admin users land on audit instead of the PHI dashboard', () => {
    assert.match(loginSrc, /function getPostLoginDestination/);
    assert.match(loginSrc, /user\?\.role === 'admin' && requested === '\/' \? '\/audit' : requested/);
    assert.match(loginSrc, /navigate\(getPostLoginDestination\(authenticatedUser, location\.state\?\.from\)/);
  });
});

describe('portal hardening contract: MRN and CSRF are wired in the SPA', () => {
  const clientSrc = fs.readFileSync(clientPath, 'utf8');
  const portalSrc = fs.readFileSync(portalPath, 'utf8');

  test('portal client stores csrfToken returned by /verify', () => {
    assert.match(clientSrc, /PORTAL_CSRF_STORAGE_KEY/);
    assert.match(clientSrc, /path === '\/verify' && payload\?\.csrfToken/);
    assert.match(clientSrc, /setPortalCsrfToken\(payload\.csrfToken\)/);
  });

  test('state-changing portal requests attach x-portal-csrf', () => {
    assert.match(clientSrc, /'x-portal-csrf': portalCsrfToken/);
    assert.match(clientSrc, /isStateChangingPortalRequest\(method\)/);
  });

  test('portal verify form requires MRN and no longer labels it optional', () => {
    assert.ok(!portalSrc.includes('MRN (optional)'));
    assert.match(portalSrc, /\['mrn', 'MRN', 'text'\]/);
    assert.match(portalSrc, /mrn: form\.mrn/);
  });
});

describe('visible workflow contracts match backend route contracts', () => {
  const dashboardSrc = fs.readFileSync(dashboardPath, 'utf8');
  const scheduleSrc = fs.readFileSync(schedulePath, 'utf8');
  const maSrc = fs.readFileSync(maPath, 'utf8');
  const encounterSrc = fs.readFileSync(encounterPath, 'utf8');

  test('new patient sex select sends backend enum values, not display labels', () => {
    assert.match(dashboardSrc, /value: 'M', label: 'Male'/);
    assert.match(dashboardSrc, /value: 'F', label: 'Female'/);
    assert.ok(!dashboardSrc.includes("options: ['Male', 'Female', 'Other']"));
  });

  test('schedule creation uses appointment_type with backend enum values', () => {
    assert.match(scheduleSrc, /appointment_type: 'follow_up'/);
    assert.match(scheduleSrc, /value: 'new_patient', label: 'New Patient'/);
    assert.match(scheduleSrc, /value: 'sick_visit', label: 'Sick Visit'/);
    assert.ok(!scheduleSrc.includes("visit_type: 'office-visit'"));
  });

  test('MA handoff guards against empty vitals and incomplete reviews', () => {
    assert.match(maSrc, /const hasVitals = VITAL_FIELDS\.some/);
    assert.match(maSrc, /Enter at least one vital/);
    assert.match(maSrc, /Confirm each active medication/);
    assert.match(maSrc, /Review allergies before sending/);
  });

  test('encounter Review & Sign gate requires SOAP note like ReviewPage signing gate', () => {
    assert.match(encounterSrc, /const canReviewSign = soapNote\.trim\(\)\.length > 0/);
    assert.ok(!encounterSrc.includes('soapNote || totalOrders > 0'));
  });
});
