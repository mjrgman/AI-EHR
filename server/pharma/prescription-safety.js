'use strict';

/**
 * Offline, deterministic prescription safety checks.
 *
 * The prescription endpoint previously created orders with NO allergy or
 * renal-dosing check of any kind — a physician could prescribe a
 * penicillin-class antibiotic to a penicillin-allergic patient and nothing
 * stopped it. drug-safety-service.js exists but depends on live NLM/FDA network
 * calls, so it is unusable in offline/mock deployments. This module provides a
 * self-contained cross-check keyed off the patient's own chart.
 *
 * checkPrescriptionSafety(drugName, allergies, labs) -> { alerts, hardStop }
 *   alerts:   [{ type, severity, title, description }]
 *   hardStop: true if a same-class allergy conflict was found (caller should
 *             block unless an explicit override reason is supplied)
 */

// Drug name (lowercased substring) -> pharmacologic class.
const DRUG_CLASSES = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'amoxicillin-clavulanate',
    'dicloxacillin', 'nafcillin', 'oxacillin', 'piperacillin', 'ampicillin-sulbactam'],
  cephalosporin: ['cephalexin', 'cefdinir', 'cefuroxime', 'ceftriaxone', 'cefazolin', 'cefpodoxime', 'cefaclor'],
  sulfonamide: ['sulfamethoxazole', 'trimethoprim-sulfamethoxazole', 'bactrim', 'septra', 'sulfadiazine', 'sulfasalazine'],
  nsaid: ['ibuprofen', 'naproxen', 'meloxicam', 'aspirin', 'ketorolac', 'celecoxib', 'diclofenac', 'indomethacin'],
  macrolide: ['azithromycin', 'clarithromycin', 'erythromycin'],
  opioid: ['codeine', 'morphine', 'hydrocodone', 'oxycodone', 'tramadol', 'hydromorphone', 'fentanyl'],
  ace_inhibitor: ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril', 'quinapril'],
  statin: ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin', 'lovastatin'],
};

// Free-text allergen -> class it implies.
const ALLERGEN_CLASS_PATTERNS = [
  [/penicillin|pcn|amoxicill/i, 'penicillin'],
  [/cephalosporin|cef[a-z]*|keflex/i, 'cephalosporin'],
  [/sulfa|sulfonamide|bactrim|septra/i, 'sulfonamide'],
  [/nsaid|ibuprofen|aspirin|naproxen|motrin|advil/i, 'nsaid'],
  [/macrolide|azithromycin|erythromycin|z-?pack/i, 'macrolide'],
  [/codeine|opioid|morphine|opiate/i, 'opioid'],
  [/ace inhibitor|lisinopril|enalapril/i, 'ace_inhibitor'],
  [/statin/i, 'statin'],
];

// Cross-reactivity pairs (allergyClass -> prescribedClass) that are a caution,
// not an absolute contraindication.
const CROSS_REACTIVITY = [
  { allergy: 'penicillin', drug: 'cephalosporin', note: 'Cephalosporins carry an estimated 1-2% cross-reactivity in penicillin-allergic patients. Confirm the reaction history was not anaphylaxis before proceeding.' },
];

// Drugs that need renal-function awareness, with an eGFR threshold below which a
// caution fires and (optionally) a lower threshold that is effectively a stop.
const RENAL_DRUGS = [
  { match: /metformin/i, cautionEgfr: 60, contraEgfr: 30, note: 'Metformin in CKD: reassess in CKD (eGFR < 60), reduce dose if eGFR 30-45, and do not start if eGFR < 30 (lactic-acidosis risk).' },
  { match: /nitrofurantoin/i, cautionEgfr: 45, contraEgfr: 30, note: 'Nitrofurantoin is ineffective and higher-risk when eGFR < 30; avoid.' },
  { match: /gabapentin|pregabalin/i, cautionEgfr: 60, contraEgfr: 15, note: 'Gabapentinoids require dose reduction as eGFR falls.' },
  { match: /(ibuprofen|naproxen|meloxicam|ketorolac|diclofenac|nsaid)/i, cautionEgfr: 60, contraEgfr: 30, note: 'NSAIDs can worsen renal function; avoid in CKD, especially eGFR < 30.' },
];

// Drug-disease contraindications keyed off the patient's active problem list
// (ICD-10 prefix). These fire independently of renal labs.
const DRUG_DISEASE = [
  {
    drug: /(ibuprofen|naproxen|meloxicam|ketorolac|diclofenac|indomethacin|aspirin|nsaid)/i,
    prefixes: ['I50'], severity: 'critical',
    note: 'NSAIDs cause sodium/fluid retention and blunt diuretics and ACE inhibitors — they can precipitate decompensation in heart failure. Avoid.',
    label: 'heart failure',
  },
  {
    drug: /(ibuprofen|naproxen|meloxicam|ketorolac|diclofenac|indomethacin|nsaid)/i,
    prefixes: ['N18'], severity: 'high',
    note: 'NSAIDs reduce renal perfusion and can accelerate CKD progression / cause AKI. Avoid in chronic kidney disease.',
    label: 'chronic kidney disease',
  },
  {
    drug: /(metoprolol|atenolol|carvedilol|propranolol|bisoprolol|nadolol)/i,
    prefixes: ['J45'], severity: 'high',
    note: 'Non-selective beta-blockers can trigger bronchospasm in asthma; use a cardioselective agent with caution if unavoidable.',
    label: 'asthma',
  },
];

