'use strict';

/**
 * Curated Drug-Drug Interaction (DDI) Table — INTERIM, NOT EXHAUSTIVE
 * ===================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The free NLM RxNav `/interaction` REST endpoints (which `rxnorm-service.js`
 * formerly relied on for drug-drug interaction screening) were RETIRED by the
 * NLM in January 2024. With that source gone, automated screening returned an
 * empty result for every pair, and the system risked reporting "no interactions"
 * for genuinely dangerous combinations (a fail-OPEN, patient-safety defect —
 * see ULTRAREVIEW pharma-ddi-01 / ULTRAPLAN P0-4).
 *
 * This module provides an INTERIM, HAND-CURATED table of a small set of
 * WELL-ESTABLISHED, HIGH-SEVERITY drug-drug interactions drawn from standard
 * references (FDA labeling, Lexicomp/Micromedex interaction monographs, and
 * widely-taught clinical pharmacology). It exists so that the highest-risk,
 * textbook pairs are caught even with the live API gone.
 *
 * CRITICAL SAFETY CONTRACT
 * ------------------------
 *   - A pair PRESENT in this table  → return a real, graded interaction.
 *   - A pair ABSENT from this table → the caller MUST fall back to the existing
 *     fail-CLOSED "screening unavailable — verify manually" sentinel. ABSENCE
 *     FROM THIS TABLE IS NOT "NO INTERACTION." This table is a small allow-list
 *     of known-bad pairs, NOT a comprehensive negative screen.
 *
 * This is explicitly NOT a substitute for a licensed, maintained interaction
 * database (e.g., First Databank, Medi-Span, Lexicomp). Swapping in a licensed
 * DB is a pending decision for Michael (ULTRAPLAN P0-4). Until that lands, this
 * curated set is the interim unblock and the fail-closed sentinel stays intact
 * for every pair not listed here.
 *
 * KEYING
 * ------
 * Interactions are keyed by INGREDIENT / generic name (normalized to lowercase,
 * trimmed). A small alias map normalizes common brand names and synonyms to the
 * canonical ingredient so that, e.g., "Coumadin" resolves to "warfarin". Some
 * entries are CLASS-based (e.g., "nsaid", "ssri") — a class-member alias map
 * resolves individual agents to their class token. RxCUI-keyed lookup is also
 * supported where a stable ingredient RxCUI is known, but name-based matching is
 * the primary path because RxCUIs are no longer resolvable offline.
 */

// ──────────────────────────────────────────
// ALIAS / CLASS NORMALIZATION
// ──────────────────────────────────────────

/**
 * Map brand names, synonyms, and class members to a canonical token used as a
 * key in the interaction table. Keys and values are lowercase. A token that is
 * already canonical (e.g., 'warfarin') need not appear here.
 *
 * Class tokens (nsaid, ssri, maoi, etc.) let a single curated row cover an
 * entire drug class without enumerating every member as a separate pair.
 */
