'use strict';

/**
 * Drug Safety Service - Drug Interactions + Safety Alerts
 *
 * Current DDI lane:
 *   1. Deterministic local interaction table for high-risk, testable fixtures.
 *   2. Fail-closed provider status when configured provider is unavailable.
 *   3. OpenFDA Drug Label API for boxed warnings and label safety text.
 *
 * The retired RxNav interaction endpoint is intentionally not used for DDI
 * decisions. Any future live provider must meet the same fail-closed contract.
 */

const https = require('https');

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';
const REQUEST_TIMEOUT_MS = 5000;

const LOCAL_DDI_PROVIDER_NAME = 'local_deterministic_ddi';
const PROVIDER_UNAVAILABLE_VALUES = new Set(['disabled', 'none', 'unavailable']);

const DOSE_AND_SIG_WORDS = new Set([
  'mg', 'mcg', 'g', 'gram', 'grams', 'ml', 'meq', 'unit', 'units', 'iu',
  'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps',
  'po', 'sl', 'iv', 'im', 'sc', 'subq', 'oral', 'daily', 'weekly', 'monthly',
  'bid', 'tid', 'qid', 'qhs', 'qam', 'qpm', 'prn', 'once', 'twice', 'three',
  'times', 'day', 'week', 'as', 'needed', 'take', 'inject', 'apply', 'by',
  'mouth', 'sublingual'
]);

const DRUG_ALIASES = [
  {
    canonical: 'warfarin',
    patterns: [/\bwarfarin\b/, /\bcoumadin\b/, /\bjantoven\b/]
  },
  {
    canonical: 'trimethoprim-sulfamethoxazole',
    patterns: [
      /\btrimethoprim\s+sulfamethoxazole\b/,
      /\bsulfamethoxazole\s+trimethoprim\b/,
      /\btrimethoprim\s+and\s+sulfamethoxazole\b/,
      /\bsulfamethoxazole\s+and\s+trimethoprim\b/,
      /\btmp\s*smx\b/,
      /\bco\s*trimoxazole\b/,
      /\bbactrim\b/,
      /\bseptra\b/
    ]
  },
  {
    canonical: 'amiodarone',
    patterns: [/\bamiodarone\b/, /\bpacerone\b/, /\bcordarone\b/]
  },
  {
    canonical: 'sildenafil',
    patterns: [/\bsildenafil\b/, /\bviagra\b/, /\brevatio\b/]
  },
  {
    canonical: 'nitroglycerin',
    patterns: [/\bnitroglycerin\b/, /\bnitrostat\b/, /\bnitro\b/]
  },
  {
    canonical: 'lisinopril',
    patterns: [/\blisinopril\b/, /\bprinivil\b/, /\bzestril\b/]
  },
  {
    canonical: 'spironolactone',
    patterns: [/\bspironolactone\b/, /\baldactone\b/]
  },
  {
    canonical: 'simvastatin',
    patterns: [/\bsimvastatin\b/, /\bzocor\b/]
  },
  {
    canonical: 'clarithromycin',
    patterns: [/\bclarithromycin\b/, /\bbiaxin\b/]
  }
];

const LOCAL_DDI_FIXTURES = [
  {
    drugs: ['sildenafil', 'nitroglycerin'],
    severity: 'critical',
    description: 'Contraindicated combination: PDE-5 inhibitors such as sildenafil with nitrates can cause severe hypotension, syncope, or myocardial ischemia.',
    source: 'DailyMed nitroglycerin labeling; local deterministic DDI',
    referenceUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=38059df3-be1b-4226-9f12-c3c37cb44fea&version=4'
  },
  {
    drugs: ['simvastatin', 'clarithromycin'],
    severity: 'critical',
    description: 'Contraindicated combination: clarithromycin can increase simvastatin exposure and raise the risk of myopathy, including rhabdomyolysis.',
    source: 'DailyMed clarithromycin labeling; local deterministic DDI',
    referenceUrl: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9bf207c0-86eb-4f3b-92e7-f65f3fccd5a7'
  },
  {
    drugs: ['lisinopril', 'spironolactone'],
    severity: 'serious',
    description: 'Potassium-sparing diuretic plus ACE inhibitor: increased hyperkalemia risk; monitor serum potassium and renal function.',
    source: 'DailyMed spironolactone labeling; local deterministic DDI',
    referenceUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=cbc817de-5ea8-4139-9c13-02bac8ff93c3&version=104'
  },
  {
    drugs: ['warfarin', 'trimethoprim-sulfamethoxazole'],
    severity: 'serious',
    description: 'Sulfamethoxazole/trimethoprim may prolong prothrombin time in patients receiving warfarin; reassess coagulation time and INR.',
    source: 'DailyMed sulfamethoxazole/trimethoprim labeling; local deterministic DDI',
    referenceUrl: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=b001e648-2710-3ada-e053-2995a90a52f1'
  },
  {
    drugs: ['warfarin', 'amiodarone'],
    severity: 'serious',
    description: 'Amiodarone inhibits warfarin metabolism and can increase anticoagulant effect; reduce warfarin dose when appropriate and monitor INR/prothrombin time.',
    source: 'DailyMed amiodarone/warfarin labeling; local deterministic DDI',
    referenceUrl: 'https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId=0caedb97-56fd-4ec0-bfb2-c7683b8f5f1b'
  }
];

