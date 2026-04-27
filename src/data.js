// ============================================================
// MJR Demo Patient — Robert Hayes, 68M
// On TRT (8 yrs) + semaglutide (14 mo) + lifestyle program.
// Today: 6-month follow-up, new labs, mild fatigue, knee pain.
// ============================================================

export const PATIENT = {
  id: "MRN-104821",
  name: "Robert Hayes",
  preferredName: "Bob",
  pronouns: "he/him",
  dob: "1957-11-04",
  age: 68,
  sex: "M",
  insurance: "Medicare + AARP supplement",
  pcp: "J. Reyes, MD",
  height: "5’11”",
  weight: "212 lb",
  weightStart: "248 lb",
  weightDelta: "−36 lb / 14 mo",
  bmi: 29.6,
  bmiStart: 34.6,
  allergies: [
    { name: "Sulfa drugs", reaction: "rash", severity: "moderate" },
    { name: "Latex", reaction: "contact dermatitis", severity: "mild" }
  ],
  problems: [
    { name: "Hypertension, controlled", icd10: "I10", since: "2014-04", active: true, note: "lisinopril 20 mg" },
    { name: "Type 2 diabetes mellitus", icd10: "E11.9", since: "2019-06", active: true, note: "A1c 6.1, at goal" },
    { name: "Hyperlipidemia", icd10: "E78.5", since: "2020-08", active: true, note: "atorvastatin 40 mg" },
    { name: "Osteoarthritis, bilateral knees", icd10: "M17.0", since: "2021-06", active: true, note: "new flare \u2014 today" },
    { name: "Obesity (class I)", icd10: "E66.01", since: "2018-02", active: true, note: "BMI 29.6, improving" },
    { name: "Vitamin D deficiency", icd10: "E55.9", since: "2022-01", active: true },
    { name: "Hypogonadism", icd10: "E29.1", since: "2017-09", active: true, note: "TRT \u00b7 specialty" }
  ],
  medications: [
    { name: "Lisinopril", dose: "20 mg", route: "PO", freq: "daily", since: "2014-05", class: "Antihypertensive" },
    { name: "Metformin XR", dose: "1000 mg", route: "PO", freq: "BID", since: "2019-07", class: "Diabetic" },
    { name: "Atorvastatin", dose: "40 mg", route: "PO", freq: "QHS", since: "2020-08", class: "Statin" },
    { name: "Semaglutide", dose: "1.7 mg", route: "SC", freq: "weekly", since: "2025-02", class: "GLP-1" },
    { name: "Cholecalciferol", dose: "5000 IU", route: "PO", freq: "daily", since: "2022-02", class: "Supplement" },
    { name: "Testosterone cypionate", dose: "100 mg", route: "IM", freq: "weekly", since: "2017-10", class: "TRT" },
    { name: "Anastrozole", dose: "0.5 mg", route: "PO", freq: "twice weekly", since: "2019-02", class: "TRT" }
  ],
  vitals: {
    bp: "126/78", hr: 64, rr: 14, temp: "98.1 °F", spo2: "97%",
    weight: "212 lb", recordedAt: "10:42 a.m. · today",
    recordedBy: "C. Watanabe, MA"
  },
  trt: {
    regimen: "Testosterone cypionate IM + anastrozole",
    startDate: "2017-10-04",
    yearsOn: 8,
    cypionate: { dose: "100 mg", schedule: "weekly IM, alternating glutes" },
    anastrozole: { dose: "0.5 mg PO", schedule: "Mon + Thu" },
    lastTitration: "2024-09-12 — dose held at 100 mg/wk",
    targetTotalT: "500–900 ng/dL",
    currentTotalT: 742,
    estradiolTarget: "20–40 pg/mL",
    currentEstradiol: 28,
    nextReview: "2026-10-12",
    consent: "On file — last reviewed 2025-10-04"
  },
  glp1: {
    drug: "Semaglutide",
    weeks: 62,
    titration: [
      { week: "0–4", dose: "0.25 mg" },
      { week: "5–8", dose: "0.5 mg" },
      { week: "9–16", dose: "1.0 mg" },
      { week: "17–40", dose: "1.5 mg" },
      { week: "41–now", dose: "1.7 mg" }
    ],
    weightHistory: [248, 241, 233, 226, 220, 215, 212],
    sideEffects: "GI tolerated; transient nausea wk 1–2 of each step.",
    nextReview: "Today — plateau at 1.7 mg, decision pending"
  },
  peptide: {
    candidate: "BPC-157",
    indication: "Patient request — bilateral knee OA, slow recovery from yardwork",
    proposedDose: "250 mcg SC BID × 4 weeks",
    weight_kg: 96.2,
    contraindications: [],
    note: "Off-label — informed consent required, document Tier C evidence."
  },
  labs: [
    { name: "Total testosterone", value: 742, unit: "ng/dL", ref: "500–900 (TRT target)", date: "2026-04-22", tier: "A", trend: "flat", history: [620, 681, 705, 742] },
    { name: "Free testosterone", value: 14.2, unit: "pg/mL", ref: "9–26", date: "2026-04-22", tier: "A", trend: "flat" },
    { name: "Estradiol (sensitive)", value: 28, unit: "pg/mL", ref: "20–40 (on AI)", date: "2026-04-22", tier: "A", trend: "flat" },
    { name: "PSA", value: 1.4, unit: "ng/mL", ref: "<4.0", date: "2026-04-22", tier: "A", trend: "flat", history: [0.9, 1.1, 1.2, 1.4] },
    { name: "Hemoglobin", value: 16.8, unit: "g/dL", ref: "13.5–17.5", date: "2026-04-22", tier: "A", trend: "up", flag: "borderline" },
    { name: "Hematocrit", value: 51.2, unit: "%", ref: "41–53", date: "2026-04-22", tier: "A", trend: "up", flag: "borderline" },
    { name: "HbA1c", value: 6.1, unit: "%", ref: "<7.0 (DM)", date: "2026-04-22", tier: "A", trend: "down", history: [8.4, 7.6, 6.8, 6.1] },
    { name: "Vitamin D, 25-OH", value: 31, unit: "ng/mL", ref: "30–100", date: "2026-04-22", tier: "B", trend: "up" },
    { name: "hs-CRP", value: 3.1, unit: "mg/L", ref: "<3.0", date: "2026-04-22", tier: "A", trend: "up", flag: "borderline" },
    { name: "LDL cholesterol", value: 88, unit: "mg/dL", ref: "<100", date: "2026-04-22", tier: "A", trend: "down" },
    { name: "ALT", value: 22, unit: "U/L", ref: "<35", date: "2026-04-22", tier: "A", trend: "down" }
  ],
  history: [
    { date: "2026-04-22", type: "Lab draw", note: "Pre-visit panel — ordered by MA agent" },
    { date: "2025-10-04", type: "Office visit", note: "TRT consent re-review; A1c 6.8" },
    { date: "2025-04-12", type: "Office visit", note: "GLP-1 titration to 1.5 mg; weight − 22 lb" },
    { date: "2025-02-08", type: "Office visit", note: "Semaglutide initiated; baseline labs" },
    { date: "2024-09-12", type: "Office visit", note: "TRT dose held — hct trending up" },
    { date: "2024-04-15", type: "Telehealth", note: "Annual TRT review" }
  ]
};

