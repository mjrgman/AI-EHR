# ULTRAPLAN — Agentic EHR Remediation & Build-Out

**Date:** 2026-05-28
**Workspace:** `C:\Users\micha\files\Clinical\EHR`
**Source review:** `ULTRAREVIEW_2026-05-28.md` (50 verified findings) + harvested open ideas (prior roadmap, last clinical plan 2026-05-19).
**Audience:** an execution run (Claude Code / Codex). Concrete enough to hand off directly.

---

## 1. Objective + Current State

**Objective:** Close the authorization and drug-safety defects that block the EHR from being a trustworthy demo-grade clinical system, reconcile the docs-vs-runtime drift, then resume the production build-out (FHIR/PG/voice) on a sound base.

**Current state (one-liner):** The system **builds clean, lints with 0 errors, and passes 308/308 tests** — but the FHIR/PHI surface has effectively **no authorization** (4 P0/P1 security findings) and the **drug-safety layer fails open** (2 P0 + 1 P1 clinical findings). Everything else is integration drift, billing-correctness, and localized UI polish.

**Hard constraints:** Test/synthetic data only (no PHI — per workspace CLAUDE.md). Never commit `_eval/`. No `move/delete/rename/merge/publish` of project content without approval; **config-drift cleanup (doc/comment alignment) is in-scope and may proceed.**

---

## 2. Prioritized Backlog (P0 → P3)

Effort key: **S** ≤ ½ day · **M** ≤ 2 days · **L** > 2 days.

### P0 — Block trust; fix first

| # | What | Why | Files | Eff | Verify |
|---|---|---|---|---|---|
| P0-1 | **RBAC + PHI filtering on FHIR R4** — mount `requireResourceAccess` per resource type and `filterPHI` for non-`all` roles on the FHIR router. | Any authenticated role reads/writes any chart by ID (IDOR). | `server/server.js:231`, `server/fhir/router.js`, `server/security/rbac.js` | M | New test: front_desk token GETs `/fhir/R4/Condition?patient=5` → 403; physician → filtered 200. |
| P0-2 | **Make scope-check fail closed** — derive effective scopes from `req.user.role` (ROLE_SCOPES) when no `scope` claim; never pass-through on absent scope. | The only FHIR authz control self-disables for login tokens. | `server/fhir/smart/scope-check.js:69-78`, `auth.js:99-113` | S | Test: login token (no scope claim) hitting an out-of-role resource → denied, not next(). |
| P0-3 | **Scope-gate FHIR writes** — add explicit `<Resource>.POST/.PUT` keys requiring a write scope; never fall a write back to a read scope; add RBAC `canWrite`. | Read-only token / any role can create/overwrite labs, problems, allergies. | `server/fhir/smart/smart-config.js:89-101`, `inbound/fhir-write.js`, `scope-check.js:78` | M | Test: `patient/*.read` token POSTs Observation → 403; unmapped write method → fail closed. |
| P0-4 | **DDI screening fail-closed + maintained source** — replace retired RxNav `/interaction` with a curated high-severity table (interim) or licensed DB; when unavailable, surface "interaction check unavailable — verify manually," never empty-as-clean. | DDI silently returns "no interactions" (patient-safety). | `server/pharma/rxnorm-service.js:209-238`, `drug-safety-service.js:146-205` | M | Test: known pair (warfarin+NSAID) → alert; source down → "unavailable" flag, not `interactions:[]`. |
| P0-5 | **Fix MediVault DDI args** — iterate reconciled list pairwise `checkDrugInteractions(med.name, otherMeds)` (or add `checkAllPairs`). | Vault med-interaction screening never runs (early return). | `server/medivault/agents/red-flag-agent.js:392`, `pharma/drug-safety-service.js:72` | S | Regression test through the MediVault path asserts a known pair flags. |

### P1 — Fix in the same cycle

