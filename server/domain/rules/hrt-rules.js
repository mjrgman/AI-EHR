/**
 * Hormone Replacement Therapy (HRT) — Rule Definitions
 *
 * Each rule mirrors the `cds_rules` table shape so the Domain Logic engine
 * can use the same evaluation primitives as the CDS engine:
 *   { id, rule_name, rule_type, trigger_condition, suggested_actions,
 *     priority, evidence_source, category }
 *
 * SAFETY CONTRACT (enforced by knowledge-base.js at load time):
 *   - Every rule MUST have a non-empty `evidence_source` string.
 *   - Every dose-change rule MUST set `requiresDosingApproval: true` on its
 *     suggested action so the Domain Logic Agent routes it through
 *     `requestDosingApproval()` → physician Tier 3 gate.
 *   - Rules that flag drug interactions (category: 'interaction') are evaluated
 *     BEFORE any dosing rule and short-circuit the recommendation.
 *
 * v1 SCOPE: testosterone, estradiol, progesterone.
 */

const HRT_RULES = [
  // ==========================================
  // TESTOSTERONE — MALE HRT
  // ==========================================
  {
    id: 'hrt-tt-low-male',
    rule_name: 'Low Total Testosterone — Male',
    rule_type: 'hormone_lab_alert',
    category: 'hrt_male',
    priority: 20,
    trigger_condition: {
      sex: 'M',
      lab: { code: 'total_testosterone', operator: '<', value: 300, unit: 'ng/dL' }
    },
    suggested_actions: {
      title: 'Low Total Testosterone Confirmed',
      description: 'Total testosterone below 300 ng/dL on confirmation. Consider symptomatic correlation (fatigue, low libido, decreased muscle mass, depressed mood) and workup for secondary causes before initiating therapy.',
      actions: [
        { type: 'recommend_lab', payload: { test_name: 'Total Testosterone (repeat, AM fasting)', indication: 'Confirm low T' } },
        { type: 'recommend_lab', payload: { test_name: 'Free Testosterone', indication: 'Distinguish SHBG effects' } },
        { type: 'recommend_lab', payload: { test_name: 'LH, FSH', indication: 'Primary vs secondary hypogonadism' } },
        { type: 'recommend_lab', payload: { test_name: 'Prolactin', indication: 'Rule out pituitary cause' } },
        { type: 'recommend_lab', payload: { test_name: 'PSA', indication: 'Baseline before TRT' } },
        { type: 'recommend_lab', payload: { test_name: 'CBC', indication: 'Baseline hematocrit before TRT' } }
      ]
    },
    evidence_source: 'Endocrine Society Clinical Practice Guideline 2018: Testosterone Therapy in Men with Hypogonadism; AUA 2018 Guideline on the Evaluation and Management of Testosterone Deficiency.'
  },
  {
    id: 'hrt-tt-init-male',
    rule_name: 'Consider Testosterone Initiation — Symptomatic Male with Confirmed Low T',
    rule_type: 'hrt_initiation',
    category: 'hrt_male',
    priority: 25,
    trigger_condition: {
      sex: 'M',
      lab: { code: 'total_testosterone', operator: '<', value: 300, unit: 'ng/dL', confirmed: true },
      symptoms_any: ['fatigue', 'low libido', 'erectile dysfunction', 'depressed mood', 'decreased muscle mass']
    },
    suggested_actions: {
      title: 'Consider Testosterone Replacement Therapy',
      description: 'Symptomatic male with confirmed low total testosterone. Baseline hematocrit and PSA obtained. Standard initiation: testosterone cypionate 100 mg IM weekly OR 200 mg IM every 2 weeks. Begin at low end and titrate based on trough level (aim 400–700 ng/dL) and symptom response at 8–12 weeks.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Testosterone cypionate',
            currentDose: null,
            proposedDose: '100 mg IM weekly',
            route: 'IM',
            frequency: 'weekly',
            rationale: 'Symptomatic hypogonadism with confirmed total T < 300 ng/dL and baseline labs within normal limits'
          }
        }
      ]
    },
    evidence_source: 'Endocrine Society 2018 CPG: Initiation criteria and dosing for testosterone therapy in symptomatic men with confirmed hypogonadism.'
  },
  {
    id: 'hrt-tt-titrate-low-male',
    rule_name: 'Testosterone Trough Below Target — Titrate Up',
    rule_type: 'hrt_titration',
    category: 'hrt_male',
    priority: 30,
    trigger_condition: {
      sex: 'M',
      on_medication: 'testosterone',
      lab: { code: 'total_testosterone', operator: '<', value: 400, unit: 'ng/dL', timing: 'trough' }
    },
    suggested_actions: {
      title: 'Testosterone Trough Below Target — Consider Dose Increase',
      description: 'Trough total testosterone below 400 ng/dL while on therapy. Assess symptom control and, if symptomatic, consider dose increase (typical increment: 20% or 20 mg for IM cypionate). Recheck hematocrit and PSA at steady state.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Testosterone cypionate',
            currentDose: 'current documented testosterone dose',
            proposedDose: 'clinician-calculated incremental increase, typically 20 mg weekly or 20%',
            route: 'IM',
            frequency: 'weekly',
            rationale: 'Trough T < 400 ng/dL with persistent symptoms'
          }
        },
        { type: 'recommend_lab', payload: { test_name: 'CBC (hematocrit)', indication: 'Monitor for erythrocytosis' } }
      ]
    },
    evidence_source: 'Endocrine Society 2018 CPG: Trough target for injectable testosterone is typically 400–700 ng/dL; dose adjustments should be made incrementally with labs 4–6 weeks after change.'
  },
  {
    id: 'hrt-tt-hct-high',
    rule_name: 'Erythrocytosis on Testosterone — Urgent',
    rule_type: 'hrt_safety',
    category: 'interaction', // Evaluated FIRST — short-circuits dose increases
    priority: 5,
    trigger_condition: {
      on_medication: 'testosterone',
      lab: { code: 'hematocrit', operator: '>=', value: 54, unit: '%' }
    },
    suggested_actions: {
      title: 'STOP: Hematocrit ≥ 54% on Testosterone',
      description: 'Erythrocytosis on testosterone therapy. Guideline recommends holding therapy until hematocrit <50% and investigating causes (sleep apnea, dose, delivery method). Do NOT increase dose.',
      actions: [
        { type: 'hold_medication', payload: { medication: 'Testosterone cypionate', reason: 'Hct ≥ 54%' } },
        { type: 'recommend_lab', payload: { test_name: 'Hematocrit (repeat in 2 weeks)', indication: 'Confirm resolution before restart' } },
        { type: 'recommend_workup', payload: { workup: 'Sleep apnea screening', indication: 'Common potentiator of erythrocytosis on TRT' } }
      ],
      blocksRuleTypes: ['hrt_titration', 'hrt_initiation']
    },
    evidence_source: 'Endocrine Society 2018 CPG: Discontinue testosterone if hematocrit >54%; re-evaluate and consider alternate formulations after resolution.'
  },
  {
    id: 'hrt-tt-psa-rise',
    rule_name: 'Significant PSA Rise on Testosterone',
    rule_type: 'hrt_safety',
    category: 'interaction',
    priority: 5,
    trigger_condition: {
      on_medication: 'testosterone',
      lab: { code: 'psa_delta', operator: '>=', value: 1.4, unit: 'ng/mL', interval_months: 12 }
    },
    suggested_actions: {
      title: 'STOP: PSA Rise ≥ 1.4 ng/mL in 12 Months on TRT',
      description: 'PSA increased by ≥ 1.4 ng/mL within 12 months of TRT initiation or any rise to >4.0 ng/mL. Urology referral indicated before any further TRT management.',
      actions: [
        { type: 'hold_medication', payload: { medication: 'Testosterone cypionate', reason: 'PSA rise exceeds threshold' } },
        { type: 'recommend_referral', payload: { specialty: 'Urology', urgency: 'soon' } }
      ],
      blocksRuleTypes: ['hrt_titration', 'hrt_initiation']
    },
    evidence_source: 'Endocrine Society 2018 CPG; AUA 2018 Guideline: PSA rise >1.4 ng/mL within 12 months warrants urologic evaluation before continuing TRT.'
  },

  // ==========================================
  // ESTRADIOL — FEMALE HRT
  // ==========================================
  {
    id: 'hrt-e2-menopausal-vasomotor',
    rule_name: 'Vasomotor Symptoms — Menopausal Female',
    rule_type: 'hrt_initiation',
    category: 'hrt_female',
    priority: 25,
    trigger_condition: {
      sex: 'F',
      age_min: 45,
      symptoms_any: ['hot flashes', 'night sweats', 'vasomotor', 'sleep disturbance (menopausal)'],
      contraindications_none: ['breast cancer history', 'estrogen-dependent cancer', 'dvt/pe history', 'active liver disease', 'unexplained vaginal bleeding']
    },
    suggested_actions: {
      title: 'Consider Estradiol for Menopausal Vasomotor Symptoms',
      description: 'Perimenopausal/postmenopausal female with significant vasomotor symptoms, no contraindications. Transdermal estradiol preferred (lower VTE risk vs oral). Typical start: estradiol patch 0.0375 mg/day or 0.05 mg/day. If intact uterus, add progestogen for endometrial protection.',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Estradiol transdermal patch',
            currentDose: null,
            proposedDose: '0.05 mg/day',
            route: 'transdermal',
            frequency: 'twice weekly',
            rationale: 'Moderate-to-severe vasomotor symptoms, no contraindications, transdermal preferred for safety profile'
          }
        },
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          conditional: 'if_intact_uterus',
          payload: {
            medication: 'Micronized progesterone',
            currentDose: null,
            proposedDose: '100 mg',
            route: 'oral',
            frequency: 'nightly',
            rationale: 'Endometrial protection required for estradiol therapy with intact uterus'
          }
        }
      ]
    },
    evidence_source: 'NAMS 2022 Position Statement on Hormone Therapy; ACOG Committee Opinion 2020: Transdermal estradiol preferred; progestogen required if intact uterus.'
  },
  {
    id: 'hrt-e2-contraindicated',
    rule_name: 'Estrogen Therapy Contraindications',
    rule_type: 'hrt_safety',
    category: 'interaction',
    priority: 5,
    trigger_condition: {
      sex: 'F',
      problems_any: ['breast cancer history', 'estrogen-dependent cancer', 'dvt/pe history', 'active liver disease', 'unexplained vaginal bleeding', 'known CHD', 'stroke history']
    },
    suggested_actions: {
      title: 'STOP: Estrogen Therapy Contraindicated',
      description: 'Patient has an absolute or strong relative contraindication to systemic estrogen. Do NOT initiate HRT. Consider non-hormonal options for vasomotor symptoms (SSRI/SNRI, gabapentin, cognitive behavioral therapy).',
      actions: [
        { type: 'abort_recommendation', payload: { reason: 'contraindication' } },
        { type: 'recommend_alternative', payload: { options: ['paroxetine 7.5 mg', 'venlafaxine 37.5 mg XR', 'gabapentin 300-900 mg qhs', 'cognitive behavioral therapy'] } }
      ],
      blocksRuleTypes: ['hrt_initiation', 'hrt_titration']
    },
    evidence_source: 'NAMS 2022 Position Statement: Absolute contraindications include hormone-sensitive cancer, active VTE, active liver disease, unexplained vaginal bleeding; CHD and stroke history are strong relative contraindications.'
  },
  {
    id: 'hrt-progesterone-endometrial',
    rule_name: 'Unopposed Estrogen in Intact Uterus',
    rule_type: 'hrt_safety',
    category: 'interaction',
    priority: 5,
    trigger_condition: {
      sex: 'F',
      on_medication: 'estradiol',
      has_uterus: true,
      not_on_medication: 'progesterone'
    },
    suggested_actions: {
      title: 'STOP: Unopposed Estrogen with Intact Uterus',
      description: 'Patient on systemic estradiol with intact uterus but no progestogen. Unopposed estrogen significantly increases endometrial hyperplasia and cancer risk. Add micronized progesterone 100 mg nightly (continuous) or 200 mg for 12 days/month (cyclic).',
      actions: [
        {
          type: 'dose_adjustment',
          requiresDosingApproval: true,
          payload: {
            medication: 'Micronized progesterone',
            currentDose: null,
            proposedDose: '100 mg',
            route: 'oral',
            frequency: 'nightly',
            rationale: 'Endometrial protection — unopposed estrogen contraindicated with intact uterus'
          }
        }
      ],
      blocksRuleTypes: []
    },
    evidence_source: 'NAMS 2022 Position Statement: Progestogen required with systemic estrogen in women with intact uterus to prevent endometrial hyperplasia/cancer.'
  }
];

module.exports = { HRT_RULES };
