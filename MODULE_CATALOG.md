# Agentic EHR Module Catalog

This document is the canonical operating map for the runtime modules in the AI EHR.

The code-level source of truth lives in `server/agents/module-registry.js`.

## Operating rules

- Patient data stays inside authenticated, auditable workflows.
- Any Tier 3 output remains draft or recommendation-only until a physician approves it.
- Every module has a defined human counterpart, handoff target, and safety boundary.
- The product is a 14-module clinical workflow system (11 encounter modules + 3 patient-data governance modules), not an unstructured pile of agents.

## Module map

| Module | Workflow band | Human counterpart | Tier | Mission | Primary handoff |
|---|---|---|---|---|---|
| Phone Triage | Access | Phone triage / nurse intake | 1 | Turn inbound calls into urgency-classified chart events and routing decisions | MA, Physician, Front Desk |
| Front Desk | Access and pre-visit | Front desk / scheduling | 1 | Manage scheduling, patient contact, and pre-visit briefing assembly | Patient, Physician, MA |
| Medical Assistant | Protocol execution | Medical assistant | 2 | Execute refill, lab, and patient-support workflows inside clinician-defined protocols | Front Desk, Physician |
| Physician | Clinical governance | Physician | 3 | Own protocol setting, escalation handling, note shaping, and final clinical authority | MA, Orders, Patient, Chart |
| Scribe | Encounter capture | Ambient scribe | 3 | Capture the encounter, extract structure, and draft the SOAP note | Physician, CDS, Orders, Coding, Quality |
| CDS | Encounter support | Clinical decision support | 2 | Surface alerts, care gaps, medication risks, and evidence-based suggestions | Physician, Orders, Quality |
| Domain Logic | Encounter support (specialty domain) | Functional-medicine / HRT / peptide specialist | 3 | Evaluate hormone, peptide, and functional-medicine patterns against evidence-based rules; propose dosing changes | Physician (via `DOSING_REVIEW_REQUEST`), CDS, Orders, MediVault Red Flag |
| Orders | Clinical execution | Ordering workflow | 3 | Consolidate labs, imaging, referrals, and prescriptions into structured order packets | Physician approval and downstream services |
| Coding | Revenue and documentation | Coding / billing review | 2 | Generate E&M support, ICD-10 mapping, and coding completeness feedback | Physician, billing staff |
| Quality | Oversight and population health | Quality / compliance operations | 2 | Track care gaps, measures, and readiness for quality programs | Physician, MA, quality operations |
| Annual Wellness Visit | Preventive visit | Physician (with MA pre-visit prep) | 2 | Detect AWV encounter type, enforce required CMS components, and surface G0438/G0439 plus add-on opportunities | Physician, Coding, Quality |
| PatientLink | Patient communication | Patient communication coordinator | 2 | Draft patient-facing communications (after-visit summaries, care gap outreach, lab notifications, appointment reminders) at 6th-grade reading level | Physician approval, then patient portal or messaging |
| Patient App | Patient-facing | Patient portal / kiosk | 1 | Patient-facing portal for registration, scheduling, refill requests, lab results, secure messaging, and voice interaction | PatientLink, MA, Front Desk, Phone Triage |
| MediVault | Patient data governance | Health information management / patient records | 3 | Patient-directed health-data governance: ingestion, dedup, reconciliation, specialty packaging, plain-language translation, red-flag monitoring | Physician (red flags + translations), PatientLink, CDS |

The first 11 rows above are the **encounter modules** (Phone Triage through Annual Wellness Visit - the workflow that produces a clinical encounter). The last 3 rows are the **patient-data governance modules** (PatientLink, Patient App, MediVault - the workflow that delivers data to and from the patient). They are listed in the runtime registry in the same `MODULE_ORDER` array, but they answer different questions: encounter modules answer "what happens in a visit", governance modules answer "what data flows to and from the patient outside the visit".

### Runtime wiring status (orchestrator vs. catalog)

The catalog above is the design map. The **agent orchestrator** (`server/agents/index.js`) actually registers **10 of these 14 modules** as runtime agents: Phone Triage, Front Desk, Medical Assistant, Physician, Scribe, CDS, Domain Logic, Orders, Coding, and Quality. The remaining 4 are **built but not wired into the orchestrator**:

