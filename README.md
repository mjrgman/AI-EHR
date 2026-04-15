# Agentic EHR

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**A ground-up reimagining of the Electronic Health Record.**

Legacy EHRs are template-driven data entry systems that burn out clinicians and fragment patient information across silos. Agentic EHR replaces that paradigm entirely. Instead of clicking through rigid forms, physicians speak naturally during patient encounters. The system listens, extracts structured clinical data from conversation, generates professional documentation, and surfaces evidence-based decision support — all in real time.

This is not an incremental upgrade to existing EHR workflows. It is a fundamentally different architecture: ambient voice input replaces manual data entry, AI-powered NLP replaces templates, and a multi-agent system learns each provider's documentation preferences over time. The goal is to return the physician's attention to the patient, not the screen.

Built by Dr. Michael Renner / [ImpactMed Consulting, LLC](https://impactmedconsulting.com).

---

## Features

- **Ambient voice capture** — real-time speech-to-text during clinical encounters
- **Automatic data extraction** — vitals, medications, problem lists, ROS, physical exam findings
- **SOAP note generation** — professional documentation from conversational input
- **Clinical Decision Support (CDS)** — evidence-based alerts, drug interaction checks, care gap detection
- **HRT / Peptide / Functional Medicine support** — specialty-medicine `DomainLogicAgent` with Tier 3 dosing-approval gate, hormone/peptide keyword routing, and a dedicated Encounter tab (see [HRT & Peptide Support](#hrt--peptide-support))
- **LabCorp integration** — pluggable client with OAuth2 + PDF/XML result parsing and mock mode for offline tests (see [LabCorp Integration](#labcorp-integration))
- **MediVault patient-owned export** — one-click FHIR R4 Bundle download of the patient's full record via `GET /api/medivault/export/:patientId`
- **Multi-agent architecture** — 10 specialized AI agents (physician, MA, front desk, phone triage, CDS, domain logic, quality, coding, orders, scribe, plus MediVault and PatientLink support modules) coordinated by an orchestrator via message bus
- **Provider learning** — adapts to individual physician documentation style and preferences
- **Prescription and lab ordering** — structured orders from natural language
- **Full audit trail** — HIPAA-compliant access logging on all PHI endpoints
- **PHI encryption** — AES-256-GCM field-level encryption with key rotation support
- **Role-based access control** — granular RBAC with scope validation
- **Offline-first** — works without internet using pattern-matching fallback (Claude API optional)
- **Docker-ready** — multi-stage build, non-root user, health checks, nginx reverse proxy

## Clinical Modules

The runtime is organized as nine explicit workflow modules with defined handoffs and safety boundaries.

| Module | Stage | Tier | Mission |
|---|---|---|---|
| Phone Triage | Access | 1 | Turn inbound calls into documented triage and routing decisions |
| Front Desk | Access / Pre-visit | 1 | Manage scheduling, patient contact, and pre-visit briefing assembly |
| Medical Assistant | Protocol execution | 2 | Execute refill, lab, and support workflows inside approved protocols |
| Physician | Clinical governance | 3 | Own protocols, escalation handling, and final clinical authority |
| Scribe | Encounter capture | 3 | Draft the SOAP note and structure encounter data |
| CDS | Encounter support | 2 | Surface alerts, care gaps, and evidence-based suggestions |
| Domain Logic | Specialty support | 3 | Layer HRT / peptide / functional-medicine rules on top of CDS with dosing approval gate |
| Lab Synthesis | Result ingestion | 2 | Parse and normalize LabCorp PDF/XML results into the patient context |
| Orders | Clinical execution | 3 | Assemble labs, imaging, referrals, and prescriptions for approval |
| Coding | Revenue / documentation | 2 | Generate E&M support, ICD-10 mapping, and completeness feedback |
| Quality | Oversight | 2 | Track care gaps, quality measures, and compliance readiness |

Patient-facing and patient-data-touching workflows stay inside authenticated, auditable boundaries. Tier 3 modules remain draft-only or recommendation-only until a physician approves them.

See `MODULE_CATALOG.md` for the canonical module map.

## Architecture

```
agentic-ehr/
├── server/
│   ├── server.js                # Express API server
│   ├── database.js              # SQLite schema, migrations, queries
│   ├── database-migrations.js   # Schema versioning
│   ├── ai-client.js             # Claude API + pattern-matching fallback
│   ├── cds-engine.js            # Clinical decision support rules
│   ├── workflow-engine.js       # Encounter state machine
│   ├── provider-learning.js     # Physician preference tracking
│   ├── audit-logger.js          # HIPAA audit middleware
│   ├── agents/
│   │   ├── base-agent.js            # Agent framework + requestDosingApproval()
│   │   ├── physician-agent.js       # Physician documentation agent
│   │   ├── ma-agent.js              # Medical assistant agent
│   │   ├── front-desk-agent.js      # Check-in/scheduling agent
│   │   ├── phone-triage-agent.js    # Phone triage protocols
│   │   ├── cds-agent.js             # Clinical decision support agent
│   │   ├── domain-logic-agent.js    # HRT/peptide/functional-med (Tier 3, deps: ['cds'])
│   │   ├── lab-synthesis-agent.js   # LabCorp result ingestion
│   │   ├── quality-agent.js         # Quality measure tracking
│   │   ├── coding-agent.js          # ICD/CPT coding agent
│   │   ├── orders-agent.js          # Lab/prescription ordering
│   │   ├── scribe-agent.js          # Documentation scribe
│   │   ├── orchestrator.js          # Agent coordination
│   │   ├── message-bus.js           # Inter-agent communication
│   │   ├── agent-memory.js          # Agent learning/context
│   │   ├── module-registry.js       # Canonical module order
│   │   └── index.js                 # Agent registry and initialization
│   ├── domain/
│   │   ├── knowledge-base.js        # Strict rule loader (fails fast on broken rules)
│   │   ├── functional-med-engine.js # Rule evaluator (mirrors cds-engine)
│   │   └── rules/
│   │       ├── hrt-rules.js         # 9 HRT rules (testosterone, estradiol, progesterone)
│   │       ├── peptide-rules.js     # 7 peptide rules (GLP-1, sermorelin, BPC-157)
│   │       └── functional-med-rules.js # 7 FM pattern rules
│   ├── integrations/
│   │   └── labcorp/
│   │       ├── client.js            # Lazy singleton LabCorp API client
│   │       ├── oauth.js             # OAuth2 flow + token rotation
│   │       ├── parser.js            # PDF / XML result parser
│   │       └── mock-responses/      # Offline fixtures for tests
│   ├── medivault/
│   │   └── index.js                 # 6 MediVault agents + buildPatientBundle()
│   ├── routes/
│   │   ├── labcorp-routes.js        # OAuth callback + order submission
│   │   └── medivault-routes.js      # Patient-owned FHIR export
│   └── security/
│       ├── hipaa-middleware.js   # HIPAA session/access controls
│       ├── phi-encryption.js    # AES-256-GCM field encryption
│       └── rbac.js              # Role-based access control
├── src/
│   ├── pages/                   # 8 React pages
│   │   ├── DashboardPage.jsx    # Patient schedule and queue
│   │   ├── EncounterPage.jsx    # Ambient capture + documentation
│   │   ├── CheckInPage.jsx      # Patient check-in workflow
│   │   ├── CheckOutPage.jsx     # Checkout and follow-up
│   │   ├── MAPage.jsx           # Medical assistant view
│   │   ├── PatientPage.jsx      # Patient chart
│   │   ├── ReviewPage.jsx       # Note review and sign-off
│   │   └── AuditPage.jsx        # Audit log viewer
│   ├── components/
│   │   ├── agents/              # Agent UI (AgentPanel, PreVisitPanel)
│   │   ├── common/              # Shared UI kit (Card, Modal, Toast, Badge, etc.)
│   │   ├── encounter/           # CDS cards, HRTPanel, PeptideCalculator, HRTRegimenCard
│   │   ├── layout/              # App shell and navigation
│   │   ├── patient/             # Patient banner, vitals, meds, labs, allergies
│   │   └── workflow/            # Queue dashboard, workflow tracker
│   ├── context/                 # AuthContext, EncounterContext
│   ├── hooks/                   # useCDS, useEncounter, usePatient, useSpeechRecognition, useHRTKeywords, useWorkflow
│   ├── utils/                   # hrt-keywords, peptide-math
│   └── api/                     # API client layer (+ medivault.js export client)
├── test/
│   ├── run-tests.js             # Test suite
│   └── scenarios/               # Clinical scenario runner + test data
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # Full deployment with nginx
├── index.html
├── vite.config.js
├── tailwind.config.js
└── package.json
```

**Stack:** Node.js + Express | React 18 + Vite | SQLite3 | Tailwind CSS | Anthropic Claude API (optional)

## Quick Start

### Prerequisites

- Node.js 18+ (recommended: 22 LTS)
- npm 9+

### Setup

```powershell
# Clone the repo
git clone https://github.com/mjrgman/AI-EHR.git
cd AI-EHR

# Install dependencies
npm install

# Create environment file (optional — runs in mock AI mode without it)
@"
PORT=3000
AI_MODE=mock
# AI_MODE=api
# ANTHROPIC_API_KEY=sk-ant-...
"@ | Set-Content -Path .env

# Start development server (frontend + backend)
npm run dev
```

If you skip `.env`, the app still runs in mock AI mode with default settings.

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Bootstrap the first clinician login

The clinician app now uses real JWT + refresh-token auth instead of the old demo role switcher. Create a local user before signing in:

```bash
npm run create-user -- \
  --username dr.renner \
  --password 'SecurePass!234' \
  --full-name 'Dr. Michael Renner' \
  --role physician \
  --email dr.renner@example.com \
  --npi-number 1234567890
```

Clinician sign-in lives at `/login`. The patient portal lives at `/portal` and uses a separate cookie-backed patient session.

### Production Build

```bash
npm run build
npm start
```

### Docker Deployment

```bash
docker-compose up -d
```

### Run Tests

```bash
npm test
```

For support and public contribution policy, see [SUPPORT.md](./SUPPORT.md), [SECURITY.md](./SECURITY.md), and [CONTRIBUTING.md](./CONTRIBUTING.md).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `AI_MODE` | No | `mock` | `mock` for pattern-matching, `api` for Claude |
| `ANTHROPIC_API_KEY` | Only if `AI_MODE=api` | — | Claude API key |
| `LABCORP_MODE` | No | `mock` | `mock` for fixture-based tests, `api` for real sandbox/production |
| `LABCORP_CLIENT_ID` | Only if `LABCORP_MODE=api` | — | LabCorp OAuth2 client ID |
| `LABCORP_CLIENT_SECRET` | Only if `LABCORP_MODE=api` | — | LabCorp OAuth2 client secret |
| `LABCORP_SANDBOX_URL` | Only if `LABCORP_MODE=api` | — | LabCorp sandbox base URL |
| `LABCORP_PROD_URL` | Only if `LABCORP_MODE=api` | — | LabCorp production base URL |
| `LABCORP_REDIRECT_URI` | Only if `LABCORP_MODE=api` | — | OAuth2 callback URL |
| `PHI_ENCRYPTION_KEY` | Production | — | AES-256 encryption key for patient data |
| `PHI_PEPPER` | No | Auto-derived | Salt for searchable PHI hashing |
| `PROVIDER_NAME` | No | `Dr. Provider` | Default provider name for orders and notes |
| `DATABASE_PATH` | No | `./data/ehr.db` | SQLite database location |
| `NODE_ENV` | No | `development` | `production` enables static file serving |

## HRT & Peptide Support

Agentic EHR includes a dedicated **Domain Logic** module for functional
medicine, hormone replacement therapy, and peptide therapy. It sits
downstream of CDS in the encounter pipeline and is structurally wired
so it can never override standard-of-care alerts.

### How it works

- **`DomainLogicAgent`** (`server/agents/domain-logic-agent.js`) is a
  Tier 3 agent with `dependsOn: ['cds']`. The orchestrator guarantees
  CDS runs first. If CDS errors, Domain Logic returns zero proposals and
  logs a LEVEL_1 safety event — it fails closed, not open.
- **Guardrail extraction**: before any dosing proposal is sent, the
  agent reads the CDS output, pulls out urgent / interaction /
  contraindication alerts, and filters its proposals against them. A
  testosterone initiation proposal is discarded at engine level if CDS
  flagged an active prostate cancer contraindication — no "just this
  once" bypass.
- **Rule files** live in `server/domain/rules/` — 9 HRT rules, 7
  peptide rules, 7 functional-medicine pattern rules. Every rule carries
  a mandatory `evidence_source` field (Endocrine Society, NAMS, ACOG,
  AUA). Rules with empty evidence are rejected at load time by
  `knowledge-base.js`.
- **Dosing approval**: every dosing change goes through
  `requestDosingApproval()` in `base-agent.js`, which routes a
  `DOSING_REVIEW_REQUEST` through the message bus to the physician
  agent. No auto-execute path exists.

### UI

The encounter page has a **4th mobile tab** labeled "HRT / Peptide"
alongside Patient / Encounter / CDS. It includes:

- **Peptide Calculator** — dose (mg) ÷ concentration (mg/mL) → U-100
  insulin-syringe units, with divide-by-zero and negative-input guards
- **HRT Regimen Card** — active regimen, proposed changes with
  "awaiting approval" badge, evidence citation, next monitoring lab due
- **CDS suggestions filtered to HRT/peptide category** — so specialty
  alerts are visible without noise from unrelated encounters

### Voice keyword routing

`src/hooks/useHRTKeywords.js` listens to the transcript buffer and
auto-focuses the HRT tab when hormone/peptide terms are heard
(testosterone, estradiol, progesterone, semaglutide, tirzepatide,
sermorelin, BPC-157, etc.). The full keyword list lives in
`src/utils/hrt-keywords.mjs` and is mirrored server-side in
`domain-logic-agent.js` `DOMAIN_KEYWORDS` — the test suite enforces
parity.

### Adding a new rule

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) → "How to add a new clinical
rule". Every new rule needs an `evidence_source`, a
`requiresDosingApproval: true` flag if it's a dosing rule, and a
scenario test in `test/scenarios/functional-med-scenarios.json`.

## LabCorp Integration

Agentic EHR ships with a pluggable LabCorp integration under
`server/integrations/labcorp/`, wired into the `LabSynthesisAgent`
pipeline. It has two modes:

- **`LABCORP_MODE=mock`** (default) — reads PDF/XML fixtures from
  `server/integrations/labcorp/mock-responses/`. Covers CBC, CMP, lipid
  panel, A1C, TSH/T3/T4, testosterone, estradiol, and IGF-1, including
  abnormal-flag cases. All tests run offline in this mode.
- **`LABCORP_MODE=api`** — hits the real LabCorp sandbox or production
  API. Requires OAuth2 credentials (see env vars above) from the
  LabCorp developer portal.

### Developer setup

1. **Sandbox signup**: go to the LabCorp developer portal and request
   sandbox credentials. Record the client ID, secret, sandbox URL, and
   required scopes.
2. **Environment**: copy the LabCorp variables from `.env.example` into
   your `.env.local` (never commit this file). Set `LABCORP_MODE=api`
   only after the credentials are filled in.
3. **Smoke test**: `node scripts/labcorp-sandbox-smoke.js` hits the
   sandbox and reports connectivity. It is deliberately **not** part of
   CI — it requires real credentials and you don't want those in GitHub
   Actions secrets without a separate review.
4. **Optional poller**: `docker-compose.yml` ships with a commented
   `labcorp-poller` service block. Uncomment it and set the env vars to
   enable periodic `pollPendingOrders()` calls.

### Request flow

```
[LabCorp API]
      ↓ (PDF/XML result)
[parser.js] — normalizes to { labOrderId, orderedAt, resultedAt, results: [...] }
      ↓
[LabSynthesisAgent.process()]
      ↓ emits LAB_SYNTHESIS_READY via message bus
[CDSAgent] + [DomainLogicAgent]
      ↓
[Physician review]
```

The parser output shape is stable — downstream agents use it via the
`LAB_ALIASES` map in `functional-med-engine.js` to match LabCorp's raw
test names to rule-friendly codes (`hba1c`, `total_testosterone`,
etc.).

### Scaffolding status

The full integration lands across Phases 2a–2c: client + parser + mock
fixtures + OAuth2 + routes + database migration + `LabSynthesisAgent` +
optional docker-compose service + sandbox smoke script. All offline
tests pass in mock mode. Real-API verification is gated on developer
portal credentials.

## MediVault Patient-Owned Export

Patients own their data. `GET /api/medivault/export/:patientId` assembles
a **FHIR R4 Bundle** (`type: "collection"`) from the patient's conditions,
allergies, medication requests, and observations, and returns it with
`Content-Disposition: attachment; filename="medivault-<id>-<date>.json"`
for a one-click browser download.

### In the UI

The **Encounter → Review & Sign** section has an "Export (MediVault)"
button. One click, and the browser downloads the full patient record as
a FHIR Bundle JSON file.

### Auditing

Every export is **double-audited**:

1. The MediVault route writes a row to `vault_access_log` naming the
   caller (`req.user.username` or `sub`), the access type (`EXPORT`),
   and the resource (`patient_bundle`).
2. The global HIPAA audit-logger middleware writes an `audit_log` row
   via a `PHI_ROUTES` entry — so every export also shows up in
   compliance reports alongside all other PHI accesses.

Two logs, two auditors: the vault-ownership layer and the HIPAA
compliance layer. Non-negotiable.

### Bundle contents

For a representative patient (Sarah Mitchell), the export produces a
14-entry Bundle: 1 Patient + 4 Conditions + 1 AllergyIntolerance +
4 MedicationRequests + 4 Observations. Every resource follows the FHIR
R4 spec and will import cleanly into any downstream patient portal,
other EHR, or research workflow.

## Security

- **PHI encryption** — AES-256-GCM with PBKDF2 (100k iterations), per-record IVs, authentication tags
- **HIPAA middleware** — session tracking, PHI field detection, access logging, 15-minute timeout
- **RBAC** — role-based access control with scope validation
- **Helmet** — security headers on all responses
- **Rate limiting** — 100 req/min standard, 500 req/min system endpoints
- **Input sanitization** — all request bodies sanitized against injection
- **Parameterized queries** — no raw SQL concatenation
- **Audit logging** — all API calls logged with session, user, and timestamp

> **Note:** This is a demonstration system with synthetic patient data. It is not certified for production clinical use. Always consult applicable regulations (HIPAA, HITECH, state law) before deploying any EHR system with real patient data.

## Demo Data

The system initializes with two synthetic patients for testing:

- **Sarah Mitchell** (MRN: 2018-04792) — Type 2 diabetes, CKD Stage 3, hypertension
- **Robert Chen** (MRN: 2020-18834) — COPD, heart failure, atrial fibrillation

All contact information uses `555-555-XXXX` phone numbers and `example.com` email domains. No real patient data is included.

## Documentation

Additional documentation is included in the repo:

| File | Description |
|------|-------------|
| `MODULE_CATALOG.md` | Canonical 9-module runtime map and safety boundaries |
| `VISION.md` | System architecture and design philosophy |
| `docs/ARCHITECTURE.md` | Single-page architecture overview for external readers |
| `docs/DEMO_SCRIPT.md` | 3-minute demo walkthrough (ambient → specialty → LabCorp → export) |
| `CONTRIBUTING.md` | How to contribute: agents, rules, integrations, tests |
| `DEPLOYMENT.md` | Full deployment guide (local, Docker, cloud, LabCorp sandbox) |
| `INTER_AGENT_COMMUNICATION.md` | Agent messaging protocol |
| `QUICKSTART_MESSAGING.md` | Quick start for agent messaging |
| `IMPLEMENTATION_SUMMARY.md` | Implementation details and decisions |
| `BUILD_SUMMARY.md` | Build process and configuration |
| `AGENT_BUILD_SUMMARY.md` | Agent system build details |
| `AGENTS_MA_PHYSICIAN_BUILD.md` | MA and Physician agent specifics |
| `server/integrations/labcorp/README.md` | LabCorp integration setup and quirks |
| `server/security/README.md` | Security module documentation |
| `server/security/QUICK_REFERENCE.md` | Security quick reference |
| `server/security/INTEGRATION_GUIDE.md` | Security integration guide |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the CATC assembler model,
the three safety invariants, and step-by-step guides for adding new
agents, integrations, clinical rules, and test scenarios.

Short version: open an issue first. Write the test before the code.
Never bypass a Tier 3 gate. Every clinical rule needs a non-empty
`evidence_source`.

Clinical safety bugs go to the
[Clinical Safety issue template](./.github/ISSUE_TEMPLATE/clinical_safety.md) —
not the standard bug report.

## License

[MIT](./LICENSE), with a **clinical-use disclaimer**: this software is
provided for educational and demonstration purposes. It is not FDA-cleared
and is not certified for production clinical use. Users assume all
responsibility for compliance with HIPAA, HITECH, state medical-practice
laws, and applicable regulations before deploying with any real patient
data.

Copyright 2026 Dr. Michael Renner / ImpactMed Consulting, LLC.
