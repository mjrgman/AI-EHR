'use strict';

/**
 * RxNorm Service — NLM RxNorm REST API Integration
 *
 * Provides canonical drug identification (RxCUI), brand/generic mapping,
 * limited curated interaction findings, and form/strength lookups using the free
 * NLM RxNorm API (https://rxnav.nlm.nih.gov/REST/).
 *
 * All lookups are cached in SQLite with a configurable TTL (default 30 days).
 * Falls back gracefully when the API is unreachable.
 */

const https = require('https');
const db = require('../database');
const curatedDdi = require('./curated-ddi');

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';
const CACHE_TTL_DAYS = 30;
const REQUEST_TIMEOUT_MS = 5000;

// Legacy RXNORM_INTERACTION_ENABLED is intentionally ignored. The retired
// interaction endpoint and its unversioned cache cannot provide a valid screen.

// Master switch for ALL outbound RxNav traffic, not just /interaction.
// Default OFF: this is a local synthetic demo and must not reach the public
// internet unless someone deliberately turns it on.
const RXNORM_LIVE_ENABLED = process.env.RXNORM_LIVE_ENABLED === 'true';

// ──────────────────────────────────────────
// HTTP CLIENT
// ──────────────────────────────────────────

/**
 * Make a GET request to the RxNorm API.
 * Returns parsed JSON or null on failure.
 */
function rxnormGet(path) {
  // SYNTHETIC-ONLY BASELINE: no outbound request unless explicitly enabled.
  //
  // Only the /interaction endpoint was gated. The name-lookup, approximate-term
  // and dosage-form calls went to rxnav.nlm.nih.gov unconditionally, so a demo
  // that documents itself as "offline by construction" reached the public
  // internet the moment anyone looked up a drug. No PHI is sent -- the query is
  // a drug name -- but an unannounced outbound call is exactly the kind of
  // thing this baseline exists to prevent, and the README claim was false while
  // it existed.
  //
  // Every caller already tolerates a null return and falls back to the local
  // curated data (see curated-ddi.js), so refusing here degrades cleanly rather
  // than failing. Set RXNORM_LIVE_ENABLED=true to restore live lookups.
  // Flagged by CodeQL as js/file-access-to-http.
  if (!RXNORM_LIVE_ENABLED) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const url = `${RXNORM_BASE}${path}`;
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          console.warn(`[RxNorm] Invalid JSON from ${path}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`[RxNorm] API request failed: ${err.message}`);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[RxNorm] Request timed out: ${path}`);
      resolve(null);
    });
  });
}

// ──────────────────────────────────────────
// CACHE LAYER
// ──────────────────────────────────────────

async function getCached(queryKey) {
  try {
    const row = await db.dbGet(
      `SELECT response_json, cached_at FROM rxnorm_cache
       WHERE query_key = ? AND cached_at > datetime('now', ?)`,
      [queryKey, `-${CACHE_TTL_DAYS} days`]
    );
    if (row) return JSON.parse(row.response_json);
  } catch {
    // Cache miss or table doesn't exist yet — proceed to API
  }
  return null;
}

