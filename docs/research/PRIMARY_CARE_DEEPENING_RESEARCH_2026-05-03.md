# Primary Care Deepening — Research Synthesis (2026-05-03)

**Purpose:** Authoritative reference for the 2026 update to the EHR's primary care surface — Quality Measures, Annual Wellness Visit, and Master Billing & Coding. Every claim cites a CMS, USPSTF, NCQA, or AAFP source. This doc feeds `PRIMARY_CARE_IMPLEMENTATION_PLAN_2026-05-03.md`.

**Audience:** Engineers extending `quality-agent.js`, `coding-agent.js`, `billing-engine.js`, and net-new modules (CCM/TCM/AWV-dedicated agents).

**Citation style:** Chicago Manual of Style 17th ed., Notes-Bibliography. URLs included for re-verification — measure sets and code rates change yearly.

---

## 1. Annual Wellness Visit (AWV) — G0438 / G0439 + Cognitive Care 99483

### 1.1 Code structure

| Code | Type | Frequency limit | Description |
|---|---|---|---|
| G0438 | Initial AWV | Once per lifetime, after first 12 months of Medicare Part B | First Medicare AWV; full HRA + screening battery |
| G0439 | Subsequent AWV | Once per 12-month period | Annual update of HRA, history, screenings |
| G0468 | FQHC AWV | Same as above | When billed by Federally Qualified Health Center |
| 99483 | Cognitive Assessment & Care Plan | Separate from AWV | Detailed evaluation of cognitive function with care plan; 50 minutes |

> AWV is **not** the Initial Preventive Physical Exam (IPPE / G0402), which is a once-per-lifetime visit billable only within the first 12 months of Medicare Part B enrollment.[^1]

### 1.2 Required components — Initial AWV (G0438)

Per CMS AWV coverage policy and the MLN booklet "Medicare Wellness Visits":[^2]

1. **Health Risk Assessment (HRA)** — minimum elements:
   - Demographic data (age, sex, race/ethnicity if collected)
   - Self-assessment of health status
   - Psychosocial risks (depression, life satisfaction, stress, anger, loneliness, social isolation)
   - Behavioral risks (tobacco use, physical activity, alcohol use, nutrition, oral health, motor vehicle safety, home safety)
   - Activities of Daily Living (ADL) and Instrumental ADL (IADL)
2. **Establish patient's medical and family history** (one-time for initial AWV)
3. **Establish list of current providers and suppliers** that regularly furnish medical care
4. **Measurements:** height, weight, BMI, blood pressure, and other routine measurements as appropriate
5. **Detection of cognitive impairment** — direct observation plus consideration of patient/caregiver/family/friend reports; use validated tool (Mini-Cog, MoCA, GPCOG, MIS, AD8 — CMS does not mandate a specific tool but requires screening)
6. **Review functional ability and level of safety** — fall risk via direct observation or validated tool (Stay Independent, Timed Up and Go); hearing impairment; ADL impairment
7. **Establish written screening schedule for the next 5-10 years** (USPSTF + ACIP)
8. **Establish list of risk factors and conditions** with recommended interventions
9. **Furnish personalized health advice** and refer to health-education or preventive counseling services / programs aimed at reducing identified risk factors
10. **Voluntary advance care planning (ACP) discussion** — at patient's discretion (G0438/G0439 includes ACP at no extra cost when patient agrees, or bill 99497/99498 separately)
11. **Social Determinants of Health (SDOH) Risk Assessment** — added 2024 per CMS MM13486[^3] as an optional element; may be reported separately as G0136 (5-15 min) when furnished

### 1.3 Required components — Subsequent AWV (G0439)

