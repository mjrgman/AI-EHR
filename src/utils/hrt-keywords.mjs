/**
 * HRT / Peptide keyword match — pure functions.
 *
 * Phase 3a: extracted from `src/components/encounter/HRTPanel.jsx` so that
 *   (a) the logic can be unit-tested without mounting a React component, and
 *   (b) Phase 3b's client-side voice routing (`useHRTKeywords`) can share one
 *       source of truth with the panel filter instead of duplicating the list.
 *
 * Shape mirrors the server-side `DOMAIN_KEYWORDS` map in
 * `server/agents/domain-logic-agent.js`. The two lists MUST stay in sync:
 * the server uses its copy to route transcripts to the Domain Logic agent,
 * and the client uses this copy to surface the resulting suggestions in the
 * HRT tab. Drift between them = the agent fires but the UI goes blind.
 *
 * Matching contract:
 *   - All keywords are lowercase (enforced by a unit test).
 *   - `isHRTRelevant` lowercases the concatenated hay ONCE and does a single
 *     substring scan per keyword — this is cheap enough to run on every
 *     CDS suggestion render without memoization.
 *   - A missing/empty/null suggestion returns false (no hay to match).
 *
 * v1 scope (per plan): testosterone + estradiol + GLP-1. Growth-hormone and
 * healing peptides are included as well so the tab covers the full rule set
 * the Domain Logic agent actually emits.
 */

// Keep lowercase and minimal — every entry is tested against every suggestion.
export const HRT_KEYWORDS = [
  // Male HRT
  'testosterone', 'trt', 'hypogonadism', 'low t', 'androgel',
  // Female HRT
  'estradiol', 'estrogen', 'progesterone', 'menopause', 'hot flashes',
  'hormone replacement', 'hrt', 'vasomotor',
  // GLP-1 / weight-management peptides
  'semaglutide', 'tirzepatide', 'ozempic', 'mounjaro', 'wegovy', 'glp-1',
  // Growth hormone peptides (research-only / educational)
  'sermorelin', 'ipamorelin', 'bpc-157', 'bpc157',
  // Functional-medicine adjacent
  'dhea', 'thyroid', 'hashimoto', 'tsh', 'peptide',
];

/**
 * Return true if a CDS/Domain-Logic suggestion looks HRT/peptide-related.
 *
 * @param {object|null|undefined} suggestion — shape:
 *   { title?, description?, rule_type?, category?, suggestion_type? }
 * @returns {boolean}
 */
export function isHRTRelevant(suggestion) {
  if (!suggestion) return false;
  const hay = [
    suggestion.title,
    suggestion.description,
    suggestion.rule_type,
    suggestion.category,
    suggestion.suggestion_type,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return false;
  return HRT_KEYWORDS.some((kw) => hay.includes(kw));
}

/**
 * Category → keyword map for voice-routing the encounter transcript to the
 * HRT/Peptide tab. MUST stay in byte-for-byte parity with the server's
 * `DOMAIN_KEYWORDS` in `server/agents/domain-logic-agent.js` — a parity test
 * in `test/run-tests.js` enforces this. Drift = server routes to the Domain
 * Logic agent but the client UI never focuses the HRT tab.
 *
 * Note on relationship to `HRT_KEYWORDS`: the flat `HRT_KEYWORDS` list above
 * is broader (includes dhea, thyroid, tsh, peptide, etc.) and is used for
 * filtering CDS suggestions into the HRT tab. `DOMAIN_KEYWORDS` is narrower
 * and categorized — it drives voice routing decisions where we need to know
 * WHICH domain matched, not just whether something matched.
 */
export const DOMAIN_KEYWORDS = {
  hrt_male: ['testosterone', 'trt', 'hypogonadism', 'low t', 'androgel'],
  hrt_female: ['estradiol', 'estrogen', 'progesterone', 'menopause', 'hormone replacement', 'hrt', 'vasomotor', 'hot flashes'],
  glp1: ['semaglutide', 'ozempic', 'wegovy', 'tirzepatide', 'mounjaro', 'zepbound', 'glp-1', 'glp1', 'weight loss injection'],
  gh_peptides: ['sermorelin', 'ipamorelin', 'cjc-1295', 'tesamorelin', 'growth hormone peptide'],
  research_peptides: ['bpc-157', 'bpc157', 'tb-500', 'research peptide'],
  functional_med: ['functional medicine', 'adrenal fatigue', 'methylation', 'mthfr', 'leaky gut', 'mitochondrial', 'hpa axis', 'hashimoto']
};

/**
 * Detect which HRT/peptide/functional-med categories a block of text mentions.
 * Mirrors the server's `DomainLogicAgent._classifyDomain` exactly so the
 * client-side voice router makes the same routing decision the server will.
 *
 * @param {string|null|undefined} text — encounter transcript or note fragment
 * @returns {Array<string>} category keys from DOMAIN_KEYWORDS that matched
 */
export function detectHRTCategories(text) {
  if (!text) return [];
  const lowered = String(text).toLowerCase();
  const matches = [];
  for (const [category, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((k) => lowered.includes(k))) matches.push(category);
  }
  return matches;
}
