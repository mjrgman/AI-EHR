'use strict';

/**
 * Drug Safety Service — Drug Interactions + Safety Alerts
 *
 * Integrates:
 *   1. NLM RxNorm Interaction API — drug-drug interaction checking with severity
 *   2. OpenFDA Drug Label API — black box warnings, contraindications, adverse reactions
 *
 * Both APIs are free with no licensing fees.
 */

const https = require('https');
const rxnorm = require('./rxnorm-service');

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';
const REQUEST_TIMEOUT_MS = 5000;

// ──────────────────────────────────────────
// SEVERITY CLASSIFICATION
// ──────────────────────────────────────────

/**
 * Normalize NLM severity strings to a standard 4-tier scale.
 * NLM returns: "high", "N/A", or textual descriptions.
 */
function classifySeverity(nlmSeverity) {
  if (!nlmSeverity) return 'moderate';
  const lower = nlmSeverity.toLowerCase();
  if (lower === 'high' || lower.includes('contraindicated') || lower.includes('serious')) return 'critical';
  if (lower.includes('major')) return 'serious';
  if (lower === 'n/a' || lower.includes('moderate')) return 'moderate';
  if (lower.includes('minor') || lower.includes('low')) return 'minor';
  return 'moderate';
}

// ──────────────────────────────────────────
// OPENFDA HTTP CLIENT
// ──────────────────────────────────────────

function fdaGet(queryParams) {
  return new Promise((resolve) => {
    const url = `${OPENFDA_BASE}?${queryParams}`;
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ──────────────────────────────────────────
// DRUG-DRUG INTERACTION CHECKING
// ──────────────────────────────────────────

/**
 * Check interactions for a new drug against all active medications.
 * Uses RxNorm interaction API for real pharmacological data.
 *
 * @param {string} newDrugName - Drug being prescribed
 * @param {Array<{medication_name: string, rxnorm_cui?: string}>} activeMeds
 * @returns {Promise<Array<{drug1, drug2, severity, description, source}>>}
 */
async function checkDrugInteractions(newDrugName, activeMeds) {
  if (!newDrugName || !activeMeds || activeMeds.length === 0) return [];

  const interactions = await rxnorm.checkInteractionsAgainstList(newDrugName, activeMeds);

  return interactions.map(i => ({
    drug1: i.drug1,
    drug2: i.drug2,
    severity: classifySeverity(i.severity),
    description: i.description,
    source: i.source || 'NLM RxNorm',
    rxcui1: i.rxcui1,
    rxcui2: i.rxcui2
  }));
}

// ──────────────────────────────────────────
// FDA DRUG LABEL LOOKUPS
// ──────────────────────────────────────────

/**
 * Get safety information from FDA drug labeling.
 * Returns boxed warnings, contraindications, and adverse reactions.
 *
 * @param {string} drugName - Generic or brand drug name
 * @returns {Promise<{boxedWarning: string|null, contraindications: string|null, adverseReactions: string|null, dosageAdmin: string|null}>}
 */
async function getDrugLabelSafety(drugName) {
  if (!drugName) return { boxedWarning: null, contraindications: null, adverseReactions: null, dosageAdmin: null };

  const query = `search=openfda.generic_name:"${encodeURIComponent(drugName)}"+openfda.brand_name:"${encodeURIComponent(drugName)}"&limit=1`;
  const data = await fdaGet(query);

  if (!data || !data.results || data.results.length === 0) {
    return { boxedWarning: null, contraindications: null, adverseReactions: null, dosageAdmin: null };
  }

  const label = data.results[0];

  return {
    boxedWarning: label.boxed_warning ? label.boxed_warning[0] : null,
    contraindications: label.contraindications ? label.contraindications[0] : null,
    adverseReactions: label.adverse_reactions ? label.adverse_reactions[0] : null,
    dosageAdmin: label.dosage_and_administration ? label.dosage_and_administration[0] : null
  };
}

/**
 * Check if a drug has a boxed (black box) warning.
 *
 * @param {string} drugName
 * @returns {Promise<{hasBoxedWarning: boolean, warning: string|null}>}
 */
async function checkBoxedWarning(drugName) {
  const safety = await getDrugLabelSafety(drugName);
  return {
    hasBoxedWarning: !!safety.boxedWarning,
    warning: safety.boxedWarning
  };
}

// ──────────────────────────────────────────
// COMPREHENSIVE SAFETY CHECK
// ──────────────────────────────────────────

/**
 * Run a full safety check for a medication being prescribed.
 * Combines interaction checking + FDA label safety data.
 *
 * @param {string} drugName - Drug being prescribed
 * @param {Array} activeMeds - Patient's current active medications
 * @param {Array} allergies - Patient's known allergies
 * @returns {Promise<{interactions: Array, boxedWarning: object, alerts: Array}>}
 */
async function fullSafetyCheck(drugName, activeMeds, allergies) {
  // Run interaction check and FDA lookup in parallel
  const [interactions, labelSafety] = await Promise.all([
    checkDrugInteractions(drugName, activeMeds || []),
    getDrugLabelSafety(drugName)
  ]);

  const alerts = [];

  // Generate alerts from interactions
  for (const interaction of interactions) {
    alerts.push({
      type: 'drug_interaction',
      severity: interaction.severity,
      title: `${interaction.drug1} ↔ ${interaction.drug2} Interaction`,
      description: interaction.description,
      source: interaction.source
    });
  }

  // Generate alert from boxed warning
  if (labelSafety.boxedWarning) {
    alerts.push({
      type: 'boxed_warning',
      severity: 'critical',
      title: `BLACK BOX WARNING: ${drugName}`,
      description: labelSafety.boxedWarning.substring(0, 500),
      source: 'FDA Drug Label'
    });
  }

  // Check contraindications text for allergy-related keywords
  if (labelSafety.contraindications && allergies && allergies.length > 0) {
    const contraText = labelSafety.contraindications.toLowerCase();
    for (const allergy of allergies) {
      if (contraText.includes(allergy.allergen.toLowerCase())) {
        alerts.push({
          type: 'contraindication',
          severity: 'critical',
          title: `Contraindicated: ${drugName} — allergy to ${allergy.allergen}`,
          description: `FDA labeling lists ${allergy.allergen} as a contraindication for ${drugName}.`,
          source: 'FDA Drug Label'
        });
      }
    }
  }

  // Sort by severity (critical first)
  const severityOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  alerts.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  return {
    interactions,
    boxedWarning: {
      hasBoxedWarning: !!labelSafety.boxedWarning,
      warning: labelSafety.boxedWarning
    },
    contraindications: labelSafety.contraindications,
    alerts
  };
}

module.exports = {
  checkDrugInteractions,
  getDrugLabelSafety,
  checkBoxedWarning,
  fullSafetyCheck,
  classifySeverity
};
