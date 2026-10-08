'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stateRoutePath = path.resolve(__dirname, '../../src/utils/stateRoute.js');
const reviewPath = path.resolve(__dirname, '../../src/pages/ReviewPage.jsx');
const checkoutPath = path.resolve(__dirname, '../../src/pages/CheckOutPage.jsx');
const schedulePath = path.resolve(__dirname, '../../src/pages/SchedulePage.jsx');
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
  });

  test('sign action hands off to checkout instead of bypassing it', () => {
    const src = read(reviewPath);
    assert.match(src, /navigate\('\/checkout\/' \+ encounterId\)/);
    assert.ok(!src.includes("navigate('/visit/' + encounterId)"), 'ReviewPage must not bypass checkout');
    assert.match(src, /'orders-pending': \['documentation', 'signed'\]/);
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