async function setCache(queryKey, data) {
  try {
    await db.dbRun(
      `INSERT OR REPLACE INTO rxnorm_cache (query_key, response_json, cached_at)
       VALUES (?, ?, datetime('now'))`,
      [queryKey, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn(`[RxNorm] Cache write failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────
// CORE LOOKUPS
// ──────────────────────────────────────────

/**
 * Look up a drug by name and return its RxCUI (canonical identifier).
 * Tries approximate match if exact match fails.
 *
 * @param {string} drugName - Drug name (brand or generic)
 * @returns {Promise<{rxcui: string, name: string}|null>}
 */
async function lookupByName(drugName) {
  if (!drugName || typeof drugName !== 'string') return null;
  const key = `name:${drugName.toLowerCase().trim()}`;

  const cached = await getCached(key);
  if (cached) return cached;

  // Try exact match first
  const exact = await rxnormGet(`/rxcui.json?name=${encodeURIComponent(drugName)}&search=1`);
  if (exact && exact.idGroup && exact.idGroup.rxnormId && exact.idGroup.rxnormId.length > 0) {
    const result = { rxcui: exact.idGroup.rxnormId[0], name: exact.idGroup.name || drugName };
    await setCache(key, result);
    return result;
  }

  // Try approximate match
  const approx = await rxnormGet(`/approximateTerm.json?term=${encodeURIComponent(drugName)}&maxEntries=1`);
  if (approx && approx.approximateGroup && approx.approximateGroup.candidate) {
    const candidates = approx.approximateGroup.candidate;
    if (candidates.length > 0) {
      const best = candidates[0];
      const result = { rxcui: best.rxcui, name: best.name || drugName, score: best.score };
      await setCache(key, result);
      return result;
    }
  }

  return null;
}

/**
 * Get all available forms and strengths for an RxCUI.
 *
 * @param {string} rxcui - RxNorm Concept Unique Identifier
 * @returns {Promise<Array<{rxcui: string, name: string, tty: string}>>}
 */
async function getAllForms(rxcui) {
  if (!rxcui) return [];
  const key = `forms:${rxcui}`;

  const cached = await getCached(key);
  if (cached) return cached;

  const data = await rxnormGet(`/rxcui/${rxcui}/allrelated.json`);
  if (!data || !data.allRelatedGroup || !data.allRelatedGroup.conceptGroup) return [];

  const forms = [];
  for (const group of data.allRelatedGroup.conceptGroup) {
    if (group.conceptProperties) {
      for (const prop of group.conceptProperties) {
        forms.push({
          rxcui: prop.rxcui,
          name: prop.name,
          tty: prop.tty // Term type: SCD, SBD, GPCK, BPCK, etc.
        });
      }
    }
  }

  await setCache(key, forms);
  return forms;
}

/**
 * Get brand/generic mapping for a drug.
 *
 * @param {string} rxcui - RxNorm Concept Unique Identifier
 * @returns {Promise<{brands: string[], generics: string[]}>}
 */
async function getBrandGenericMapping(rxcui) {
  if (!rxcui) return { brands: [], generics: [] };
  const key = `brandgeneric:${rxcui}`;

  const cached = await getCached(key);
  if (cached) return cached;

  const data = await rxnormGet(`/rxcui/${rxcui}/allrelated.json`);
  if (!data || !data.allRelatedGroup || !data.allRelatedGroup.conceptGroup) {
    return { brands: [], generics: [] };
  }

  const brands = [];
  const generics = [];

  for (const group of data.allRelatedGroup.conceptGroup) {
    if (!group.conceptProperties) continue;
    for (const prop of group.conceptProperties) {
      // SBD = Semantic Branded Drug, BN = Brand Name
      if (prop.tty === 'SBD' || prop.tty === 'BN') {
        brands.push(prop.name);
      }
      // SCD = Semantic Clinical Drug, IN = Ingredient
      if (prop.tty === 'SCD' || prop.tty === 'IN') {
        generics.push(prop.name);
      }
    }
  }

  const result = { brands, generics };
  await setCache(key, result);
  return result;
}

/**
 * Sentinel describing the state of an interaction screening attempt.
 *
 * IMPORTANT (fail-closed contract): drug-drug interaction screening MUST
 * distinguish three states, never collapsing them:
 *   - SCREENED_CLEAN  : the source was reachable and returned zero interactions.
 *   - INTERACTIONS     : the source returned one or more interaction pairs.
 *   - UNAVAILABLE      : the source was unreachable / errored. This is NOT
 *                        "no interactions" — callers must surface it as a
 *                        WARNING ("interaction check unavailable — verify
 *                        manually"), never as a clean result.
 *
 * The NLM RxNav `/interaction` endpoints were RETIRED in January 2024, so in
 * the current build screening is effectively always UNAVAILABLE. Replacing the
 * data source (curated table or licensed DB) is a deferred decision pending
 * Michael — see ULTRAPLAN P0-4. Until then we fail CLOSED.
 */
const SCREENING_UNAVAILABLE = 'unavailable';

/**
 * Build the explicit "screening unavailable" sentinel interaction.
 * Returned (as a single-element array) whenever the upstream source cannot be
 * reached, so a downstream `for..of` consumer surfaces a warning rather than
 * silently treating an empty list as "safe / no interactions."
 *
 * @param {string} [reason] - Human-readable reason for unavailability.
 * @returns {{status: string, severity: string, description: string, source: string, unavailable: true}}
 */
function buildUnavailableInteraction(reason) {
  return {
    status: SCREENING_UNAVAILABLE,
    unavailable: true,
    severity: 'unknown',
    description:
      'Drug interaction check unavailable — automated screening source could not be reached. '
      + 'Verify interactions manually.'
      + (reason ? ` (${reason})` : ''),
    source: 'screening-unavailable'
  };
}

/**
 * True when an interactions array contains an unavailable marker.
 * False does not establish completed screening: curated findings have limited
 * coverage, and an empty supplied history has no pairwise comparisons.
 *
 * @param {Array} interactions
 * @returns {boolean}
 */
function isScreeningUnavailable(interactions) {
  return Array.isArray(interactions)
    && interactions.some(i => i && i.status === SCREENING_UNAVAILABLE);
}

/**
 * Return limited curated findings, or an explicit unavailable marker.
 * The retired interaction endpoint and legacy interaction cache are quarantined
 * regardless of environment flags. A curated miss is never a negative screen.
 */
async function getInteractions(rxcui1, rxcui2, name1, name2) {
  if (typeof name1 === 'string' && name1.trim()
      && typeof name2 === 'string' && name2.trim()) {
    const curated = curatedDdi.lookupCuratedInteraction(name1, name2);
    if (curated) {
      return [{
        severity: curated.severity,
        description: curated.description,
        source: curated.source,
        curated: true,
        limitedCoverage: true
      }];
    }
  }
  return [buildUnavailableInteraction(
    !rxcui1 || !rxcui2
      ? 'no curated finding; pair identifiers missing; comprehensive screening unavailable'
      : 'no curated finding; NLM /interaction API retired 2024-01'
  )];
}

/**
 * Screen independent entries without discarding findings when history is invalid.
 * An explicit empty list has no pairwise comparisons; it is not a safety claim.
 * No identifier lookup is needed for this limited, name-based interaction path.
 */
async function checkInteractionsAgainstList(drugName, activeMeds) {
  if (typeof drugName !== 'string' || !drugName.trim()) {
    return [buildUnavailableInteraction('new drug name missing or invalid')];
  }
  if (!Array.isArray(activeMeds)) {
    return [buildUnavailableInteraction('medication history missing or invalid')];
  }
  const allInteractions = [];
  for (const med of activeMeds) {
    if (!med || typeof med !== 'object' || Array.isArray(med)
        || typeof med.medication_name !== 'string' || !med.medication_name.trim()) {
      allInteractions.push({
        drug1: drugName,
        drug2: null,
        ...buildUnavailableInteraction('medication history contains an invalid entry')
      });
      continue;
    }
    const interactions = await getInteractions(null, med.rxnorm_cui, drugName, med.medication_name);
    for (const interaction of interactions) {
      allInteractions.push({
        drug1: drugName,
        drug2: med.medication_name,
        comparisonId: med.comparisonId,
        rxcui1: null,
        rxcui2: med.rxnorm_cui || null,
        ...interaction
      });
    }
  }
  return allInteractions;
}

/**
 * Resolve a medication name to RxCUI and return enriched data.
 * Used during prescription creation to normalize medication identifiers.
 *
 * @param {string} drugName - Drug name (brand or generic)
 * @returns {Promise<{rxcui: string, name: string, genericName: string, brandNames: string[]}|null>}
 */
async function resolveAndEnrich(drugName) {
  const lookup = await lookupByName(drugName);
  if (!lookup) return null;

  const mapping = await getBrandGenericMapping(lookup.rxcui);

  return {
    rxcui: lookup.rxcui,
    name: lookup.name,
    genericName: mapping.generics.length > 0 ? mapping.generics[0] : lookup.name,
    brandNames: mapping.brands
  };
}

module.exports = {
  lookupByName,
  getAllForms,
  getBrandGenericMapping,
  getInteractions,
  checkInteractionsAgainstList,
  resolveAndEnrich,
  isScreeningUnavailable,
  buildUnavailableInteraction,
  SCREENING_UNAVAILABLE
};
