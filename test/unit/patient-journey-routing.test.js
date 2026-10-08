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
    assert.match(reviewSrc, /api\.signEncounter\(encounterId\)/);
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
