'use strict';

// Unit tests for server/triage-service.js — the two-tier clinical AI surface
// behind the provider Decision Queue.
//
// These exercise the DETERMINISTIC mock-mode behavior (AI_MODE unset/'mock',
// the demo default with no API key): triage MUST apply the AHRQ Emergency
// Severity Index (ESI, 5-level acuity) to the patient's actual synthetic
// record, the mid-tier summary MUST be a single paragraph derived from that
// record, and the decision tree MUST contain at least four distinct,
// contextual, one-click options. SYNTHETIC DATA ONLY.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Force mock mode before requiring the service (ai-client reads env at load).
delete process.env.ANTHROPIC_API_KEY;
process.env.AI_MODE = 'mock';

const triage = require('../../server/triage-service');

// ----------------------------------------------------------------------------
// Synthetic records spanning the acuity spectrum.
// ----------------------------------------------------------------------------
const CRITICAL = {
  first_name: 'Critical', last_name: 'Case', sex: 'M', age: 60,
  chief_complaint: 'Severe shortness of breath',
  vitals: { spo2: 84, systolic_bp: 88, heart_rate: 134, respiratory_rate: 34, temperature: 99.1 },
  problems: [{ problem_name: 'COPD', status: 'chronic' }],
};
const HIGH_RISK = {
  first_name: 'Robert', last_name: 'Chen', sex: 'M', age: 70,
  chief_complaint: 'Chest pain radiating to the left arm',
  vitals: { spo2: 96, systolic_bp: 150, heart_rate: 98, respiratory_rate: 18, temperature: 98.6 },
  problems: [{ problem_name: 'Coronary Artery Disease', status: 'chronic' }],
};
const URGENT = {
  first_name: 'Sarah', last_name: 'Mitchell', sex: 'F', age: 62,
  chief_complaint: 'Blood sugars running high, increased thirst',
  vitals: { spo2: 98, systolic_bp: 142, heart_rate: 88, respiratory_rate: 16, temperature: 98.6 },
  problems: [{ problem_name: 'Type 2 Diabetes Mellitus', status: 'chronic' }, { problem_name: 'Hypertension', status: 'chronic' }],
};
const ROUTINE = {
  first_name: 'Wellness', last_name: 'Visit', sex: 'F', age: 35,
  chief_complaint: 'Annual physical, no complaints',
  vitals: { spo2: 99, systolic_bp: 118, heart_rate: 70, respiratory_rate: 14, temperature: 98.4 },
  problems: [],
};

describe('triage-service: ESI acuity (AHRQ Emergency Severity Index)', () => {
  test('critical vital signs => ESI 1 (Emergent)', () => {
    const t = triage.mockTriage(CRITICAL);
    assert.equal(t.esi_level, 1);
    assert.equal(t.level_of_care, 'Emergent');
    assert.match(t.rationale, /ESI 1/);
    assert.match(t.rationale, /AHRQ Emergency Severity Index/);
  });

  test('high-risk chief complaint with stable vitals => ESI 2 (Emergent)', () => {
    const t = triage.mockTriage(HIGH_RISK);
    assert.equal(t.esi_level, 2);
    assert.equal(t.level_of_care, 'Emergent');
    assert.match(t.rationale, /chest pain/i);
  });

  test('single abnormal vital + chronic disease => ESI 3 (Urgent same-day)', () => {
    const t = triage.mockTriage(URGENT);
    assert.equal(t.esi_level, 3);
    assert.equal(t.level_of_care, 'Urgent (same-day)');
  });

  test('stable wellness visit => ESI 4 (Routine)', () => {
    const t = triage.mockTriage(ROUTINE);
    assert.equal(t.esi_level, 4);
    assert.equal(t.level_of_care, 'Routine');
  });

  test('empty record (no vitals/complaint/problems) => ESI 5 (Self-care)', () => {
    const t = triage.mockTriage({ vitals: {}, problems: [], chief_complaint: '' });
    assert.equal(t.esi_level, 5);
    assert.equal(t.level_of_care, 'Self-care');
  });

  test('triage is deterministic (same input => same output)', () => {
    const a = triage.mockTriage(HIGH_RISK);
    const b = triage.mockTriage(HIGH_RISK);
    assert.deepEqual(a, b);
  });
});

describe('triage-service: assessVitals thresholds', () => {
  test('flags critical SpO2 < 90 and SBP > 220', () => {
    const r = triage.assessVitals({ spo2: 85, systolic_bp: 230 });
    assert.equal(r.critical.length, 2);
  });
  test('flags abnormal-but-not-critical SpO2 92', () => {
    const r = triage.assessVitals({ spo2: 92 });
    assert.equal(r.abnormal.length, 1);
    assert.equal(r.critical.length, 0);
  });
  test('normal vitals produce no flags', () => {
    const r = triage.assessVitals({ spo2: 99, systolic_bp: 118, heart_rate: 70, respiratory_rate: 14, temperature: 98.4 });
    assert.equal(r.abnormal.length, 0);
    assert.equal(r.critical.length, 0);
  });
});

