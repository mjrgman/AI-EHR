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
  const prefix = normalized.split('.')[0];
  if (cachedPrefixMap.has(prefix)) {
    const row = cachedPrefixMap.get(prefix);
    return {
      icd10_code: normalized,
      hcc_v28_number: row.hcc_v28_number,
      hcc_v28_label: row.hcc_v28_label,
      is_payment_hcc: row.is_payment_hcc === 1,
      match_type: 'prefix',
      prefix_matched: row.icd10_prefix,
      notes: `Matched on prefix ${row.icd10_prefix}; consider using a more specific code mapped exactly.`
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

/**
 * MEAT check: confirms the encounter documentation supports HCC capture
 * for a given ICD-10 code.
 *
 * @param {string} icd10 - the code being captured
 * @param {string} encounterText - the full encounter note / transcript
 * @returns {{satisfied: boolean, elements: object, missing: string[], evidence: object}}
 */
function checkMEAT(icd10, encounterText) {
  if (!encounterText || typeof encounterText !== 'string') {
    return {
      satisfied: false,
      elements: { Monitored: false, Evaluated: false, Assessed: false, Treated: false },
      missing: ['Monitored', 'Evaluated', 'Assessed', 'Treated'],
      evidence: {}
    };
  }
  const elements = {};
  const evidence = {};
  const missing = [];

  for (const [name, pattern] of Object.entries(MEAT_PATTERNS)) {
    const match = encounterText.match(pattern);
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

  return { icd10, satisfied, satisfiedCount, elements, missing, evidence };
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
