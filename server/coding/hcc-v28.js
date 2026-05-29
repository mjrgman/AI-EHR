'use strict';

/**
 * HCC V28 lookup + reporting module.
 *
 * CY 2026 is the final year of CMS's V24→V28 phase-in (100% V28).
 * Replaces the legacy V24 hardcoded map in coding-agent.js.
 *
 * Three responsibilities:
 *   1. lookupHCC(icd10)            — exact + prefix match against V28
 *   2. checkMEAT(icd10, text)      — Monitored / Evaluated / Assessed / Treated test
 *   3. buildHCCReport(icd10s, text) — full per-encounter HCC capture report
 *
 * Data source: server/seed/hcc_v28_seed.json (curated primary-care subset).
 * Full CMS-mapping CSV ingestion belongs in scripts/build-hcc-v28-seed.js when
 * the curated subset is expanded.
 *
 * Caching: the seed is loaded into module scope on first call. The DB-backed
 * lookup path (when scripts/build-hcc-v28-seed.js populates the table) takes
 * precedence; falls back to the JSON seed if the DB has no rows yet.
 */

const path = require('path');
const fs = require('fs');

// Module-scoped cache. Reset by clearCache() (used in tests).
let cachedSeed = null;
let cachedExactMap = null;
let cachedPrefixMap = null;

const SEED_PATH = path.join(__dirname, '..', 'seed', 'hcc_v28_seed.json');

// ==========================================
// SEED LOADING
// ==========================================

function loadSeed() {
  if (cachedSeed) return cachedSeed;
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  cachedSeed = parsed;
  cachedExactMap = new Map();
  cachedPrefixMap = new Map();
  for (const row of parsed.rows || []) {
    cachedExactMap.set(row.icd10_code, row);
    if (!cachedPrefixMap.has(row.icd10_prefix)) {
      cachedPrefixMap.set(row.icd10_prefix, row);
    }
  }
  return parsed;
}

function clearCache() {
  cachedSeed = null;
  cachedExactMap = null;
  cachedPrefixMap = null;
}

// ==========================================
// LOOKUP
// ==========================================

/**
 * Resolve an ICD-10 code to its V28 HCC mapping.
 *
 * Lookup order:
 *   1. Exact match on icd10_code
 *   2. Prefix match on icd10_prefix (e.g., "E11.65" falls back to "E11")
 *   3. Returns null if no match
 *
 * Return shape (when matched):
 *   {
 *     icd10_code: 'E11.65',
 *     hcc_v28_number: 36,
 *     hcc_v28_label: 'Diabetes with...',
 *     is_payment_hcc: true,
 *     match_type: 'exact' | 'prefix',
 *     notes: '...'
 *   }
 *
 * @param {string} icd10
 * @returns {object|null}
 */