| # | What | Why | Files | Eff | Verify |
|---|---|---|---|---|---|
| P1-1 | **RBAC on LabCorp submit** — add `requireResourceAccess('lab_orders')`/`canWrite` to `/api/orders/:id/submit-to-labcorp`. | Any role exfiltrates a patient order to an external lab. | `server/routes/labcorp-routes.js:206-262` | S | Test: front_desk → 403; physician → 200. |
| P1-2 | **Portal verify hardening** — require a non-public factor (OTP/mandatory MRN) in all envs; add IP+identity rate-limiting/lockout; generic error + delay. | Name+DOB + no throttling enables enumeration/takeover. | `server/routes/patient-portal.js:57-88`, `integrations/patient-voice.js:310-330` | M | Test: 6 rapid attempts → locked; verify without 2nd factor → denied. |
| P1-3 | **FDA boxed-warning OR query** — query `generic_name` first, fall back to a separate `brand_name` query (match dosing-service pattern). | Boxed warnings silently dropped (warfarin, methotrexate). | `server/pharma/drug-safety-service.js:102` | S | Test: known boxed-warning drug → `hasBoxedWarning:true`. |
| P1-4 | **CCM mutual-exclusion** — select one CCM path/month (higher-value compliant); add intra-CCM stacking guard so 99490/99487 and 99491 can't co-occur. | Duplicate-service overbilling. | `server/care-management/engine.js:40-72`, `stacking-rules.js` | M | Test: staff≥20min + physician≥30min month emits exactly one CCM code. |
| P1-5 | **Dashboard queue keys** — replace `QUEUE_CONFIG` keys with canonical hyphenated engine states; reuse `WorkflowTracker` STATE_META as the single source. | "Waiting"/"With Provider" cards always read 0. | `src/pages/DashboardPage.jsx:13-17` | S | Browser: all queue cards reflect real counts; unit test on key set. |
| P1-6 | **Agent API route (or remove dead methods)** — decide: build `/api/agents/*` router OR delete `runAgentPipeline`/`getAgentBriefing`/`runMAAgent` + the two unmounted panels. | FE calls 404; ~600 lines orphan UI. | `src/api/client.js:318-320`, `server/`, `src/components/agents/*` | M | If built: e2e run returns pipeline result. If removed: grep shows no dead refs. |

### P2 — Next cycle (grouped)

**Alignment / docs-runtime drift** (mechanical, in-scope per config-cleanup rule):
- alignment-01/04: register the 4 modules OR fix `PRODUCTION_ROADMAP.md:21` + the "9-agent" comments in `index.js:4,66` / `orchestrator.js:10` (enumerate `domain_logic`). **S.**
- alignment-02: register AWVAgent and retire inline `_checkAWVComponents`, or mark "built, not wired." **S–M.**
- alignment-03/05: surface MediVault agents via routes/bus listeners + wire PatientLinkAgent post-visit, OR down-rank catalog/VISION. **M.**

**Security hardening:** sec-smart-register-public-04 (admin auth + no ALL_SCOPES default, **S**); sec-jwt-no-alg-pin-06 (pin algs/iss/aud, fail-boot without secret, **S**); sec-portal-csrf-07 (CSRF token, **M**); sec-gcm-iv-length-09 (12-byte IV + independent pepper, **S**); sec-smart-authorize-auto-approve-11 (PKCE + consent + launch-patient validation, **M**).

**Clinical correctness:** pharma-dose-units-04 (compatible-unit guard, **S**); redflag-troponin-inr-thresholds-07 (unit-aware + structured-flag preference, **M**); hcc-prefix-overmap-08 (tentative + `is_payment_hcc:null` on prefix, **S**); meat-keyword-overcapture-09 (diagnosis-proximate MEAT scoping, **M**); hedis-cbp-denominator-10 (timing/event gates or "not certified" label, **M**).

**Gaps:** gaps-02 (mount or delete panels — folds into P1-6); gaps-03 (Bearer token on MediVault export, **S**); gaps-04 (surface high-value backend features or backlog, **M**).

**UI:** ui-icon-entity-01 (Unicode glyphs, **S**); ui-badge-danger-01 (Badge `danger` alias, **S**); ui-schedule-sort-mutate-01 (`[...].sort()`, **S**); ui-audit-noshape-01 (defensive defaults, **S**).

### P3 — Hygiene / backlog
sec-xml-recursive-walk-10, sec-dev-bypass-header-12 (dead-code-eliminate header trust in prod), age-calc-leap-11 (calendar age), fhir-condition-recordeddate-12; naming-02/04/05/06/07/08/09/10 (export convention, `_agentResults` ×6, HRT casing, .mjs comment, dup seed, speech paths, `captureCharge`, role-id fallback); gaps-06 (dead methods/orphan endpoints); ui-cds-array-shape-01, ui-hook-deps-02, ui-appshell-queue-sum-01.

---

## 3. Recommended Execution Sequence (waves)

**Wave 0 — Baseline (S).** Capture green baseline: `npm run build`, `npm run lint`, `npm run test:unit`. Snapshot counts (308 pass). No edits.

