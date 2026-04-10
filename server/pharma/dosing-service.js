'use strict';

/**
 * Dosing Reference Service — Drug Dosing Lookups + Validation
 *
 * Integrates:
 *   1. OpenFDA Drug Label API — dosage_and_administration from structured labeling
 *   2. DailyMed API (NLM) — structured product labeling with dosing info
 *   3. Local SQLite cache — drug_dosing_reference table for fast repeat lookups
 *
 * Both APIs are free, no API key required.
 * All lookups cached locally with graceful fallback when APIs are unreachable.
 */

const https = require('https');
const db = require('../database');

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';
const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json';
const REQUEST_TIMEOUT_MS = 5000;

// ──────────────────────────────────────────
// TABLE INITIALIZATION
// ──────────────────────────────────────────

db.dbRun(`
  CREATE TABLE IF NOT EXISTS drug_dosing_reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_name TEXT NOT NULL,
    rxnorm_cui TEXT,
    indication TEXT,
    typical_dose TEXT,
    max_dose TEXT,
    renal_adjustment TEXT,
    hepatic_adjustment TEXT,
    geriatric_notes TEXT,
    source TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(drug_name, indication)
  )
`).catch(err => {
  console.warn('[Dosing] Table creation failed:', err.message);
});

// ──────────────────────────────────────────
// HTTP CLIENT
// ──────────────────────────────────────────

/**
 * Make a GET request over HTTPS. Returns parsed JSON or null on failure.
 * 5-second timeout, graceful fallback on any error.
 */
function httpsGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          console.warn(`[Dosing] Invalid JSON from ${url}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`[Dosing] API request failed: ${err.message}`);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[Dosing] Request timed out: ${url}`);
      resolve(null);
    });
  });
}

// ──────────────────────────────────────────
// CACHE LAYER
// ──────────────────────────────────────────

/**
 * Get cached dosing info for a drug. Returns null on cache miss.
 */
async function getCached(drugName) {
  try {
    const rows = await db.dbAll(
      `SELECT * FROM drug_dosing_reference
       WHERE drug_name = ? AND cached_at > datetime('now', '-30 days')`,
      [drugName.toLowerCase().trim()]
    );
    if (rows && rows.length > 0) return rows;
  } catch {
    // Cache miss or table doesn't exist yet
  }
  return null;
}

/**
 * Store dosing info in the local cache.
 */
