'use strict';

// Wave 1 CLINICAL — pharma-dose-units-04 + redflag-troponin-inr-thresholds-07.
//
// (1) pharma-dose-units-04: validateDose / toMg must only compare doses on
//     dimensionally-compatible units. Comparing mg to mL (or "units"), or a
//     weight-normalized mg/kg to a flat mg, must NOT produce a false pass/fail —
//     it must fail CLOSED with a "cannot validate — verify manually" notice.
//
// (2) redflag-troponin-inr-thresholds-07: troponin thresholds must be
//     UNIT-AWARE. A high-sensitivity troponin reported in ng/L must NOT
//     false-fire against the conventional ng/mL threshold, and a real
//     conventional elevation in ng/mL must still fire.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ──────────────────────────────────────────────────────────────────────────
// pharma-dose-units-04 — dosing-service compatible-unit guard
// ──────────────────────────────────────────────────────────────────────────

// Patch the DB cache layer so getDosing() resolves from the local cache path
// (the real internal code path) without hitting any external API. validateDose
// calls the module-internal getDosing, which first reads the dosing cache via
// db.dbAll, so a cached row lets us control the reference units deterministically.
const dosingDbPath = require.resolve('../../server/database');
const dosingDb = require(dosingDbPath);
const origDosingDbAll = dosingDb.dbAll; // true module original
let dosingCacheRow = null;
// NOTE: the actual db.dbAll patch is installed once, below, as a single unified
// handler shared by both this section and the red-flag section (same module).

const dosing = require('../../server/pharma/dosing-service');

function setDosingRef({ max_dose, typical_dose }) {
  dosingCacheRow = {
    drug_name: 'teststat',
    rxnorm_cui: null,
    indication: 'general',
    typical_dose: typical_dose || null,
    max_dose: max_dose || null,
    renal_adjustment: null,
    hepatic_adjustment: null,
    geriatric_notes: null,
    source: 'OpenFDA'
  };
}

