#!/usr/bin/env node
/**
 * Build the clinical rule provenance register.
 *
 * Extracts every clinical rule the system can fire, together with whatever
 * source attribution it actually carries, and writes docs/CLINICAL_RULE_REGISTER.md.
 *
 * This script reports. It does not invent provenance: a field the code does
 * not carry is emitted as MISSING, not guessed. Regenerate with:
 *
 *   node scripts/build-clinical-rule-register.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'CLINICAL_RULE_REGISTER.md');

// Fields the review process requires for every activatable clinical rule.
const REQUIRED_FIELDS = [
  'source_title', 'issuing_authority', 'source_version', 'publication_date',
  'source_url', 'target_population', 'exclusions', 'evidence_strength',
  'last_reviewed', 'physician_approved',
];

/** A source string is "structured" only if it is an object carrying the fields. */
function auditProvenance(evidenceSource) {
  if (evidenceSource && typeof evidenceSource === 'object') {
    return REQUIRED_FIELDS.filter((f) => !evidenceSource[f]);
  }
  // A free-text string can at best imply authority + year. Everything else is absent.
  return REQUIRED_FIELDS.filter((f) => f !== 'source_title');
}

/** Pull a year out of a citation string, if one is stated at all. */
function statedYear(text) {
  const years = String(text).match(/\b(19|20)\d{2}\b/g);
  return years ? Math.max(...years.map(Number)) : null;
}

const rows = [];

function addRow(row) {
  const missing = auditProvenance(row.evidence_source);
  const year = statedYear(row.evidence_source || '');
  rows.push({ ...row, missing, year });
}

// ---------------------------------------------------------------------------
// 1. Domain rules (HRT / peptide / functional medicine) -- structured modules
// ---------------------------------------------------------------------------
const DOMAIN_SETS = [
  ['hrt-rules.js', 'HRT', require('../server/domain/rules/hrt-rules').HRT_RULES],
  ['peptide-rules.js', 'Peptide', require('../server/domain/rules/peptide-rules').PEPTIDE_RULES],
  ['functional-med-rules.js', 'Functional medicine', require('../server/domain/rules/functional-med-rules').FUNCTIONAL_MED_RULES],
];