export const PATIENT_VOICE = [
  {
    source: "Pre-visit intake — yesterday, 6:14 p.m.",
    quote: "I want to keep losing weight but I’m starting to plateau. And my knees are killing me when I get up from the couch.",
    flags: ["weight-plateau", "arthralgia", "patient-priority"]
  },
  {
    source: "Phone triage — yesterday, 6:22 p.m.",
    quote: "A guy at my gym started peptides for joint pain. Worth talking about, or marketing?",
    flags: ["peptide-inquiry"]
  },
  {
    source: "MA intake — today, 10:42 a.m.",
    quote: "Energy is good. Sleep is fine. Erections are fine. I’m not stopping the testosterone.",
    flags: ["TRT-priority"]
  },
  {
    source: "Live transcript — today, 10:51 a.m.",
    quote: "I’d rather climb the semaglutide dose than add another pill. And I want to know what to do about the knees.",
    flags: ["shared-decision", "patient-priority"]
  }
];

export const TRANSCRIPT = [
  { t: "10:48:02", who: "MD", text: "Bob, six-month check-in. Walk me through how you’re feeling on the semaglutide and the testosterone." },
  { t: "10:48:14", who: "PT", text: "Testosterone’s great. Energy’s fine, lifting fine, sleep fine. I’m not stopping that." },
  { t: "10:48:33", who: "PT", text: "Semaglutide — I lost 36 pounds total but the last six weeks I’ve barely moved. Plateau." },
  { t: "10:49:08", who: "MD", text: "Side effects? Any GI?" },
  { t: "10:49:18", who: "PT", text: "Nope. Tolerating it well. The only thing is my knees — yardwork on Saturday flared them." },
  { t: "10:50:02", who: "MD", text: "Let’s look at labs. A1c is 6.1 — that’s great. Hematocrit’s creeping up at 51.2 again." },
  { t: "10:50:33", who: "PT", text: "Same as last fall? You held my dose then." },
  { t: "10:51:12", who: "PT", text: "I’d rather climb the semaglutide dose than add another pill. And I want to know what to do about the knees." }
];

