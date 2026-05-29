# Agentic EHR — Ultra-Review (6 Dimensions)

**Date:** 2026-05-28
**Workspace:** `C:\Users\micha\files\Clinical\EHR` (`mjr-ehr-interactive@1.0.0`)
**Scope:** Read-only review. No source code modified.
**Method:** Six parallel dimensions (alignment, correctness/security, clinical-domain, naming/consistency, gaps, UI). Every finding below was adversarially verified against ground-truth code; severities are post-verdict (adjusted where the original over- or under-stated impact).

---

## Executive Summary

The Agentic EHR **builds clean and ships a working UI** (`vite build` exit 0, lint 0 errors / 129 warnings, 308/308 unit tests pass). The architecture catalog (14-module registry) is real code, and the strongest layers — HCC V28 coding, care-management stacking, FHIR R4 mappers, and the auth core (bcrypt-12, lockout, JWT blacklist, parameterized SQL, AES-256-GCM) — are largely faithful to 2026 CMS/spec guidance.

The review surfaced **two clusters of serious defects**:

1. **Authorization on the FHIR/PHI surface is effectively absent.** The entire `/fhir/R4` API is gated only by `requireAuth`; its single authorization control (`smartScopeCheck`) is a no-op for the app's own login tokens, there is no RBAC/PHI filtering, and write endpoints map to read scopes. Net: any authenticated low-privilege role can read or write any patient's chart by ID. These are the four P0 security findings.

2. **The pharma/drug-safety layer cannot be trusted for prescribing.** Drug-interaction screening depends on an NLM API that was retired Jan-2024 and **fails open** ("no interactions found" instead of "unavailable"); MediVault's red-flag agent calls the interaction function with the wrong arguments so vault med-screening never runs; the FDA boxed-warning lookup ANDs generic+brand so it almost never matches. These are the two P0 + one P1 clinical-safety findings.

Everything else is integration drift (docs claim 14 modules execute; only 10 do), billing-correctness bugs, and localized UI polish/robustness items. **No defect crashes the happy path or blocks the build.**

### Severity Rollup (post-verdict, 50 findings)

| Severity | Count | Where |
|---|---|---|
| **P0** | **5** | 3 security (FHIR authz), 2 clinical (DDI fail-open, MediVault arg bug) |
| **P1** | **6** | 2 security, 2 clinical, 1 naming (dashboard), 1 gap (agent route) |
| **P2** | **22** | 4 alignment, 6 security, 4 clinical, 1 naming, 3 gaps, 4 UI |
| **P3** | **17** | 1 alignment, 2 security, 3 clinical, 8 naming, 1 gap, 3 UI |
| **Total** | **50** | |

---

## Dimension 1 — Alignment (docs vs. runtime)

**Verdict:** The "14-module clinical workflow runtime" headline is **true at the catalog/code level but drifts at runtime wiring.** The registry declares 14 modules and real code exists for nearly all of them, but the orchestrator registers only **10** agents. AWV and PatientLink are built but orphaned (never registered); MediVault's 6-agent pipeline exists but only its FHIR-export capability has an HTTP surface. In-code comments still say "9 agents," contradicting both the 14-module headline and the 10 actually registered. A reader trusting `VISION.md`/`PRODUCTION_ROADMAP.md` would believe all 14 modules execute in a coordinated runtime; only 10 do.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| alignment-01 | P1 | `server/agents/index.js:66-81` | Orchestrator registers 10 agents, not the claimed 14 (runtime-verified); `PRODUCTION_ROADMAP.md:21` claims "orchestrator (14 modules…parallel execution)". | Register the 4 missing modules **or** correct the roadmap to "10 agents run in the orchestrator; 4 are standalone/route-driven/governance." |
| alignment-02 | P2 | `server/agents/awv-agent.js:239-248` | AWVAgent is a complete BaseAgent subclass with `dependsOn:['scribe','cds']` but is never registered or invoked (only `quality-agent.js:223` runs an inline `_checkAWVComponents` fallback). Orphaned dead code + divergent-duplicate hazard. | Register AWVAgent (dep graph is ready) and retire the inline checker, or mark VISION/catalog "built, not yet wired." |
| alignment-03 | P2 | `server/routes/medivault-routes.js:28-59` | All 6 MediVault agents instantiate, but the only route imports `buildPatientBundle` and exposes only `GET /medivault/export/:patientId`. The dedup→reconcile→redflag flow has no production entry point (message-bus handlers are pass-through, no listeners). | Add routes/bus listeners that actually invoke the 6 agents, or annotate that only FHIR export is surfaced. |
| alignment-04 | P2 | `server/agents/index.js:4`, `orchestrator.js:10` | Stale "9-agent" comments contradict the 14-module headline AND the 10 registered; `orchestrator.js` enumeration omits `domain_logic` though it is registered. | Update both comment blocks to "10 registered agents," enumerate `domain_logic`, point to the 14-module catalog as a superset. |
| alignment-05 | P2 | `server/routes/patient-portal.js:15-21` | PatientLink catalog claims after-visit-summary / care-gap drafting, but only the `toPlainLanguage()` helper is imported; the agent class is never instantiated in production. | Wire PatientLinkAgent into the post-visit flow, or down-rank the catalog/VISION language. |
| alignment-06 | P3 | `VISION.md:503` | "Encounter runtime operational (Scribe, CDS, Orders, Coding, Quality, AWV)" over-claims AWV and omits Domain Logic (which is registered). | Correct to "Scribe, CDS, Domain Logic, Orders, Coding, Quality"; move AWV to a "built, pending registration" note. |

