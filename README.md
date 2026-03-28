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
- **Multi-agent architecture** — 9 specialized AI agents (physician, MA, front desk, phone triage, CDS, quality, coding, orders, scribe) coordinated by an orchestrator via message bus
- **Provider learning** — adapts to individual physician documentation style and preferences
- **Prescription and lab ordering** — structured orders from natural language
- **Full audit trail** — HIPAA-compliant access logging on all PHI endpoints
- **PHI encryption** — AES-256-GCM field-level encryption with key rotation support
- **Role-based access control** — granular RBAC with scope validation
- **Offline-first** — works without internet using pattern-matching fallback (Claude API optional)
- **Docker-ready** — multi-stage build, non-root user, health checks, nginx reverse proxy

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
│   │   ├── base-agent.js        # Agent framework
│   │   ├── physician-agent.js   # Physician documentation agent
│   │   ├── ma-agent.js          # Medical assistant agent
│   │   ├── front-desk-agent.js  # Check-in/scheduling agent
│   │   ├── phone-triage-agent.js # Phone triage protocols
│   │   ├── cds-agent.js         # Clinical decision support agent
│   │   ├── quality-agent.js     # Quality measure tracking
│   │   ├── coding-agent.js      # ICD/CPT coding agent
│   │   ├── orders-agent.js      # Lab/prescription ordering
│   │   ├── scribe-agent.js      # Documentation scribe
│   │   ├── orchestrator.js      # Agent coordination
│   │   ├── message-bus.js       # Inter-agent communication
│   │   ├── agent-memory.js      # Agent learning/context
│   │   └── index.js             # Agent registry and initialization
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
│   │   ├── encounter/           # CDS suggestion cards and lists
│   │   ├── layout/              # App shell and navigation
│   │   ├── patient/             # Patient banner, vitals, meds, labs, allergies
│   │   └── workflow/            # Queue dashboard, workflow tracker
│   ├── context/                 # AuthContext, EncounterContext
│   ├── hooks/                   # useCDS, useEncounter, usePatient, useSpeechRecognition, useWorkflow
│   └── api/                     # API client layer
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

```bash
# Clone the repo
git clone https://github.com/impactmed/agentic-ehr.git
cd agentic-ehr

# Install dependencies
npm install

# Create environment file (optional — runs in mock AI mode without it)
cat > .env << 'EOF'
PORT=3000
AI_MODE=mock
# AI_MODE=api
# ANTHROPIC_API_KEY=sk-ant-...
EOF

# Start development server (frontend + backend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

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

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `AI_MODE` | No | `mock` | `mock` for pattern-matching, `api` for Claude |
| `ANTHROPIC_API_KEY` | Only if `AI_MODE=api` | — | Claude API key |
| `PHI_ENCRYPTION_KEY` | Production | — | AES-256 encryption key for patient data |
| `PHI_PEPPER` | No | Auto-derived | Salt for searchable PHI hashing |
| `PROVIDER_NAME` | No | `Dr. Provider` | Default provider name for orders and notes |
| `DATABASE_PATH` | No | `./data/ehr.db` | SQLite database location |
| `NODE_ENV` | No | `development` | `production` enables static file serving |

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
| `VISION.md` | System architecture and design philosophy |
| `DEPLOYMENT.md` | Full deployment guide (local, Docker, cloud) |
| `INTER_AGENT_COMMUNICATION.md` | Agent messaging protocol |
| `QUICKSTART_MESSAGING.md` | Quick start for agent messaging |
| `IMPLEMENTATION_SUMMARY.md` | Implementation details and decisions |
| `BUILD_SUMMARY.md` | Build process and configuration |
| `AGENT_BUILD_SUMMARY.md` | Agent system build details |
| `AGENTS_MA_PHYSICIAN_BUILD.md` | MA and Physician agent specifics |
| `server/security/README.md` | Security module documentation |
| `server/security/QUICK_REFERENCE.md` | Security quick reference |
| `server/security/INTEGRATION_GUIDE.md` | Security integration guide |

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss proposed changes.

## License

[MIT](LICENSE) — Copyright 2026 Dr. Michael Renner / ImpactMed Consulting, LLC.
