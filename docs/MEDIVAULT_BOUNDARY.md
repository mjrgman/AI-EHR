# MediVault — EHR-of-Record vs Vault-of-Record Boundary

**Status:** Phase 3c (lands with the patient-owned export endpoint)
**Authoritative code:** `server/medivault/`, `server/routes/medivault-routes.js`, `src/api/medivault.js`
**Audit:** `server/audit-logger.js` `PHI_ROUTES` + MediVault-specific `vault_access_log` table

---

## Why this doc exists

MediVault is the third Tier-3 patient-data-governance module (alongside the encounter pipeline and PatientLink). The README and VISION describe what it does at a feature level; this doc closes the gaps a reader needs to act on it: what runs where, who audits what, and which fields the EHR owns vs which fields the vault owns.

If you are touching MediVault code or wiring a downstream consumer, read this end-to-end before opening the PR.

---

## 1. Sandbox vs production — there is no separate sandbox

Unlike LabCorp (which has `LABCORP_MODE=mock|api` and separate sandbox URLs), **MediVault has no external integration mode switch**. MediVault is *internal* to the EHR: every MediVault agent operates against the same SQLite/Postgres backend that the rest of the EHR uses. The "production" vs "non-production" distinction is the same one as for the rest of the EHR — `NODE_ENV`, `DATABASE_PATH`, and the data the database happens to contain.

If a reader expected a sandbox endpoint URL (the way LabCorp has one): it does not exist. There is one MediVault, and it lives where the EHR lives.

This is by design. MediVault is a patient-directed view onto the EHR's clinical record, not a third-party service. There is no remote vault to call.

> **Status correction (2026-05-03):** Yesterday's `HAL_ITERATION_2026-05-02_OPUS.md` Gap 5 implied a sandbox-vs-production distinction. That distinction does not exist for MediVault and the implication was wrong. The right question for MediVault is the EHR-of-record vs vault-of-record split — see §4.

## 2. Passkey ceremony — not implemented (today)

The MediVault export endpoint (`GET /api/medivault/export/:patientId`) authenticates via the regular JWT/cookie session flow that the rest of the API uses. The caller in `vault_access_log.accessed_by` is `req.user.username` (or `req.user.sub`/`req.user.id`, in that order), set by the existing `auth` middleware.

There is **no passkey ceremony, no separate WebAuthn challenge, no per-export consent prompt** in the current implementation. A clinician who is logged in and has the relevant RBAC scope can hit the export endpoint and get a FHIR Bundle.

If a future phase adds patient-side passkey verification (the patient must approve each export from their phone, for example), the wiring point is `mountMediVaultRoutes(app, { db })` in `server/routes/medivault-routes.js` — add the challenge as middleware on the router before the export handler. Until that ships, the route relies on standard server-side auth + RBAC + audit.

## 3. Audit interaction — two layers, both required

Every successful export writes **two audit rows**, in two different tables, owned by two different concerns:

### Layer 1 — MediVault-specific (`vault_access_log`)

Written by `server/routes/medivault-routes.js` after the bundle assembles cleanly:

| Column | Value |
|---|---|
| `patient_id` | the exported patient's ID |
| `accessed_by` | `req.user.username` / `sub` / `id` (cascade) — never "system" |
| `access_type` | `'EXPORT'` |
| `resource_accessed` | `'patient_bundle'` |
| `authorized` | `1` (the response would not have reached this line if auth had failed) |

This row is the **vault-ownership audit**: who pulled this patient's full file, on what date. It exists so a patient or auditor can ask "who has touched my record this year" and get a complete answer for vault-side actions specifically.

### Layer 2 — HIPAA-wide (`audit_log` via `PHI_ROUTES`)

Written by the global HIPAA audit middleware (`server/audit-logger.js` `auditMiddleware`) on every PHI-route request. The MediVault export endpoint is registered in `PHI_ROUTES` so this middleware fires on every call, exported bundle or not.

This row is the **HIPAA compliance audit**: every PHI access logged with session, user, timestamp, route, status. It exists so a HIPAA auditor can run one query against `audit_log` and see every PHI-touching call across the entire app — the MediVault export is one row in that stream, alongside every other patient-data fetch.

### Why both

If you only had Layer 1, MediVault exports would be visible to vault operators but invisible to a HIPAA auditor reviewing the global PHI access log. If you only had Layer 2, exports would be visible in the HIPAA audit stream but the patient (or vault operator) couldn't ask "who has my record" without joining across many tables.

Two logs, two auditors. Non-negotiable. **Removing either layer breaks a separate compliance promise.**

### Failure mode

The route handler treats the Layer 1 write as best-effort: if `vault_access_log` insert fails, the response still returns the bundle with `console.warn` output for ops triage. The trade-off is documented in `server/routes/medivault-routes.js:77-82` — patient access to their own data wins over a perfect audit trail. Layer 2 is strict: if the global HIPAA middleware can't write its row, the request fails before it reaches the handler.

## 4. EHR-of-record vs vault-of-record line

This is the most important boundary in the module and the one most likely to confuse a new reader.

### EHR-of-record tables (authoritative clinical record)

The patient-owned FHIR Bundle export pulls from the **main EHR tables**:

| EHR table | FHIR resource | Mapper |
|---|---|---|
| `patients` | `Patient` | `server/fhir/mappers/patient.js` |
| `problems` | `Condition` | `server/fhir/mappers/condition.js` |
| `allergies` | `AllergyIntolerance` | `server/fhir/mappers/allergy-intolerance.js` |
| `medications` | `MedicationRequest` | `server/fhir/mappers/medication-request.js` |
| `labs` | `Observation` (category=laboratory) | `server/fhir/mappers/observation-labs.js` |
| `vitals` | `Observation` (category=vital-signs) | `server/fhir/mappers/observation-vitals.js` |