describe('pharma-dose-units-04: dose comparisons are unit-compatibility guarded', () => {
  test('toMg returns null for non-mass units (mL, units) — never coerces volume to mass', () => {
    assert.equal(dosing.toMg(10, 'mg'), 10);
    assert.equal(dosing.toMg(1, 'g'), 1000);
    assert.equal(dosing.toMg(500, 'mcg'), 0.5);
    assert.equal(dosing.toMg(5, 'mL'), null, 'mL is volume, not convertible to mg');
    assert.equal(dosing.toMg(10, 'units'), null, 'activity units not convertible to mg');
  });

  test('unitsAreComparable: mass-vs-mass compatible; mass-vs-volume not', () => {
    const mg = dosing.parseDose('500 mg');
    const g = dosing.parseDose('1 g');
    const ml = dosing.parseDose('5 mL');
    const units = dosing.parseDose('10 units');

    assert.equal(dosing.unitsAreComparable(mg, g).compatible, true);
    assert.equal(dosing.unitsAreComparable(mg, ml).compatible, false);
    assert.equal(dosing.unitsAreComparable(mg, units).compatible, false);
  });

  test('unitsAreComparable: flat mg vs mg/kg is NOT comparable (different dose basis)', () => {
    const flat = dosing.parseDose('500 mg');
    const perKg = dosing.parseDose('5 mg/kg');
    assert.equal(perKg.per, 'kg');
    assert.equal(dosing.unitsAreComparable(flat, perKg).compatible, false);
  });

  test('validateDose fails CLOSED on incompatible units (prescribed mL vs max mg)', async () => {
    setDosingRef({ max_dose: '500 mg', typical_dose: '250 mg' });
    const res = await dosing.validateDose('teststat', '5 mL');
    // Must NOT claim a clean pass — comparison was indeterminate.
    assert.equal(res.isValid, false, 'incompatible units must not return a clean isValid:true');
    assert.equal(res.comparable, false);
    assert.match(res.warning, /verify manually|cannot compare/i);
  });

  test('validateDose still flags a real over-max breach on compatible units', async () => {
    setDosingRef({ max_dose: '500 mg', typical_dose: '250 mg' });
    const res = await dosing.validateDose('teststat', '2 g'); // 2000 mg > 500 mg
    assert.equal(res.isValid, false);
    assert.match(res.warning, /exceeds maximum/i);
  });

  test('validateDose passes cleanly on a compatible, in-range dose', async () => {
    setDosingRef({ max_dose: '500 mg', typical_dose: '250 mg' });
    const res = await dosing.validateDose('teststat', '250 mg');
    assert.equal(res.isValid, true);
    assert.equal(res.comparable, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// redflag-troponin-inr-thresholds-07 — unit-aware troponin handling
// ──────────────────────────────────────────────────────────────────────────
//
// Patch the database accessors BEFORE requiring the agent so no real DB is hit.
const dbPath = require.resolve('../../server/database');
const db = require(dbPath); // same module object as dosingDb above
let labRows = [];
const origDbGet = db.dbGet;
const origDbRun = db.dbRun;
// Single unified dbAll handler serving BOTH sections (same module object):
// dosing-cache reads (drug_dosing_reference) and red-flag lab_report reads.
db.dbAll = async (sql) => {
  if (/drug_dosing_reference/.test(sql)) {
    return dosingCacheRow ? [dosingCacheRow] : [];
  }
  if (/lab_report/.test(sql)) return labRows;
  return []; // no medication_list docs
};
db.dbGet = async () => null;
db.dbRun = async () => ({});

const { RedFlagAgent } = require('../../server/medivault/agents/red-flag-agent');

function labDoc(text) {
  return [{ id: 7, ocr_text: text, created_at: '2026-05-01' }];
}

describe('redflag-troponin-inr-thresholds-07: unit-aware troponin thresholds', () => {
  test('hs-troponin 50 ng/L (= 0.05 ng/mL) does NOT fire as critical-high', async () => {
    labRows = labDoc('Troponin I: 50 ng/L');
    const agent = new RedFlagAgent();
    const alerts = await agent._checkLabValues(1);
    const tropCritical = alerts.find(a => a.details && a.details.test === 'Troponin' && a.severity === 'critical');
    assert.equal(tropCritical, undefined,
      '50 ng/L is 0.05 ng/mL — below the 0.4 ng/mL conventional critical threshold; must not false-fire');
  });

  test('hs-troponin 1000 ng/L (= 1.0 ng/mL) DOES fire as critical-high', async () => {
    labRows = labDoc('Troponin: 1000 ng/L');
    const agent = new RedFlagAgent();
    const alerts = await agent._checkLabValues(1);
    const tropCritical = alerts.find(a => a.details && a.details.test === 'Troponin' && a.severity === 'critical');
    assert.ok(tropCritical, '1000 ng/L = 1.0 ng/mL exceeds the 0.4 ng/mL critical threshold');
  });

  test('conventional troponin 0.5 ng/mL still fires critical-high', async () => {
    labRows = labDoc('Troponin: 0.5 ng/mL');
    const agent = new RedFlagAgent();
    const alerts = await agent._checkLabValues(1);
    const tropCritical = alerts.find(a => a.details && a.details.test === 'Troponin' && a.severity === 'critical');
    assert.ok(tropCritical, '0.5 ng/mL exceeds the 0.4 ng/mL conventional critical threshold');
  });

  test('troponin in an unrecognized unit is NOT compared (fail closed, no false fire)', async () => {
    labRows = labDoc('Troponin: 1000 banana/L');
    const agent = new RedFlagAgent();
    const alerts = await agent._checkLabValues(1);
    const trop = alerts.find(a => a.details && a.details.test === 'Troponin');
    assert.equal(trop, undefined, 'unknown unit must not be compared against the fixed threshold');
  });

  test('a structured lab critical flag is preferred even on a sub-threshold number', async () => {
    // 0.05 ng/mL is numerically sub-threshold, but the lab marked it critical.
    labRows = labDoc('Troponin: 0.05 ng/mL (CC)');
    const agent = new RedFlagAgent();
    const alerts = await agent._checkLabValues(1);
    const trop = alerts.find(a => a.details && a.details.test === 'Troponin' && a.severity === 'critical');
    assert.ok(trop, 'a structured critical flag from the lab should escalate regardless of the raw number');
    assert.equal(trop.details.source, 'structured_flag');
  });
});

// Restore DB accessors so later concurrent suites are unaffected.
test('teardown: restore patched db accessors', () => {
  db.dbAll = origDosingDbAll; // true module original (captured before any patch)
  db.dbGet = origDbGet;
  db.dbRun = origDbRun;
  assert.ok(true);
});