for (const [file, surface, ruleSet] of DOMAIN_SETS) {
  for (const rule of ruleSet || []) {
    const actions = (rule.suggested_actions && rule.suggested_actions.actions) || [];
    addRow({
      surface,
      file: `server/domain/rules/${file}`,
      id: rule.id,
      name: rule.rule_name,
      evidence_source: rule.evidence_source,
      educational_only: rule.educational_only === true,
      emits_dosing: actions.some((a) => ['dose_adjustment', 'prescribe', 'start_medication', 'titrate'].includes(a.type)),
      gated: actions.some((a) => a.requiresDosingApproval === true),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. CDS rules seeded into the database -- parsed from the seed source
// ---------------------------------------------------------------------------
const dbSrc = fs.readFileSync(path.join(ROOT, 'server', 'database.js'), 'utf8');

// Split on rule_name boundaries rather than matching within a fixed window --
// a fixed window silently dropped the 7 longest rule objects, which is exactly
// the kind of undercount this register exists to prevent.
const cdsBlocks = dbSrc
  .split(/(?=rule_name:\s*')/)
  .filter((chunk) => /^rule_name:\s*'/.test(chunk) && /evidence_source:\s*'/.test(chunk));

const declaredRuleNames = (dbSrc.match(/rule_name:\s*'/g) || []).length;
if (cdsBlocks.length !== declaredRuleNames) {
  console.warn(
    `[register] WARNING: parsed ${cdsBlocks.length} CDS rules but database.js declares ` +
    `${declaredRuleNames} rule_name keys. The register is INCOMPLETE.`
  );
}

for (const block of cdsBlocks) {
  const name = (block.match(/rule_name:\s*'([^']*)'/) || [])[1];
  const src = (block.match(/evidence_source:\s*'([^']*)'/) || [])[1];
  addRow({
    surface: 'CDS (DB-seeded)',
    file: 'server/database.js',
    id: '(no stable id -- seeded row)',
    name,
    evidence_source: src,
    educational_only: false,
    emits_dosing: false,
    gated: false,
  });
}

// ---------------------------------------------------------------------------
// 3. Seed files that DO carry structured _meta
// ---------------------------------------------------------------------------
const SEEDS = [
  ['USPSTF', 'server/seed/uspstf_recommendations_seed.json', 'recommendations'],
  ['HCC v28', 'server/seed/hcc_v28_seed.json', null],
];
const seedMeta = [];
for (const [label, rel, listKey] of SEEDS) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const meta = data._meta || {};
  const count = listKey && Array.isArray(data[listKey]) ? data[listKey].length : null;
  seedMeta.push({ label, rel, meta, count });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const bySurface = rows.reduce((acc, r) => {
  (acc[r.surface] = acc[r.surface] || []).push(r);
  return acc;
}, {});

const CURRENT_YEAR = 2026;
const STALE_AFTER_YEARS = 3;

const out = [];
out.push('# Clinical Rule Provenance Register');
out.push('');
out.push('> **Generated by `scripts/build-clinical-rule-register.js`. Do not hand-edit.**');
out.push('> Regenerate after any rule change.');
out.push('');
out.push('This register exists to answer one question for each clinical rule the system');
out.push('can fire: **on whose authority, from what document, of what vintage?**');
out.push('');
out.push('It reports what the code carries. Where a field is absent it says MISSING; it');
out.push('does not guess. **No rule in this register has a recorded physician approval,**');
out.push('so by the standing rule none should be treated as activated clinical guidance.');
out.push('');
out.push(`Rules catalogued: **${rows.length}**`);
out.push('');

out.push('## Summary');
out.push('');
out.push('| Surface | Rules | Any citation | Structured provenance | Emits dosing |');
out.push('|---|---:|---:|---:|---:|');
for (const [surface, list] of Object.entries(bySurface)) {
  const cited = list.filter((r) => r.evidence_source && String(r.evidence_source).trim()).length;
  const structured = list.filter((r) => r.missing.length === 0).length;
  const dosing = list.filter((r) => r.emits_dosing).length;
  out.push(`| ${surface} | ${list.length} | ${cited} | ${structured} | ${dosing} |`);
}
out.push('');

out.push('## The gap, stated plainly');
out.push('');
out.push('Every field below is required before a rule may be activated. The count is');
out.push('how many of the ' + rows.length + ' rules are missing it.');
out.push('');
out.push('| Required field | Rules missing it |');
out.push('|---|---:|');
for (const field of REQUIRED_FIELDS) {
  out.push(`| \`${field}\` | ${rows.filter((r) => r.missing.includes(field)).length} |`);
}
out.push('');
out.push('`evidence_source` is a free-text string everywhere. It often names a real');
out.push('guideline and sometimes a year, which is genuinely useful for a reviewer, but');
out.push('it is not machine-checkable and carries no URL, no population, no exclusions,');
out.push('no evidence grade, and no review date.');
out.push('');

out.push('## Citations that state a year older than ' + STALE_AFTER_YEARS + ' years');
out.push('');
out.push('Age alone does not make a guideline wrong -- some stand for a decade. These are');
out.push('the ones a reviewer should check first for a newer edition.');
out.push('');
out.push('| Year | Surface | Rule | Cited source |');
out.push('|---:|---|---|---|');
const aging = rows
  .filter((r) => r.year && (CURRENT_YEAR - r.year) > STALE_AFTER_YEARS)
  .sort((a, b) => a.year - b.year);
for (const r of aging) {
  const src = String(r.evidence_source).replace(/\|/g, '\\|').slice(0, 90);
  out.push(`| ${r.year} | ${r.surface} | ${r.name} | ${src} |`);
}
out.push('');
const undated = rows.filter((r) => !r.year && r.evidence_source);
out.push(`**${undated.length} rules cite a source with no year at all**, which is worse than an old year --`);
out.push('there is no way to tell which edition was used.');
out.push('');

out.push('## Seed files with structured provenance');
out.push('');
out.push('These are the exception and the model to follow: they carry a `_meta` block.');
out.push('');
for (const s of seedMeta) {
  out.push(`### ${s.label} — \`${s.rel}\``);
  out.push('');
  if (s.count !== null) out.push(`- entries: **${s.count}**`);
  for (const [k, v] of Object.entries(s.meta)) {
    if (Array.isArray(v)) continue;
    out.push(`- \`${k}\`: ${String(v).slice(0, 200)}`);
  }
  out.push('');
}

out.push('## Full register');
out.push('');
for (const [surface, list] of Object.entries(bySurface)) {
  out.push(`### ${surface}`);
  out.push('');
  out.push('| Rule | Cited source | Yr | Dosing | Gated | Edu-only |');
  out.push('|---|---|---:|:---:|:---:|:---:|');
  for (const r of list) {
    const src = r.evidence_source
      ? String(r.evidence_source).replace(/\|/g, '\\|').slice(0, 110)
      : '**MISSING**';
    out.push([
      '',
      r.name || r.id,
      src,
      r.year || '—',
      r.emits_dosing ? 'yes' : '—',
      r.gated ? 'yes' : '—',
      r.educational_only ? 'yes' : '—',
      '',
    ].join(' | ').trim());
  }
  out.push('');
}

out.push('## What a reviewer must do before any rule is activated');
out.push('');
out.push('1. For each rule, locate the current primary source and record all ten required');
out.push('   fields. Primary sources only -- the issuing body\'s own document, not a');
out.push('   summary, blog, or secondary reference.');
out.push('2. Separate what the source actually says from local policy and implementation');
out.push('   assumptions. Thresholds chosen for convenience are not guideline content and');
out.push('   must be labelled as local policy.');
out.push('3. Record a named physician\'s approval, with a date, per rule.');
out.push('4. Only then flip the rule to active.');
out.push('');
out.push('Until step 3 is recorded, treat every rule here as draft.');
out.push('');

fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${rows.length} rules catalogued across ${Object.keys(bySurface).length} surfaces`);
console.log(`  ${rows.filter((r) => r.missing.length === 0).length} with complete structured provenance`);
console.log(`  ${aging.length} citing a source older than ${STALE_AFTER_YEARS} years`);
console.log(`  ${undated.length} citing a source with no year`);