function lookupHCC(icd10) {
  if (!icd10 || typeof icd10 !== 'string') return null;
  loadSeed();

  const normalized = icd10.trim().toUpperCase();

  // 1. Exact match
  if (cachedExactMap.has(normalized)) {
    const row = cachedExactMap.get(normalized);
    return {
      icd10_code: row.icd10_code,
      hcc_v28_number: row.hcc_v28_number,
      hcc_v28_label: row.hcc_v28_label,
      is_payment_hcc: row.is_payment_hcc === 1,
      match_type: 'exact',
      notes: row.notes || null
    };
  }

  // 2. Prefix match — find the longest prefix that's in the map
  // (This isn't strictly "longest prefix" since seed prefixes are 3-char,
  //  but if "E11" is in the map and code is "E11.65", we match.)
  //
  // PREFIX OVERMAP GUARD (hcc-prefix-overmap-08): a prefix match copies the
  // is_payment_hcc flag from whatever seed row happened to register the prefix
  // first — payment eligibility decided by non-deterministic insert order, in
  // both directions (false-positive AND false-negative). Payment HCC capture
  // drives risk-adjustment revenue and RADV exposure, so a prefix-only match is
  // NEVER payment-eligible on its own. We surface the HCC *number/label* as a
  // clinical hint (the prefix family is informative) but mark the result
  // TENTATIVE with is_payment_hcc:null — fail closed: only an exact/validated
  // seed row is payment-eligible. Downstream payment gates (e.g.
  // coding-agent._flagHCCCodes) check `is_payment_hcc` truthiness and therefore
  // correctly exclude prefix-only matches.
  const prefix = normalized.split('.')[0];
  if (cachedPrefixMap.has(prefix)) {
    const row = cachedPrefixMap.get(prefix);
    return {
      icd10_code: normalized,
      hcc_v28_number: row.hcc_v28_number,
      hcc_v28_label: row.hcc_v28_label,
      // Prefix-only matches are TENTATIVE: not payment-eligible until an exact
      // code mapping confirms payment status. null = "undetermined", distinct
      // from false ("confirmed non-payment") on an exact row.
      is_payment_hcc: null,
      tentative: true,
      match_type: 'prefix',
      prefix_matched: row.icd10_prefix,
      notes: `Matched on prefix ${row.icd10_prefix} (TENTATIVE — not payment-eligible without an exact-code mapping); use a more specific code mapped exactly to confirm HCC payment status.`
    };
  }

  return null;
}

// ==========================================
// MEAT DOCUMENTATION CHECK
// ==========================================

// Keyword indicators for each MEAT element.
// Conservative — high-precision matches; some clinical synonyms intentionally omitted to reduce false positives.
const MEAT_PATTERNS = {
  Monitored: /\b(monitor(?:ing|ed)?|track(?:ing|ed)?|observ(?:ing|ed)?|surveill?ance|follow(?:ing|ed)?[ -]?up|check(?:ing|ed)?\s+\w+\s+level)\b/i,
  Evaluated: /\b(evaluat(?:ing|ed|ion)?|review(?:ing|ed)?|examin(?:ing|ed|ation)|assess(?:ing|ed)?\s+(?:via|with|using|status)|test(?:ed|ing)?\s+result|labs?\s+(?:show|reveal|indicate))\b/i,
  Assessed: /\b(assess(?:ing|ed|ment)?|impressi(?:on|ons)?|status:?\s+(?:stable|controlled|uncontrolled|worsening|improving)|exacerbat(?:ed|ion)|stable|controlled|uncontrolled)\b/i,
  // Treated: prescribing, dose changes, continuation, or referrals.
  // Pattern allows 0-2 words between "adjust/increase/start" and the noun
  // ("dose"/"medication") so phrases like "adjusted insulin dose" match.
  // Bare "continue/continued <drug>" also matches — physicians write "continue lisinopril"
  // far more often than "continue on lisinopril".
  Treated: /\b(treat(?:ed|ing|ment)?|prescrib(?:ed|ing)|medicat(?:ed|ion)|(?:adjust|increas|titrat|reduc|decreas)(?:ed|ing)?(?:\s+\w+){0,2}\s+(?:dose|medication|insulin|therapy)|start(?:ed|ing)\s+\w+|continu(?:ed|ing|e)\s+\w+|discontinu(?:ed|ing)|refer(?:red|ral))\b/i
};

// ------------------------------------------------------------------
// DIAGNOSIS-PROXIMITY SCOPING (meat-keyword-overcapture-09)
// ------------------------------------------------------------------
//
// The original checkMEAT scanned the WHOLE note for each MEAT keyword and
// ignored the ICD-10 entirely. A payment HCC could therefore be marked
// MEAT-satisfied by text describing a *different* problem (e.g. the note says
// "stable" about the patient's mood, miles away from the diabetes line).
// That weakens RADV defensibility — the documentation must support THE coded
// diagnosis, not merely contain a MEAT-flavored word somewhere.
//
// Fix: when the note actually mentions the coded condition, restrict MEAT
// matching to text within a proximity window of a condition mention. If the
// note contains NO recognizable mention of the condition, there is no "dx" to
// be far from, so we fall back to the whole-note scan (unchanged behavior) —
// this is the only safe default and keeps the regex-level edge cases intact.

