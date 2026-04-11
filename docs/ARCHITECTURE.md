# Agentic EHR — Architecture Overview

A single-page tour for external readers. For the canonical module map, read
[`../MODULE_CATALOG.md`](../MODULE_CATALOG.md). For the full design
philosophy, read [`../VISION.md`](../VISION.md). This doc is the bridge
between them.

---

## The one-paragraph pitch

Agentic EHR is a nine-module clinical workflow runtime — nine specialized
agents with defined autonomy tiers, handoffs, and safety boundaries,
assembled behind a single orchestrator. Instead of clicking through
templates, physicians speak. The system listens, extracts structured
clinical data, runs it through a clinical decision support engine, layers
specialty-medicine rules on top, and surfaces draft orders and notes for
physician approval. Nothing ever auto-executes: every dosing change, every
prescription, every order is draft-only until a Tier 3 physician approves.

---

## The 9 CATC modules

CATC = **Clinical Agent Tracking & Coordination**. Every module declares
its tier, its human counterpart, and its primary handoff.

```
┌────────────────┬────────────────┬─────────┬──────────────────────────────┐
│ Module         │ Workflow band  │  Tier   │ Primary handoff              │
├────────────────┼────────────────┼─────────┼──────────────────────────────┤
│ Phone Triage   │ Access         │    1    │ MA, Physician, Front Desk    │
│ Front Desk     │ Access / pre   │    1    │ Patient, Physician, MA       │
│ Med. Assistant │ Protocol exec  │    2    │ Front Desk, Physician        │
│ Physician      │ Clinical gov.  │    3    │ (final authority)            │
│ Scribe         │ Encounter cap  │    3    │ Physician                    │
│ CDS            │ Encounter supp │    2    │ Physician, Orders            │
│ Domain Logic   │ Specialty supp │    3    │ Physician, CDS (adds to)     │
│ Orders         │ Clinical exec  │    3    │ Physician                    │
│ Coding         │ Revenue / doc  │    2    │ Billing, Physician           │
│ Quality        │ Oversight      │    2    │ Physician, Admin             │
└────────────────┴────────────────┴─────────┴──────────────────────────────┘
```

The tenth module — **Domain Logic** — is the specialty-medicine overlay
added in Phase 1. It depends on CDS (`dependsOn: ['cds']`), which means
the orchestrator guarantees CDS runs first and Domain Logic can only
*add* to CDS — never override or suppress a CDS alert. This is the
structural implementation of "standard of care is the guardrail."

---

## Three safety invariants

Every contribution is measured against these rules.

### 1. Patient data stays inside authenticated, auditable workflows

Every PHI-touching route is listed in `server/audit-logger.js` `PHI_ROUTES`,
which forces an audit log entry on every call. RBAC (`server/security/rbac.js`)
gates access by role. PHI at rest is encrypted field-level via
`server/security/phi-encryption.js` (AES-256-GCM, PBKDF2 100k iterations,
per-record IVs).

### 2. Tier 3 outputs stay draft until a physician approves

The `BaseAgent` class (`server/agents/base-agent.js`) enforces this at the
framework level. Any agent at `autonomyTier: 3` that wants to act on a
dosing change must go through `requestDosingApproval()`, which:

1. Validates required fields
2. Audits as an `ESCALATION`
3. Sends a `DOSING_REVIEW_REQUEST` to the physician agent
4. Emits a `SAFETY_LEVEL.LEVEL_1` event on timeout or rejection
5. Only returns an "approved" result when the physician explicitly approves

There is no "just this once" bypass. You cannot write code in `DomainLogicAgent`
that places an order without going through this flow.

### 3. Standard of care is the guardrail for specialty medicine