export const AGENTS = {
  pre_visit: [
    { key: "phone_triage", label: "Phone Triage", role: "Pre-visit", status: "complete", time: "yesterday 6:22 p.m.", confidence: 0.94, headline: "Routed to TRT/GLP-1 follow-up + peptide inquiry sub-topic", detail: "Symptoms: weight plateau, knee arthralgia. Urgency: routine. Patient also requested education on BPC-157 — flagged for physician.", quote: "A guy at my gym started peptides for joint pain.", tier: "B" },
    { key: "front_desk", label: "Front Desk", role: "Pre-visit", status: "complete", time: "today 8:30 a.m.", confidence: 0.97, headline: "1-page briefing prepared — 4 sections, 3 priorities", detail: "Pulled active problems, current meds, last 6 visits, 14-month GLP-1 timeline, 8-year TRT history. Surfaced peptide question for physician review.", tier: "B" },
    { key: "ma", label: "MA", role: "Pre-visit", status: "complete", time: "today 10:42 a.m.", confidence: 0.99, headline: "Vitals captured • 8 pre-visit labs resulted", detail: "BP 126/78, weight 212 lb (−2 from last visit). Labs back: CBC, CMP, HbA1c, lipids, total/free T, estradiol, PSA, 25-OH D, hs-CRP. PHQ-2: 0.", quote: "Energy is good. I’m not stopping the testosterone.", tier: "A" },
    { key: "physician_pre", label: "Physician (pre)", role: "Pre-visit", status: "review_needed", time: "queued", confidence: 0.78, headline: "Awaiting your review — peptide request needs informed consent", detail: "BPC-157 is off-label; evidence Tier C. MA agent prepared a consent draft and a 4-week monitoring plan if you proceed.", tier: "C" }
  ],
  encounter: [
    { key: "scribe", label: "Scribe", role: "In-encounter", status: "live", time: "live", confidence: 0.91, headline: "Drafting SOAP — 78% complete", detail: "Subjective + HPI captured. Objective: vitals + exam pending. Assessment: 2 candidates pending your selection.", tier: "A" },
    { key: "cds", label: "CDS", role: "In-encounter", status: "advisory", time: "live", confidence: 0.88, headline: "4 advisories — 2 evidence-graded recommendations", detail: "Hct 51.2 — consider therapeutic phlebotomy or TRT dose review. hs-CRP rising. 25-OH D recheck in 8 wk. Mammogram does not apply (M).", tier: "A" },
    { key: "orders", label: "Orders", role: "In-encounter", status: "ready", time: "live", confidence: 0.93, headline: "3 orders staged — awaiting cosign", detail: "Lab: CBC recheck 4 wk. Imaging: bilateral knee X-ray, weight-bearing. Standing TRT renewal queued.", tier: "A" },
    { key: "coding", label: "Coding", role: "In-encounter", status: "draft", time: "live", confidence: 0.86, headline: "Suggested E&M 99214 — 5 ICD-10 candidates", detail: "MDM moderate (chronic w/ exacerbation + new sx). ICDs: E29.1, E11.9, E66.01, M17.0, E55.9.", tier: "B" },
    { key: "quality", label: "Quality", role: "In-encounter", status: "watch", time: "live", confidence: 0.95, headline: "1 open care gap — colonoscopy due", detail: "Last colonoscopy 2018; due now per USPSTF. Reminder queued for check-out unless deferred.", tier: "A" }
  ]
};