---

## Dimension 2 — Correctness / Security

**Verdict:** The auth **core** is reasonably built, but the **authorization layer has load-bearing defects** for a HIPAA system. The FHIR surface has no RBAC/PHI filtering and its scope check is a no-op for login tokens; write endpoints map to read scopes; SMART dynamic registration is public; the portal verifies identity with name+DOB and no rate-limiting; JWT verification doesn't pin algorithm/issuer/audience.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| sec-fhir-rbac-idor-01 | P0 | `server/server.js:231` + `server/fhir/router.js:79-345` | Entire FHIR R4 API has no RBAC or PHI filtering — any authenticated role (front_desk, billing) can GET any patient's full chart by ID (IDOR + broken function-level auth). | Mount `requireResourceAccess` per resource type + `filterPHI` on the FHIR router; treat it as a first-class authz boundary like `/api/*`. |
| sec-smart-scope-noop-02 | P0 | `server/fhir/smart/scope-check.js:69-70` + `auth.js:99-113` | `if (!user || !user.scope) return next();` — login tokens carry no `scope` claim, so scope enforcement silently disables itself for the primary auth path. | Derive effective scopes from `req.user.role` (ROLE_SCOPES) or enforce RBAC independently. Fail closed. |
| sec-fhir-write-unscoped-03 | P0 | `server/fhir/smart/smart-config.js:89-101` + `inbound/fhir-write.js` | Write methods (`Patient.POST`, etc.) are unmapped → fall back to the resource's **read** scope. Any user (or a read-only SMART token) can create/overwrite patients, labs, vitals, problems, allergies. | Add explicit `.POST`/`.PUT` keys requiring a write scope; never fall a write back to a read scope; add RBAC `canWrite`. Fail closed. |
| sec-labcorp-order-ownership-08 | P1 | `server/routes/labcorp-routes.js:206-262` + `server.js:277` | `POST /api/orders/:id/submit-to-labcorp` has no RBAC (the `lab_orders` guard is prefixed to `/api/lab-orders`, not `/api/orders`). Any role can transmit any patient's order to an external lab by enumerating IDs. | Add `requireResourceAccess('lab_orders')` / `canWrite` to this route. |
| sec-portal-weak-verify-05 | P1 | `server/routes/patient-portal.js:57-88` + `integrations/patient-voice.js:310-330` | Portal verify uses name+DOB (MRN optional outside production), with **no rate-limiting/lockout** in any environment. Enables enumeration / takeover with low-secrecy data. | Require a non-public factor (OTP/credential/mandatory MRN) in all envs; add IP+identity rate-limiting; generic error + delay. |
| sec-smart-register-public-04 | P2 | `server/server.js:226` + `smart/token.js:797-884` | `/smart/register` is unauthenticated and defaults to ALL_SCOPES. (Token minting re-derives scopes from the user's role, so this is an abuse-surface/DoS + spec violation, **not** a data-breach path.) | Require admin auth on `/smart/register`; never default to ALL_SCOPES. |
| sec-jwt-no-alg-pin-06 | P2 | `server/security/auth.js:24-39,108-121` | `jwt.verify` pins no algorithm/issuer/audience; missing `JWT_SECRET` silently falls back to an ephemeral random key (warn, not fail). Failure modes are fail-safe, so hardening not active exploit. | Pass `{algorithms:['HS256'], issuer, audience}`; set iss/aud at sign time; refuse to boot in prod without `JWT_SECRET`. |
| sec-portal-csrf-07 | P2 | `server/services/portal-session-service.js:23-42` | Portal cookie auth with SameSite=Lax and no CSRF token; code self-admits the gap. (JSON-only body parser + prod CORS preflight materially reduce real-world exploitability.) | Add a synchronizer/double-submit CSRF token; SameSite=Strict; require a custom header on XHR. |
| sec-smart-authorize-auto-approve-11 | P2 | `server/fhir/smart/token.js:595-727` | `/smart/authorize` auto-approves (no consent), no PKCE despite advertising S256, and writes unvalidated launch `patient` into audit/patient_id. (Requires an authenticated session — not an unauth bypass.) | Enforce PKCE, add a consent/authorization decision, validate launch patient context against the user. |
| sec-gcm-iv-length-09 | P2 | `server/security/phi-encryption.js:57-91` | 16-byte GCM IV (NIST recommends 12); legacy decrypt path uses a deterministic salt; `getPepper()` falls back to a key-derived value when `PHI_PEPPER` unset (pepper not independent). | Use a 12-byte IV; require an independent `PHI_PEPPER`; plan migration off the deterministic-salt legacy format. |
| sec-xml-recursive-walk-10 | P3 | `server/integrations/labcorp/parser.js:59-77,297-339` | `findAll()` does an unbounded recursive walk over a server-to-server response; no buffer/depth cap (XXE already mitigated by default; fails soft). | Cap buffer size, set max walk depth, explicitly disable DTD/entity, validate coerced numerics. |
| sec-dev-bypass-header-12 | P3 | `server/security/auth.js:291-314` + `rbac.js:599-608` | `x-user-id`/`x-user-role` header-trust bypass gated on `NODE_ENV==='development' && ENABLE_DEV_AUTH_BYPASS==='true'`. `NODE_ENV` defaults to development, so a single misconfig reinstates full impersonation (a third copy exists in `hipaa-middleware.js:41-50`). | Dead-code-eliminate header-trust from prod builds; assert `NODE_ENV==='production'` at boot and refuse to start with the flag set. |

---

## Dimension 3 — Clinical Domain

**Verdict:** Coding and care-management are the **strongest** layers (HCC V28 seed correctly encodes 2024-2026 model changes; MEAT gating present; G2211/APCM rules faithful; FHIR mappers spec-conformant). The **pharma/drug-safety layer is the dominant clinical-safety problem** and must be labeled demo-only until repaired. Several billing/quality logic defects can produce incorrect claims or misleading alerts.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| pharma-ddi-01 | P0 | `server/pharma/rxnorm-service.js:209-238` | DDI screening calls NLM RxNav `/interaction/list.json`, **retired Jan-2024**. Returns empty → system reports "no interactions" (fails OPEN). The dedicated `fullSafetyCheck` path has no local fallback. | Replace with a maintained DDI source (or local curated high-severity table); until then **fail CLOSED** — surface "interaction check unavailable — verify manually." |
| medivault-ddi-args-02 | P0 | `server/medivault/agents/red-flag-agent.js:392` | Calls `checkDrugInteractions(medications)` — array passed as `newDrugName`, `activeMeds` undefined → guard returns `[]` every time. Vault med-interaction screening never runs (e.g., warfarin+NSAID gets no flag). | Iterate pairwise `checkDrugInteractions(med.name, otherMeds)` or add a `checkAllPairs(meds)` helper; add a regression test on a known interacting pair. |
| pharma-fda-andquery-03 | P1 | `server/pharma/drug-safety-service.js:102` | Boxed-warning lookup ANDs `generic_name` AND `brand_name` with the same string → almost never matches → `hasBoxedWarning:false` for drugs that carry one (warfarin, methotrexate). | Match the dosing-service pattern: query generic first, fall back to a separate brand query; add a boxed-warning regression test. |
| ccm-mutually-exclusive-06 | P1 | `server/care-management/engine.js:40-72` | Can emit staff CCM (99490/99487) AND physician CCM (99491) in the same patient-month — CMS forbids billing both (alternative paths). No intra-CCM exclusion in the stacking matrix. | Select a single CCM path per month (higher-value compliant code); add an intra-family stacking guard. |
| pharma-dose-units-04 | P2 | `server/pharma/dosing-service.js:339-410` | `toMg()` returns raw value for `units`/`mL` and drops `/kg`,`/day`; `validateDose` compares incompatible units and returns `isValid:true` on mismatch (fail-open). **Currently dead code** (no caller), so latent. | Compare only dimensionally-compatible units; return "cannot validate — verify manually" on mismatch; reason about /kg, /day. |
| redflag-troponin-inr-thresholds-07 | P2 | `server/medivault/agents/red-flag-agent.js:86-112` | Fixed troponin (0.4 ng/mL) / INR (5.0) thresholds ignore assay (hs-troponin in ng/L) and indication; value-extraction grabs the first adjacent number with no unit check → false-critical and missed-critical both possible. | Capture/validate the reported unit before comparing; prefer the lab's structured abnormal flag; label thresholds as illustrative defaults. |
| hcc-prefix-overmap-08 | P2 | `server/coding/hcc-v28.js:103-118` + seed | Prefix fallback copies the first seed row's `is_payment_hcc` to any sibling code → payment-flag decided by non-deterministic insert order; errors in both directions. | On prefix match return "tentative" with `is_payment_hcc:null`; complete exact-code seed for payment families. |
| meat-keyword-overcapture-09 | P2 | `server/coding/hcc-v28.js:129-178` | MEAT "Assessed" regex matches bare `stable`/`controlled` anywhere in the note; `checkMEAT` ignores the ICD-10 and scans the whole note → a payment HCC can be marked MEAT-satisfied by unrelated text, weakening RADV defensibility. | Scope MEAT matching to text proximate to the diagnosis; require an adjacent condition reference; surface the matched evidence span. |
| hedis-cbp-denominator-10 | P2 | `server/quality/hedis/measures/cbp.js`, `bcs-e.js` | CBP omits the on/before-June-30 diagnosis-timing gate and the event/visit requirement; BCS-E approximates enrollment by "patient exists" and omits advanced-illness/frailty exclusion. Mis-placed denominators, no caveat in output. | Implement the timing/event gates, or label outputs "approximate / not certified for HEDIS submission." |
| age-calc-leap-11 | P3 | `cbp.js`, `bcs-e.js`, `quality/uspstf-matcher.js` | Age = `floor(ms / 365.25 days)` undercounts by up to ~1 day at age boundaries (only Dec-31 DOBs flip on the HEDIS Dec-31 path; broader on USPSTF `Date.now()` path). | Use calendar y/m/d comparison (matches NCQA "as of Dec 31"). |
| fhir-condition-recordeddate-12 | P3 | `server/fhir/mappers/condition.js:23-77` | Hardcodes `verificationStatus:'confirmed'`, omits `recordedDate`, uses `created_at` for `lastUpdated`. (Schema has no certainty/`updated_at` column, so the cleanest fix is to omit verificationStatus.) | Emit `recordedDate`; omit (or schema-back) verificationStatus; same simplification exists in `allergy-intolerance.js`. |

---

## Dimension 4 — Naming / Consistency

**Verdict:** Broadly coherent (build/lint/tests green) with **one functional consistency bug** (dashboard queue keys) and a cluster of cosmetic naming/terminology drifts.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| naming-workflow-state-vocab-01 | P1 | `src/pages/DashboardPage.jsx:13-17` | `QUEUE_CONFIG` keys (`waiting`, `with_provider`) don't match any backend workflow state (hyphenated vocab, enforced by a DB CHECK constraint). The "Waiting" and "With Provider" cards **always render 0**. | Replace keys with canonical engine states; reuse `WorkflowTracker` STATE_META as the single source of truth. |
| naming-dead-encounter-context-03 | P2 | `src/context/EncounterContext.jsx:5-30` | `EncounterProvider` wraps the whole app but has zero consumers (`useEncounterContext`/`activeEncounter` referenced only in their own file); pages re-derive `encounterId` from `useParams`. Misleads architecture readers. | Wire intended consumers, or delete the provider and its App.jsx mount. |
| naming-route-export-convention-02 | P3 | `server/server.js:24-29` | Route modules use 3 export conventions (factory / direct router / mount-fn) and `patient-portal.js` lacks the `-routes` suffix. | Standardize on `mount*(app, deps)` (4 of 6); rename to `patient-portal-routes.js`. |
| naming-agentResults-unused-04 | P3 | `server/agents/awv-agent.js:255` | Unused-param convention inconsistent: `awv` uses `_agentResults`; **6** agents (ma, physician, cds, front-desk, phone-triage, scribe) declare plain unused `agentResults` (lint warnings). | Apply `_agentResults` to all 6 unused-param agents. |
| naming-hrt-casing-05 | P3 | `src/utils/hrt-keywords.mjs:49` | HRT acronym flips between `HRT` (const/component/hook) and `Hrt` (`isHrtRelevant`, `detectHrtCategories`). | Standardize on all-caps; rename + update **all** import sites (HRTPanel, useHRTKeywords, **and EncounterPage** — fix list in the verdict is under-scoped). |
| naming-stale-mjs-comment-06 | P3 | `src/components/encounter/PeptideCalculator.jsx:8` | Comment names `peptide-math.js`; actual file/import is `peptide-math.mjs`. | Fix the comment; optionally document the `.mjs`-utils / `.js`-hooks split. |
| naming-duplicate-schema-seed-07 | P3 | `server/database.js:1106` ↔ `database-migrations.js:530` | One CDS-rule seed string is duplicated verbatim across two files (idempotent INSERT OR IGNORE). (The users-table-DDL half of the original claim is **false** — DDL lives in one place.) | Import the seed from a single canonical module. |
| naming-speech-endpoint-path-08 | P3 | `server/server.js:391` | `/api/patients/extract-from-speech` vs `/{vitals,prescriptions,lab-orders}/from-speech` — two path styles for one operation class. | Normalize to `from-speech` (3-to-1 majority). |
| naming-update-charge-verb-09 | P3 | `src/api/client.js:309` | `updateCharge` uses POST while peer `update*` methods use PATCH; name implies PATCH semantics. | Rename to `captureCharge` (matches backend `billing.captureCharge`). |
| naming-role-identifier-10 | P3 | `src/context/AuthContext.jsx:78` | `user.role` (raw) vs `currentRole` (UI bucket) reconciled with `\|\|`; the fallback is unreachable dead code. (They are intentionally distinct value spaces — do NOT normalize to equality.) | Drop the unreachable `\|\| currentRole`; document that `currentRole` is the UI bucket and `user.role` is canonical. |

---

## Dimension 5 — Gaps (FE↔BE wiring)

**Verdict:** A handful of dead front-end methods, orphan endpoints, and unsurfaced backend features. One real broken feature path (agent API), the rest are tech-debt / backlog decisions.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| gaps-01 | P1 | `src/api/client.js:318-320` | FE calls `/api/agents/run`, `/agents/briefing/:id`, `/agents/ma`; **no server route exists** (documented in ROUTE_PERMISSIONS.md but never implemented) → 404. | Add an agents router, or remove the dead client methods. |
| gaps-02 | P2 | `src/components/agents/AgentPanel.jsx` | `AgentPanel`/`PreVisitPanel` (~600 lines) are built but never imported; they also call the missing agent endpoints. | Mount or delete. |
| gaps-03 | P2 | `src/api/medivault.js:45-48` | MediVault export wrapper sends no `Authorization` header → 401 in production (fails safe; masked in dev by the auth bypass). | Attach the Bearer token from sessionStorage (`ehr_auth_session_v1`). |
| gaps-04 | P2 | `server/routes/care-management-routes.js` | care-management, HEDIS, cpt-suggestions, eligibility have no FE. (`vitals/from-speech` **does** have a FE — the original claim over-lists.) | Surface high-value ones; backlog the rest. |
| gaps-06 | P3 | `src/api/client.js:286-320` | Dead FE methods (`getBillingCharges`, `getPatientAuditTrail`) and orphan endpoints (`/api/ai/status`, `POST /preferences/decay`). | Wire or remove. |

---

## Dimension 6 — UI

**Verdict:** Strong shape, working build. Defects are localized, not structural: routing, AuthContext/token-refresh, loading/empty/error states, and accessibility basics are all in place. Highest-severity items are a cosmetic icon-render bug, a missing Badge variant, and a state-mutation-during-render.

| ID | Sev | File | Problem | Recommendation |
|---|---|---|---|---|
| ui-icon-entity-01 | P2 | `src/pages/MAPage.jsx:282` | Literal HTML-entity strings (`'&#x1F3A4;'`) passed as the TouchButton `icon` prop → React escapes the string, user sees raw text not a glyph. (Bug is specific to entities in a *string literal*; bare-JSX entities elsewhere render fine.) | Pass actual Unicode chars (🎤 / ⏹); verify in browser. |
| ui-badge-danger-01 | P2 | `src/pages/SchedulePage.jsx:16` | `no-show` → variant `'danger'`, which `Badge` doesn't define → unstyled transparent pill on the clinically-important No-Show state. | Use `'urgent'` or add a `danger` alias to `Badge.VARIANTS`. |
| ui-schedule-sort-mutate-01 | P2 | `src/pages/SchedulePage.jsx:331` | `appointments.sort().map()` mutates the state-referenced array during render (React anti-pattern; idempotent comparator hides it today). | `[...appointments].sort()` or `useMemo` (CheckInPage already does this). |
| ui-audit-noshape-01 | P2 | `src/pages/AuditPage.jsx:263` | `setLogs/setTotal/setTotalPages` with no fallback; `total.toLocaleString()` unconditional → crashes on a malformed response shape (robustness gap, not a live crash). | Defensive defaults: `\|\| []`, `\|\| 0`, `\|\| 1`; guard the header. |
| ui-cds-array-shape-01 | P3 | `src/hooks/useCDS.js:15` | `refresh()` stores raw response then `.filter()`s it; `evaluate()` stores `.suggestions`. Two paths assume different shapes — latent crash if the GET endpoint ever wraps. | Normalize: `Array.isArray(data) ? data : data?.suggestions \|\| []`. |
| ui-hook-deps-02 | P3 | `src/pages/EncounterPage.jsx:367` (+3) | Four `exhaustive-deps` lint warnings (toast omissions harmless; speech/encounter are partial-dependency lists). | Memoize the `toast` value object; close the dep lists. |
| ui-appshell-queue-sum-01 | P3 | `src/components/layout/AppShell.jsx:51` | `reduce((sum,[,v])=>sum+v,0)` assumes numeric counts; string values would concat into a garbage label (backend returns numbers, so defensive only). | Coerce: `sum + (Number(value) \|\| 0)`. |

---

## UI VERDICT: Correct / Clear / Working

Answering each explicitly, with evidence from the UI dimension and the ground-truth build state.

### WORKING — **YES.**
- `vite build` exits 0 (3.24s, 85 modules, 0 errors/warnings), code-split per page.
- `eslint` exits 0 — **0 errors**, 129 warnings (hygiene only).
- `node --test` — **308/308 pass**, 87 suites, 0 fail, completed in ~2.95s (no hang).
- Routing is correctly wired (lazy-loaded pages, `ProtectedRoute` gate, catch-all redirect); AuthContext/api-client token-refresh flow is coherent.
- **No defect crashes the happy path.** The most severe UI items (icon entity, Badge variant, schedule sort) are cosmetic/latent.

### CLEAR — **MOSTLY YES, two visible blemishes.**
- Loading/empty/error states present on every page; accessibility basics (aria-labels, `role="dialog"`, focus restore, Escape-to-close) handled in shared components.
- **Blemishes:** the MA voice button renders raw text `&#x1F3A4;` instead of a microphone glyph (ui-icon-entity-01), and the No-Show badge renders with no color (ui-badge-danger-01). Both visible, both cosmetic, both one-line fixes.
- One cross-domain clarity bug bleeds into UI: the Dashboard "Waiting"/"With Provider" cards always read 0 (naming-workflow-state-vocab-01) — misleading on a triage surface.

### CORRECT — **LARGELY, with localized robustness gaps.**
- The happy path is correct: state, navigation, and the refresh flow behave as intended; 308 unit tests green.
- **Localized correctness issues:** state-mutation-during-render in SchedulePage (latent, idempotent today), and missing array/number fallbacks in AuditPage / useCDS / AppShell that surface only on malformed or future-changed API shapes.
- None of these are structural; all are scoped P2/P3 polish-and-robustness fixes.

**Overall UI verdict: WORKING and largely CORRECT/CLEAR**, pending a short list of P2/P3 fixes — chiefly the two visible render bugs and the dashboard queue-key mismatch.

---

*This report is read-only analysis. The companion implementation plan is at `_ultraplan/ULTRAPLAN_2026-05-28_clinical.md`.*