`DomainLogicAgent` is the first specialty module. Its `process()` method
runs **after** CDS (enforced by the orchestrator's `dependsOn` check),
extracts "guardrails" from the CDS output (urgent / interaction /
contraindication alerts), and then filters its own dosing proposals
against those guardrails. Any conflicting proposal is discarded at engine
level and logged as a LEVEL_1 safety event.

If CDS errored or didn't run, Domain Logic returns zero proposals — it
*fails closed*, not open.

---

## End-to-end request flow (happy path)

```
[Patient speaks]
      ↓
[useSpeechRecognition hook]  — browser-based speech-to-text
      ↓
[2-second debounced autosave]
      ↓
PATCH /api/encounters/:id   — transcript landed in DB
      ↓
[Physician clicks "Extract Data"]
      ↓
POST /api/ai/extract-data   — ai-client.js pattern matching or Claude API
      ↓
[CDS auto-triggers via message bus]
      ↓
[CDSAgent runs cds-engine rules → suggestions]
      ↓
[DomainLogicAgent runs AFTER CDS]
      ↓
   ├── reads CDS output
   ├── extracts guardrails (urgent/interaction/contraindication)
   ├── runs HRT / peptide / functional-med rules
   ├── filters proposals against guardrails
   └── emits dosing proposals via requestDosingApproval()
      ↓
[Physician reviews in Encounter UI]
      ↓
[Physician approves] → [OrdersAgent assembles order] → [audit log entry]
```

Every arrow in that flow is audited. Every Tier 3 step requires physician
approval. No step auto-executes.

---

## Data flows (what the CATC wire diagram carries)

The message bus (`server/agents/message-bus.js`) wires modules together
using typed events. Key event types:

| Event | Emitted by | Consumed by |
|---|---|---|
| `ENCOUNTER_COMPLETED` | Orchestrator | Scribe, CDS, Domain Logic, Coding, Quality |
| `NOTE_SIGNED` | Physician | Coding, MediVault, PatientLink |
| `CARE_GAP_DETECTED` | Quality | Orders, MA |
| `LAB_RESULTED` | LabSynthesisAgent | CDS, Domain Logic, Results Routing |
| `LAB_SYNTHESIS_READY` | LabSynthesisAgent | CDS, Domain Logic |
| `DOSING_REVIEW_REQUEST` | Domain Logic (or any Tier 3) | Physician |
| `DOSING_APPROVED` / `DOSING_REJECTED` | Physician | Originating agent |
| `FUNCTIONAL_PATTERN_DETECTED` | Domain Logic | CDS (informational), Physician |
| `TRANSLATION_READY` | ClinicalAssist (future) | Patient App, PatientLink |
| `PATIENT_LETTER` | Physician | PatientLink |
| `PRIOR_AUTH_UPDATE` | Pharma (future) | Orders, Physician |

---

## Integrations

### Claude API (optional, via `ai-client.js`)

The AI client is a lazy-singleton wrapper with a 30-second `Promise.race`
timeout. In `AI_MODE=mock` (the default), it runs pattern-matching
regex-based extractors. In `AI_MODE=api`, it hits the Anthropic Claude
API using `ANTHROPIC_API_KEY`.

No PHI is ever sent to Claude without an explicit config opt-in. Mock mode
is the default precisely so contributors can run the full test suite
offline.

### LabCorp (Phases 2a-2c)

The LabCorp integration (`server/integrations/labcorp/`) follows the same
lazy-singleton pattern. In `LABCORP_MODE=mock`, it reads PDF/XML fixtures
from `mock-responses/`. In `LABCORP_MODE=api`, it goes through OAuth2
against the LabCorp developer portal. OAuth tokens are stored encrypted
in the `labcorp_tokens` table. The parser output feeds into
`LabSynthesisAgent`, which emits `LAB_SYNTHESIS_READY` for CDS and Domain
Logic to consume.

### MediVault (Phase 3c)

MediVault is the patient-owned data layer. `GET /api/medivault/export/:patientId`
assembles a FHIR R4 Bundle from the patient's conditions, allergies,
medications, and observations, and returns it with
`Content-Disposition: attachment; filename="medivault-<id>-<date>.json"`.
Every export is double-audited: the route writes a `vault_access_log`
row with the caller's identity, and the global audit-logger writes an
`audit_log` row via a `PHI_ROUTES` entry.

---

## Stack at a glance

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (tested on 18 / 20 / 22) |
| Web server | Express |
| Database | SQLite3 (WAL mode) |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| Speech | Browser Web Speech API |
| AI (optional) | Anthropic Claude via `ai-client.js` |
| Lab integration | LabCorp API (Phase 2) |
| Container | Dockerfile + docker-compose |
| Tests | Custom harness, 250+ scenarios |

---

## Where to read next

- **Add a new agent**: [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → "How to add a new agent"
- **Add a new clinical rule**: [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → "How to add a new clinical rule"
- **Full CATC module map**: [`../MODULE_CATALOG.md`](../MODULE_CATALOG.md)
- **Design philosophy**: [`../VISION.md`](../VISION.md)
- **Deployment**: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- **Demo walkthrough**: [`./DEMO_SCRIPT.md`](./DEMO_SCRIPT.md)
