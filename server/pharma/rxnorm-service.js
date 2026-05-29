'use strict';

/**
 * RxNorm Service — NLM RxNorm REST API Integration
 *
 * Provides canonical drug identification (RxCUI), brand/generic mapping,
 * drug interaction checking, and form/strength lookups using the free
 * NLM RxNorm API (https://rxnav.nlm.nih.gov/REST/).
 *
 * All lookups are cached in SQLite with a configurable TTL (default 30 days).
 * Falls back gracefully when the API is unreachable.
 */

const https = require('https');
const db = require('../database');

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';
const CACHE_TTL_DAYS = 30;
const REQUEST_TIMEOUT_MS = 5000;

// ──────────────────────────────────────────
// HTTP CLIENT
// ──────────────────────────────────────────

/**
 * Make a GET request to the RxNorm API.
 * Returns parsed JSON or null on failure.
 */
function rxnormGet(path) {
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
 * True if an interactions array represents an unavailable-screening result
 * rather than a completed screen. Use this to decide whether an empty list
 * may be trusted as "no interactions."
 *
 * @param {Array} interactions
 * @returns {boolean}
 */
function isScreeningUnavailable(interactions) {
  return Array.isArray(interactions)
    && interactions.some(i => i && i.status === SCREENING_UNAVAILABLE);
}

/**
 * Check drug-drug interactions between two RxCUIs.
 *
 * FAIL-CLOSED: on any upstream error / unreachable source, returns a
 * single-element array containing the "screening unavailable" sentinel
 * (see buildUnavailableInteraction). A genuinely-empty array is returned ONLY
 * when the source responded successfully with zero interaction pairs.
 *
 * @param {string} rxcui1 - First drug RxCUI
 * @param {string} rxcui2 - Second drug RxCUI
 * @returns {Promise<Array<{severity: string, description: string, source: string, status?: string}>>}
 */
async function getInteractions(rxcui1, rxcui2) {
  if (!rxcui1 || !rxcui2) return [];
  const sorted = [rxcui1, rxcui2].sort();
  const key = `interaction:${sorted[0]}:${sorted[1]}`;

  const cached = await getCached(key);
  // Never serve an "unavailable" sentinel from cache — re-attempt each time so
  // a restored source recovers immediately. Only cache genuine results.
  if (cached && !isScreeningUnavailable(cached)) return cached;

  const data = await rxnormGet(
    `/interaction/list.json?rxcuis=${sorted[0]}+${sorted[1]}`
  );

  // FAIL CLOSED: a null/absent response means the upstream source was
  // unreachable or returned an error (the NLM /interaction API was retired
  // Jan-2024, so this is the live path). Surface "unavailable", never empty.
  if (!data) {
    return [buildUnavailableInteraction('upstream source unreachable')];
  }

  // A well-formed response with no interaction group = source reachable,
  // genuinely zero interactions. Safe to return empty (and cache it).
  if (!data.fullInteractionTypeGroup) {
    await setCache(key, []);
    return [];
  }

  const interactions = [];
  for (const group of data.fullInteractionTypeGroup) {
    for (const type of (group.fullInteractionType || [])) {
      for (const pair of (type.interactionPair || [])) {
        interactions.push({
          severity: pair.severity || 'unknown',
          description: pair.description || '',
          source: group.sourceName || 'NLM'
        });
      }
    }
  }

  await setCache(key, interactions);
  return interactions;
}

/**
 * Check interactions for a drug against a list of active medications.
 * Resolves drug names to RxCUIs first if needed.
 *
 * @param {string} drugName - The new drug being prescribed
 * @param {Array<{medication_name: string, rxnorm_cui?: string}>} activeMeds - Current medications
 * @returns {Promise<Array<{drug1: string, drug2: string, severity: string, description: string, source: string}>>}
 */
async function checkInteractionsAgainstList(drugName, activeMeds) {
  if (!drugName || !activeMeds || activeMeds.length === 0) return [];

  // Resolve the new drug. A failed resolve means we cannot screen this drug at
  // all — FAIL CLOSED rather than returning an empty (falsely-clean) list.
  const newDrug = await lookupByName(drugName);
  if (!newDrug) {
    return [{
      drug1: drugName,
      drug2: null,
      ...buildUnavailableInteraction(`could not resolve "${drugName}" to a drug identifier`)
    }];
  }

  const allInteractions = [];

  for (const med of activeMeds) {
    // Use stored RxCUI if available, otherwise look up
    let medRxcui = med.rxnorm_cui;
    if (!medRxcui) {
      const lookup = await lookupByName(med.medication_name);
      if (lookup) medRxcui = lookup.rxcui;
    }
    if (medRxcui && medRxcui === newDrug.rxcui) continue;

    // Could not resolve this active med → cannot screen this pair. Emit an
    // explicit unavailable marker instead of silently skipping it.
    if (!medRxcui) {
      allInteractions.push({
        drug1: drugName,
        drug2: med.medication_name,
        rxcui1: newDrug.rxcui,
        rxcui2: null,
        ...buildUnavailableInteraction(`could not resolve "${med.medication_name}" to a drug identifier`)
      });
      continue;
    }

    const interactions = await getInteractions(newDrug.rxcui, medRxcui);
    for (const interaction of interactions) {
      allInteractions.push({
        drug1: drugName,
        drug2: med.medication_name,
        rxcui1: newDrug.rxcui,
        rxcui2: medRxcui,
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