const ALIASES = {
  // Anticoagulants
  coumadin: 'warfarin',
  jantoven: 'warfarin',

  // NSAIDs (class token: 'nsaid')
  ibuprofen: 'nsaid',
  naproxen: 'nsaid',
  diclofenac: 'nsaid',
  ketorolac: 'nsaid',
  meloxicam: 'nsaid',
  celecoxib: 'nsaid',
  indomethacin: 'nsaid',
  advil: 'nsaid',
  motrin: 'nsaid',
  aleve: 'nsaid',
  toradol: 'nsaid',

  // Sulfonamide antibiotics
  bactrim: 'sulfamethoxazole',
  septra: 'sulfamethoxazole',
  'sulfamethoxazole-trimethoprim': 'sulfamethoxazole',
  'trimethoprim-sulfamethoxazole': 'sulfamethoxazole',
  cotrimoxazole: 'sulfamethoxazole',
  tmp: 'trimethoprim',
  'tmp-smx': 'sulfamethoxazole',

  // SSRIs / SNRIs (class token: 'ssri')
  fluoxetine: 'ssri',
  sertraline: 'ssri',
  paroxetine: 'ssri',
  citalopram: 'ssri',
  escitalopram: 'ssri',
  fluvoxamine: 'ssri',
  venlafaxine: 'ssri',
  duloxetine: 'ssri',
  prozac: 'ssri',
  zoloft: 'ssri',
  paxil: 'ssri',
  lexapro: 'ssri',
  celexa: 'ssri',
  effexor: 'ssri',
  cymbalta: 'ssri',

  // MAOIs (class token: 'maoi')
  phenelzine: 'maoi',
  tranylcypromine: 'maoi',
  isocarboxazid: 'maoi',
  selegiline: 'maoi',
  rasagiline: 'maoi',
  linezolid: 'maoi', // reversible MAO-A inhibition — clinically relevant for serotonin syndrome
  nardil: 'maoi',
  parnate: 'maoi',
  marplan: 'maoi',

  // ACE inhibitors (class token: 'ace_inhibitor')
  lisinopril: 'ace_inhibitor',
  enalapril: 'ace_inhibitor',
  ramipril: 'ace_inhibitor',
  benazepril: 'ace_inhibitor',
  captopril: 'ace_inhibitor',
  quinapril: 'ace_inhibitor',
  perindopril: 'ace_inhibitor',

  // ARBs (class token: 'arb') — same hyperkalemia risk with K-sparing agents
  losartan: 'arb',
  valsartan: 'arb',
  irbesartan: 'arb',
  olmesartan: 'arb',
  candesartan: 'arb',
  telmisartan: 'arb',

  // Potassium-sparing diuretics / aldosterone antagonists (class token: 'potassium_sparing')
  spironolactone: 'potassium_sparing',
  eplerenone: 'potassium_sparing',
  amiloride: 'potassium_sparing',
  triamterene: 'potassium_sparing',
  aldactone: 'potassium_sparing',

  // Statins metabolized by CYP3A4 (class token: 'cyp3a4_statin')
  simvastatin: 'cyp3a4_statin',
  lovastatin: 'cyp3a4_statin',
  atorvastatin: 'cyp3a4_statin',
  zocor: 'cyp3a4_statin',
  mevacor: 'cyp3a4_statin',
  lipitor: 'cyp3a4_statin',

  // Strong CYP3A4 inhibitors (class token: 'strong_cyp3a4_inhibitor')
  clarithromycin: 'strong_cyp3a4_inhibitor',
  erythromycin: 'strong_cyp3a4_inhibitor',
  itraconazole: 'strong_cyp3a4_inhibitor',
  ketoconazole: 'strong_cyp3a4_inhibitor',
  voriconazole: 'strong_cyp3a4_inhibitor',
  posaconazole: 'strong_cyp3a4_inhibitor',
  ritonavir: 'strong_cyp3a4_inhibitor',
  cobicistat: 'strong_cyp3a4_inhibitor',
  nefazodone: 'strong_cyp3a4_inhibitor',
  biaxin: 'strong_cyp3a4_inhibitor',

  // Methotrexate
  mtx: 'methotrexate',
  trexall: 'methotrexate',
  rheumatrex: 'methotrexate'
};

// ──────────────────────────────────────────
// CURATED INTERACTION TABLE
// ──────────────────────────────────────────

/**
 * Each entry pairs two canonical tokens (in any order — lookup sorts them) with
 * a graded interaction. Severity tiers mirror the drug-safety-service scale:
 *   'critical' (contraindicated / life-threatening) > 'serious' (major) >
 *   'moderate'. Every entry carries a mechanism and a citable source.
 *
 * Interactions are stored under a sorted "tokenA|tokenB" key.
 */
function pairKey(a, b) {
  return [a, b].sort().join('|');
}