- **Annual Wellness Visit** — `AWVAgent` is a complete `BaseAgent` subclass (`dependsOn: ['scribe','cds']`) but is **not registered** with the orchestrator and is never invoked through the pipeline. AWV component checking that does run today is an inline fallback inside `quality-agent.js` (`_checkAWVComponents`), not the standalone agent. Status: **built, not wired.**
- **PatientLink** — only the `toPlainLanguage()` helper is imported into the patient-portal route; the `PatientLinkAgent` class (after-visit summaries, care-gap drafting, etc.) is **not instantiated** in production. Status: **built, not wired.**
- **MediVault** — all 6 MediVault agents (ingestion, dedup, reconciliation, packaging, translation, red-flag) instantiate, but the only HTTP surface is `GET /medivault/export/:patientId` (FHIR export). The dedup → reconcile → red-flag flow has **no production entry point** (message-bus handlers are pass-through with no listeners). Status: **FHIR export surfaced; full agent pipeline built, not wired.**
- **Patient App** — patient-facing portal surface; its agent-side governance flow shares MediVault/PatientLink wiring above. Status: **portal routes present; agent governance flow not fully wired.**

When these modules are registered/surfaced, update this note and the orchestrator comment in `server/agents/index.js` together.

## Patient control and safety boundaries

- Phone Triage: verified caller context and approved triage protocols only; emergency routing must be explicit.
- Front Desk: respects contact preferences and scheduling context; makes no clinical decisions.
- Medical Assistant: acts only inside approved protocols and escalates exceptions.
- Physician: remains final human decision-maker for all Tier 3 outputs.
- Scribe: draft-only; nothing reaches the permanent record without clinician review.
- CDS: recommendation-only; does not diagnose, treat, or silently change care.
- Domain Logic: recommendation-only and draft-only; every dosing change routes through `requestDosingApproval()` → physician `DOSING_REVIEW_REQUEST` and cannot auto-execute. Evidence source is a mandatory field on every rule.
- Orders: prepares structured orders but does not transmit without physician authorization.
- Coding: supports accurate coding but cannot distort clinical truth for reimbursement.
- Quality: flags gaps and compliance risks; does not auto-order care.
- Annual Wellness Visit: recommendation-only checklist; physician signs component completeness before billing.
- PatientLink: drafts only — no patient-facing message reaches the patient without physician review.
- Patient App: patient-initiated actions only; clinical content (lab results, medications) is read-only; refill requests and symptom reports route through physician review.
- MediVault: all clinical output is Tier 3 — physician reviews before any translated content reaches the patient. Data governance is patient-directed but clinician-validated. See `docs/MEDIVAULT_BOUNDARY.md` for the EHR-of-record vs vault-of-record split.

## Dependency shape

- Access layer: `phone_triage`, `front_desk`, `ma`, `physician`
- Encounter layer phase 1: `scribe`, `cds`, `domain_logic`
- Encounter layer phase 2: `orders`, `coding`
- Oversight and preventive layer phase 3: `quality`, `awv`
- Patient-data governance layer (runs alongside encounter pipeline, not in it): `patient_link`, `patient_app`, `medivault`

## Domain Logic module — scope note

The Domain Logic module mirrors the CDS engine's shape (rule loader + evaluator + suggestion
emitter) but targets specialty-medicine knowledge that falls outside mainstream primary-care
guidelines: functional-medicine patterns, bioidentical hormone replacement, peptide therapy
titration, and similar clinician-authored protocols. Rules live in
`server/domain/rules/*.js` and are loaded by `server/domain/knowledge-base.js`. The agent
consumes encounter context plus lab results, emits `FUNCTIONAL_PATTERN_DETECTED` for
informational findings, and uses `requestDosingApproval()` for any therapy change. Because
this domain has narrower evidence bases and tighter safety windows than guideline-driven
primary care, the module runs at Tier 3 — nothing executes without an explicit physician
approval captured in the audit trail.

## Why this matters

- The README, vision docs, and runtime metadata should all describe the same system.
- Future UI work can render module metadata directly from the registry instead of duplicating labels by hand.
- Refinement work should happen against these modules and their handoffs, not against vague "AI agent" marketing language.
