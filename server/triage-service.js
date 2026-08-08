/**
 * MJR-EHR Triage + Decision Service
 *
 * Two-tier clinical AI surface that powers the provider Decision Queue:
 *
 *   1. TRIAGE (top tier) — sorts an incoming patient to the appropriate level
 *      of care using the Emergency Severity Index (ESI), a 5-level acuity
 *      algorithm maintained by the Agency for Healthcare Research and Quality
 *      (AHRQ; ESI Implementation Handbook v4). ESI 1 is most acute (immediate
 *      life threat), ESI 5 is least acute (self-care). Mapped here to a
 *      level_of_care recommendation (Emergent / Urgent same-day / Routine /
 *      Self-care).
 *
 *   2. PATIENT SUMMARY (mid tier) — a single, plain-language paragraph the
 *      provider reads at a glance. In api mode this is the cost-efficient
 *      haiku model (the ai-client.callClaude default); in mock mode it is a
 *      deterministic synthesis of the patient's actual synthetic record.
 *
 *   3. DECISION TREE (top tier) — at least four one-click clinically-plausible
 *      actions plus an always-available fifth "dictate a custom decision"
 *      affordance (the fifth is rendered client-side, not generated here).
 *
 * Model tiers follow the ai-client.js pattern:
 *   - mid tier  = MODEL_MID  = 'claude-haiku-4-5-20251001' (callClaude default)
 *   - top tier  = MODEL_TOP  = 'claude-sonnet-4-6'
 *
 * In mock mode (AI_MODE unset/'mock', the demo default with no API key) BOTH
 * tiers are deterministic and DERIVED FROM THE PATIENT'S ACTUAL SYNTHETIC
 * RECORD (vitals, chief_complaint, problems, age) — so the demo works fully
 * offline with no API key. When AI_MODE=api the same functions route through
 * ai-client.callClaude with the appropriate model and fall back to mock on any
 * error.
 *
 * SYNTHETIC DATA ONLY. This is a clinical demo; no real PHI is ever processed.
 */

'use strict';

const aiClient = require('./ai-client');

// Model-tier labels surfaced in the response payload so the demo visibly shows
// which tier produced what. Mid tier = cost-efficient haiku; top tier = sonnet.
const MODEL_MID = 'claude-haiku-4-5-20251001';
const MODEL_TOP = 'claude-sonnet-4-6';