const PROXIMITY_WINDOW = 160; // chars on each side of a condition mention

// ICD-family → condition synonyms used to locate the diagnosis in free text.
// Keyed by the 3-char ICD prefix. Lay/clinical synonyms included because notes
// rarely repeat the formal HCC label verbatim ("blood pressure" not
// "essential hypertension"). Conservative, high-precision terms only.
const CONDITION_SYNONYMS = {
  E11: ['diabet', 'dm2', 't2dm', 'a1c', 'hba1c', 'glucose', 'glycemic', 'insulin', 'metformin'],
  E10: ['diabet', 'dm1', 't1dm', 'a1c', 'hba1c', 'glucose', 'insulin'],
  I10: ['hypertens', 'blood pressure', 'bp ', 'htn', 'lisinopril', 'amlodipine'],
  I50: ['heart failure', 'chf', 'hfref', 'hfpef', 'cardiomyopathy', 'ejection fraction'],
  J44: ['copd', 'emphysema', 'chronic bronchitis', 'bronchodilator', 'inhaler'],
  J45: ['asthma', 'wheez', 'inhaler', 'albuterol'],
  N18: ['ckd', 'kidney disease', 'renal', 'gfr', 'egfr', 'nephropathy'],
  F32: ['depress', 'phq', 'mood'],
  F33: ['depress', 'phq', 'mood']
};

/**
 * Build the list of lowercase search terms that indicate the coded condition
 * is being discussed in the note. Combines: (a) the literal ICD code and its
 * 3-char prefix, (b) per-family synonyms, (c) salient words pulled from the
 * HCC label (stop-words and generic clinical filler removed).
 */
function conditionTermsFor(icd10) {
  const terms = new Set();
  if (typeof icd10 === 'string' && icd10.trim()) {
    const norm = icd10.trim().toUpperCase();
    terms.add(norm.toLowerCase());
    const prefix = norm.split('.')[0];
    terms.add(prefix.toLowerCase());
    for (const syn of CONDITION_SYNONYMS[prefix] || []) terms.add(syn);
  }
  const mapping = lookupHCC(icd10);
  if (mapping && mapping.hcc_v28_label) {
    const STOP = new Set([
      'with', 'and', 'or', 'the', 'not', 'a', 'an', 'of', 'unspecified',
      'other', 'long', 'term', 'complications', 'disease', 'disorder',
      'chronic', 'acute', 'payment', 'hcc', 'removed', 'essential', 'status'
    ]);
    for (const w of mapping.hcc_v28_label.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !STOP.has(w)) terms.add(w);
    }
  }
  return [...terms].filter(Boolean);
}

/**
 * Returns the diagnosis-proximate slices of the note: for every condition-term
 * occurrence, the +/- PROXIMITY_WINDOW chars around it. Returns null when the
 * note does not mention the condition at all (caller falls back to whole note).
 */
function proximitySegments(text, terms) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const term of terms) {
    let from = 0;
    let idx;
    while ((idx = lower.indexOf(term, from)) !== -1) {
      ranges.push([Math.max(0, idx - PROXIMITY_WINDOW), Math.min(text.length, idx + term.length + PROXIMITY_WINDOW)]);
      from = idx + term.length;
    }
  }
  if (ranges.length === 0) return null;
  // Merge overlapping ranges, then join with a separator so a pattern can't
  // match across two non-adjacent windows.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i]);
  }
  return merged.map(([s, e]) => text.slice(s, e)).join('\n…\n');
}

/**
 * MEAT check: confirms the encounter documentation supports HCC capture
 * for a given ICD-10 code.
 *
 * MEAT matching is scoped to text PROXIMATE to a mention of the coded condition
 * (meat-keyword-overcapture-09). A keyword far from any diagnosis mention is no
 * longer captured. When the note never mentions the condition, the whole note
 * is scanned (there is no diagnosis context to scope to).
 *
 * @param {string} icd10 - the code being captured
 * @param {string} encounterText - the full encounter note / transcript
 * @returns {{satisfied: boolean, elements: object, missing: string[], evidence: object, scope: string}}
 */
