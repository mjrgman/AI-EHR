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
 * Check drug-drug interactions between two RxCUIs.
 *
 * @param {string} rxcui1 - First drug RxCUI
 * @param {string} rxcui2 - Second drug RxCUI
 * @returns {Promise<Array<{severity: string, description: string, source: string}>>}
 */
async function getInteractions(rxcui1, rxcui2) {
  if (!rxcui1 || !rxcui2) return [];
  const sorted = [rxcui1, rxcui2].sort();
  const key = `interaction:${sorted[0]}:${sorted[1]}`;

  const cached = await getCached(key);
  if (cached) return cached;

  const data = await rxnormGet(
    `/interaction/list.json?rxcuis=${sorted[0]}+${sorted[1]}`
  );

  if (!data || !data.fullInteractionTypeGroup) return [];

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

  // Resolve the new drug
  const newDrug = await lookupByName(drugName);
  if (!newDrug) return [];

  const allInteractions = [];

  for (const med of activeMeds) {
    // Use stored RxCUI if available, otherwise look up
    let medRxcui = med.rxnorm_cui;
    if (!medRxcui) {
      const lookup = await lookupByName(med.medication_name);
      if (lookup) medRxcui = lookup.rxcui;
    }
    if (!medRxcui || medRxcui === newDrug.rxcui) continue;

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
  resolveAndEnrich
};
