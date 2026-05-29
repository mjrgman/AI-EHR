# Agentic EHR: Production Prototype Roadmap

**From 14-Module Runtime to FHIR-Compliant, AI-Native Clinical System**

Dr. Michael Renner | ImpactMed Consulting, LLC
**Original:** April 2, 2026 (commit f66be4a) | **Last refreshed:** May 3, 2026
Repository: github.com/mjrgman/AI-EHR | Branch: main

> **Refresh note (2026-05-03):** Module count updated from "9" to "14" to align with `server/agents/module-registry.js` (11 encounter modules + 3 patient-data governance modules). Sprint 1-2 deliverables have substantially landed (FHIR R4 mappers exist for Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest; `server/db/adapters/postgres.js` shim is in place). Sprint 3 onward (RAG/pgvector, voice pipeline, Medplum) remain as planned.

---

## Executive Summary

This roadmap converts the Agentic EHR from a 14-module clinical workflow catalog (11 encounter + 3 patient-data governance) into a production-grade prototype capable of FHIR interoperability, HIPAA-compliant AI layering, and integration with existing health systems. Of those 14 cataloged modules, 10 are registered and run in the orchestrator runtime today; the remaining 4 (AWV, PatientLink, Patient App, MediVault) are built but not yet wired into the orchestrator. Five gaps separate the current state from a production prototype. The system is not starting from zero — it already has a multi-agent orchestrator, CDS engine, HIPAA middleware, billing/scheduling modules, and Docker deployment.

## Current State

The system is **not** a demo. It already has:

- **Multi-agent orchestrator** (10 registered agents — Phone Triage, Front Desk, MA, Physician, Scribe, CDS, Domain Logic, Orders, Coding, Quality — with dependency-aware parallel execution, message bus, agent memory). The 14-module catalog is a superset: AWV, PatientLink, Patient App, and MediVault are built but not registered in the orchestrator (standalone/route-driven/governance). See [`MODULE_CATALOG.md`](./MODULE_CATALOG.md) and [`server/agents/module-registry.js`](./server/agents/module-registry.js)
- **CDS engine** with rule-based evaluation, HEART score protocol, antibiotic stewardship, drug interaction checks
- **HIPAA middleware** with AES-256-GCM field-level encryption (PBKDF2 100k iterations, per-record IV+salt), RBAC, session tracking, audit logging, rate limiting
- **Claude API integration** with pattern-matching offline fallback
- **Billing/scheduling** modules (Phase 2 complete)
- **Docker deployment** with multi-stage build, nginx reverse proxy, health checks
- **Test surface:** 275 tests across scenarios + HTTP boundary + RBAC + auth + portal + 77 unit tests, 100% pass (verified 2026-05-03)

## Five Gaps to Production

### Gap 1: FHIR R4 Interoperability (Critical)

**Current:** Research docs only. Zero FHIR resources in code. Custom SQLite schema.

**Target:** FHIR R4 facade on existing Express server using @medplum/fhir-router.

**Resource Mapping:**

| FHIR Resource | Internal Table(s) | Agent Owner | Sprint |
|---|---|---|---|
| Patient | patients | Front Desk | 1 |
| Encounter | encounters | Scribe / Physician | 1 |
| Observation | vitals, lab_results | MA / CDS | 1 |
| Condition | problems | Physician / CDS | 1 |
| MedicationRequest | medications, prescriptions | Orders | 2 |
| AllergyIntolerance | allergies | CDS | 2 |
| DiagnosticReport | lab_results (grouped) | Orders | 2 |
| ServiceRequest | orders | Orders | 3 |
| DocumentReference | encounter_notes (SOAP) | Scribe | 3 |
| CarePlan | treatment_plans | Physician / Quality | 3 |

**SMART-on-FHIR:** OAuth2 Authorization Code + PKCE. ClientApplication registration with target EHR. Launch context handling. Sprint 4-5.

### Gap 2: PostgreSQL Migration (High)

**Current:** SQLite3 (single-user, no vector support).

**Target:** PostgreSQL 15+ with pgvector extension.

**Approach:** Prisma ORM for schema migration. UUIDs replace integer PKs for FHIR compatibility. Encryption at rest (pgcrypto or RDS encryption), SSL/TLS in transit, row-level security, pgaudit extension. Sprint 2.

