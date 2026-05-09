# Primary Care Deepening — Implementation Plan (2026-05-03)

**Companion to:** `PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md` (citations live there)
**Targets:** EHR's quality, AWV, and billing/coding surface — bring it from "good demo" to "credible primary-care production candidate"

**Read order:** §1 architecture orientation → §2-9 phased work → §10 sequencing/risk → §11 test plan → §12 decision queue (your nod)

---

## 1. Architecture orientation — what already exists, what to extend

| Component | Current state | This plan extends it |
|---|---|---|
| `server/agents/quality-agent.js` | 8 MIPS measures, AWV component checker, immunizations, dashboard | Extend measures, plug in USPSTF catalog, refactor AWV into dedicated agent |
| `server/agents/coding-agent.js` | E&M MDM/time logic, **HCC V24 map**, modifiers, upcoding warning | **HCC V24 → V28 remap** (critical), add G2211 detection, add APCM eligibility |
| `server/billing-engine.js` | MDM 3-element, RVU table (2024), chronic prefix lists | Update RVUs to 2026, add care-management code generation |
| `server/cds-engine.js` | Rule-based CDS | Add USPSTF-driven preventive prompts |
| `server/agents/orchestrator.js` | dependsOn ordering | Wire new agents in |
| `server/agents/module-registry.js` | 13 modules | Add `awv` module, optionally `care_management` module |
| FHIR mappers (`server/fhir/mappers/`) | 9 resource types | Add Procedure + Immunization mappers (HEDIS ECDS dependency) |
| Database (`server/database.js`) | Existing tables | Add 7 new tables (see §2) |

**Guiding principle:** new functionality **extends** existing agents where the boundary is thin (HCC table swap, USPSTF catalog), and lands as **new agents/modules** where the surface area is large (dedicated AWV module, care management engine).

---

## 2. Database schema additions

All new tables follow existing patterns: `INTEGER PRIMARY KEY AUTOINCREMENT`, FK to `patients(id) ON DELETE CASCADE`, `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`.

### 2.1 `hcc_codes_v28` — seed table (read-mostly)

```sql
CREATE TABLE IF NOT EXISTS hcc_codes_v28 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icd10_code TEXT NOT NULL,        -- e.g. "E11.65"
  icd10_prefix TEXT NOT NULL,      -- e.g. "E11"
  hcc_v28_number INTEGER NOT NULL, -- e.g. 36
  hcc_v28_label TEXT NOT NULL,     -- "Diabetes with Glycemic, Unspecified, or Long-term Complications"
  coefficient_community REAL,      -- V28 community-payment coefficient
  coefficient_institutional REAL,  -- V28 institutional coefficient
  is_payment_hcc INTEGER DEFAULT 1,
  notes TEXT,
  source_url TEXT,
  effective_year INTEGER DEFAULT 2026
);
CREATE INDEX IF NOT EXISTS idx_hcc_v28_icd10 ON hcc_codes_v28(icd10_code);
CREATE INDEX IF NOT EXISTS idx_hcc_v28_prefix ON hcc_codes_v28(icd10_prefix);
```

Seeded from `server/seed/hcc_v28_seed.json` generated via a one-shot script (`scripts/build-hcc-v28-seed.js`) that pulls from CMS 2026 Model Software/ICD-10 Mappings.

### 2.2 `uspstf_recommendations` — seed table

```sql
CREATE TABLE IF NOT EXISTS uspstf_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_key TEXT UNIQUE NOT NULL,           -- e.g. "breast_cancer_screening"
  title TEXT NOT NULL,
  grade TEXT NOT NULL,                       -- 'A' or 'B'
  population_min_age INTEGER,
  population_max_age INTEGER,
  population_sex TEXT,                       -- 'F', 'M', or NULL
  population_risk_factors TEXT,              -- JSON array of qualifying risk factors
  recommendation_text TEXT NOT NULL,
  cadence_months INTEGER,                    -- e.g. 24 for biennial mammography
  uspstf_url TEXT,
  last_updated TEXT,                         -- '2024-04' for breast cancer
  cpt_codes TEXT,                            -- JSON array of CPT/HCPCS codes that satisfy
  effective_year INTEGER DEFAULT 2026
);
```

### 2.3 `care_management_enrollments`