async function setCache(drugName, dosingData) {
  const name = drugName.toLowerCase().trim();
  try {
    await db.dbRun(
      `INSERT OR REPLACE INTO drug_dosing_reference
         (drug_name, rxnorm_cui, indication, typical_dose, max_dose,
          renal_adjustment, hepatic_adjustment, geriatric_notes, source, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        name,
        dosingData.rxnorm_cui || null,
        dosingData.indication || 'general',
        dosingData.typical_dose || null,
        dosingData.max_dose || null,
        dosingData.renal_adjustment || null,
        dosingData.hepatic_adjustment || null,
        dosingData.geriatric_notes || null,
        dosingData.source || 'unknown'
      ]
    );
  } catch (err) {
    console.warn(`[Dosing] Cache write failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────
// OPENFDA DRUG LABEL API
// ──────────────────────────────────────────

/**
 * Get raw dosing text from the FDA Drug Label API.
 * Queries by generic name and extracts dosage_and_administration.
 *
 * @param {string} drugName - Generic or brand drug name
 * @returns {Promise<string|null>} Raw dosing text or null
 */
async function getDosingFromFDA(drugName) {
  if (!drugName || typeof drugName !== 'string') return null;

  const encoded = encodeURIComponent(drugName);
  const url = `${OPENFDA_BASE}?search=openfda.generic_name:"${encoded}"&limit=1`;
  const data = await httpsGet(url);

  if (!data || !data.results || data.results.length === 0) {
    // Retry with brand name search
    const brandUrl = `${OPENFDA_BASE}?search=openfda.brand_name:"${encoded}"&limit=1`;
    const brandData = await httpsGet(brandUrl);
    if (!brandData || !brandData.results || brandData.results.length === 0) {
      return null;
    }
    const label = brandData.results[0];
    return label.dosage_and_administration ? label.dosage_and_administration[0] : null;
  }

  const label = data.results[0];
  return label.dosage_and_administration ? label.dosage_and_administration[0] : null;
}

// ──────────────────────────────────────────
// DAILYMED API (NLM)
// ──────────────────────────────────────────

/**
 * Get raw dosing text from the DailyMed API.
 * Queries structured product labeling by drug name.
 *
 * @param {string} drugName - Drug name
 * @returns {Promise<string|null>} Raw dosing info or null
 */
async function getDosingFromDailyMed(drugName) {
  if (!drugName || typeof drugName !== 'string') return null;

  const encoded = encodeURIComponent(drugName);
  const url = `${DAILYMED_BASE}?drug_name=${encoded}`;
  const data = await httpsGet(url);

  if (!data || !data.data || data.data.length === 0) return null;

  // Return a summary of available SPL entries
  const spls = data.data.slice(0, 3).map(spl => ({
    setid: spl.setid,
    title: spl.title,
    published_date: spl.published_date
  }));

  // Build a readable summary from the SPL metadata
  const lines = spls.map(spl =>
    `${spl.title || 'Untitled'} (published: ${spl.published_date || 'unknown'}, setid: ${spl.setid})`
  );

  return lines.join('\n');
}

// ──────────────────────────────────────────
// DOSING TEXT PARSING
// ──────────────────────────────────────────

/**
 * Extract structured dosing fields from raw FDA dosing text.
 * Best-effort regex extraction — not all fields will be populated.
 */
function parseFDADosingText(text) {
  if (!text) return {};

  const result = {};

  // Try to extract typical dose (common patterns: "X mg", "X mg/kg", "X mg once daily")
  const doseMatch = text.match(/(\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL|units?)(?:\/(?:kg|m2|day|dose))?(?:\s+(?:once|twice|three times|every \d+\s*(?:hours?|hrs?|h))?\s*(?:daily|per day|a day)?)?)/i);
  if (doseMatch) {
    result.typical_dose = doseMatch[1].trim();
  }

  // Try to extract max dose
  const maxMatch = text.match(/(?:maximum|max(?:imum)?|not (?:to )?exceed|up to)\s+(?:dose[:\s]+)?(\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL|units?)(?:\/(?:kg|m2|day|dose))?(?:\s*(?:per|\/)\s*day)?)/i);
  if (maxMatch) {
    result.max_dose = maxMatch[1].trim();
  }

  // Try to extract renal adjustment
  const renalMatch = text.match(/(?:renal|kidney|creatinine clearance|CrCl|GFR|eGFR)[^.]*\./i);
  if (renalMatch) {
    result.renal_adjustment = renalMatch[0].trim();
  }

  // Try to extract hepatic adjustment
  const hepaticMatch = text.match(/(?:hepatic|liver|Child-Pugh|cirrhosis)[^.]*\./i);
  if (hepaticMatch) {
    result.hepatic_adjustment = hepaticMatch[0].trim();
  }

  // Try to extract geriatric notes
  const geriatricMatch = text.match(/(?:geriatric|elderly|older (?:adult|patient)|age[sd]?\s*(?:65|≥\s*65))[^.]*\./i);
  if (geriatricMatch) {
    result.geriatric_notes = geriatricMatch[0].trim();
  }

  return result;
}

// ──────────────────────────────────────────
// PRIMARY DOSING LOOKUP
// ──────────────────────────────────────────

/**
 * Get dosing information for a drug.
 * Checks local cache first, then queries FDA and DailyMed APIs.
 *
 * @param {string} drugName - Drug name (generic or brand)
 * @returns {Promise<{drug_name: string, typical_dose: string|null, max_dose: string|null, renal_adjustment: string|null, hepatic_adjustment: string|null, geriatric_notes: string|null, raw_fda_text: string|null, dailymed_info: string|null, source: string, cached: boolean}>}
 */
async function getDosing(drugName) {
  if (!drugName || typeof drugName !== 'string') {
    return { drug_name: drugName, error: 'Invalid drug name', source: 'none', cached: false };
  }

  const normalizedName = drugName.toLowerCase().trim();

  // Check cache first
  const cached = await getCached(normalizedName);
  if (cached && cached.length > 0) {
    const row = cached[0];
    return {
      drug_name: row.drug_name,
      rxnorm_cui: row.rxnorm_cui,
      indication: row.indication,
      typical_dose: row.typical_dose,
      max_dose: row.max_dose,
      renal_adjustment: row.renal_adjustment,
      hepatic_adjustment: row.hepatic_adjustment,
      geriatric_notes: row.geriatric_notes,
      source: row.source,
      cached: true
    };
  }

  // Query both APIs in parallel
  const [fdaText, dailymedText] = await Promise.all([
    getDosingFromFDA(normalizedName),
    getDosingFromDailyMed(normalizedName)
  ]);

  // Parse structured fields from FDA text
  const parsed = parseFDADosingText(fdaText);

  const result = {
    drug_name: normalizedName,
    typical_dose: parsed.typical_dose || null,
    max_dose: parsed.max_dose || null,
    renal_adjustment: parsed.renal_adjustment || null,
    hepatic_adjustment: parsed.hepatic_adjustment || null,
    geriatric_notes: parsed.geriatric_notes || null,
    raw_fda_text: fdaText || null,
    dailymed_info: dailymedText || null,
    source: fdaText ? 'OpenFDA' : (dailymedText ? 'DailyMed' : 'none'),
    cached: false
  };

  // Cache the result if we got any data
  if (fdaText || dailymedText) {
    await setCache(normalizedName, {
      indication: 'general',
      typical_dose: parsed.typical_dose || null,
      max_dose: parsed.max_dose || null,
      renal_adjustment: parsed.renal_adjustment || null,
      hepatic_adjustment: parsed.hepatic_adjustment || null,
      geriatric_notes: parsed.geriatric_notes || null,
      source: result.source
    });
  }

  return result;
}

// ──────────────────────────────────────────
// DOSE VALIDATION
// ──────────────────────────────────────────

/**
 * Parse a dose string into a numeric value and unit.
 * Handles patterns like "500 mg", "10mg", "0.5 g", "100 mcg".
 *
 * @param {string} doseStr - Dose string to parse
 * @returns {{value: number, unit: string}|null}
 */
function parseDose(doseStr) {
  if (!doseStr || typeof doseStr !== 'string') return null;
  const match = doseStr.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|mL|units?)/i);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