// ---------------------------------------------------------------------------
// SEVERITY CLASSIFICATION
// ---------------------------------------------------------------------------

/**
 * Normalize interaction severities to a standard 4-tier scale.
 */
function classifySeverity(severity) {
  if (!severity) return 'moderate';
  const lower = String(severity).toLowerCase();
  if (['critical', 'serious', 'moderate', 'minor'].includes(lower)) return lower;
  if (lower === 'high' || lower.includes('contraindicated') || lower.includes('life-threatening')) return 'critical';
  if (lower.includes('serious') || lower.includes('major')) return 'serious';
  if (lower === 'n/a' || lower.includes('moderate')) return 'moderate';
  if (lower.includes('minor') || lower.includes('low')) return 'minor';
  return 'moderate';
}

function normalizeDrugName(name) {
  if (!name) return '';
  const normalized = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/[/-]/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .split(/\s+/)
    .filter(token => token && !DOSE_AND_SIG_WORDS.has(token))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function canonicalizeDrugName(name) {
  const normalized = normalizeDrugName(name);
  if (!normalized) return '';

  for (const alias of DRUG_ALIASES) {
    if (alias.patterns.some(pattern => pattern.test(normalized))) {
      return alias.canonical;
    }
  }

  return normalized;
}

function getMedicationName(medication) {
  if (!medication) return '';
  if (typeof medication === 'string') return medication;
  return medication.medication_name ||
    medication.generic_name ||
    medication.name ||
    medication.drug ||
    medication.display ||
    '';
}

function normalizeMedicationList(medications) {
  if (!Array.isArray(medications)) return [];
  return medications
    .map((medication) => {
      const name = getMedicationName(medication);
      return {
        original: medication,
        name,
        canonical: canonicalizeDrugName(name)
      };
    })
    .filter(medication => medication.name && medication.canonical);
}

function pairKey(drugA, drugB) {
  return [drugA, drugB].sort().join('|');
}

function fixturePairKey(fixture) {
  return pairKey(fixture.drugs[0], fixture.drugs[1]);
}

function findLocalFixture(drugA, drugB) {
  const key = pairKey(canonicalizeDrugName(drugA), canonicalizeDrugName(drugB));
  return LOCAL_DDI_FIXTURES.find(fixture => fixturePairKey(fixture) === key) || null;
}

function buildInteraction(drugAName, drugBName, fixture) {
  return {
    drug1: drugAName,
    drug2: drugBName,
    severity: classifySeverity(fixture.severity),
    description: fixture.description,
    source: fixture.source,
    referenceUrl: fixture.referenceUrl,
    provider: LOCAL_DDI_PROVIDER_NAME,
    canonicalPair: fixturePairKey(fixture)
  };
}

function getDdiProviderStatus() {
  const configuredProvider = String(process.env.DDI_PROVIDER || 'local').toLowerCase();

  if (PROVIDER_UNAVAILABLE_VALUES.has(configuredProvider)) {
    return {
      provider: configuredProvider,
      available: false,
      failClosed: true,
      reason: `DDI provider is configured as ${configuredProvider}`
    };
  }

  return {
    provider: LOCAL_DDI_PROVIDER_NAME,
    available: true,
    failClosed: true,
    deterministic: true,
    fixtureCount: LOCAL_DDI_FIXTURES.length
  };
}

function buildFailClosedInteraction(drugAName, drugBName, reason) {
  return {
    drug1: drugAName || 'unknown medication',
    drug2: drugBName || 'active medication list',
    severity: 'critical',
    description: `Drug-drug interaction provider unavailable (${reason || 'unknown reason'}). Hold or route for physician/pharmacist review before finalizing medication changes.`,
    source: 'DDI provider fail-closed guardrail',
    provider: 'unavailable',
    pending_ddi_check: true
  };
}

function checkPairWithLocalProvider(drugName, activeMedications) {
  const interactions = [];
  const primaryName = getMedicationName(drugName) || drugName;

  for (const activeMed of activeMedications) {
    const activeName = activeMed.name || getMedicationName(activeMed.original);
    const fixture = findLocalFixture(primaryName, activeName);
    if (!fixture) continue;
    interactions.push(buildInteraction(primaryName, activeName, fixture));
  }

  return interactions;
}

// ---------------------------------------------------------------------------
// OPENFDA HTTP CLIENT
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DRUG-DRUG INTERACTION CHECKING
// ---------------------------------------------------------------------------

/**
 * Check interactions for a new drug against active medications.
 *
 * Supports the historical array-only call shape by delegating to
 * checkMedicationListInteractions, but callers should prefer the explicit
 * (newDrugName, activeMeds) signature for prescribing flows.
 *
 * @param {string|Array} newDrugName - Drug being prescribed, or medication list.
 * @param {Array<{medication_name: string, rxnorm_cui?: string}>} activeMeds
 * @returns {Promise<Array<{drug1, drug2, severity, description, source}>>}
 */
async function checkDrugInteractions(newDrugName, activeMeds) {
  if (Array.isArray(newDrugName) && activeMeds === undefined) {
    return checkMedicationListInteractions(newDrugName);
  }

  const primaryName = getMedicationName(newDrugName) || newDrugName;
  const activeMedications = normalizeMedicationList(activeMeds);
  if (!primaryName || activeMedications.length === 0) return [];

  const providerStatus = getDdiProviderStatus();
  if (!providerStatus.available) {
    return [
      buildFailClosedInteraction(
        primaryName,
        activeMedications.map(med => med.name).join(', '),
        providerStatus.reason
      )
    ];
  }

  return checkPairWithLocalProvider(primaryName, activeMedications);
}

/**
 * Check all unique medication pairs in a reconciled list.
 *
 * @param {Array<string|{medication_name: string}>} medications
 * @returns {Promise<Array>}
 */
async function checkMedicationListInteractions(medications) {
  const medicationList = normalizeMedicationList(medications);
  if (medicationList.length < 2) return [];

  const providerStatus = getDdiProviderStatus();
  if (!providerStatus.available) {
    return [
      buildFailClosedInteraction(
        medicationList[0].name,
        medicationList.slice(1).map(med => med.name).join(', '),
        providerStatus.reason
      )
    ];
  }

  const interactions = [];
  const seenPairs = new Set();

  for (let i = 0; i < medicationList.length; i++) {
    for (let j = i + 1; j < medicationList.length; j++) {
      const drugA = medicationList[i];
      const drugB = medicationList[j];
      const key = pairKey(drugA.canonical, drugB.canonical);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      const fixture = findLocalFixture(drugA.name, drugB.name);
      if (!fixture) continue;
      interactions.push(buildInteraction(drugA.name, drugB.name, fixture));
    }
  }

  return interactions;
}

// ---------------------------------------------------------------------------
// FDA DRUG LABEL LOOKUPS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// COMPREHENSIVE SAFETY CHECK
// ---------------------------------------------------------------------------

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
  const [interactions, labelSafety] = await Promise.all([
    checkDrugInteractions(drugName, activeMeds || []),
    getDrugLabelSafety(drugName)
  ]);

  const alerts = [];

  for (const interaction of interactions) {
    alerts.push({
      type: interaction.pending_ddi_check ? 'ddi_check_unavailable' : 'drug_interaction',
      severity: interaction.severity,
      title: interaction.pending_ddi_check
        ? 'Drug interaction check unavailable'
        : `${interaction.drug1} + ${interaction.drug2} Interaction`,
      description: interaction.description,
      source: interaction.source,
      referenceUrl: interaction.referenceUrl
    });
  }

  if (labelSafety.boxedWarning) {
    alerts.push({
      type: 'boxed_warning',
      severity: 'critical',
      title: `BLACK BOX WARNING: ${drugName}`,
      description: labelSafety.boxedWarning.substring(0, 500),
      source: 'FDA Drug Label'
    });
  }

  if (labelSafety.contraindications && allergies && allergies.length > 0) {
    const contraText = labelSafety.contraindications.toLowerCase();
    for (const allergy of allergies) {
      if (contraText.includes(allergy.allergen.toLowerCase())) {
        alerts.push({
          type: 'contraindication',
          severity: 'critical',
          title: `Contraindicated: ${drugName} - allergy to ${allergy.allergen}`,
          description: `FDA labeling lists ${allergy.allergen} as a contraindication for ${drugName}.`,
          source: 'FDA Drug Label'
        });
      }
    }
  }

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
  checkMedicationListInteractions,
  getDdiProviderStatus,
  getDrugLabelSafety,
  checkBoxedWarning,
  fullSafetyCheck,
  classifySeverity,
  normalizeDrugName,
  canonicalizeDrugName
};