```sql
CREATE TABLE IF NOT EXISTS care_management_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  program_type TEXT NOT NULL,         -- 'CCM', 'PCM', 'BHI', 'CoCM', 'APCM', 'RPM', 'RTM'
  program_subtype TEXT,               -- 'noncomplex', 'complex', 'level1', 'level2', 'level3'
  enrolled_date TEXT NOT NULL,
  consent_date TEXT NOT NULL,         -- patient consent (verbal or written), required annually
  consent_method TEXT,                -- 'verbal', 'written'
  consent_documented_by TEXT,
  status TEXT DEFAULT 'active',       -- 'active', 'paused', 'terminated'
  termination_date TEXT,
  termination_reason TEXT,
  qualifying_conditions TEXT,         -- JSON array of ICD-10 codes
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cme_patient_active ON care_management_enrollments(patient_id, status);
```

### 2.4 `care_management_time_log`

```sql
CREATE TABLE IF NOT EXISTS care_management_time_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  staff_user_id INTEGER NOT NULL,
  staff_role TEXT NOT NULL,              -- 'physician', 'np', 'pa', 'rn', 'ma', 'sw'
  service_date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  activity_summary TEXT NOT NULL,        -- short narrative
  cpt_eligible TEXT,                     -- JSON array of CPT codes this counts toward
  billable_month TEXT,                   -- 'YYYY-MM'
  billed INTEGER DEFAULT 0,
  billed_cpt TEXT,                       -- final CPT actually billed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (enrollment_id) REFERENCES care_management_enrollments(id) ON DELETE CASCADE,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cmtl_billable ON care_management_time_log(patient_id, billable_month, billed);
```

### 2.5 `awv_records`

```sql
CREATE TABLE IF NOT EXISTS awv_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  encounter_id INTEGER,
  awv_type TEXT NOT NULL,                -- 'IPPE_G0402', 'INITIAL_G0438', 'SUBSEQUENT_G0439'
  visit_date TEXT NOT NULL,
  next_eligible_date TEXT NOT NULL,      -- visit_date + 12 months
  hra_complete INTEGER DEFAULT 0,
  hra_data TEXT,                         -- JSON
  sdoh_complete INTEGER DEFAULT 0,
  sdoh_data TEXT,                        -- JSON
  cognitive_screen_tool TEXT,            -- 'MiniCog', 'MoCA', 'GPCOG', 'AD8', 'MIS'
  cognitive_screen_result TEXT,          -- 'normal', 'positive_followup_needed'
  fall_risk_screen_tool TEXT,            -- 'StayIndependent', 'TUG', 'MorseFall'
  fall_risk_score TEXT,
  depression_screen_tool TEXT,           -- 'PHQ-2', 'PHQ-9'
  depression_screen_score INTEGER,
  acp_discussed INTEGER DEFAULT 0,
  prevention_plan_provided INTEGER DEFAULT 0,
  signed INTEGER DEFAULT 0,
  signed_at DATETIME,
  signed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_awv_patient_eligible ON awv_records(patient_id, next_eligible_date);
```

### 2.6 `quality_measure_results`

```sql
CREATE TABLE IF NOT EXISTS quality_measure_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  encounter_id INTEGER,
  measure_set TEXT NOT NULL,        -- 'MIPS', 'HEDIS', 'USPSTF', 'STARS'
  measure_id TEXT NOT NULL,         -- e.g. 'Q001', 'BCS-E', 'breast_cancer_screening'
  measure_year INTEGER NOT NULL,    -- 2026
  status TEXT NOT NULL,             -- 'met', 'not_met', 'gap', 'exclusion', 'not_applicable'
  numerator INTEGER,
  denominator INTEGER,
  evaluation_data TEXT,             -- JSON snapshot
  evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_qmr_patient_year ON quality_measure_results(patient_id, measure_year, measure_set);
```

### 2.7 `apcm_enrollments`

```sql
CREATE TABLE IF NOT EXISTS apcm_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  level INTEGER NOT NULL,            -- 1, 2, or 3
  level_cpt TEXT NOT NULL,           -- 'G0556', 'G0557', 'G0558'
  enrolled_date TEXT NOT NULL,
  consent_date TEXT NOT NULL,
  qualifying_basis TEXT NOT NULL,    -- 'one_chronic', 'two_plus_chronic', 'dual_eligible_high_complexity'
  qpp_pathway TEXT NOT NULL,         -- 'value_in_primary_care_mvp', 'mssp', 'reach_aco'
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_apcm_patient_active ON apcm_enrollments(patient_id, status);
```