These are the EHR's clinical source of truth. They exist and are written to by the rest of the EHR (Scribe, Orders, MA workflow, LabSynthesis) regardless of whether MediVault is enabled. The Bundle is a **read-only projection** of these rows into FHIR R4 shape.

### Vault-of-record tables (MediVault-specific working data)

The MediVault module also creates and uses its own tables in `server/medivault/index.js` `INIT_TABLES`:

| Vault table | Purpose | Owned by |
|---|---|---|
| `vault_documents` | Inbound external documents (OCR text, classification, extracted dates) | IngestionAgent |
| `vault_timeline` | Deduplicated event timeline across documents | DedupAgent |
| `vault_conflicts` | Cross-source disagreements (med list, allergy, problem) awaiting resolution | ReconciliationAgent |
| `vault_access_log` | Per-export audit (Layer 1 above) | medivault-routes.js |
| `specialty_packets` | Specialty-tailored clinical packets for outside specialists | SpecialtyPackagingAgent |
| `patient_translations` | Plain-language translations of clinical content (status: draft → physician_review → approved → delivered) | TranslationAgent |

These tables are **NOT in the patient-owned export**. They support patient-data governance workflows that happen *around* the clinical record — ingesting outside documents, reconciling conflicts, drafting plain-language summaries for the patient. Their state is auditable and patient-readable separately, but the canonical clinical record stays in the EHR-of-record tables.

### What this means for callers

- A **patient** asking "give me a copy of my chart" gets the FHIR Bundle from EHR-of-record tables only. The vault working data is workflow scaffolding, not the chart.
- A **HIPAA auditor** reviewing PHI access sees both layers in `audit_log` and can drill into `vault_access_log` for vault-specific events.
- A **downstream EHR or research consumer** importing the FHIR Bundle gets a complete patient record (problem list, allergies, meds, labs, vitals) without any MediVault internals. The Bundle is interoperable; the vault tables are this EHR's implementation detail.
- A **physician** approving a `patient_translations` row goes through the same Tier-3 review flow as any other physician-approval — the translation status moves to `approved` and only then can `delivered` follow.

### Where the line could shift

Today, the line is "EHR tables = chart, vault tables = workflow." Two future shifts are plausible:

1. **Patient amendments / corrections.** If a patient submits a correction (e.g., "the medication list is missing my OTC magnesium"), the `vault_conflicts` row resolves into… what? Does it write back to `medications`? Does it stay in the vault as a patient-asserted overlay? The current code treats `vault_conflicts.resolution_status` as a triage-only field; the write-back path is not yet implemented. When it is, this section needs an update.
2. **External vault export.** If MediVault grows to publish to an external patient-controlled vault (e.g., Apple Health, a personal HIE, or a privacy-preserving research consortium), the `vault_documents` and `patient_translations` tables become candidate exports. Today they are not.

---

## 5. File map (where each thing lives)

| Concern | File |
|---|---|
| Module overview + table init + `buildPatientBundle()` | `server/medivault/index.js` |
| HTTP route + audit | `server/routes/medivault-routes.js` |
| Browser client (download trigger) | `src/api/medivault.js` |
| Six Tier-3 agents | `server/medivault/agents/{ingestion,dedup,reconciliation,specialty-packaging,translation,red-flag}-agent.js` |
| FHIR mappers (shared with the rest of the FHIR API) | `server/fhir/mappers/{patient,condition,allergy-intolerance,medication-request,observation-labs,observation-vitals}.js` |
| FHIR response helpers | `server/fhir/utils/fhir-response.js` |
| Module registry entry | `server/agents/module-registry.js` (key: `medivault`) |
| Doc references | `README.md` §"MediVault Patient-Owned Export"; `VISION.md` §III; `MODULE_CATALOG.md` |

## 6. Quick reference for adding a new export field

If you want to add a new clinical field to the export Bundle:

1. **Add the FHIR mapper** under `server/fhir/mappers/` (or extend an existing one).
2. **Add the read** to `buildPatientBundle()` in `server/medivault/index.js` between the existing reads.
3. **Push entries** with `urn:uuid:<resource-prefix>-<id>` `fullUrl` (matches the existing convention).
4. **Update this doc's §4 EHR-of-record table.**
5. **Add a scenario test** under `test/scenarios/` that asserts the new resource appears in the exported Bundle.

If the field comes from a vault-side table (e.g., a `patient_translations.plain_language_text` block), think hard before pulling it into the export — that crosses the boundary in §4. The right move is usually to keep working data in the vault tables and reference them from the EHR-of-record tables only after physician review.

## 7. Quick reference for callers

```js
// Server-side: build a Bundle programmatically (e.g., for a research export)
const { buildPatientBundle } = require('./medivault');
const bundle = await buildPatientBundle(patientId);
// bundle.resourceType === 'Bundle'
// bundle.type === 'collection'
// bundle.entry[0].resource.resourceType === 'Patient'

// Browser: trigger a patient-facing download
import { exportPatient } from '../api/medivault';
const { filename, size } = await exportPatient(patientId);
// File download already initiated in browser
```

The route handler audits both layers automatically. Programmatic callers of `buildPatientBundle()` directly are responsible for their own audit context — the function is intentionally stateless and does NOT write `vault_access_log`. Wire your audit at the call site.
