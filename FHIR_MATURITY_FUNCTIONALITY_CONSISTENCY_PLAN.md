# FHIR Translation Layer Maturity, Functionality, and Consistency Plan

## Scope

- Repository: `C:\Users\micha\files\Clinical\EHR`
- Focus area: `server/fhir/*` plus integration points in `server/server.js`, auth/security, and tests.
- Objective: assess current maturity and define a concrete plan to reach interoperable, production-ready behavior.

## Executive Summary

The project already has a meaningful FHIR R4 read/export layer (CapabilityStatement, resource mappers, read/search routes, and mapper tests). Current maturity is best described as **Level 2.5 / 5 (pilot-ready read facade)**.

The highest-impact gaps are:

1. No inbound FHIR ingestion path (Bundle or resource writes).
2. No SMART-on-FHIR launch/auth endpoints.
3. Security posture for `/fhir/R4` is not clearly enforced by app-level auth middleware.
4. Data-model consistency issue in Practitioner mapping vs users schema.
5. Test coverage is mapper-focused, not HTTP contract-focused.

## Maturity Scorecard

| Domain | Current | Target | Notes |
|---|---:|---:|---|
| R4 export coverage | 3.5/5 | 4/5 | Core read/search routes exist for key resources. |
| Inbound interoperability | 0.5/5 | 4/5 | No Bundle ingestion or external ID reconciliation yet. |
| SMART-on-FHIR readiness | 0/5 | 3.5/5 | No SMART discovery/launch/token surface. |
| Security and access control | 1.5/5 | 4/5 | Route-level protection for FHIR not explicit. |
| Consistency and schema alignment | 2/5 | 4/5 | Practitioner mapper and users schema are misaligned. |
| Test and observability | 2.5/5 | 4/5 | Good mapper tests; missing endpoint-level contract tests and telemetry. |
| Delivery hygiene | 2/5 | 4/5 | `server/fhir` is currently untracked in `main` branch state. |

## Findings and Evidence

## F1. Read/export layer exists and is integrated