---

## 3. Phase 1 — HCC V28 remap (HIGHEST priority, ~3-4 hrs)

**Why first:** code currently uses V24 numbering on Medicare patients; risk-adjustment-driven workflows are wrong as of CY 2026.

### Steps

1. **Build V28 seed.** Write `scripts/build-hcc-v28-seed.js` that downloads the CMS 2026 V28 ICD-10 mappings CSV and emits `server/seed/hcc_v28_seed.json` (~10K rows).
2. **Add migration 010.** `server/database-migrations.js` migration adds `hcc_codes_v28` table and seeds from JSON.
3. **Refactor `coding-agent.js:34-49` `hccCodes` Map** → query the table via `db.dbAll`. Cache results in-memory at agent boot.
4. **Add HCC capture report** — new function `_buildHCCReport(icd10Codes)` that returns `{ hcc_v28_number, label, isPaymentHcc, suspected: false, addressed_in_visit: bool }`.
5. **Surface "suspected HCC" prompts** — when a chronic-condition keyword appears in transcript but no matching ICD-10 in problem list, suggest a code.
6. **MEAT documentation check** — flag HCC codes appearing in the bill that lack at least one of (Monitor / Evaluate / Assess / Treat) keywords in the encounter note.

### Files touched

- NEW: `server/seed/hcc_v28_seed.json`, `scripts/build-hcc-v28-seed.js`, `docs/HCC_V28_MIGRATION.md`
- MODIFIED: `server/agents/coding-agent.js`, `server/database-migrations.js`
- TESTS: `test/unit/hcc-v28.test.js` (new), scenarios in `test/scenarios/hcc-recapture-scenarios.json` (new)

---

## 4. Phase 2 — Care Management code engine (~6-8 hrs)

**Why second:** unlocks substantial new revenue paths that primary care leaves on the table; clean greenfield module.

### New module: `server/care-management/`

```
server/care-management/
├── index.js                  # mount + table init
├── engine.js                 # eligibility + monthly billable-code computation
├── eligibility.js            # checks chronic condition counts, consent status
├── codes.js                  # CPT code definitions (CCM, PCM, TCM, BHI, ACP, RPM, RTM, APCM)
├── stacking-rules.js         # CMS conflict matrix (CCM↔TCM, APCM↔CCM, etc.)
└── routes.js                 # /api/care-management endpoints
```

### Endpoints

```
POST   /api/care-management/enroll         { patient_id, program, consent }
PATCH  /api/care-management/enroll/:id     { status, consent_renewal }
POST   /api/care-management/time-log       { enrollment_id, minutes, summary, staff_id }
GET    /api/care-management/billable/:patientId/:yearMonth
GET    /api/care-management/eligible-programs/:patientId
POST   /api/care-management/awv-tcm-bridge { patient_id }   # TCM → CCM eligibility helper
```

### CCM monthly bill computation logic

```
inputs: enrollment, time_log[YYYY-MM], existing_TCM_overlap

1. If APCM enrolled this month → emit G0556/G0557/G0558 only; CCM/PCM/BHI suppressed.
2. If TCM service period (99495/99496) covers this month → CCM suppressed for overlap days.
3. Sum staff-time minutes (excludes physician personal time).
4. If staff_minutes >= 60 AND complex MDM → 99487 + add-on 99489 per +30 min.
5. Else if staff_minutes >= 20 → 99490 + add-on 99439 per +20 min (cap 2).
6. Sum physician personal-care minutes:
   - If >= 30 → 99491 + add-on 99437 per +30 min.
7. Output { codes: [{cpt, units, supporting_minutes, supporting_log_ids}] }
```

### Tests

- Each code path traced through `test/scenarios/care-management-scenarios.json`
- Stacking conflict tests in `test/unit/care-management-stacking.test.js`
- TCM-to-CCM bridge test (TCM qualifies as comprehensive visit for CCM init)

---

## 5. Phase 3 — Dedicated AWV agent (~4-5 hrs)