### Gap 3: RAG / Vector Search for Agent Memory (High)

**Current:** agent-memory.js uses SQLite key-value lookups. No embeddings, no semantic search.

**Target:** pgvector inside PostgreSQL. LangChain.js RAG pipeline.

**What gets embedded:** Patient encounter notes, clinical guidelines (USPSTF, AHA), provider preferences, drug interactions (FDA/NLM), prior auth rules.

**Stack:** pgvector (vector(1536)), text-embedding-3-small (OpenAI), @langchain/core + @langchain/anthropic + @langchain/community/vectorstores/postgres. De-identification before embedding. Sprint 3.

### Gap 4: Production Voice Pipeline (Medium-High)

**Current:** Web Speech API (browser-only, no diarization, no BAA).

**Target:** Dual provider — Deepgram for real-time (400ms latency), AssemblyAI for batch QA ($0.0025/min).

**Key features:** Speaker diarization (provider vs. patient), medical vocabulary boosting, encrypted audio storage with 30-day retention, HIPAA BAA with both providers. Sprint 4-5.

### Gap 5: Medplum Integration (Medium)

**Current:** No FHIR server. Custom auth.

**Target:** Medplum Server (v5.1.6) self-hosted via Docker Compose.

**Strategy:** Medplum as FHIR CDR alongside existing Express backend. Medplum handles FHIR storage, OAuth2/SMART-on-FHIR, subscriptions. Express retains custom logic (billing, agent orchestration, CDS rules). Nginx routes /fhir/* to Medplum, /api/* to Express. Sprint 5-6.

## Master Timeline

| Sprint | Dates | Deliverables | Dependencies |
|---|---|---|---|
| 1 | Apr 7-18 | FHIR facade: Patient, Encounter, Observation, Condition | None |
| 2 | Apr 21 - May 2 | FHIR: MedicationRequest, AllergyIntolerance, DiagnosticReport. PostgreSQL migration. | Sprint 1 |
| 3 | May 5-16 | FHIR: ServiceRequest, DocumentReference, CarePlan. pgvector + RAG pipeline. Agent memory upgrade. | Sprint 2 |
| 4 | May 19-30 | Deepgram voice pipeline. Speaker diarization. Scribe agent integration. | Sprint 1 |
| 5 | Jun 1-12 | AssemblyAI batch pipeline. Medplum Docker deployment. SMART-on-FHIR auth. | Sprint 2-3 |
| 6 | Jun 15-26 | Medplum CDR migration. Bot-based agent triggers. React component integration. | Sprint 5 |
| 7 | Jun 29 - Jul 10 | FHIR capability statement. Pen testing. BAA documentation. Synthea test patients. | All |

## Production Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind + @medplum/react | Provider UI |
| Backend | Express.js + @medplum/fhir-router | REST API + FHIR facade |
| FHIR Server | Medplum Server (self-hosted Docker) | FHIR CDR + OAuth2 |
| Database | PostgreSQL 15+ with pgvector | Clinical data + vectors |
| ORM | Prisma | Schema migrations |
| AI Engine | Claude API (@anthropic-ai/sdk) | Clinical reasoning |
| RAG | @langchain/core + @langchain/anthropic | Vector retrieval |
| Voice (Real-time) | Deepgram Nova-2 (WebSocket) | Live transcription |
| Voice (Batch) | AssemblyAI (streaming) | Post-encounter QA |
| Auth | OAuth2 + SMART-on-FHIR via Medplum | EHR launch |
| Deployment | Docker Compose + nginx | Multi-container |
| Testing | Synthea + FHIR validator | Clinical test data |

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Medplum MCP experimental (no PHI BAA from Claude) | High | Use $ai operation for production PHI; Claude for synthetic data only |
| FHIR facade diverges from Medplum CDR | Medium | Build facade as disposable; migrate to Medplum storage in Sprint 6 |
| pgvector performance on large datasets | Low | IVFFlat indexing; partition by patient_id; benchmark at 10K records |
| Voice latency exceeds clinical threshold | Medium | Dual provider strategy |
| SQLite to PostgreSQL data loss | Medium | Row count verification; parallel run; rollback script |

---

*Sprint 1 begins April 7, 2026. First deliverable: FHIR R4 endpoints for Patient, Encounter, Observation, and Condition.*