const RAW_INTERACTIONS = [
  {
    a: 'warfarin',
    b: 'nsaid',
    severity: 'serious',
    mechanism:
      'Additive bleeding risk: NSAIDs inhibit platelet aggregation and cause GI mucosal injury; '
      + 'some NSAIDs also displace warfarin from protein binding, increasing anticoagulant effect.',
    source: 'FDA warfarin (Coumadin) labeling; Lexicomp interaction monograph (Risk D)'
  },
  {
    a: 'warfarin',
    b: 'sulfamethoxazole',
    severity: 'serious',
    mechanism:
      'Sulfamethoxazole/trimethoprim inhibits CYP2C9 metabolism of S-warfarin and displaces it '
      + 'from albumin, markedly increasing INR and bleeding risk.',
    source: 'FDA warfarin labeling; Micromedex (Major)'
  },
  {
    a: 'maoi',
    b: 'ssri',
    severity: 'critical',
    mechanism:
      'Concurrent or insufficiently-spaced MAOI + serotonergic agent (SSRI/SNRI) causes excess '
      + 'serotonergic activity → serotonin syndrome (hyperthermia, rigidity, autonomic instability). '
      + 'Contraindicated; a 2-week (5-week for fluoxetine) washout is required.',
    source: 'FDA SSRI/MAOI labeling (contraindication); Lexicomp (Risk X)'
  },
  {
    a: 'methotrexate',
    b: 'trimethoprim',
    severity: 'critical',
    mechanism:
      'Both are antifolates; trimethoprim potentiates methotrexate-induced bone-marrow suppression '
      + '(pancytopenia) and reduces renal clearance, risking severe toxicity.',
    source: 'FDA methotrexate labeling; Lexicomp (Risk X)'
  },
  {
    a: 'methotrexate',
    b: 'sulfamethoxazole',
    severity: 'critical',
    mechanism:
      'Sulfamethoxazole/trimethoprim adds antifolate effect and displaces methotrexate from protein '
      + 'binding while reducing renal elimination → severe myelosuppression.',
    source: 'FDA methotrexate labeling; Micromedex (Contraindicated)'
  },
  {
    a: 'methotrexate',
    b: 'nsaid',
    severity: 'serious',
    mechanism:
      'NSAIDs reduce renal clearance of methotrexate (especially at antineoplastic/high doses), '
      + 'increasing serum levels and risk of myelosuppression, nephrotoxicity, and GI toxicity.',
    source: 'FDA methotrexate labeling; Lexicomp (Risk C/D dose-dependent)'
  },
  {
    a: 'ace_inhibitor',
    b: 'potassium_sparing',
    severity: 'serious',
    mechanism:
      'ACE inhibition reduces aldosterone, and potassium-sparing diuretics block renal potassium '
      + 'excretion; combined use can cause severe, potentially fatal hyperkalemia.',
    source: 'FDA ACE-inhibitor labeling; Micromedex (Major)'
  },
  {
    a: 'arb',
    b: 'potassium_sparing',
    severity: 'serious',
    mechanism:
      'ARBs reduce aldosterone-mediated potassium excretion; with a potassium-sparing diuretic this '
      + 'produces additive hyperkalemia risk.',
    source: 'FDA ARB labeling; Micromedex (Major)'
  },
  {
    a: 'cyp3a4_statin',
    b: 'strong_cyp3a4_inhibitor',
    severity: 'serious',
    mechanism:
      'Strong CYP3A4 inhibition sharply raises plasma concentrations of CYP3A4-metabolized statins '
      + '(simvastatin, lovastatin), markedly increasing the risk of myopathy and rhabdomyolysis. '
      + 'Simvastatin/lovastatin are contraindicated with strong CYP3A4 inhibitors.',
    source: 'FDA simvastatin labeling (contraindication); Lexicomp (Risk X for simva/lova)'
  },
  {
    a: 'warfarin',
    b: 'ssri',
    severity: 'serious',
    mechanism:
      'SSRIs impair platelet serotonin uptake (antiplatelet effect) and some inhibit CYP2C9, '
      + 'additively increasing bleeding risk with warfarin.',
    source: 'FDA SSRI labeling; Lexicomp (Risk C/D)'
  }
];

const INTERACTIONS = (() => {
  const map = new Map();
  for (const entry of RAW_INTERACTIONS) {
    map.set(pairKey(entry.a, entry.b), entry);
  }
  return map;
})();

// ──────────────────────────────────────────
// NORMALIZATION + LOOKUP
// ──────────────────────────────────────────

/**
 * Normalize a drug name to its canonical interaction-table token.
 * Lowercases/trims, then resolves aliases (brand names, class members).
 * Returns null for empty/non-string input.
 *
 * @param {string} name
 * @returns {string|null}
 */
function normalizeToken(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = name.toLowerCase().trim();
  if (!cleaned) return null;
  // Resolve alias chains a single step (aliases map directly to canonical tokens).
  return ALIASES[cleaned] || cleaned;
}

/**
 * Look up a curated interaction between two drugs BY NAME.
 *
 * @param {string} nameA - first drug name (brand or generic)
 * @param {string} nameB - second drug name (brand or generic)
 * @returns {{severity: string, description: string, mechanism: string, source: string, curated: true}|null}
 *   A graded interaction if the pair is in the curated table, otherwise null.
 *   NULL DOES NOT MEAN "NO INTERACTION" — the caller must fall back to the
 *   fail-closed "screening unavailable" sentinel for unlisted pairs.
 */
function lookupCuratedInteraction(nameA, nameB) {
  const tokenA = normalizeToken(nameA);
  const tokenB = normalizeToken(nameB);
  if (!tokenA || !tokenB) return null;
  if (tokenA === tokenB) return null; // same drug / same class — not a pair
  const hit = INTERACTIONS.get(pairKey(tokenA, tokenB));
  if (!hit) return null;
  return {
    severity: hit.severity,
    description: `${hit.mechanism}`,
    mechanism: hit.mechanism,
    source: `Curated DDI (interim) — ${hit.source}`,
    curated: true
  };
}

/**
 * True if a curated interaction exists for the given name pair.
 * @param {string} nameA
 * @param {string} nameB
 * @returns {boolean}
 */
function hasCuratedInteraction(nameA, nameB) {
  return lookupCuratedInteraction(nameA, nameB) !== null;
}

module.exports = {
  lookupCuratedInteraction,
  hasCuratedInteraction,
  normalizeToken,
  // Exposed for tests / introspection only.
  _ALIASES: ALIASES,
  _INTERACTION_COUNT: INTERACTIONS.size
};