**Why:** current AWV checker in `quality-agent.js` is component-based but doesn't generate the bill, doesn't track 12-month eligibility, doesn't enforce SDOH (2024+ requirement), and doesn't attach 99483/G0136 add-ons.

### New: `server/agents/awv-agent.js`

```js
class AWVAgent extends BaseAgent {
  constructor() {
    super('awv', { autonomyTier: 2, dependsOn: ['scribe', 'cds'] });
  }

  async process(context, agentResults) {
    // 1. Eligibility check (12-month window from prior G0438/G0439 in awv_records)
    const eligibility = await this._checkEligibility(context.patient.id);
    if (!eligibility.eligible) return { eligible: false, reason, nextEligibleDate };

    // 2. Determine type (Initial G0438 if first ever, Subsequent G0439 if prior exists)
    const awvType = await this._determineType(context.patient.id);

    // 3. Component checklist (HRA, SDOH, cognitive, fall risk, depression, BMI, BP, prevention plan)
    const components = this._evaluateComponents(context, awvType);

    // 4. Add-on suggestions (G2211 if longitudinal, ACP if discussed >=16min, 99483 if cognitive positive, G0136 if SDOH separately documented)
    const addons = this._suggestAddons(context, components);

    // 5. Persist to awv_records on encounter sign
    return { eligibility, awvType, components, addons, missingRequired, billableCpt };
  }
}
```

### Module-registry entry

Add `awv` to `server/agents/module-registry.js`:

```js
awv: Object.freeze({
  key: 'awv',
  displayName: 'Annual Wellness Visit',
  workflowBand: 'preventive_visit',
  humanCounterpart: 'physician (with MA pre-visit prep)',
  autonomyTier: 2,
  summary: 'Detects AWV encounter type, enforces required components per CMS, generates G0438/G0439 + add-ons.',
  primaryInputs: ['encounter context', 'transcript', 'prior AWV records', 'patient age'],
  primaryOutputs: ['component checklist', 'missing-required list', 'billable CPT', 'add-on opportunities'],
  primaryHandoff: 'physician (sign), coding agent (bill), quality agent (record AWV measure satisfaction)'
})
```

### Frontend

- New `src/components/encounter/AWVChecklist.jsx` — live component-completeness widget on EncounterPage when encounter_type includes 'wellness' or 'awv'
- New `src/pages/AWVDashboardPage.jsx` — panel-level view of patients due for AWV (next_eligible_date <= today + 30d)

---

## 6. Phase 4 — G2211 detection (~1-2 hrs)

Smallest phase, fastest revenue-impact win.

### Edits to `server/billing-engine.js`

```js
function detectG2211Eligibility(context) {
  const longitudinalSignals = {
    hasEstablishedRelationship: context.patient.created_at < new Date(Date.now() - 365 * 86400000),
    hasOngoingChronicCondition: (context.problems || []).some(p =>
      p.status === 'active' && CHRONIC_CONDITION_PREFIXES.some(prefix => (p.icd10_code || '').startsWith(prefix))
    ),
    encounterType: context.encounter?.encounter_type,
    isHomeOrResidence: context.encounter?.location_type === 'home' || context.encounter?.location_type === 'residence',
    isOfficeOutpatient: !context.encounter?.location_type || context.encounter?.location_type === 'office',
    isTelehealth: !!context.encounter?.is_telehealth
  };

  const eligible = (longitudinalSignals.hasEstablishedRelationship || longitudinalSignals.hasOngoingChronicCondition)
    && (longitudinalSignals.isOfficeOutpatient || longitudinalSignals.isHomeOrResidence || longitudinalSignals.isTelehealth);

  return {
    eligible,
    addOnCpt: eligible ? 'G2211' : null,
    rationale: eligible
      ? 'Longitudinal-care relationship established; G2211 supports the visit complexity add-on'
      : 'Visit does not meet G2211 longitudinal-care criteria',
    estimatedReimbursementUSD: eligible ? 16.05 : 0
  };
}
```

### Output

Wire `g2211` into the existing `coding-agent` result so the encounter UI shows it as an add-on suggestion. Document the longitudinal-care intent line that, while not required, helps for audit defense.

---

## 7. Phase 5 — USPSTF catalog + matcher (~3-4 hrs)

### Seed

