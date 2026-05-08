/**
 * Peptide Therapy — Rule Definitions
 *
 * Mirrors the shape of hrt-rules.js. All dose-changing rules carry
 * `requiresDosingApproval: true` so the Domain Logic Agent routes them
 * through the Tier 3 physician approval gate.
 *
 * v1 SCOPE:
 *   - GLP-1 receptor agonists (semaglutide, tirzepatide) — FDA-approved for
 *     T2DM / weight management. Dosing rules follow package inserts and
 *     STEP / SURMOUNT trial titration schedules.
 *   - Growth-hormone secretagogues (sermorelin, ipamorelin) — non-FDA compounded.
 *     Rules are educational / titration-support only and carry the
 *     `educational_only: true` flag.
 *   - BPC-157 — research compound, not FDA-approved. Educational rules only.
 *
 * SAFETY CONTRACT:
 *   - Every rule MUST have a non-empty `evidence_source`.
 *   - Compounded / non-FDA peptides MUST carry `educational_only: true` to
 *     signal the frontend to show stronger disclaimers.
 */

const PEPTIDE_RULES = [
  // ==========================================
  // GLP-1 RECEPTOR AGONISTS — SEMAGLUTIDE
  // ==========================================
  {
    id: 'pep-sema-t2dm-init',
    rule_name: 'Semaglutide Initiation — Type 2 Diabetes',
    rule_type: 'peptide_initiation',
    category: 'glp1_t2dm',
    priority: 25,
    trigger_condition: {
      pregnancy_gate: { required: true, reproductive_age_max: 55, lmp_required: true },
      problems_any: ['type 2 diabetes', 'T2DM', 'E11'],
      lab: { code: 'hba1c', operator: '>=', value: 7.0, unit: '%' },
      contraindications_none: ['medullary thyroid carcinoma', 'MEN-2', 'history of pancreatitis', 'pregnancy']
    },
    suggested_actions: {
      title: 'Consider Semaglutide (Ozempic) for T2DM',
      description: 'T2DM with A1C ≥7.0% and no contraindications. Semaglutide has demonstrated A1C reduction, weight loss, and CV benefit in T2DM. Standard titration: 0.25 mg weekly x 4 weeks → 0.5 mg weekly x 4 weeks → 1.0 mg weekly. Max 2.0 mg weekly.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Semaglutide (Ozempic)',
            currentDose: null,
            proposedDose: '0.25 mg SQ weekly',
            route: 'SQ',
            frequency: 'weekly',
            rationale: 'T2DM with A1C ≥7.0% — initiate at lowest dose for GI tolerance, titrate q4 weeks'
          }
        },
        { type: 'patient_counseling', payload: { topics: ['GI side effects (nausea, vomiting, constipation)', 'Hypoglycemia risk if on sulfonylurea or insulin', 'Injection technique', 'Report severe abdominal pain (pancreatitis)'] } }
      ]
    },
    evidence_source: 'SUSTAIN trials; ADA Standards of Care 2025: GLP-1 RA recommended as part of glucose-lowering therapy with demonstrated CV benefit in T2DM. Ozempic/Wegovy labeling requires pregnancy-risk counseling and semaglutide discontinuation before planned pregnancy or when pregnancy is recognized.'
  },
  {
    id: 'pep-sema-titrate-up',
    rule_name: 'Semaglutide Titration — A1C Not at Goal',
    rule_type: 'peptide_titration',
    category: 'glp1_t2dm',
    priority: 30,
    trigger_condition: {
      pregnancy_gate: { required: true, reproductive_age_max: 55, lmp_required: true },
      on_medication: 'semaglutide',
      lab: { code: 'hba1c', operator: '>=', value: 7.0, unit: '%' },
      weeks_on_current_dose: { operator: '>=', value: 4 },
      tolerating_current: true
    },
    suggested_actions: {
      title: 'Semaglutide Titration — Advance to Next Dose',
      description: 'A1C above goal after ≥4 weeks on current dose with good tolerance. Advance to next titration step (0.25 → 0.5 → 1.0 → 1.7 → 2.0 mg weekly).',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Semaglutide',
            currentDose: '{{currentDose}}',
            proposedDose: '{{nextTitrationStep}}',
            route: 'SQ',
            frequency: 'weekly',
            rationale: 'A1C above target with adequate trial of current dose and good tolerability'
          }
        }
      ]
    },
    evidence_source: 'Semaglutide package insert (Ozempic, Novo Nordisk); SUSTAIN trial protocols: titrate q4 weeks if tolerated. Pregnancy gate requires documented non-pregnant status and LMP before reproductive-risk dose escalation.'
  },
  {
    id: 'pep-sema-gi-intolerance',
    rule_name: 'GLP-1 GI Intolerance — Hold or Reduce',
    rule_type: 'peptide_titration',
    category: 'glp1_safety',
    priority: 10,
    trigger_condition: {
      on_medication: 'semaglutide',
      symptoms_any: ['severe nausea', 'persistent vomiting', 'severe abdominal pain', 'unable to tolerate PO']
    },
    suggested_actions: {
      title: 'GLP-1 Intolerance — Assess and Hold if Severe',
      description: 'Severe GI symptoms on GLP-1. Rule out pancreatitis (lipase, CT if indicated). Hold dose until symptoms resolve, then resume at previous tolerated dose (not advance).',
      actions: [
        { type: 'hold_medication', payload: { medication: 'Semaglutide', reason: 'GI intolerance' } },
        { type: 'recommend_lab', payload: { test_name: 'Lipase', indication: 'Rule out pancreatitis' } }
      ],
      blocksRuleTypes: ['peptide_titration']
    },
    evidence_source: 'Semaglutide package insert black box warnings; ADA Standards of Care 2025.'
  },
  {
    id: 'pep-mtc-contraindication',
    rule_name: 'GLP-1 Contraindication — MTC/MEN-2',
    rule_type: 'peptide_safety',
    category: 'interaction',
    priority: 5,
    trigger_condition: {
      problems_any: ['medullary thyroid carcinoma', 'MTC', 'MEN-2', 'multiple endocrine neoplasia 2']
    },
    suggested_actions: {
      title: 'STOP: GLP-1 Contraindicated (Personal/Family Hx MTC or MEN-2)',
      description: 'GLP-1 receptor agonists carry a boxed warning for risk of thyroid C-cell tumors. Personal or family history of MTC or MEN-2 is an absolute contraindication.',
      actions: [{ type: 'abort_recommendation', payload: { reason: 'mtc_contraindication' } }],
      blocksRuleTypes: ['peptide_initiation', 'peptide_titration']
    },
    evidence_source: 'Semaglutide package insert boxed warning (Ozempic, Wegovy); tirzepatide package insert (Mounjaro, Zepbound).'
  },

  // ==========================================
  // GLP-1 — TIRZEPATIDE (SURMOUNT / SURPASS)
  // ==========================================
  {
    id: 'pep-tirz-obesity-init',
    rule_name: 'Tirzepatide for Weight Management',
    rule_type: 'peptide_initiation',
    category: 'glp1_weight',
    priority: 30,
    trigger_condition: {
      pregnancy_gate: { required: true, reproductive_age_max: 55, lmp_required: true },
      bmi_min: 30,
      contraindications_none: ['medullary thyroid carcinoma', 'MEN-2', 'history of pancreatitis', 'pregnancy']
    },
    suggested_actions: {
      title: 'Consider Tirzepatide (Zepbound) for Weight Management',
      description: 'BMI ≥30 (or ≥27 with weight-related comorbidity), no contraindications. Tirzepatide demonstrated greater weight reduction than semaglutide in head-to-head data. Standard titration: 2.5 mg x 4 weeks → 5 mg maintenance, advancing in 2.5 mg increments as needed up to 15 mg weekly.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Tirzepatide (Zepbound)',
            currentDose: null,
            proposedDose: '2.5 mg SQ weekly',
            route: 'SQ',
            frequency: 'weekly',
            rationale: 'Obesity/overweight with comorbidity, no contraindications — initiate per SURMOUNT titration schedule'
          }
        }
      ]
    },
    evidence_source: 'SURMOUNT-1, SURMOUNT-2 trials (NEJM 2022, 2023); tirzepatide package insert (Zepbound, Eli Lilly): discontinue Zepbound when pregnancy is recognized; pregnancy gate requires documented non-pregnant status and LMP before reproductive-risk initiation.'
  },

  // ==========================================
  // GROWTH HORMONE SECRETAGOGUES (EDUCATIONAL ONLY)
  // ==========================================
  {
    id: 'pep-sermorelin-igf1-context',
    rule_name: 'Sermorelin — Context Note',
    rule_type: 'peptide_context',
    category: 'gh_peptides',
    priority: 50,
    educational_only: true,
    trigger_condition: {
      on_medication: 'sermorelin'
    },
    suggested_actions: {
      title: 'Sermorelin Monitoring (Educational)',
      description: 'Sermorelin is a compounded growth-hormone-releasing hormone analog. Not FDA-approved for anti-aging or performance use. If being used, monitor IGF-1 quarterly and stay below upper limit of age-adjusted reference range. Physician retains full discretion — no auto-titration recommendation.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'IGF-1', indication: 'Sermorelin monitoring' } }
      ]
    },
    evidence_source: 'FDA-unapproved compounded peptide; clinician experience and endocrine literature on GH axis. No guideline-level evidence for long-term use in adults without documented GH deficiency.'
  },

  // ==========================================
  // BPC-157 (EDUCATIONAL ONLY — RESEARCH PEPTIDE)
  // ==========================================
  {
    id: 'pep-bpc157-note',
    rule_name: 'BPC-157 — Research Compound Note',
    rule_type: 'peptide_context',
    category: 'research_peptides',
    priority: 55,
    educational_only: true,
    trigger_condition: {
      on_medication: 'bpc-157'
    },
    suggested_actions: {
      title: 'BPC-157 Research Status Note',
      description: 'BPC-157 is a research peptide. No FDA approval, no established dosing, no long-term human safety data. This system does not generate dosing recommendations for BPC-157. Document patient use for safety/context only.',
      actions: []
    },
    evidence_source: 'FDA has not approved BPC-157 for any indication; evidence is limited to preclinical and small-scale studies. Listed for context and documentation only.'
  }
];

module.exports = { PEPTIDE_RULES };