Same as G0438 except:
- **Update** (don't re-establish) HRA, medical/family history, provider list
- **Update** measurements, cognitive impairment detection, fall risk, hearing impairment
- **Update** the personalized prevention plan and screening schedule
- All other elements same

### 1.4 Common denial reasons (per AAFP)[^4]

- Billed inside 12-month window from prior G0438/G0439
- Same-day E/M without modifier 25 properly applied to E/M
- Missing one or more required HRA elements (most common: no SDOH or no fall risk)
- No written prevention plan / screening schedule documented
- Cognitive screening not documented (most common in subsequent AWVs)

### 1.5 Add-on opportunities

- **G2211** — visit complexity add-on for the AWV when the longitudinal-care intent is documented (allowed since 2025; see §5)
- **99497/99498** — ACP if 16+ minutes spent on advance directive discussion (waived deductible/coinsurance when same-day as AWV)
- **99483** — separate CPT code for detailed cognitive assessment + care plan when initial cognitive screen is positive
- **G0136** — standalone SDOH risk assessment, 5-15 min
- **96160/96161** — HRA administration codes (when an HRA tool is administered separately, e.g., for non-AWV preventive context)

---

## 2. HCC V28 Risk Adjustment — 2026 = 100% V28

### 2.1 Phase-in completion

CMS transitioned the CMS-HCC model from V24 to V28 over a three-year phase-in:[^5]

| Plan Year | V28 Weight | V24 Weight |
|---:|---:|---:|
| CY 2024 | 33% | 67% |
| CY 2025 | 67% | 33% |
| **CY 2026** | **100%** | **0%** |

**Operational impact:** Any code in the EHR that maps an ICD-10 code to a "HCC number" must now use V28 numbering, not V24. The current `coding-agent.js:34-49` `hccCodes` Map uses V24 numbers and must be remapped.

### 2.2 V28 versus V24 — what changed

Per CMS technical specifications:[^6]

- **V28 removed >2,000 ICD-10 codes** from the V24 payment HCC set after CMS reviewed conditions coded more often in MA versus FFS
- **Only ~10% of all ICD-10 codes map to "payment HCCs"** in V28 (down from V24)
- HCC numbering renumbered (e.g., V24 HCC 19 = Diabetes w/o Complication maps to V28 HCC 36 = Diabetes with Glycemic, Unspecified, or Long-term Complications, with different child HCC structure)
- V28 added new HCC categories for some chronic conditions and removed others previously rewarded under V24
- Coefficient values entirely re-calibrated against 2018 MA encounter data (vs V24's 2014 calibration)

### 2.3 V28 HCCs most relevant to primary care (sampled — full list at CMS 2026 Model Software/ICD-10 Mappings)[^7]

| ICD-10 prefix or code | V28 HCC | Description |
|---|---:|---|
| E11.65, E11.0-E11.9 | 36 | Diabetes with glycemic / unspecified / long-term complications |
| E11.21-E11.29 | 37 | Diabetes with kidney complications |
| E11.31-E11.39 | 38 | Diabetes with ophthalmologic complications |
| E11.40-E11.49 | 39 | Diabetes with neurologic complications |
| I50.x (heart failure) | 224 | Heart failure (V28 keeps as a single HCC; V24 split it) |
| J44.x (COPD) | 280 | COPD (V28 simplified from V24 multi-HCC structure) |
| N18.4, N18.5, N18.6 | 326-329 | CKD stages 4-5, ESRD (V28 removed CKD Stage 3 from payment HCCs — major change) |
| F32, F33 (depression) | 155 → 151 (V28 renumbered) | Major depressive disorder (recurrent codes have separate HCC in V28) |
| I48 (atrial fibrillation) | 248 | Atrial fibrillation/flutter |
| C50, C61, C18-C20 | Various 17-22 | Active cancers — primary site specific |
| E66.01 (morbid obesity, BMI 40+) | 48 | Morbid obesity (BMI ≥ 40 still required documentation) |

> **Critical 2024-2026 change:** CKD Stage 3 (N18.3, N18.30, N18.31, N18.32) was **removed from payment HCCs** in V28. Only CKD Stage 4+ scores. This affects risk-adjusted revenue for CKD-3 patients significantly.[^8]

### 2.4 HCC capture workflow

Per CMS RADV (Risk Adjustment Data Validation) program:
- HCC must be **coded to highest specificity** (e.g., I50.21 systolic CHF acute, not I50.9 unspecified)
- HCC must be **documented as MEAT** (Monitored, Evaluated, Assessed, Treated) — coding from a passive problem list is insufficient
- HCC must be **face-to-face documented** in the calendar year (some HCCs have annual recapture requirement)
- Specificity is required: for diabetes, code the complication category (E11.21 vs E11.65), not just E11.9

---

## 3. MIPS / MVP / APCM 2026 (Quality Payment Program)

### 3.1 Headline 2026 changes

Per the CY 2026 Medicare Physician Fee Schedule Final Rule and 2026 MIPS Annual Call for Quality Measures:[^9][^10]

- **Performance threshold:** stays at **75 points** (same as 2024-2025 — CMS chose stability)
- **6 new MVPs proposed** + revisions to all 21 existing MVPs (final list in MPFS Final Rule)
- **Multispecialty groups must form subgroups** for MVP reporting; small practices (≤15 ECs) exempt
- **APCM (Advanced Primary Care Management)** new code family — billing requires either (a) reporting Value in Primary Care MVP, OR (b) participating in MSSP or REACH ACO
- **Quality ID 487 (Screening for Social Drivers of Health) being removed** — replaced by Improvement Activity / MVP-level requirement
- **Meaningful Measures 2.0 framework** — CMS explicit goal to reduce reporting burden while focusing on outcome-meaningful measures

### 3.2 Value in Primary Care MVP (MVP M0005)

Foundation MVP for family medicine and internal medicine:[^11]

**Quality measures (4 required):**
1. Q001 — Diabetes: HbA1c Poor Control (>9%)
2. Q236 — Controlling High Blood Pressure
3. Q134 — Preventive Care and Screening: Screening for Depression and Follow-Up Plan
4. Q321 (or alternative) — CAHPS for MIPS Survey

**Plus** outcome measure choices, care coordination measures, and patient experience.

**Improvement Activities:** Reduced count for MVP reporting (4 in traditional MIPS → 2 in MVP)

**Promoting Interoperability:** Same as traditional MIPS

**Cost:** Calculated from claims by CMS

### 3.3 MIPS measures most relevant to primary care (2026 set)

Existing in `quality-agent.js` mipsMeasures array — verify these are still in the 2026 measure set during implementation:

| QID | Measure | Status 2026 |
|---|---|---|
| 001 | Diabetes: HbA1c Poor Control >9% | Active |
| 047 | Advance Care Plan | Active |
| 110 | Influenza Immunization | Active |
| 111 | Pneumococcal Vaccination | Active |
| 112 | Breast Cancer Screening | Active (mapped to BCS-E) |
| 113 | Colorectal Cancer Screening | Active (mapped to COL-E) |
| 117 | Diabetes: Eye Exam | Active |
| 122 | Diabetes: Medical Attention for Nephropathy | Active |
| 128 | Preventive Care: BMI Screening + Follow-Up | Active |
| 130 | Documentation of Current Medications | Active |
| 134 | Preventive Care: Depression Screening + Follow-Up | Active |
| 226 | Preventive Care: Tobacco Use Screening + Cessation | Active |
| 236 | Controlling High Blood Pressure | Active |
| 317 | Preventive Care: BP Screening | Active |
| 318 | Falls: Screening for Fall Risk | Active |
| 487 | Screening for Social Drivers of Health | **REMOVED 2026** |

### 3.4 APCM (Advanced Primary Care Management) — 2026 new

Per CMS CY 2026 MPFS:[^12]

| Code | Description | Eligibility |
|---|---|---|
| G0556 | APCM Level 1 — patients with ≤1 chronic condition | Per beneficiary per month |
| G0557 | APCM Level 2 — patients with 2+ chronic conditions | Per beneficiary per month |
| G0558 | APCM Level 3 — patients dual-eligible OR 2+ chronic conditions with QHP-determined high complexity | Per beneficiary per month |

Bundles many existing CCM/PCM/TCM/CCCM elements. Cannot be billed concurrent with CCM (99490/99491), Complex CCM (99487), PCM (99424-99427), or BHI (99484). **Replaces** the patchwork of care management codes for practices that elect APCM.

---

## 4. Care Management Codes — CCM, TCM, BHI, ACP, RPM, RTM

### 4.1 Chronic Care Management (CCM) — clinical staff time

Per CMS CCM MLN booklet (June 2025):[^13]

| Code | Description | Time | Frequency |
|---|---|---|---|
| 99490 | Non-complex CCM, clinical staff time directed by physician/QHP | ≥20 min/month | 1×/month |
| 99439 | Add-on to 99490 — each additional 20 min staff time | +20 min increments | Up to 2× per 99490 |
| 99487 | Complex CCM, clinical staff | ≥60 min, moderate-high MDM | 1×/month |
| 99489 | Add-on to 99487 — each additional 30 min | +30 min increments | No cap |

**Eligibility:** ≥2 chronic conditions expected to last ≥12 months OR until death, place patient at significant risk of death/decompensation/functional decline. Patient consent (verbal or written) documented annually.

### 4.2 CCM provided personally by physician/QHP

| Code | Description | Time |
|---|---|---|
| 99491 | CCM personally by physician/QHP (not incident-to) | ≥30 min |
| 99437 | Add-on to 99491 — each additional 30 min by physician | +30 min |

### 4.3 Principal Care Management (PCM) — single high-risk condition

| Code | Time | By whom |
|---|---|---|
| 99424 | ≥30 min/month physician/QHP | Personally by physician |
| 99425 | +30 min add-on to 99424 | Physician |
| 99426 | ≥30 min/month clinical staff directed | Staff |
| 99427 | +30 min add-on to 99426 | Staff |

### 4.4 Transitional Care Management (TCM)

| Code | Complexity | Required face-to-face | Required interactive contact |
|---|---|---|---|
| 99495 | Moderate MDM | Within 14 days of discharge | Within 2 business days |
| 99496 | High MDM | Within 7 days of discharge | Within 2 business days |

**Service period:** 30 days from discharge. **Cannot overlap** with CCM service period. **TCM qualifies as the comprehensive E/M visit required to initiate CCM** for the same patient.

### 4.5 Behavioral Health Integration (BHI)

| Code | Description | Time |
|---|---|---|
| 99484 | General BHI | ≥20 min/month |
| 99492 | Initial Collaborative Care Management (CoCM) | ≥70 min, first month |
| 99493 | Subsequent CoCM | ≥60 min, subsequent months |
| 99494 | Add-on to 99492/99493 — each additional 30 min | +30 min |

### 4.6 Advance Care Planning (ACP)

| Code | Time |
|---|---|
| 99497 | First 30 min ACP discussion |
| 99498 | Each additional 30 min |

**Waived** Medicare deductible and coinsurance when furnished same-day as AWV (G0438/G0439). Otherwise patient cost-sharing applies.

### 4.7 Remote Patient Monitoring (RPM) and Remote Therapeutic Monitoring (RTM)

**RPM (physiologic data — BP, glucose, weight, etc.):**

| Code | Description |
|---|---|
| 99453 | Initial setup + patient education on equipment (one-time per episode) |
| 99454 | Device supply with daily recordings, 30-day period (16+ days of data required) |
| 99457 | First 20 min/month of RPM treatment management services |
| 99458 | Each additional 20 min/month (add-on) |

**RTM (non-physiologic — musculoskeletal, respiratory, CBT, etc.):**

| Code | Description |
|---|---|
| 98975 | Initial setup |
| 98976 | Device supply, respiratory system, 30 days |
| 98977 | Device supply, musculoskeletal, 30 days |
| 98980 | First 20 min/month treatment management |
| 98981 | Each additional 20 min/month |

### 4.8 Stacking restrictions (CMS 2025-2026)

- CCM (99490, 99491) **cannot** be billed during a TCM service period (99495, 99496) for the same patient
- CCM and PCM cannot both be billed for the same patient in the same calendar month
- BHI (99484) and CoCM (99492-99494) cannot be billed concurrently for the same patient
- APCM (G0556-G0558) **replaces** CCM/PCM/BHI/RPM/RTM for the patients enrolled — cannot stack
- RPM and RTM cannot both be billed for the same patient in the same month

---

## 5. G2211 — Visit Complexity Add-On

Per CMS MM13473 and AAFP G2211 guidance:[^14][^15]

### 5.1 What it captures

> "Inherent complexity of the visit that's derived from the longitudinal nature of the practitioner-patient relationship, as well as ongoing medical care related to a patient's single, serious condition or complex condition."

### 5.2 Billable scenarios

- The provider is "the continuing focal point for all health care services the patient needs"
- Both new and established patient visits qualify (yes — even new patients, when intent to provide longitudinal care is documented)
- No frequency limit — can bill at every qualifying visit
- Determined by **physician-patient relationship**, not diagnosis complexity

### 5.3 NOT billable

- Discrete, routine, or time-limited visits where ongoing care relationship is not assumed
- Procedure-only visits

### 5.4 Eligible base codes

| Year | E/M code family |
|---|---|
| 2024 | Office/outpatient (99202-99215) |
| 2025 | + telehealth versions of above |
| **2026** | **+ home/residence E/M (99341, 99342, 99344, 99345, 99347, 99348, 99349, 99350)** |

### 5.5 Modifier 25 rule (2025+)

G2211 **can** be billed when the base E/M has modifier 25 appended for same-day:
- Annual Wellness Visits
- Vaccine administration
- Any Medicare Part B preventive service

(This was a 2024 restriction that CMS lifted in 2025.)

### 5.6 Documentation

CMS requires no additional documentation beyond the standard E/M medical-necessity documentation. AAFP recommends that the visit note demonstrate the longitudinal-care relationship — e.g., "patient established with this practice since [year]; ongoing management of [chronic condition]" — even though it is not strictly required.

### 5.7 RVU and payment

G2211 work RVU = 0.33 (CY 2024-2026 schedule); approximate national reimbursement ~$16.05 added to the base E/M payment. Cumulative impact at primary-care volume: meaningful — a panel of 2,000 Medicare patients with 2.5 visits/year averaging G2211 attachment yields ~$80K/year additional revenue.

---

## 6. USPSTF Grade A and B Recommendations — Adult Primary Care

Source: USPSTF "A and B Recommendations" page (current as of 2026-05-03).[^16]

### 6.1 Cancer screening

| Topic | Grade | Eligible Population | Recommendation |
|---|:---:|---|---|
| Breast cancer screening | B | Women 40-74 | Biennial screening mammography |
| Cervical cancer screening | A | Women 21-65 | Cytology q3y or HPV test (alone or co-test) q5y |
| Colorectal cancer screening | A | Adults 50-75 | Multiple approved strategies |
| Colorectal cancer screening | B | Adults 45-49 | Begin screening at 45 |
| Lung cancer screening | B | Adults 50-80 with 20+ pack-year smoking (current or quit ≤15y) | Annual low-dose CT |
| Skin cancer prevention counseling | B | Ages 6mo-24y, fair skin | UV exposure minimization |

### 6.2 Cardiovascular

| Topic | Grade | Eligible Population | Recommendation |
|---|:---:|---|---|
| Abdominal aortic aneurysm screening | B | Men 65-75 ever-smokers | One-time ultrasound |
| Hypertension screening | A | Adults 18+ without HTN | Office BP + out-of-office confirmation |
| Statin primary prevention | B | Adults 40-75 with ≥1 CVD risk factor + ≥10% 10-year ASCVD risk | Clinician-prescribed statin |
| Diet/physical activity behavioral counseling | B | Adults with CVD risk factors | Behavioral counseling intervention |

### 6.3 Diabetes/metabolic

| Topic | Grade | Eligible Population | Recommendation |
|---|:---:|---|---|
| Prediabetes/T2DM screening | B | Adults 35-70 with overweight/obesity | Screen; refer prediabetes to prevention |
| Pediatric obesity behavioral intervention | B | Children/adolescents ≥6y, BMI ≥95%ile | Intensive behavioral intervention referral |
| Adult obesity behavioral intervention | B | Adults BMI ≥30 | Intensive multicomponent behavioral intervention |
| Healthy weight & weight gain in pregnancy | B | Pregnant persons | Behavioral counseling for healthy gestational weight |

### 6.4 Infectious disease

| Topic | Grade | Eligible Population | Recommendation |
|---|:---:|---|---|
| Chlamydia/gonorrhea screening | B | Sexually active women ≤24; women 25+ at risk | Screen all in lower group; risk-based for older |
| HBV screening (adolescents/adults) | B | At-risk adults/adolescents | Screen at-risk |
| HBV screening (pregnant) | A | All pregnant women | Screen at first prenatal visit |
| HCV screening | B | Adults 18-79 | Universal screening in age range |
| HIV screening | A | Adolescents/adults 15-65 (broader for at-risk) | Universal screening |
| HIV PrEP | A | Adolescents/adults at HIV acquisition risk | Prescribe ART for prevention |
| Latent TB screening | B | Asymptomatic at-risk adults | Screen at-risk populations |
| Syphilis (nonpregnant) | A | Adolescents/adults at risk | Risk-based screening |
| Syphilis (pregnant) | A | Pregnant women | Universal early screening |

### 6.5 Mental health & behavioral

| Topic | Grade | Eligible Population | Recommendation |
|---|:---:|---|---|
| Anxiety screening (adults) | B | Adults ≤64 incl. perinatal | Screen for anxiety disorders |
| Depression screening (adults) | B | Adults incl. perinatal and 65+ | Screen for depression |
| Unhealthy alcohol use | B | Adults 18+ incl. pregnant | Screen + brief intervention |
| Unhealthy drug use screening | B | Adults 18+ | Screen via questioning |
| Tobacco cessation (nonpregnant) | A | Nonpregnant adults | Ask, advise, offer behavioral/pharmacologic |
| Tobacco cessation (pregnant) | A | Pregnant persons | Ask, advise, offer behavioral |
| Tobacco use prevention (youth) | B | School-aged tobacco-naïve | Primary care education/counseling |
| STI behavioral counseling | B | Sexually active adolescents/at-risk adults | Behavioral counseling |
| Falls prevention interventions | B | Adults 65+ at increased risk (June 2024 update) | Exercise interventions; multifactorial assessment |
| IPV screening | B | Reproductive-age women incl. perinatal (June 2025 update) | Screen + provide intervention |

### 6.6 Pregnancy / perinatal

| Topic | Grade | Population | Recommendation |
|---|:---:|---|---|
| Aspirin for preeclampsia | B | Pregnant at high risk | Low-dose aspirin (81mg/d) after 12wk |
| Asymptomatic bacteriuria | B | Pregnant | Urine culture screening |
| Breastfeeding counseling | B | Pregnant + postpartum (April 2025 update) | Support interventions/referrals |
| Folic acid | A | Persons planning/able to become pregnant | Daily 0.4-0.8 mg |
| Gestational diabetes | B | Pregnant ≥24 weeks | Universal screening |
| Hypertensive disorders of pregnancy | B | Pregnant | BP monitoring throughout |
| Perinatal depression preventive interventions | B | Pregnant/postpartum at risk | Counseling interventions |
| Rh(D) screening (initial) | A | Pregnant first visit | Blood typing + antibody |
| Rh(D) screening (follow-up) | B | Unsensitized Rh-neg pregnant | Repeat antibody at 24-28wk unless father Rh-neg |
| Syphilis (pregnancy) — May 2025 update | A | Pregnant | Universal early screening (multiple times in some risk profiles) |
| Osteoporosis screening — January 2025 update | B | Postmenopausal women | Bone density per risk factors |

### 6.7 2025-2026 USPSTF updates (citation tags)

| Topic | Update Date | Net Change |
|---|---|---|
| Falls prevention | June 2024 | Strengthened to B for exercise; multifactorial assessment for high-risk |
| Breast cancer screening | April 2024 | Lowered start age 50→40 (biennial through 74) |
| Osteoporosis screening | January 2025 | Updated risk-factor-based screening guidance |
| Breastfeeding counseling | April 2025 | Reaffirmed Grade B |
| IPV screening | June 2025 | Reaffirmed Grade B; expanded population to perinatal |
| Syphilis (pregnancy) | May 2025 | Reaffirmed Grade A; emphasized universal early |

---

## 7. HEDIS Measurement Year 2026

Source: NCQA "HEDIS MY 2026: What's New, What's Changed, What's Retired".[^17] Required-for-Health-Plan-Ratings list (April 2025 posting).[^18]

### 7.1 Major MY 2026 framework shift

- **Technical specifications now align with FHIR®** — same data structure as ECDS (Electronic Clinical Data Systems) measures
- **Risk Adjustment Tables** for MY 2026 posted March 31, 2026
- **Medication List Directory** (NDC codes) updated March 31, 2026
- Migration toward digital quality measures (dQMs) continues

### 7.2 Required for 2026 Health Plan Ratings — primary care relevant

| Measure | Code | Description | Reporting |
|---|---|---|---|
| Breast Cancer Screening | BCS-E | Mammography in women 50-74 within 27 months | ECDS |
| Colorectal Cancer Screening | COL-E | Adults 45-75 with appropriate screening | ECDS |
| Cervical Cancer Screening | CCS-E | Women 21-64 with appropriate cytology/HPV | ECDS (new for MY 2026) |
| Controlling High Blood Pressure | CBP | Adults 18-85 with HTN BP <140/90 (rate 1) | Hybrid; potential rate 2 at <130/80 |
| Comprehensive Diabetes Care (HbA1c poor control) | CDC | A1c >9% in adults 18-75 with diabetes | Hybrid (transitioning to ECDS) |
| Childhood/Adult Immunizations | CIS-E / IMA-E | Per ACIP schedule | ECDS |
| Chlamydia screening | CHL | Sexually active women 16-24 | Administrative |

### 7.3 New / changed in MY 2026

- **CBP:** dual-rate option (140/90 AND 130/80) being phased
- **CCS:** moving from Hybrid to ECDS-only
- **Several measures** moving to digital-only / FHIR specifications

### 7.4 ECDS reporting standard

ECDS (Electronic Clinical Data Systems) reporting allows quality data from:
- Administrative claims
- Case management systems
- HIE feeds
- EHRs
- Patient registries

This **maps cleanly onto our FHIR R4 architecture** — ECDS measures pull from FHIR resources (Observation, Condition, MedicationRequest, Immunization, Procedure, etc.) which we already produce via `server/fhir/mappers/`. **This is the single biggest architectural win available** in this deepening pass.

---

## 8. Implementation tie-back (for plan doc)

Each finding above maps to one or more proposals in `PRIMARY_CARE_IMPLEMENTATION_PLAN_2026-05-03.md`:

| Research finding | Implementation work |
|---|---|
| §1 AWV components + SDOH HRA + 99483 | Dedicated AWV agent or extended Quality agent module |
| §2 HCC V28 100% in 2026 | Replace `coding-agent.js:34-49` HCC map; add V28 lookup table |
| §3 APCM G0556-G0558 + MVP subgroup | New APCM enrollment table + MVP reporting helper |
| §3 QID 487 removal | Remove from quality-agent measures array |
| §4 CCM/TCM/BHI/ACP/RPM full code set | New `care-management-engine.js` module + database tables |
| §5 G2211 + 2026 home-visit expansion | Extend `billing-engine.js` with G2211 detection rules |
| §6 USPSTF Grade A/B catalog | New `uspstf_recommendations` seed table + matcher |
| §7 HEDIS MY 2026 ECDS via FHIR | New `hedis-adapter.js` consuming our FHIR mappers |

---

## Citations (Chicago NB)

[^1]: Centers for Medicare & Medicaid Services, "Annual Wellness Visit," https://www.cms.gov/medicare/coverage/preventive-services/medicare-wellness-visits/annual-wellness-visit (accessed May 3, 2026).

[^2]: Centers for Medicare & Medicaid Services, MLN6775421 "Medicare Wellness Visits," https://www.cms.gov/Outreach-and-Education/Medicare-Learning-Network-MLN/MLNProducts/preventive-services/medicare-wellness-visits.html (accessed May 3, 2026).

[^3]: Centers for Medicare & Medicaid Services, MM13486 "Annual Wellness Visit: Social Determinants of Health Risk Assessment," https://www.cms.gov/files/document/mm13486-annual-wellness-visit-social-determinants-health-risk-assessment.pdf (accessed May 3, 2026).

[^4]: American Academy of Family Physicians, "How to avoid Medicare annual wellness visit denials," https://www.aafp.org/pubs/fpm/blogs/gettingpaid/entry/medicare_awv_coding.html (accessed May 3, 2026).

[^5]: Centers for Medicare & Medicaid Services, "Calendar Year (CY) 2026 Risk Adjustment Implementation Memo," https://www.cms.gov/files/document/cy-2026-risk-adjustment-implementation-memo-g.pdf (accessed May 3, 2026).

[^6]: Centers for Medicare & Medicaid Services, "Risk Adjustment Technical Specifications 2026," https://www.cms.gov/files/document/hhqrp-qm-risk-adjustment-technical-specifications-2026.pdf (accessed May 3, 2026).

[^7]: Centers for Medicare & Medicaid Services, "2026 Model Software/ICD-10 Mappings," https://www.cms.gov/medicare/payment/medicare-advantage-rates-statistics/risk-adjustment/2026-model-software-icd-10-mappings (accessed May 3, 2026).

[^8]: American Academy of Family Physicians, "What Family Physicians Need to Know About the Wave of 2024 HCC Changes," https://www.aafp.org/pubs/fpm/issues/2023/1100/hcc-update.html (accessed May 3, 2026).

[^9]: Centers for Medicare & Medicaid Services, "2026 MIPS Annual Call for Quality Measures Fact Sheet," https://mmshub.cms.gov/sites/default/files/2026-MIPS-Annual-Call-for-Quality-Measures-Fact-Sheet.pdf (accessed May 3, 2026).

[^10]: American Academy of Family Physicians, "AAFP summary of 2026 proposed MPFS outlines payment boost," https://www.aafp.org/news/government-medicine/2026-mpfs-executive-summary.html (accessed May 3, 2026).

[^11]: Centers for Medicare & Medicaid Services QPP, "Value in Primary Care MVP," https://qpp.cms.gov/mips/explore-mips-value-pathways/2024/M0005 (accessed May 3, 2026).

[^12]: American Academy of Family Physicians, "Coding for Advanced Primary Care Management," https://www.aafp.org/family-physician/practice-and-career/getting-paid/coding/advanced-primary-care-management.html (accessed May 3, 2026).

[^13]: Centers for Medicare & Medicaid Services, MLN909188 "Chronic Care Management Services" (June 2025), https://www.cms.gov/files/document/chroniccaremanagement.pdf (accessed May 3, 2026).

[^14]: Centers for Medicare & Medicaid Services, MM13473 "How to Use the Office & Outpatient Evaluation and Management Visit Complexity Add-On Code G2211," https://www.cms.gov/files/document/mm13473-how-use-office-and-outpatient-evaluation-and-management-visit-complexity-add-code-g2211.pdf (accessed May 3, 2026).

[^15]: American Academy of Family Physicians, "G2211 Add-on Code: What It Is and How to Use It," https://www.aafp.org/family-physician/practice-and-career/getting-paid/coding/evaluation-management/G2211-what-it-is-and-how-to-use-it.html (accessed May 3, 2026).

[^16]: U.S. Preventive Services Task Force, "A and B Recommendations," https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics/uspstf-a-and-b-recommendations (accessed May 3, 2026).

[^17]: National Committee for Quality Assurance, "HEDIS MY 2026: What's New, What's Changed, What's Retired," https://www.ncqa.org/blog/hedis-my-2026-whats-new-whats-changed-whats-retired/ (accessed May 3, 2026).

[^18]: National Committee for Quality Assurance, "2026 Health Plan Ratings Required HEDIS, CAHPS Measures" (April 2025), https://wpcdn.ncqa.org/www-prod/2026-HPR-List-of-Required-Performance-Measures_April-2025-Posting.pdf (accessed May 3, 2026).