`server/seed/uspstf_recommendations_seed.json` from `PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md` §6 — ~37 recommendations.

### Migration

Migration 011 creates `uspstf_recommendations` table + seeds from JSON.

### Matcher

New helper `server/agents/quality/uspstf-matcher.js`:

```js
function matchApplicableRecommendations(patient, encounter) {
  // Returns array of { topic_key, title, applicable: bool, completed_within_cadence: bool, last_completion_date, next_due_date }
}
```

### Integration

`quality-agent.js` calls matcher; merges results into `gaps` + `dashboard.topActions`.

---

## 8. Phase 6 — HEDIS MY 2026 ECDS adapter (~5-6 hrs)

**Architectural win:** HEDIS MY 2026 specs are FHIR — we already produce FHIR. This is the highest-leverage piece.

### New module: `server/quality/hedis/`

```
server/quality/hedis/
├── adapter.js              # converts patient → FHIR resources via existing mappers
├── measures/
│   ├── bcs-e.js            # Breast Cancer Screening ECDS
│   ├── col-e.js            # Colorectal Cancer Screening ECDS
│   ├── ccs-e.js            # Cervical Cancer Screening ECDS (NEW for MY 2026)
│   ├── cbp.js              # Controlling Blood Pressure (potential dual rate)
│   ├── cdc-a1c.js          # Diabetes A1c poor control
│   └── ima-e.js            # Adult immunizations
└── reporting.js            # population-level rollup for panel reports
```

Each measure file exports `{ id, name, denominator(fhirBundle), numerator(fhirBundle), exclusions(fhirBundle), score(fhirBundle) }`.

### Endpoint

`GET /api/quality/hedis/:patientId?year=2026` → per-patient HEDIS measure status.
`GET /api/quality/hedis/panel?year=2026` → panel rollup.

### Tests

Synthetic FHIR Bundles in `test/fixtures/hedis/` covering numerator-met, gap, exclusion, denominator-failed cases for each measure.

---

## 9. Phase 7 — 2026 MIPS measure refresh + APCM hooks (~2-3 hrs)

### Edits

- Remove **QID 487** (Screening for Social Drivers of Health) from `quality-agent.js mipsMeasures` — replaced by improvement activity / MVP-level requirement
- Add stubs for new 2026 measures from CMS 2026 MIPS Annual Call (verify final list during implementation)
- Add `apcm_enrollments` table + enrollment endpoint
- Add MVP reporting helper that pulls measure satisfaction from `quality_measure_results` table for MVP submission

### Surface in UI

`src/pages/QualityDashboardPage.jsx` (NEW) — MVP-aligned dashboard showing measure satisfaction with goal markers.

---

## 10. Sequencing + risk

### Recommended order

1. **Phase 1 — HCC V28 remap** (3-4 hrs) — risk-adjustment correctness
2. **Phase 4 — G2211 detection** (1-2 hrs) — quick revenue win
3. **Phase 5 — USPSTF catalog** (3-4 hrs) — feeds preventive prompts
4. **Phase 3 — AWV agent** (4-5 hrs) — full preventive-visit workflow
5. **Phase 2 — Care management engine** (6-8 hrs) — bigger surface, depends on schema
6. **Phase 6 — HEDIS ECDS adapter** (5-6 hrs) — biggest architectural lift
7. **Phase 7 — MIPS 2026 refresh + APCM** (2-3 hrs) — wraps it together

**Total:** ~25-32 hours of focused work. Suitable for 2-3 working sessions if uninterrupted.

### Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| HCC V28 mappings change before publication | Low (final 2026 model published) | Medium | Cache source URL + version in seed; nightly diff check optional |
| 2026 final MPFS changes any G2211 / APCM detail | Medium | Low (changes are usually expansions) | Keep code-detection rules in one file; easy to amend |
| HEDIS measure spec interpretation (numerator/denominator edge cases) | Medium | Medium | Use NCQA-published ECDS reference XML if available; write thorough fixture tests |
| AWV agent changes break existing quality-agent measure flow | Low | Medium | Extract AWV checker first, run regression on quality-agent before deleting old code |
| Breaking schema change to existing tables | Low (all new tables) | High | All schema additions are NEW tables; migrations are additive |
| Test scenario coverage gap | Medium | Medium | Aim for ≥1 happy path + ≥1 edge case per new code path |