export const CDS = [
  { id: "cds-1", title: "Hematocrit 51.2% — trending up on TRT", body: "Hct rising over 3 draws (49.4 → 50.6 → 51.2). Consider dose review or therapeutic phlebotomy.", evidence: "Endocrine Society 2024, IIa", tier: "A", urgency: "routine", action: "Open TRT panel", quote: "You held my dose then.", quoteSource: "Patient — today, 10:50 a.m." },
  { id: "cds-2", title: "GLP-1 plateau — dose escalation candidate", body: "Weight loss flat × 6 wk on 1.7 mg. Per protocol, consider 2.0 mg or 2.4 mg if tolerated.", evidence: "STEP-1 / SELECT 2024", tier: "A", urgency: "routine", action: "Open GLP-1 panel" },
  { id: "cds-3", title: "Bilateral knee X-ray, weight-bearing", body: "OA flare reported. Imaging will inform escalation pathway (PT, intra-articular, or referral).", evidence: "AAOS 2023", tier: "B", urgency: "routine", action: "Add imaging order" },
  { id: "cds-4", title: "Colonoscopy overdue (USPSTF / HEDIS COL-E)", body: "Last screening 2018. Patient is 68M, due now.", evidence: "USPSTF 2024 Grade A", tier: "A", urgency: "routine", action: "Order screening" },
  { id: "cds-5", title: "BPC-157 — evidence brief", body: "Off-label peptide. No FDA approval. Limited clinical signal for soft-tissue healing; no long-term safety data.", evidence: "Tier C — mostly preclinical", tier: "C", urgency: "informational", action: "Open consent template" }
];

// SOAP note draft (with inline CDS markers as [[cds-N]] tokens)
export const SOAP_DRAFT = {
  subjective: "68M, 8 years on TRT (cypionate 100 mg IM weekly + anastrozole 0.5 mg twice weekly) and 14 months on semaglutide for T2DM/obesity, presents for 6-month follow-up. Reports stable energy, libido, and sleep on TRT — explicit priority to continue. Reports 36-lb total weight loss on semaglutide with a 6-week plateau at 1.7 mg. No GI side effects. New chief complaint: bilateral knee pain, worse after yardwork Saturday. Patient inquired about BPC-157 peptide for joint recovery.",
  objective: "Vitals: BP 126/78, HR 64, RR 14, T 98.1°F, SpO2 97%, weight 212 lb (BMI 29.6, down from 34.6). Labs (today): Total T 742 ng/dL, Free T 14.2 pg/mL, E2 28 pg/mL, PSA 1.4, Hgb 16.8 [[cds-1]], Hct 51.2 [[cds-1]], A1c 6.1 (down from 6.8), 25-OH D 31, hs-CRP 3.1, LDL 88, ALT 22. Exam pending.",
  assessment: "(1) Hypogonadism on TRT — well-controlled, target labs achieved; hematocrit borderline elevated, monitor. (2) T2DM on semaglutide — excellent glycemic response; weight plateau on 1.7 mg [[cds-2]]. (3) Bilateral knee OA — acute flare; imaging warranted [[cds-3]]. (4) Patient request — BPC-157 peptide [[cds-5]]; off-label, evidence Tier C, requires informed consent. (5) Care gap — colonoscopy overdue [[cds-4]].",
  plan: "Continue TRT at current dose; recheck CBC in 4 wk; if Hct >52% consider phlebotomy. Escalate semaglutide to 2.0 mg with standard nausea precautions. Order bilateral knee X-ray, weight-bearing. Refer to PT. Defer BPC-157 pending knee imaging and patient education — consent template attached if patient elects to proceed. Schedule screening colonoscopy. Continue lisinopril, atorvastatin, metformin, vitamin D. Follow up 12 weeks."
};