describe('triage-service: mid-tier patient summary', () => {
  test('is a single paragraph derived from the record', () => {
    const s = triage.mockSummary(URGENT);
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 40);
    assert.ok(!s.includes('\n'), 'summary must be a single paragraph (no newlines)');
    // References the actual record content.
    assert.match(s, /Sarah Mitchell/);
    assert.match(s, /62-year-old female/);
    assert.match(s, /Type 2 Diabetes Mellitus/);
  });

  test('reports abnormal vitals when present', () => {
    const s = triage.mockSummary(CRITICAL);
    assert.match(s, /SpO2 84%/);
  });

  test('handles no-vitals gracefully', () => {
    const s = triage.mockSummary({ first_name: 'No', last_name: 'Vitals', sex: 'F', age: 40, chief_complaint: 'fatigue', problems: [], vitals: {} });
    assert.match(s, /No vitals/i);
  });
});

describe('triage-service: top-tier decision tree', () => {
  test('returns at least four distinct contextual options', () => {
    const t = triage.mockTriage(URGENT);
    const opts = triage.mockDecisionOptions(URGENT, t);
    assert.ok(opts.length >= 4, 'at least four options');
    const keys = new Set(opts.map(o => o.key));
    assert.equal(keys.size, opts.length, 'option keys are distinct');
    for (const o of opts) {
      assert.ok(o.key && o.label && o.detail && o.action, 'each option has key/label/detail/action');
      assert.ok(['medication', 'lab_order', 'imaging_order', 'referral', 'follow_up', 'admit'].includes(o.action));
    }
  });

  test('options are derived from the patient complaint/problems (specific, not generic)', () => {
    const t = triage.mockTriage(URGENT);
    const opts = triage.mockDecisionOptions(URGENT, t);
    const blob = opts.map(o => `${o.label} ${o.detail}`).join(' ');
    assert.match(blob, /Type 2 Diabetes Mellitus|blood sugars/i);
  });

  test('emergent presentation (ESI 1-2) yields the emergency-bypass 911 set, suppressing the routine tree', () => {
    // EMERGENCY BYPASS (added 2026-06-10): ESI 1-2 patients are emergent and do
    // NOT receive the routine deliberative tree. The decision set is the single
    // headline 911 action plus an ED-transfer fallback — an emergency is not a
    // deliberation (AHRQ ESI v4, levels 1-2). This replaces the prior
    // escalate_emergent/stat_diagnostics expectation for ESI 2 inputs.
    const t = triage.mockTriage(HIGH_RISK);
    assert.equal(t.esi_level, 2);
    const opts = triage.mockDecisionOptions(HIGH_RISK, t);
    const keys = opts.map(o => o.key);
    assert.ok(keys.includes(triage.EMERGENCY_911_KEY), 'emergency cases expose the one-click 911 action');
    // The routine 4-option deliberative keys are SUPPRESSED for emergencies.
    assert.ok(!keys.includes('escalate_emergent'));
    assert.ok(!keys.includes('stat_diagnostics'));
    assert.ok(!keys.includes('treat_and_educate'));
  });
});

describe('triage-service: async tiered API (mock mode)', () => {
  test('triagePatient labels the TOP-tier model and runs offline', async () => {
    const r = await triage.triagePatient(URGENT);
    assert.equal(r.model, triage.MODEL_TOP);
    assert.equal(r.mode, 'mock');
    assert.equal(r.esi_level, 3);
  });

  test('summarizePatient labels the MID-tier model and runs offline', async () => {
    const r = await triage.summarizePatient(URGENT);
    assert.equal(r.model, triage.MODEL_MID);
    assert.equal(r.mode, 'mock');
    assert.ok(r.summary.length > 0);
  });

  test('buildDecisionOptions labels the TOP-tier model and returns >= 4 options', async () => {
    const t = await triage.triagePatient(URGENT);
    const r = await triage.buildDecisionOptions(URGENT, t);
    assert.equal(r.model, triage.MODEL_TOP);
    assert.ok(r.options.length >= 4);
  });

  test('MID and TOP tiers are distinct models (haiku vs sonnet)', () => {
    assert.notEqual(triage.MODEL_MID, triage.MODEL_TOP);
    assert.match(triage.MODEL_MID, /haiku/);
    assert.match(triage.MODEL_TOP, /sonnet/);
  });
});