// High-risk chief-complaint keyword groups. Presence escalates ESI acuity per
// AHRQ ESI v4 high-risk-presentation guidance (chest pain, dyspnea, stroke/FAST,
// sepsis-spectrum presentations are treated as high-risk regardless of vitals).
const HIGH_RISK_KEYWORDS = [
  { group: 'chest pain', patterns: [/chest\s*pain/i, /chest\s*pressure/i, /chest\s*tightness/i, /substernal/i] },
  { group: 'shortness of breath', patterns: [/shortness\s*of\s*breath/i, /\bSOB\b/i, /dyspnea/i, /difficulty\s*breathing/i, /can'?t\s*breathe/i] },
  { group: 'stroke', patterns: [/stroke/i, /\bFAST\b/i, /facial\s*droop/i, /slurred\s*speech/i, /one[\s-]*sided\s*weakness/i, /sudden\s*weakness/i] },
  { group: 'sepsis', patterns: [/sepsis/i, /septic/i, /\bfever\b.*\b(rigors|confusion)\b/i, /altered\s*mental/i] },
  { group: 'severe bleeding', patterns: [/hemorrhage/i, /uncontrolled\s*bleeding/i, /vomiting\s*blood/i, /hematemesis/i] },
];

function calculateAge(dob) {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

/**
 * Identify abnormal and critical vitals against standard adult thresholds.
 * Critical thresholds map to ESI 1 (immediate life threat) per AHRQ ESI v4
 * danger-zone vital-sign criteria.
 */
function assessVitals(vitals = {}) {
  const abnormal = [];
  const critical = [];
  const v = vitals || {};

  const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

  const spo2 = num(v.spo2);
  if (spo2 !== null) {
    if (spo2 < 90) critical.push(`SpO2 ${spo2}% (critical hypoxemia)`);
    else if (spo2 < 95) abnormal.push(`SpO2 ${spo2}%`);
  }

  const sbp = num(v.systolic_bp);
  if (sbp !== null) {
    if (sbp < 90 || sbp > 220) critical.push(`SBP ${sbp} mmHg`);
    else if (sbp >= 140) abnormal.push(`SBP ${sbp} mmHg`);
  }

  const hr = num(v.heart_rate);
  if (hr !== null) {
    if (hr > 130 || hr < 40) critical.push(`HR ${hr} bpm`);
    else if (hr > 100 || hr < 50) abnormal.push(`HR ${hr} bpm`);
  }

  const rr = num(v.respiratory_rate);
  if (rr !== null) {
    if (rr > 30) critical.push(`RR ${rr}/min`);
    else if (rr > 20 || rr < 10) abnormal.push(`RR ${rr}/min`);
  }

  // Temperature thresholds in FAHRENHEIT (this app stores °F throughout — see
  // MAPage VITAL_RANGES and the CDS `fever` rule). The AHRQ ESI danger-zone
  // "Temp > 40" is stated in Celsius; 40 °C == 104 °F is the critical fever
  // threshold here, and 100.4 °F (38 °C) is the abnormal-fever threshold.
  const temp = num(v.temperature);
  if (temp !== null) {
    if (temp > 104) critical.push(`Temp ${temp}°F`);
    else if (temp > 100.4) abnormal.push(`Temp ${temp}°F`);
  }

  return { abnormal, critical };
}

function matchHighRiskComplaint(chiefComplaint = '') {
  const cc = String(chiefComplaint || '');
  const hits = [];
  for (const { group, patterns } of HIGH_RISK_KEYWORDS) {
    if (patterns.some((p) => p.test(cc))) hits.push(group);
  }
  return hits;
}

/**
 * EMERGENCY BYPASS — ESI 1 and ESI 2 are emergent and must NOT wait in line for
 * the routine 4-option deliberative decision tree. Per AHRQ ESI v4: ESI 1 =
 * patient requires IMMEDIATE life-saving intervention; ESI 2 = high-risk
 * situation, the patient cannot safely wait (confused/lethargic/disoriented,
 * severe pain/distress, or a danger-zone vital). Both route straight to
 * emergency handling (call 911 / send to ED now), not to a multi-option
 * deliberation. (AHRQ ESI Implementation Handbook v4, levels 1-2.)
 */
const EMERGENCY_ESI_THRESHOLD = 2; // esi_level <= 2 is an emergency bypass

// One-click emergency action keys. The decide endpoint recognizes these as an
// emergency escalation (vs. a routine disposition) and flags the MA close-out
// as an EMERGENCY rather than a routine task.
const EMERGENCY_911_KEY = 'emergency_911';
const EMERGENCY_ED_TRANSFER_KEY = 'emergency_ed_transfer';
const EMERGENCY_DECISION_KEYS = [EMERGENCY_911_KEY, EMERGENCY_ED_TRANSFER_KEY];

/**
 * True when the patient is an emergency-bypass case (ESI 1-2). An emergency is
 * not a deliberation: the routine 4-option tree is suppressed for these.
 */
function isEmergency(esiLevel) {
  return esiLevel != null && Number(esiLevel) <= EMERGENCY_ESI_THRESHOLD;
}

/**
 * Build the SUPPRESSED-tree emergency decision set for an ESI 1-2 patient: a
 * single headline "Call 911 / Send to ED now" one-click action, plus an
 * optional secondary "Direct ED transfer / rapid response". No routine
 * deliberative options are offered — an emergency is not a deliberation.
 * Each option keeps the { key, label, detail, action } shape; `action` is
 * 'admit' (the highest-acuity downstream order category).
 */
function emergencyDecisionOptions(record = {}, triage = {}) {
  const cc = (record.chief_complaint || '').trim();
  const ccLabel = cc || 'this presentation';
  const esi = triage.esi_level;
  const loc = triage.level_of_care || 'Emergent';
  return [
    {
      key: EMERGENCY_911_KEY,
      label: 'Call 911 / Send to ED now',
      detail: `EMERGENT (ESI ${esi ?? '1-2'} · ${loc}): activate 911 / emergency response for ${ccLabel} immediately. Do not wait for routine workup — initiate life-saving measures and continuous monitoring now.`,
      action: 'admit',
    },
    {
      key: EMERGENCY_ED_TRANSFER_KEY,
      label: 'Direct ED transfer / rapid response',
      detail: `Arrange immediate direct transfer to the Emergency Department (or activate in-facility rapid response) for ${ccLabel}; document time of activation and hand off to the receiving team.`,
      action: 'admit',
    },
  ];
}

function esiToLevelOfCare(esi) {
  switch (esi) {
    case 1:
    case 2:
      return 'Emergent';
    case 3:
      return 'Urgent (same-day)';
    case 4:
      return 'Routine';
    case 5:
    default:
      return 'Self-care';
  }
}

/**
 * Deterministic ESI triage derived from the patient's actual record.
 * Returns { esi_level, level_of_care, rationale }.
 *
 * Algorithm (AHRQ ESI v4, simplified for the demo):
 *  - ESI 1 if any critical/danger-zone vital is present.
 *  - High-risk chief complaint or 2+ abnormal vitals -> ESI 2.
 *  - One high-risk complaint with stable vitals, or 1 abnormal vital plus
 *    a relevant chronic problem, or advanced age (>= 75) -> ESI 3.
 *  - Otherwise routine -> ESI 4, or self-care -> ESI 5 when nothing abnormal.
 */
function mockTriage(record) {
  const vitals = record.vitals || {};
  const chiefComplaint = record.chief_complaint || '';
  const problems = Array.isArray(record.problems) ? record.problems : [];
  const age = record.age != null ? record.age : calculateAge(record.dob);

  const { abnormal, critical } = assessVitals(vitals);
  const highRisk = matchHighRiskComplaint(chiefComplaint);
  const reasons = [];

  let esi;
  if (critical.length > 0) {
    esi = 1;
    reasons.push(`Critical vital sign(s): ${critical.join(', ')} — immediate life threat (ESI 1).`);
  } else if (highRisk.length > 0 || abnormal.length >= 2) {
    esi = 2;
    if (highRisk.length > 0) reasons.push(`High-risk presentation: ${highRisk.join(', ')}.`);
    if (abnormal.length >= 2) reasons.push(`Multiple abnormal vitals: ${abnormal.join(', ')}.`);
  } else if (abnormal.length === 1 || (age != null && age >= 75) || (abnormal.length >= 1 && problems.length > 0)) {
    esi = 3;
    if (abnormal.length === 1) reasons.push(`Abnormal vital: ${abnormal[0]}.`);
    if (age != null && age >= 75) reasons.push(`Advanced age (${age}y) raises baseline risk.`);
    if (problems.length > 0) reasons.push(`Active chronic problem(s) increase complexity (${problems.length} on the list).`);
  } else if (problems.length > 0 || chiefComplaint.trim().length > 0) {
    esi = 4;
    reasons.push('Stable vitals with a focused complaint or chronic-disease follow-up.');
  } else {
    esi = 5;
    reasons.push('No abnormal vitals and no acute complaint documented.');
  }

  const levelOfCare = esiToLevelOfCare(esi);
  reasons.push(`Routed to ${levelOfCare} care.`);

  return {
    esi_level: esi,
    level_of_care: levelOfCare,
    rationale: `[ESI ${esi} — AHRQ Emergency Severity Index, 5-level acuity] ${reasons.join(' ')}`,
  };
}

/**
 * Deterministic one-paragraph patient summary derived from the actual record.
 * Mid-tier (haiku) equivalent — plain-language, single paragraph.
 */
function mockSummary(record) {
  const name = [record.first_name, record.last_name].filter(Boolean).join(' ') || 'The patient';
  const age = record.age != null ? record.age : calculateAge(record.dob);
  const sexWord = record.sex === 'M' ? 'male' : record.sex === 'F' ? 'female' : 'patient';
  const ageSex = age != null ? `${age}-year-old ${sexWord}` : sexWord;

  const problems = (Array.isArray(record.problems) ? record.problems : [])
    .map((p) => p.problem_name || p.name)
    .filter(Boolean);
  const cc = (record.chief_complaint || '').trim();

  const { abnormal, critical } = assessVitals(record.vitals || {});
  const vitalFlags = [...critical, ...abnormal];

  const parts = [];
  parts.push(`${name} is a ${ageSex}${cc ? ` presenting with ${cc.toLowerCase()}` : ' here for evaluation'}.`);
  if (problems.length > 0) {
    parts.push(`Active history includes ${problems.slice(0, 4).join(', ')}${problems.length > 4 ? ', among others' : ''}.`);
  } else {
    parts.push('No chronic problems are documented on the active list.');
  }
  if (vitalFlags.length > 0) {
    parts.push(`Today's vitals are notable for ${vitalFlags.join(', ')}, which warrant attention.`);
  } else if (record.vitals && Object.keys(record.vitals).length > 0) {
    parts.push('Vitals recorded today are within normal limits.');
  } else {
    parts.push('No vitals have been recorded for this visit yet.');
  }
  parts.push('A disposition decision is requested.');

  return parts.join(' ');
}

/**
 * Build at least four contextual, clinically-plausible one-click decision
 * options derived from the patient's actual complaint and problems, plus
 * triage context. Each option: { key, label, detail, action }.
 *
 * `action` is the downstream order category the chosen option represents
 * (medication | lab_order | imaging_order | referral | follow_up | admit),
 * routed to the medical-assistant queue to close out.
 */
function mockDecisionOptions(record, triage) {
  // EMERGENCY BYPASS: ESI 1-2 patients do NOT get the routine deliberative
  // tree. They get the single 911/ED escalation set — an emergency is not a
  // deliberation (AHRQ ESI v4, levels 1-2). This SUPPRESSES the 4-option tree.
  if (isEmergency(triage.esi_level)) {
    return emergencyDecisionOptions(record, triage);
  }

  const cc = (record.chief_complaint || '').trim();
  const problems = (Array.isArray(record.problems) ? record.problems : [])
    .map((p) => p.problem_name || p.name)
    .filter(Boolean);
  const primaryProblem = problems[0] || (cc || 'the presenting concern');
  const ccLabel = cc || primaryProblem;
  const highRisk = matchHighRiskComplaint(cc);
  const options = [];

  // High-acuity-but-not-emergency (ESI 3 with a high-risk complaint flag) still
  // gets the urgent escalation-leaning set below. ESI 1-2 already returned the
  // emergency-bypass set above.
  if (highRisk.length > 0) {
    options.push({
      key: 'escalate_emergent',
      label: `Escalate ${ccLabel} to emergent evaluation`,
      detail: `Initiate emergent workup for ${ccLabel} (continuous monitoring, IV access, stat labs) and arrange immediate higher-level-of-care transfer.`,
      action: 'admit',
    });
    options.push({
      key: 'stat_diagnostics',
      label: `Order stat diagnostics for ${ccLabel}`,
      detail: highRisk.includes('chest pain')
        ? 'Stat 12-lead EKG, troponin, and portable chest X-ray; recheck vitals in 15 minutes.'
        : highRisk.includes('shortness of breath')
          ? 'Stat chest X-ray, BNP, and ABG; apply supplemental O2 to keep SpO2 ≥ 92%.'
          : `Stat labs and imaging targeted to ${ccLabel}; recheck vitals in 15 minutes.`,
      action: 'lab_order',
    });
    options.push({
      key: 'specialist_now',
      label: 'Activate specialist / rapid-response consult',
      detail: `Page the appropriate specialty service for ${ccLabel} and document time of activation.`,
      action: 'referral',
    });
    options.push({
      key: 'reassess_15',
      label: 'Stabilize and reassess in 15 minutes',
      detail: 'Begin supportive measures, place on continuous monitoring, and re-triage after the next vital-sign set.',
      action: 'follow_up',
    });
    return options;
  }

  // Urgent / routine decision set, derived from the complaint + problem list.
  options.push({
    key: 'treat_and_educate',
    label: `Start/adjust treatment for ${primaryProblem} with patient education`,
    detail: `Initiate or titrate first-line therapy for ${primaryProblem}, counsel on adherence and warning signs, and document teach-back.`,
    action: 'medication',
  });
  options.push({
    key: 'order_workup',
    label: `Order targeted workup for ${ccLabel}`,
    detail: `Order labs/imaging appropriate to ${ccLabel}${problems.length > 1 ? ` in the context of ${problems.slice(1, 3).join(' and ')}` : ''}, with results-based recheck.`,
    action: 'lab_order',
  });
  options.push({
    key: 'refer_specialist',
    label: `Refer to specialty care for ${primaryProblem}`,
    detail: `Place a routine referral for ${primaryProblem} for co-management; send records and document the reason.`,
    action: 'referral',
  });
  options.push({
    key: 'schedule_followup',
    label: 'Schedule follow-up and monitor',
    detail: `Arrange a follow-up visit to reassess ${ccLabel}, continue current management, and return sooner for worsening symptoms.`,
    action: 'follow_up',
  });
  return options;
}

// ==========================================
// PUBLIC API — tiered, api-mode aware
// ==========================================

/**
 * Triage a patient to a level of care (TOP tier).
 * @returns {Promise<{esi_level:number, level_of_care:string, rationale:string, model:string}>}
 */
async function triagePatient(record) {
  const mock = mockTriage(record);

  if (!aiClient.isClaudeEnabled()) {
    return { ...mock, model: MODEL_TOP, mode: 'mock' };
  }

  try {
    const system = `You are a triage clinician applying the Emergency Severity Index (ESI), the AHRQ 5-level acuity scale (1 = immediate life threat, 5 = self-care). Return ONLY JSON: {"esi_level": number 1-5, "level_of_care": string, "rationale": string}. Map ESI 1-2 -> "Emergent", 3 -> "Urgent (same-day)", 4 -> "Routine", 5 -> "Self-care".`;
    const user = `Patient record (synthetic):\n${JSON.stringify({
      age: record.age != null ? record.age : calculateAge(record.dob),
      sex: record.sex,
      chief_complaint: record.chief_complaint,
      vitals: record.vitals,
      problems: (record.problems || []).map((p) => p.problem_name || p.name),
    }, null, 2)}`;
    const raw = await aiClient.callClaude(system, user, MODEL_TOP);
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const esi = Math.min(5, Math.max(1, parseInt(parsed.esi_level, 10) || mock.esi_level));
    return {
      esi_level: esi,
      level_of_care: parsed.level_of_care || esiToLevelOfCare(esi),
      rationale: parsed.rationale || mock.rationale,
      model: MODEL_TOP,
      mode: 'api',
    };
  } catch (err) {
    console.error('[TRIAGE] Claude triage failed, using deterministic ESI:', err.message);
    return { ...mock, model: MODEL_TOP, mode: 'mock-fallback' };
  }
}

/**
 * One-paragraph patient summary (MID tier — cost-efficient haiku).
 * @returns {Promise<{summary:string, model:string}>}
 */
async function summarizePatient(record) {
  const mock = mockSummary(record);

  if (!aiClient.isClaudeEnabled()) {
    return { summary: mock, model: MODEL_MID, mode: 'mock' };
  }

  try {
    const system = 'You are a clinical scribe. Write ONE concise plain-language paragraph (3-5 sentences) summarizing this patient for a provider deciding on disposition. No headers, no lists, no markdown. Only describe what is in the record.';
    const user = `Patient record (synthetic):\n${JSON.stringify({
      name: [record.first_name, record.last_name].filter(Boolean).join(' '),
      age: record.age != null ? record.age : calculateAge(record.dob),
      sex: record.sex,
      chief_complaint: record.chief_complaint,
      vitals: record.vitals,
      problems: (record.problems || []).map((p) => p.problem_name || p.name),
    }, null, 2)}`;
    // Mid tier: the callClaude default model is haiku, so omit the model arg.
    const raw = await aiClient.callClaude(system, user);
    const text = String(raw || '').trim();
    return { summary: text || mock, model: MODEL_MID, mode: 'api' };
  } catch (err) {
    console.error('[TRIAGE] Claude summary failed, using deterministic summary:', err.message);
    return { summary: mock, model: MODEL_MID, mode: 'mock-fallback' };
  }
}

/**
 * Top-tier decision tree: >= 4 one-click options derived from the record.
 * @returns {Promise<{options:Array, model:string}>}
 */
async function buildDecisionOptions(record, triage) {
  // EMERGENCY BYPASS: never ask the model to "deliberate" on an ESI 1-2 patient.
  // Return the deterministic 911/ED escalation set directly and SUPPRESS the
  // routine 4-option tree, in both mock and api modes.
  if (isEmergency(triage.esi_level)) {
    return { options: emergencyDecisionOptions(record, triage), model: MODEL_TOP, mode: 'emergency-bypass' };
  }

  const mock = mockDecisionOptions(record, triage);

  if (!aiClient.isClaudeEnabled()) {
    return { options: mock, model: MODEL_TOP, mode: 'mock' };
  }

  try {
    const system = `You are a senior clinician proposing a decision tree for a provider. Return ONLY a JSON array of AT LEAST 4 objects: [{"key": string, "label": string, "detail": string, "action": one of "medication"|"lab_order"|"imaging_order"|"referral"|"follow_up"|"admit"}]. Each option must be a distinct, clinically-plausible disposition specific to this patient's complaint and problems.`;
    const user = `Patient (synthetic):\n${JSON.stringify({
      chief_complaint: record.chief_complaint,
      problems: (record.problems || []).map((p) => p.problem_name || p.name),
      triage,
    }, null, 2)}`;
    const raw = await aiClient.callClaude(system, user, MODEL_TOP);
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 4) {
      const options = parsed.map((o, i) => ({
        key: String(o.key || `option_${i + 1}`),
        label: String(o.label || `Option ${i + 1}`),
        detail: String(o.detail || ''),
        action: ['medication', 'lab_order', 'imaging_order', 'referral', 'follow_up', 'admit'].includes(o.action) ? o.action : 'follow_up',
      }));
      return { options, model: MODEL_TOP, mode: 'api' };
    }
    return { options: mock, model: MODEL_TOP, mode: 'mock-fallback' };
  } catch (err) {
    console.error('[TRIAGE] Claude decision tree failed, using deterministic options:', err.message);
    return { options: mock, model: MODEL_TOP, mode: 'mock-fallback' };
  }
}

module.exports = {
  MODEL_MID,
  MODEL_TOP,
  // emergency-bypass constants
  EMERGENCY_ESI_THRESHOLD,
  EMERGENCY_911_KEY,
  EMERGENCY_ED_TRANSFER_KEY,
  EMERGENCY_DECISION_KEYS,
  // pure helpers (testable)
  assessVitals,
  matchHighRiskComplaint,
  esiToLevelOfCare,
  calculateAge,
  isEmergency,
  emergencyDecisionOptions,
  mockTriage,
  mockSummary,
  mockDecisionOptions,
  // tiered async API
  triagePatient,
  summarizePatient,
  buildDecisionOptions,
};
