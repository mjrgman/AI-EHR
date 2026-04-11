# Agentic EHR — 3-Minute Demo Script

A scripted walkthrough of the full clinical loop: ambient voice capture →
specialty-medicine recommendation → LabCorp result pull → patient-owned
MediVault export. Intended as a reference for anyone producing a demo
video, recording a screencast, or presenting the project live.

**Total runtime**: 3 minutes (180 seconds)
**Demo patient**: Sarah Mitchell (MRN 2018-04792) — seed data, no PHI
**Pre-flight**: `npm run dev` running; browser at http://localhost:5173;
logged in as "Dr. Provider".

---

## Scene 1 — The pitch (0:00 – 0:20, 20 seconds)

**On screen**: README hero section, Agentic EHR logo, blank encounter page.

**Voiceover**:

> "This is Agentic EHR. It's a nine-module clinical workflow runtime that
> replaces legacy EHR templates with ambient voice capture, decision
> support, and physician-gated automation. Nothing ever auto-executes.
> Every dosing change, every prescription, every order is draft-only
> until a physician approves. Let me show you."

**On-screen action**:
- Open dashboard, Sarah Mitchell row highlighted
- Click into her encounter

**Captured still**: `preview_screenshot` of dashboard with Sarah's row.

---

## Scene 2 — Ambient voice capture (0:20 – 1:00, 40 seconds)

**On screen**: `EncounterPage.jsx`, transcript pane empty, "Start Recording"
button prominent.

**Voiceover**:

> "I see Sarah Mitchell. She's a 52-year-old with type 2 diabetes and
> CKD stage 3. Today she's asking about testosterone replacement for
> her husband — she wants to know what's involved. I'll just talk."

**On-screen action**:
- Click "Start Recording" (or paste a pre-recorded transcript into the
  textarea so the demo is reproducible and doesn't depend on the browser
  microphone)
- Transcript fills in: _"Sarah Mitchell, 52-year-old female, established
  patient. Husband interested in testosterone replacement. Discussed
  starting testosterone cypionate 100mg IM every 2 weeks. Will check
  baseline total testosterone, PSA, hematocrit."_

**On-screen action**:
- Auto-save indicator fires at 2 seconds
- Click "Extract Data"
- Structured output appears: vitals, meds, problems extracted

**Captured still**: the transcript area with the text visible plus the
extraction pop-out.

**Voiceover**:

> "The system pulls structured data out of the transcript — vitals,
> medications, problems — and hands it to the agent pipeline."

---

## Scene 3 — CDS + Domain Logic fire (1:00 – 1:45, 45 seconds)

**On screen**: CDS pane on the right.

**Voiceover**:

> "The CDS agent runs first. It's looking at standard-of-care rules:
> drug interactions, care gaps, screening reminders. Watch the right
> pane."

**On-screen action**:
- CDS suggestions pane populates: routine labs due, screening reminders

**Voiceover**:

> "Now the Domain Logic agent runs — this is the specialty-medicine
> overlay. It only runs *after* CDS, and it can only add to CDS output,
> not override it. It's picked up the testosterone keywords."

**On-screen action**:
- Switch to HRT / Peptide tab (4th mobile tab)
- HRT panel shows: proposed regimen card, evidence citation
  (Endocrine Society 2018), monitoring labs due

**Voiceover**:

> "The Domain Logic agent has proposed an initiation regimen — testosterone
> cypionate 100mg IM every 2 weeks — with the evidence citation inline.
> Because this is a dosing change, the agent sends it through
> `requestDosingApproval()`. Nothing ships until I approve it."

**On-screen action**:
- Point at the "awaiting approval" badge on the proposed regimen card

**Captured still**: HRT panel with the proposed regimen + "awaiting approval"
badge.

---

## Scene 4 — LabCorp result comes back (1:45 – 2:25, 40 seconds)

**On screen**: still the HRT tab, but switch to showing a prior lab order
for Sarah that's been resulted.