**Wave 1 — Security authz boundary (P0-1, P0-2, P0-3, P1-1).** *Sequential within wave* — P0-2 (fail-closed scope) is the foundation; P0-1 (RBAC/PHI) and P0-3 (write scopes) build on it; P1-1 (LabCorp) reuses the same RBAC pattern. Single cohesive auth pass. **Dependency:** P0-1/3 depend on P0-2 landing first.

**Wave 2 — Drug-safety (P0-4, P0-5, P1-3).** *Parallel-safe with Wave 1* (different files: `server/pharma/*`, `server/medivault/*`). P0-4 (DDI source/fail-closed) before P0-5 (which calls it) and before P1-3 (same service file — sequence P1-3 after P0-4 to avoid merge churn).

**Wave 3 — Billing + dashboard correctness (P1-4, P1-5, P1-6).** Independent of Waves 1-2. P1-5 (dashboard) and P1-4 (CCM) fully parallel. P1-6 (agent API) is the decision gate — resolve build-vs-delete before touching the panels.

**Wave 4 — P2 cluster.** Run the four sub-groups in parallel lanes: (a) alignment/docs, (b) security hardening, (c) clinical correctness, (d) UI quick-wins. Lane (d) UI is fully independent and can start any time after Wave 0.

**Wave 5 — P3 hygiene.** Batch the naming/lint fixes (clears most of the 129 warnings) and remaining defensive-hardening items.

**Verification gate after every wave:** rerun build + lint + test:unit; assert no regression in the 308-test baseline; add the wave's new tests; for UI items, load the page in a browser/Playwright and confirm the rendered fix.

**Can run fully in parallel:** Wave 2 (pharma) ∥ Wave 1 (security) ∥ UI lane (Wave 4d). **Must be sequential:** P0-2 → P0-1/P0-3; P0-4 → P0-5; doc fixes (alignment) after any code that changes which modules register.

---

## 4. UI Work-Stream (explicit)

Independent of backend waves; start after Wave 0. Order by visibility:

1. **ui-badge-danger-01** (S) — add `danger` alias to `Badge.VARIANTS` (align with TouchButton palette). Browser-verify No-Show badge shows red.
2. **ui-icon-entity-01** (S) — replace entity strings with literal Unicode in `MAPage.jsx:282`. Browser-verify mic/stop glyph renders.
3. **P1-5 dashboard queue keys** (S) — canonical states; browser-verify all 4 cards populate.
4. **ui-schedule-sort-mutate-01** (S) — `[...appointments].sort()`.
5. **ui-audit-noshape-01** (S) — defensive defaults + header guard.
6. **P3 UI:** ui-cds-array-shape-01 (normalize), ui-hook-deps-02 (memoize toast + close deps), ui-appshell-queue-sum-01 (`Number(value)||0`).

**UI verification standard (per workspace rule):** load each changed page in browser/Playwright, confirm render + no console errors, click sample interactive elements. "Build passed" is not sufficient.

---

## 5. Risks + Scope Boundaries

**Risks:**
- **Authz changes can lock out legitimate roles.** Mitigate: add the role-matrix test suite (per-role × per-resource) *before* tightening, so a 403 regression is caught immediately. P0-2 fail-closed is the highest-blast-radius change — land it behind the new tests.
- **DDI source swap (P0-4) is the only item needing external research/licensing.** Interim curated table is the unblock; flag licensed-DB selection as a Michael decision. (Complexity Protocol applies — dispatch a Codex second-opinion on DDI source options before committing.)
- **P1-6 agent API is a build-vs-delete decision**, not a mechanical fix — surface to Michael before spending the M effort either way.
- **Doc realignment (alignment-*) must follow code**, not lead it — if the 4 modules get registered, the "10 vs 14" narrative changes; sequence doc edits last (patch-sequencing rule: source first, derivatives second).

**Scope boundaries (non-negotiable):**
- **Test/synthetic data only — no PHI.** This is a dev workspace.
- **Never commit `_eval/`.**
- **No move/delete/rename/merge/publish of project content** (manuscript/EHR data/clinical artifacts) without Michael's approval. Config/doc/comment drift cleanup IS permitted and expected.
- Do not start a dev server or external network calls as part of plan hand-off without explicit go.

---

*Companion review: `../ULTRAREVIEW_2026-05-28.md`. Supersedes the wiring assumptions in `ULTRAPLAN_2026-05-19_clinical.md` where they conflict with the 2026-05-28 runtime ground truth (10 agents registered, not 14).*