- Evidence:
  - FHIR router mounted at `/fhir/R4` in [server/server.js](C:/Users/micha/files/Clinical/EHR/server/server.js#L118).
  - Read/search endpoints in [server/fhir/router.js](C:/Users/micha/files/Clinical/EHR/server/fhir/router.js#L47).
  - CapabilityStatement in [server/fhir/capability-statement.js](C:/Users/micha/files/Clinical/EHR/server/fhir/capability-statement.js#L1).

Assessment: strong start for export use cases.

## F2. No inbound FHIR ingestion

- Evidence:
  - Router currently exposes GET handlers only; no POST/PUT/PATCH/DELETE in [server/fhir/router.js](C:/Users/micha/files/Clinical/EHR/server/fhir/router.js#L47).

Impact: cannot accept external FHIR data for ingestion or reconciliation.

## F3. SMART-on-FHIR not implemented

- Evidence:
  - No SMART discovery (`/.well-known/smart-configuration`) or launch endpoints in `server/fhir`.

Impact: SMART app ecosystem cannot launch against this stack yet.

## F4. Security coverage for FHIR routes needs explicit hardening

- Evidence:
  - FHIR routes are mounted globally at [server/server.js](C:/Users/micha/files/Clinical/EHR/server/server.js#L118).
  - No explicit global `app.use(auth.requireAuth)` found in the current server route setup.

Impact: risk of accidental PHI exposure if not gated by upstream controls.

## F5. Practitioner mapper and users schema are inconsistent

- Evidence:
  - Practitioner mapper expects `full_name`, `email`, `phone`, `npi_number` in [server/fhir/mappers/practitioner.js](C:/Users/micha/files/Clinical/EHR/server/fhir/mappers/practitioner.js#L1).
  - Auth table bootstrap creates `users` with `display_name` (not `full_name`) in [server/security/auth.js](C:/Users/micha/files/Clinical/EHR/server/security/auth.js#L44).
  - Migrations define a different users shape including `full_name/email/phone/npi_number` in [server/database-migrations.js](C:/Users/micha/files/Clinical/EHR/server/database-migrations.js#L59).

Impact: Practitioner resources may be incomplete and behavior depends on which table definition actually exists.

## F6. FHIR tests validate mappers, not endpoint contracts

- Evidence:
  - FHIR test phase is mapper/util-level in [test/run-tests.js](C:/Users/micha/files/Clinical/EHR/test/run-tests.js#L1072).
  - No direct HTTP tests for `/fhir/R4/*` route behavior, error semantics, or query filtering.

Impact: route regressions can pass CI unnoticed.

## F7. Search/conformance is minimal

- Evidence:
  - Basic search parameters only; no paging strategy, `_include`, history, conditional behaviors in [server/fhir/utils/search-params.js](C:/Users/micha/files/Clinical/EHR/server/fhir/utils/search-params.js#L1) and [server/fhir/router.js](C:/Users/micha/files/Clinical/EHR/server/fhir/router.js#L1).

Impact: sufficient for initial pilots, limited for broader interoperability expectations.

## F8. Branch hygiene risk for FHIR deliverable

- Evidence:
  - Current git state shows `server/fhir/` as untracked on `main` in local working tree.

Impact: major interop work can be lost or inconsistently reviewed if not committed as a coherent changeset.

## Functionality and Consistency Assessment

## What is functionally solid now

- Patient, Encounter, Condition, Observation (vitals/labs), AllergyIntolerance, MedicationRequest, Appointment, Practitioner export mapping exists.
- CapabilityStatement and OperationOutcome/search Bundle utility foundation exists.
- Core mapper tests pass in local suite.

## What is functionally missing

- Inbound FHIR payload handling.
- External-to-internal identity mapping and idempotency strategy.
- SMART launch/auth.
- Endpoint-level conformance tests and error-contract tests.

## Where consistency is currently weak

- Practitioner data model drift (`display_name` vs `full_name`, migration vs auth bootstrap schema).
- Security posture for FHIR endpoints not explicit in app pipeline.
- Capability metadata and actual route/search behavior are not yet fully contract-tested together.

## Phased Plan

## Phase 0: Stabilize and Baseline (1-2 days)

- Commit FHIR files as an auditable, reviewable unit.
- Freeze current capability set and route list in a baseline test.
- Decide and document canonical users schema (`display_name` vs `full_name`) and enforce one source of truth.

Acceptance criteria:

- `server/fhir` tracked in git.
- Single canonical users schema documented and validated at startup.

## Phase 1: Read-Layer Hardening (2-4 days)

- Enforce auth/role gating for `/fhir/R4` with explicit middleware.
- Add endpoint tests for:
  - success paths (`200`)
  - not found (`404 OperationOutcome`)
  - invalid query (`400 OperationOutcome`)
- Align CapabilityStatement details with real behavior (formats, interactions, supported params).

Acceptance criteria:

- Unauthorized FHIR requests fail in production mode.
- Endpoint contract tests pass in CI.

## Phase 2: Consistency Remediation (2-3 days)

- Refactor `Practitioner` mapper to work against canonical users schema.
- Add schema-aware mapper tests for both minimum and full practitioner profiles.
- Validate internal status mappings for Encounter/Appointment/MedicationRequest against existing DB enums.

Acceptance criteria:

- Practitioner payload contains deterministic required fields from live schema.
- No mapper depends on non-existent columns.

## Phase 3: Inbound FHIR Ingestion v1 (4-7 days)

- Add ingestion endpoints (starting with `POST /fhir/R4/Bundle` transaction-like subset).
- Add staging tables:
  - `fhir_ingest_jobs`
  - `fhir_ingest_items`
  - `fhir_id_map` (external resource ID <-> internal ID)
- Implement initial inbound translators for `Patient` and `Encounter`.
- Add idempotency rules and conflict behavior (`upsert`, duplicate detection, validation failure handling).

Acceptance criteria:

- Valid bundle with Patient/Encounter ingests successfully.
- Replayed bundle is idempotent.
- Failures produce OperationOutcome and persisted ingest diagnostics.

## Phase 4: SMART-on-FHIR Foundation (4-6 days)

- Add SMART discovery endpoint.
- Implement OAuth metadata + launch context integration path.
- Define token scopes and role mapping to existing RBAC.
- Add auditable launch/session trail.

Acceptance criteria:

- SMART discovery endpoint returns valid config.
- Token scope maps to route-level access checks.

## Phase 5: Conformance and Operationalization (ongoing)

- Expand search support (`_count`, paging strategy, targeted `_include`).
- Add interoperability smoke tests and negative tests.
- Add FHIR route metrics: volume, latency, failure codes, ingest error classes.
- Document Medplum facade option with explicit boundaries (facade vs system-of-record).

Acceptance criteria:

- Measurable route SLOs and error budgets.
- Repeatable interoperability test runs as part of release checklist.

## Recommended Immediate Next Move

Execute **Phase 0 + Phase 1** before any new feature scope. That sequence yields the fastest risk reduction and makes subsequent ingestion/SMART work reliable.

## Short-Term Deliverables (next PR)

1. Track and commit `server/fhir`.
2. Add auth middleware protection to `/fhir/R4`.
3. Add HTTP-level route tests for existing FHIR GET endpoints.
4. Resolve users schema/practitioner mapping mismatch.

## Definition of Done for This Plan

- Export layer is secure, versioned, and contract-tested.
- Inbound ingestion exists for at least Patient + Encounter with idempotency.
- SMART foundation exists for launch and scoped access.
- Schema and mapper behavior are internally consistent and enforced by tests.