**Voiceover**:

> "Let me show you what happens when a lab result lands. In production
> this comes from LabCorp over an authenticated API — in demo mode we're
> reading a mock PDF fixture, but the agent pipeline is exactly the same."

**On-screen action**:
- Trigger a mock LabCorp result (via the demo admin button or a scripted
  message bus emit)
- `LabSynthesisAgent` parses the result, emits `LAB_SYNTHESIS_READY`
- CDS + Domain Logic re-evaluate with the new labs
- A new CDS alert appears: "Hematocrit 54% — erythrocytosis threshold"

**Voiceover**:

> "The lab synthesis agent parsed the PDF, normalized it to our data
> model, and the CDS engine fired an erythrocytosis alert. Because
> Domain Logic runs after CDS, it picks this up as a guardrail and
> automatically blocks any testosterone dose increase proposal. That's
> the 'standard of care is the guardrail' invariant — specialty rules
> can never override a mainstream safety signal."

**Captured still**: CDS alert + blocked dose increase with the engine-level
safety-event log entry visible.

---

## Scene 5 — MediVault patient-owned export (2:25 – 2:55, 30 seconds)

**On screen**: Review & Sign section at the bottom of the encounter page.

**Voiceover**:

> "The last piece is patient ownership. This is Sarah's data — if she
> asks for it, she gets it, in a format any downstream system can read."

**On-screen action**:
- Click "Export (MediVault)" button
- Browser download fires: `medivault-1-2026-04-11.json`
- Open the JSON in a viewer — show it's a FHIR R4 Bundle with
  `resourceType: "Bundle"`, `type: "collection"`, and entries for
  Patient, Conditions, AllergyIntolerances, MedicationRequests,
  and Observations

**Voiceover**:

> "That's a FHIR R4 Bundle. Every resource type a downstream EHR or
> patient portal would expect. And every export is double-audited — the
> vault access log names the caller, and the global HIPAA audit logger
> writes its own row. Patients own their data, we own the proof of
> who touched it."

**Captured still**: the FHIR Bundle JSON opened in a viewer + the
`vault_access_log` table query result showing the export row.

---

## Scene 6 — Close (2:55 – 3:00, 5 seconds)

**On screen**: back to the GitHub repo.

**Voiceover**:

> "Agentic EHR. Open source. Nine CATC modules. Tier 3 gates everywhere
> they matter. Repo link in the description."

**Captured still**: README top of page.

---

## Recording checklist

Before you hit record:

- [ ] `git stash` any WIP — the demo runs on `main`
- [ ] `rm data/ehr.db && npm run seed` to get a clean Sarah Mitchell
- [ ] `npm run dev` — confirm frontend + backend up
- [ ] Test every scene end-to-end before recording
- [ ] Browser zoom at 100% — no accidental zooms mid-record
- [ ] Hide any personal bookmarks, extensions, or tab titles
- [ ] Test audio levels — voiceover clipping is the #1 reason demos
      look unprofessional

## PHI hygiene

- **Only use Sarah Mitchell and Robert Chen** — the two synthetic seed
  patients
- **Never use a real patient name or MRN**, even as a "just for demo"
  placeholder
- **Audit log screenshots** — scrub any `accessed_by` values that look
  like real usernames; use `demo-provider` throughout
- **If anything on screen could look like PHI to a reviewer, cut the
  frame or blur it**

## Post-production notes

- **Time the scenes**: 20 + 40 + 45 + 40 + 30 + 5 = 180 seconds exactly
- **If you run over**, trim Scene 3 — the CDS fire is the most
  editable section
- **If you run under**, expand Scene 4 with a second lab fixture
- **Captions**: generate auto-captions and review — clinical terms
  (erythrocytosis, cypionate, hematocrit) are frequently miscaptioned
- **Music**: optional, but if used keep it under −20 dB and cut during
  voiceover
