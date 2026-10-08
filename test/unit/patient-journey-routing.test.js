'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stateRoutePath = path.resolve(__dirname, '../../src/utils/stateRoute.js');
const reviewPath = path.resolve(__dirname, '../../src/pages/ReviewPage.jsx');
const checkoutPath = path.resolve(__dirname, '../../src/pages/CheckOutPage.jsx');
const schedulePath = path.resolve(__dirname, '../../src/pages/SchedulePage.jsx');
const serverPath = path.resolve(__dirname, '../../server/server.js');
const databasePath = path.resolve(__dirname, '../../server/database.js');
const billingPath = path.resolve(__dirname, '../../server/billing-engine.js');
const workflowPath = path.resolve(__dirname, '../../server/workflow-engine.js');
const visitPath = path.resolve(__dirname, '../../src/pages/VisitSummaryPage.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('patient journey routing: entry through terminal checkout', () => {
  test('schedule recognizes checked-in appointments and can reopen their encounter', () => {
    const src = read(schedulePath);
    assert.match(src, /'checked-in':\s*\{\s*label:\s*'Checked In'/);
    assert.match(src, /appt\.status === 'checked-in' && appt\.encounter_id/);
  });

  test('vitals-recorded resumes in provider encounter workspace', () => {
    assert.match(read(stateRoutePath), /'vitals-recorded':\s*'\/encounter\/'/);
  });

  test('signed encounters continue to checkout, checked-out encounters become read-only visits', () => {
    const src = read(stateRoutePath);
    assert.match(src, /'signed':\s*'\/checkout\/'/);
    assert.match(src, /'checked-out':\s*'\/visit\/'/);
    assert.match(src, /'completed':\s*'\/visit\/'/);
  });

  test('sign action is server-atomic and hands off to checkout', () => {
    const reviewSrc = read(reviewPath);
    const serverSrc = read(serverPath);
    assert.match(reviewSrc, /api\.signEncounter\(encounterId, encounter\.patient_id\)/);
    assert.match(reviewSrc, /navigate\('\/checkout\/' \+ encounterId\)/);
    assert.ok(!reviewSrc.includes("navigate('/visit/' + encounterId)"), 'ReviewPage must not bypass checkout');
    assert.match(serverSrc, /app\.post\('\/api\/encounters\/:id\/sign'/);
    assert.match(serverSrc, /BEGIN IMMEDIATE TRANSACTION/);
  });

  test('encounter persistence includes check-in edits and signature provenance', () => {
    const dbSrc = read(databasePath);
    const serverSrc = read(serverPath);
    assert.match(dbSrc, /chief_complaint=COALESCE/);
    assert.match(dbSrc, /encounter_type=COALESCE/);
    assert.match(dbSrc, /signed_by=COALESCE/);
    assert.match(dbSrc, /signed_at=COALESCE/);
    assert.match(serverSrc, /updates\.encounter_type/);
  });

  test('workflow timestamps are not silently dropped by the database allowlist', () => {
    const dbSrc = read(databasePath);
    for (const field of ['check_in_time', 'roomed_time', 'vitals_time', 'provider_start_time', 'signed_time', 'checkout_time']) {
      assert.ok(dbSrc.includes(`'${field}'`), `workflow allowlist must include ${field}`);
    }
  });

  test('checkout requires signed state and completes linked appointment atomically', () => {
    const src = read(billingPath);
    assert.match(src, /wf\.current_state !== 'signed'/);
    assert.match(src, /workflow\.transitionState\(encounterId, 'checked-out'\)/);
    assert.match(src, /UPDATE appointments[\s\S]*status = 'completed'/);
    assert.match(src, /ROLLBACK/);
  });

  test('physician assistants are recognized as providers in workflow authorization', () => {
    assert.match(read(workflowPath), /'physician_assistant'/);
  });

  test('MA decision close-out can hand orders-pending back to documentation', () => {
    const src = read(workflowPath);
    assert.match(src, /isMaCloseoutHandoff/);
    assert.match(src, /wf\.current_state === 'orders-pending'/);
    assert.match(src, /targetState === 'documentation'/);
  });

  test('signing cannot bypass a decided item awaiting MA close-out', () => {
    const src = read(serverPath);
    assert.match(src, /decisionItem\.status === 'decided'/);
    assert.match(src, /decisionItem\.ma_status === 'awaiting'/);
    assert.match(src, /Cannot sign while a provider decision is awaiting MA close-out/);
  });

  test('appointment check-in status is committed with the workflow transition', () => {
    const serverSrc = read(serverPath);
    const scheduleSrc = read(schedulePath);
    assert.match(serverSrc, /target_state === 'checked-in'[\s\S]*BEGIN IMMEDIATE TRANSACTION/);
    assert.match(serverSrc, /UPDATE appointments[\s\S]*status = 'checked-in'/);
    assert.match(scheduleSrc, /if \(appt\.encounter_id\)[\s\S]*navigate\('\/checkin\/' \+ appt\.encounter_id\)/);
    assert.ok(!/updateAppointment\(appt\.id, \{ status: 'checked-in'/.test(scheduleSrc));
  });

  test('front desk can complete checkout but cannot edit a draft charge', () => {
    const src = read(serverPath);
    assert.match(src, /app\.get\('\/api\/encounters\/:id\/charge',[^\n]*'front_desk'/);
    assert.match(src, /app\.post\('\/api\/encounters\/:id\/checkout',[^\n]*'front_desk'/);
    assert.doesNotMatch(src, /app\.post\('\/api\/encounters\/:id\/charge',[^\n]*'front_desk'/);
    assert.match(src, /Front-desk checkout may not override the E\/M code/);
  });

  test('MA orders-pending resume opens the close-out worklist', () => {
    const src = read(stateRoutePath);
    assert.match(src, /state === 'orders-pending'[\s\S]*\['ma', 'medical_assistant'\]\.includes\(userRole\)[\s\S]*return '\/decisions'/);
  });

  test('sign route is explicitly classified as durable SIGN audit activity', () => {
    const auditSrc = read(path.resolve(__dirname, '../../server/audit-logger.js'));
    assert.match(auditSrc, /'POST \/api\/encounters\/:id\/sign':[\s\S]*action: 'SIGN'/);
    assert.match(auditSrc, /DURABLE_AUDIT_ACTIONS = new Set\(\['EXPORT', 'SIGN', 'PRESCRIBE'\]\)/);
  });

  test('checkout success exposes the completed visit summary', () => {
    const src = read(checkoutPath);
    assert.match(src, /View Completed Visit/);
    assert.match(src, /navigate\('\/visit\/' \+ encounterId\)/);
  });

  test('completed visit keeps patient context and terminal status visible', () => {
    const src = read(visitPath);
    assert.match(src, /<PatientBanner patient=\{patient\} \/>/);
    assert.match(src, /isCompleted \? 'Completed' : 'Signed'/);
  });
});
