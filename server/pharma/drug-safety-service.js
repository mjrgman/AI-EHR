'use strict';

/**
 * Drug Safety Service — Drug Interactions + Safety Alerts
 *
 * Integrates:
 *   1. Limited curated interaction findings; comprehensive screening unavailable
 *   2. OpenFDA Drug Label API — black box warnings, contraindications, adverse reactions
 *
 * Interaction coverage is limited; label lookup is a separate assessment.
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
 * Uses limited curated findings and explicit unavailable markers.
 *
 * @param {string} newDrugName - Drug being prescribed
 * @param {Array<{medication_name: string, rxnorm_cui?: string}>} activeMeds
 * @returns {Promise<Array<{drug1, drug2, severity, description, source}>>}
 */
async function checkDrugInteractions(newDrugName, activeMeds) {
  const interactions = await rxnorm.checkInteractionsAgainstList(newDrugName, activeMeds);

  return interactions.map(i => {
    // Preserve the fail-closed "screening unavailable" sentinel verbatim so
    // downstream consumers surface it as a WARNING rather than treating the
    // absence of interactions as a clean result. Do NOT re-classify its
    // severity (it is 'unknown', not a clinical grade).
    if (i && i.unavailable) {
      return {
        drug1: i.drug1,
        drug2: i.drug2,
        severity: 'unknown',
        status: rxnorm.SCREENING_UNAVAILABLE,
        unavailable: true,
        description: i.description,
        source: i.source || 'screening-unavailable',
        rxcui1: i.rxcui1 || null,
        rxcui2: i.rxcui2 || null
      };
    }
    // Curated interactions already carry a clinical-grade severity
    // ('critical'/'serious'/'moderate'); preserve it verbatim rather than
    // re-running classifySeverity (which would, e.g., upgrade 'serious' to
    // 'critical' because it matches the 'serious' keyword test).
    if (i && i.curated) {
      return {
        drug1: i.drug1,
        drug2: i.drug2,
        severity: i.severity,
        description: i.description,
        source: i.source || 'Curated DDI (interim)',
        curated: true,
        limitedCoverage: true,
        comparisonId: i.comparisonId,
        rxcui1: i.rxcui1 || null,
        rxcui2: i.rxcui2 || null
      };
    }
    return {
      drug1: i.drug1,
      drug2: i.drug2,
      comparisonId: i.comparisonId,
      severity: classifySeverity(i.severity),
      description: i.description,
      source: i.source || 'NLM RxNorm',
      rxcui1: i.rxcui1,
      rxcui2: i.rxcui2
    };
  });
}

/**
 * True if a checkDrugInteractions result indicates screening could not be
 * performed (fail-closed sentinel present). Callers should surface a
 * "verify manually" warning rather than reporting "no interactions."
 *
 * @param {Array} interactions - result of checkDrugInteractions
 * @returns {boolean}
 */
function isScreeningUnavailable(interactions) {
  return Array.isArray(interactions)
    && interactions.some(i => i && i.unavailable === true);
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
  const EMPTY = { boxedWarning: null, contraindications: null, adverseReactions: null, dosageAdmin: null };
  if (!drugName) return EMPTY;

  const encoded = encodeURIComponent(drugName);

  // Query generic_name FIRST, then fall back to a SEPARATE brand_name query.
  // (Previously the two were AND-ed in one query — `generic_name:"X" +
  // brand_name:"X"` — which requires a single label to carry the same string as
  // BOTH its generic and brand name, so it almost never matched and boxed
  // warnings were silently dropped for drugs that carry one, e.g. warfarin,
  // methotrexate. This mirrors the dosing-service generic-then-brand pattern.)
  let data = await fdaGet(`search=openfda.generic_name:"${encoded}"&limit=1`);

  if (!data || !data.results || data.results.length === 0) {
    data = await fdaGet(`search=openfda.brand_name:"${encoded}"&limit=1`);
  }

  if (!data || !data.results || data.results.length === 0) {
    return { ...EMPTY };
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
    checkDrugInteractions(drugName, activeMeds),
    getDrugLabelSafety(drugName)
  ]);

  const alerts = [];

  // Generate alerts from interactions. The screening-unavailable sentinel is
  // surfaced as an explicit WARNING (fail closed) — never silently dropped and
  // never presented as a clean "no interactions" result.
  for (const interaction of interactions) {
    if (interaction.unavailable) {
      alerts.push({
        type: 'interaction_screening_unavailable',
        severity: 'warning',
        title: `Interaction check unavailable: ${drugName}`,
        description: interaction.description,
        source: interaction.source,
        unavailable: true
      });
      continue;
    }
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

  // Sort by severity (critical first). 'warning' (unavailable) ranks just
  // above the lowest tier so it stays visible without masking real findings.
  const severityOrder = { critical: 0, serious: 1, moderate: 2, warning: 2.5, minor: 3 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  // Fail-closed flag: when true, the interaction screen could NOT be completed
  // and the empty/partial interaction list must not be read as "no interactions."
  const noComparisons = typeof drugName === 'string' && drugName.trim().length > 0
    && Array.isArray(activeMeds) && activeMeds.length === 0;
  // Curated positives are useful findings, never a comprehensive completed screen.
  const interactionScreeningUnavailable = !noComparisons;
  const interactionScreening = {
    status: noComparisons ? 'not_applicable' : 'incomplete',
    reason: noComparisons ? 'no_pairwise_comparisons' : 'comprehensive_provider_unavailable',
    findings: interactions.filter(i => !i.unavailable),
    inputComplete: typeof drugName === 'string' && drugName.trim().length > 0
      && Array.isArray(activeMeds) && activeMeds.every(m => m
        && typeof m.medication_name === 'string' && m.medication_name.trim().length > 0)
  };
  if (interactionScreeningUnavailable && !alerts.some(a => a.unavailable)) {
    alerts.push({
      type: 'interaction_screening_unavailable',
      severity: 'warning',
      title: `Interaction check incomplete: ${drugName}`,
      description: 'Only limited curated findings are available. Comprehensive interaction screening is unavailable; verify manually.',
      source: 'screening-unavailable',
      unavailable: true
    });
  }

  return {
    interactions,
    interactionScreeningUnavailable,
    interactionScreening,
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
  isScreeningUnavailable,
  getDrugLabelSafety,
  checkBoxedWarning,
  fullSafetyCheck,
  classifySeverity
};