### Reversibility

Every phase is reversible:
- New tables can be dropped (`DROP TABLE IF EXISTS`)
- New agent files can be deleted
- HCC V24 → V28 remap keeps V24 numbers in a `hcc_v24_legacy` column for fallback comparison
- Migrations versioned; rollback script per migration

---

## 11. Test plan summary

| Phase | Unit tests added | Scenario JSONs added | HTTP boundary tests added |
|---|---|---|---|
| 1 HCC V28 | hcc-v28.test.js (mapping + MEAT check) | hcc-recapture-scenarios.json | (none — internal) |
| 2 Care Mgmt | care-management-stacking.test.js, ccm-billing.test.js, tcm-bridge.test.js | care-management-scenarios.json | care-mgmt-routes.test.js |
| 3 AWV | awv-agent.test.js, awv-eligibility.test.js | awv-scenarios.json (initial, subsequent, ineligible, missing-component) | awv-routes.test.js |
| 4 G2211 | g2211-detection.test.js | g2211-scenarios.json | (none) |
| 5 USPSTF | uspstf-matcher.test.js | uspstf-scenarios.json | (none) |
| 6 HEDIS | hedis-bcs-e.test.js, hedis-col-e.test.js, hedis-ccs-e.test.js, hedis-cbp.test.js, hedis-cdc-a1c.test.js | (fixtures only) | hedis-routes.test.js |
| 7 MIPS+APCM | mips-2026.test.js, apcm-eligibility.test.js | apcm-scenarios.json | apcm-routes.test.js |

Target coverage on new code: **>80% line coverage** (anything safety-critical >90%).

Existing test count: 275 (verified 2026-05-03). Estimated new tests: ~80-100 additional. Final count target: ~360-380 tests, all passing.

---

## 12. Decision queue (your nod before I start writing code)

Per "don't dump HTML, surface decisions as Y/N" rule. Each item below is a YES/NO with my recommendation.

**1. Build a NEW `awv-agent.js` (Recommendation: Y)** — vs. extending the existing `_checkAWVComponents` in `quality-agent.js`. The AWV surface is large enough (eligibility tracking, multiple add-on codes, dedicated UI, persisted records) that a dedicated agent is the right boundary. The legacy `_checkAWVComponents` becomes a fallback / migration target.

**2. Stand up `server/care-management/` as a NEW module (Recommendation: Y)** — vs. extending `coding-agent.js`. CCM/TCM/BHI/RPM/APCM together have ~20 CPT codes, complex stacking rules, monthly billing computation, and multi-month time aggregation. They don't belong in the per-encounter coding agent.

**3. Stand up `server/quality/hedis/` as a NEW module (Recommendation: Y)** — same logic: HEDIS measures are panel-level (not per-encounter) and pull from FHIR resources. Doesn't fit inside `quality-agent.js`.

**4. Add 7 new database tables in one migration vs split (Recommendation: split — 3 migrations)** — Migration 010 = HCC V28 + USPSTF (seed-only, low risk). Migration 011 = AWV + quality_measure_results (per-encounter writes). Migration 012 = Care management + APCM (multi-month aggregation). Easier to roll back individually.

**5. Implementation pace — full sequence in this conversation, OR do Phase 1+4 now and split? (Recommendation: split — Phase 1 + 4 + 5 NOW; the rest in a follow-up session)** — Phases 1 (HCC V28), 4 (G2211), 5 (USPSTF) total ~7-10 hours and form a coherent "billing + preventive prompt" deliverable. Phases 2 (care mgmt), 3 (AWV agent), 6 (HEDIS ECDS), 7 (MIPS/APCM) form a coherent "panel management" deliverable for a second session.

**6. Should I run `npm test` after each phase? (Recommendation: Y)** — keeps the 275-test baseline green; surfaces regressions early. You already have unit-test infrastructure that runs in <2 sec.

**7. Should I update `BLIND_EVALUATION_REPORT.md` after each implementation phase? (Recommendation: N until end)** — single comprehensive update at the end avoids churn. The eval is already published; daily drift updates noise the document.

---

Reply with `1Y 2Y 3Y 4Y 5Y 6Y 7Y` (or any mix). I'll execute in the agreed order.