/**
 * Convert a dose to milligrams for comparison.
 */
function toMg(value, unit) {
  switch (unit) {
    case 'g': return value * 1000;
    case 'mcg': return value / 1000;
    case 'mg': return value;
    default: return value; // units, mL — can't convert, return as-is
  }
}

/**
 * Validate a prescribed dose against known dosing data.
 * Checks if the dose is within typical range and below max dose.
 *
 * @param {string} drugName - Drug name
 * @param {string} prescribedDose - Prescribed dose (e.g., "500 mg")
 * @returns {Promise<{isValid: boolean, warning: string|null}>}
 */
async function validateDose(drugName, prescribedDose) {
  if (!drugName || !prescribedDose) {
    return { isValid: true, warning: 'Unable to validate: missing drug name or dose' };
  }

  const prescribed = parseDose(prescribedDose);
  if (!prescribed) {
    return { isValid: true, warning: `Unable to parse prescribed dose: ${prescribedDose}` };
  }

  // Get dosing data
  const dosing = await getDosing(drugName);

  if (dosing.source === 'none') {
    return { isValid: true, warning: `No dosing reference data available for ${drugName}` };
  }

  const warnings = [];

  // Check against max dose
  if (dosing.max_dose) {
    const maxParsed = parseDose(dosing.max_dose);
    if (maxParsed) {
      const prescribedMg = toMg(prescribed.value, prescribed.unit);
      const maxMg = toMg(maxParsed.value, maxParsed.unit);

      if (prescribedMg > maxMg) {
        warnings.push(
          `Prescribed dose ${prescribedDose} exceeds maximum dose ${dosing.max_dose} for ${drugName}`
        );
      }
    }
  }

  // Check if significantly higher than typical dose (> 2x)
  if (dosing.typical_dose) {
    const typicalParsed = parseDose(dosing.typical_dose);
    if (typicalParsed) {
      const prescribedMg = toMg(prescribed.value, prescribed.unit);
      const typicalMg = toMg(typicalParsed.value, typicalParsed.unit);

      if (typicalMg > 0 && prescribedMg > typicalMg * 2) {
        warnings.push(
          `Prescribed dose ${prescribedDose} is more than 2x the typical dose ${dosing.typical_dose} for ${drugName}`
        );
      }
    }
  }

  if (warnings.length > 0) {
    return { isValid: false, warning: warnings.join('; ') };
  }

  return { isValid: true, warning: null };
}

// ──────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────

module.exports = {
  getDosing,
  validateDose,
  getDosingFromFDA,
  getDosingFromDailyMed
};