function checkMEAT(icd10, encounterText) {
  if (!encounterText || typeof encounterText !== 'string') {
    return {
      satisfied: false,
      elements: { Monitored: false, Evaluated: false, Assessed: false, Treated: false },
      missing: ['Monitored', 'Evaluated', 'Assessed', 'Treated'],
      evidence: {},
      scope: 'none'
    };
  }

  // Scope to diagnosis-proximate text when the condition is mentioned.
  const terms = conditionTermsFor(icd10);
  const segments = proximitySegments(encounterText, terms);
  const searchText = segments !== null ? segments : encounterText;
  const scope = segments !== null ? 'diagnosis-proximate' : 'whole-note';

  const elements = {};
  const evidence = {};
  const missing = [];

  for (const [name, pattern] of Object.entries(MEAT_PATTERNS)) {
    const match = searchText.match(pattern);
    if (match) {
      elements[name] = true;
      evidence[name] = match[0];
    } else {
      elements[name] = false;
      missing.push(name);
    }
  }

  // CMS RADV standard: at least ONE MEAT element documented for HCC capture.
  // (Some payers prefer ≥2; we surface the count so the caller can decide.)
  const satisfiedCount = Object.values(elements).filter(Boolean).length;
  const satisfied = satisfiedCount >= 1;

  return { icd10, satisfied, satisfiedCount, elements, missing, evidence, scope };
}

// ==========================================
// HCC REPORT
// ==========================================

/**
 * Build a per-encounter HCC capture report.
 *
 * @param {string[]} icd10Codes - ICD-10 codes attached to the encounter
 * @param {string} encounterText - full encounter documentation
 * @returns {{
 *   payment_hccs: Array,       // codes that map to payment HCCs
 *   non_payment_hccs: Array,   // codes mapped but not payment-relevant under V28
 *   unmapped: Array,           // codes with no V28 mapping in our seed
 *   meat_failures: Array,      // payment HCC codes lacking MEAT evidence
 *   summary: object
 * }}
 */
function buildHCCReport(icd10Codes, encounterText = '') {
  const payment_hccs = [];
  const non_payment_hccs = [];
  const unmapped = [];
  const meat_failures = [];

  const codes = Array.isArray(icd10Codes) ? icd10Codes : [];

  for (const code of codes) {
    if (!code) continue;
    const mapping = lookupHCC(code);
    if (!mapping) {
      unmapped.push(code);
      continue;
    }
    const meat = checkMEAT(code, encounterText);

    const entry = { ...mapping, meat };

    if (mapping.is_payment_hcc) {
      payment_hccs.push(entry);
      if (!meat.satisfied) {
        meat_failures.push({
          icd10_code: code,
          hcc_v28_number: mapping.hcc_v28_number,
          hcc_v28_label: mapping.hcc_v28_label,
          missing: meat.missing,
          recommendation: 'HCC at risk of denial — document at least one MEAT element (Monitored / Evaluated / Assessed / Treated) for this code.'
        });
      }
    } else {
      non_payment_hccs.push(entry);
    }
  }

  return {
    payment_hccs,
    non_payment_hccs,
    unmapped,
    meat_failures,
    summary: {
      total_codes_evaluated: codes.length,
      payment_hcc_count: payment_hccs.length,
      non_payment_hcc_count: non_payment_hccs.length,
      unmapped_count: unmapped.length,
      meat_failure_count: meat_failures.length,
      capture_quality: payment_hccs.length === 0
        ? 'no_payment_hccs'
        : meat_failures.length === 0
          ? 'all_supported'
          : `${meat_failures.length}_at_risk`
    }
  };
}

module.exports = {
  lookupHCC,
  checkMEAT,
  buildHCCReport,
  loadSeed,
  clearCache
};