function classOfDrug(drugName) {
  const n = String(drugName || '').toLowerCase();
  for (const [cls, names] of Object.entries(DRUG_CLASSES)) {
    if (names.some((d) => n.includes(d))) return cls;
  }
  return null;
}

function classOfAllergen(allergen) {
  const a = String(allergen || '');
  for (const [re, cls] of ALLERGEN_CLASS_PATTERNS) {
    if (re.test(a)) return cls;
  }
  return null;
}

function latestEgfr(labs) {
  if (!Array.isArray(labs)) return null;
  const egfr = labs.find((l) => /e?gfr/i.test(l.test_name || l.test_code || ''));
  if (!egfr) return null;
  const val = parseFloat(egfr.result_value);
  return Number.isFinite(val) ? val : null;
}

function checkPrescriptionSafety(drugName, allergies = [], labs = [], medications = [], problems = []) {
  const alerts = [];
  let hardStop = false;

  const drugClass = classOfDrug(drugName);
  const drugLower = String(drugName || '').toLowerCase();

  // Drug-disease contraindications against the active problem list.
  for (const rule of DRUG_DISEASE) {
    if (!rule.drug.test(drugLower)) continue;
    const hit = (problems || []).find((p) => {
      const status = String(p.status || '').toLowerCase();
      if (status === 'resolved' || status === 'inactive') return false;
      return rule.prefixes.some((pfx) => String(p.icd10_code || '').startsWith(pfx));
    });
    if (hit) {
      alerts.push({
        type: 'drug_disease_contraindication',
        severity: rule.severity,
        title: `${drugName} in ${rule.label} (${hit.problem_name || hit.icd10_code})`,
        description: rule.note,
      });
    }
  }

  // Prior-discontinuation check: re-prescribing a drug the patient previously
  // stopped for an adverse reaction warrants an explicit heads-up.
  for (const med of medications || []) {
    const status = String(med.status || '').toLowerCase();
    if (status !== 'discontinued' && status !== 'inactive') continue;
    const medName = String(med.medication_name || med.name || '').toLowerCase();
    const sameDrug = medName && drugLower && (drugLower.includes(medName) || medName.includes(drugLower));
    const sameClass = drugClass && classOfDrug(medName) === drugClass;
    if ((sameDrug || sameClass) && med.discontinued_reason) {
      alerts.push({
        type: 'prior_discontinuation',
        severity: 'high',
        title: `Previously discontinued: ${med.medication_name || drugName}`,
        description: `This patient previously discontinued ${med.medication_name || drugName}` +
          `${med.end_date ? ` (${med.end_date})` : ''}. Documented reason: ${med.discontinued_reason}. ` +
          `Confirm it is appropriate to resume before prescribing.`,
      });
    }
  }

  for (const allergy of allergies || []) {
    const allergenText = allergy.allergen || allergy.name || '';
    const allergyClass = classOfAllergen(allergenText);

    // Same-class conflict OR the allergen name literally appears in the drug name.
    const sameClass = drugClass && allergyClass && drugClass === allergyClass;
    const nameMatch = allergenText && drugLower.includes(allergenText.toLowerCase());
    if (sameClass || nameMatch) {
      hardStop = true;
      alerts.push({
        type: 'allergy_conflict',
        severity: 'critical',
        title: `ALLERGY CONFLICT: ${drugName} vs documented allergy to ${allergenText}`,
        description: `Patient has a documented allergy to ${allergenText}` +
          (allergy.reaction ? ` (reaction: ${allergy.reaction}` + (allergy.severity ? `, ${allergy.severity}` : '') + ')' : '') +
          `. ${drugName} is${sameClass ? ` the same drug class (${drugClass})` : ' a direct match'}. Do not prescribe without documented justification.`,
      });
      continue;
    }

    // Cross-reactivity caution.
    for (const x of CROSS_REACTIVITY) {
      if (allergyClass === x.allergy && drugClass === x.drug) {
        alerts.push({
          type: 'cross_reactivity',
          severity: 'high',
          title: `Cross-reactivity caution: ${drugName} in a patient allergic to ${allergenText}`,
          description: x.note,
        });
      }
    }
  }

  // Renal-dosing checks.
  const egfr = latestEgfr(labs);
  if (egfr != null) {
    for (const rd of RENAL_DRUGS) {
      if (!rd.match.test(drugLower)) continue;
      if (egfr < rd.contraEgfr) {
        alerts.push({
          type: 'renal_contraindication',
          severity: 'critical',
          title: `Renal contraindication: ${drugName} at eGFR ${egfr}`,
          description: rd.note + ` Current eGFR is ${egfr}.`,
        });
      } else if (egfr < rd.cautionEgfr) {
        alerts.push({
          type: 'renal_caution',
          severity: 'high',
          title: `Renal dose caution: ${drugName} at eGFR ${egfr}`,
          description: rd.note + ` Current eGFR is ${egfr}.`,
        });
      }
    }
  }

  return { alerts, hardStop };
}

module.exports = { checkPrescriptionSafety, classOfDrug, classOfAllergen, latestEgfr };
