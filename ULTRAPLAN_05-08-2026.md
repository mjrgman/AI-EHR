# Ultraplan — Agentic EHR

**Date:** 2026-05-08
**Author:** 5-agent local ultrareview (security, clinical-safety, AI-trust, architecture, tests/CI) + cross-verification
**Stage:** Development / hard-code build — no live patient data
**Mission:** Move from "hardened" (post-2026-04-07 ultrareview) to **best AI EHR ever conceived** on the axes that actually matter: clinical correctness, AI trust, architectural ceiling, and capability differentiation.

---

## Where we stand (one paragraph)

The 2026-04-07 ultrareview closed 77 findings in a 6-agent fix sweep. Spot-checks confirm the headline P0s (auth wiring, RBAC, JWT_SECRET non-export, agent governance, mutex, Tier-3 dosing approval) are real in code. The architecture and vision remain best-in-class — three-tier autonomy, module registry, fail-closed Domain Logic, evidence-source-required rules. **What the prior review missed and what's accumulated since** is now the work in front of us. Five themes:

1. **Clinical correctness has critical holes** the prior review didn't see — most importantly a **prescription-write backdoor** that bypasses every Tier-3 gate this project was architected around.
2. **The AI inference layer is fundamentally non-reproducible** — no prompt persistence, no model-version pinning on every call, silent mock-fallback. This is the single thing standing between "great AI EHR" and "best AI EHR ever."
3. **Engineering-integrity controls** (audit-log immutability, transcript encryption, supply-chain pinning, break-glass) are partial — fine for dev, but they cap what the system can become.
4. **Architecture ceiling is single-node** — Postgres adapter is a stub, message bus is in-process, sessions are Maps. No path to multi-tenancy or horizontal scale today.
5. **Testing has improved** (auth, RBAC, encryption, dosing-approval, scheduling tests now exist) but UI is 100% dark, scenarios are narratives not assertions, no migration tests, no coverage gate.

---

## Findings → Ultraplan crosswalk

Every finding below carries **EVID:** (file:line) and **OWNER:** (subsystem). Items without evidence are not in this plan.

### P0 — Stop-the-bleed real bugs (this week)

| ID | Finding | EVID | Owner | Fix |
|---|---|---|---|---|
| **U0-01** | **`POST /api/prescriptions` is a Tier-3 backdoor.** Accepts `medication_name`, `dose`, `route`, `frequency`, and `status: 'signed'` from the client. No call to `requestDosingApproval`, no CDS, no allergy, no domain guardrail. The entire Tier-3 architecture is bypassable through a normal REST POST. | `server/server.js:707-779` (esp. line 734 `status: req.body.status || 'signed'`) | Server / Tier-3 | Require `dosing_approval_id` issued via `BaseAgent.requestDosingApproval`. Re-run CDS + allergy + domain-logic guardrails server-side. Reject any client-supplied `status: 'signed'`. |
| **U0-02** | **`POST /api/prescriptions/from-speech` is the same backdoor, worse.** Extracts meds via regex from transcript and writes `status: 'signed'` directly. Speech → signed Rx, zero safety layer. | `server/server.js:781-828` (line 815) | Server / Tier-3 | Route through Domain Logic + CDS pipeline. Output is a *proposed* prescription (`status: 'draft'`), not signed. Signing requires the dosing-approval flow. |
| **U0-03** | **MediVault drug-interaction checks never fire.** `red-flag-agent` calls `drugSafetyService.checkDrugInteractions(medications)` with one arg; signature is `(newDrugName, activeMeds)`. `!activeMeds` short-circuits to `[]`. | `server/medivault/agents/red-flag-agent.js:392` vs `server/pharma/drug-safety-service.js:72` | MediVault / Pharma | Fix arg order. Add unit test that exercises the call from MediVault end and asserts non-empty interactions for a known pair. |
| **U0-04** | **DDI source is dead.** `drug-safety-service.js` calls `rxnorm.checkInteractionsAgainstList`. NLM retired the RxNorm interaction API in Jan 2024 — service silently returns empty arrays. Every "interaction-checked" prescription today is unchecked. | `server/pharma/drug-safety-service.js:72-86`, `server/pharma/rxnorm-service.js` | Pharma | Replace with live source: DrugBank, OpenFDA AERS, self-hosted NIH RXNAV proxy, or licensed feed. Add **fail-closed mode** — if source unreachable, prescription is held with `pending_ddi_check`, not auto-approved. |
| **U0-05** | **Pregnancy gating absent on HRT and most peptide rules.** Estradiol rule fires for `sex:'F', age_min:45` with no β-hCG / LMP gate. Only GLP-1 lists pregnancy in contraindications. ACOG documents spontaneous pregnancies through age 50+. | `server/domain/rules/hrt-rules.js:165-168`, `server/domain/rules/peptide-rules.js:141` | Domain rules | Add `pregnancy_status` and LMP requirement to every reproductive-age-female-eligible rule in HRT + peptides. Block initiation if LMP unknown. Propagate check into `functional-med-engine.evaluateTrigger`. |
| **U0-06** | **Critical-value notification has no active path.** `red-flag-agent` writes alerts to a queue with no STAT/page/SMS callback. K+ ≥6.0, troponin >0.4 produces a queue entry, not a clinician-paged event. | `server/medivault/agents/red-flag-agent.js:198-220` | MediVault | Emit synchronous `CRITICAL_VALUE` event to physician on-call channel. Require physician ack within configurable SLA. Log unacked criticals as Level-1 safety failures. Recalibrate troponin scale (legacy vs hsTrop), creatinine threshold to 5.0, add pediatric ranges. |
| **U0-07** | **Postgres adapter is a stub** but docs and code paths suggest it works. Every method throws. Production claim is false; multi-tenancy and managed-DB stories are blocked. | `server/db/adapters/postgres.js:23-46` | DB | Either implement end-to-end (translate `?`→`$N`, replace AUTOINCREMENT/BOOLEAN/serialize, connection pool, migration parity tests) or strike all "Postgres-ready" claims and pin SQLite explicitly until it lands. |
| **U0-08** | **Mock-fallback is silent.** When Claude API errors, `_claudeExtractClinicalData` and `_claudeGenerateSOAPNote` fall through to regex/pattern-matching with `console.error` only. No `safety_events` row, no `ai_degraded=true` tag on the encounter. A clinician opens a chart not knowing the SOAP note was regex-built. | `server/ai-client.js:769-801`, `:867-870` | AI client | On fallback: insert `safety_events` Level-2 row, set encounter flag `ai_degraded=true`, render banner on chart UI: "Note generated in fallback mode; clinician verification required." |

### P1 — Reliability and correctness (this sprint)

| ID | Finding | EVID | Owner | Fix |
|---|---|---|---|---|
| U1-01 | **No renal/hepatic/pediatric dose-adjustment layer.** `pharma/dosing-service.js` extracts `renal_adjustment`/`hepatic_adjustment` as text from FDA labels but nothing reads them at order time. | `server/pharma/dosing-service.js:206-242`, `server/agents/orders-agent.js` | Orders / Pharma | Insert dose-adjustment middleware between `domain-logic-agent` proposals and `requestDosingApproval`. Pulls eGFR/AST-ALT-bilirubin/age-weight, blocks or annotates per FDA-label thresholds. |
| U1-02 | **`lab-synthesis-agent` runs in parallel with CDS** (`dependsOn: []`), so CDS can evaluate stale labs in same pipeline. | `server/agents/lab-synthesis-agent.js:42` | Orchestrator | Set `dependsOn: ['lab_synthesis']` on cds-agent and domain-logic-agent (or invert: lab_synthesis runs first). |
| U1-03 | **Audit log has no integrity proof.** Plain SQLite rows, no hash chain, no append-only constraint, no nightly verifier. A future regression or insider write rewrites history undetectably. | `server/audit-logger.js`, `server/database-migrations.js` (no `previous_hash`/`hmac` columns) | Audit | Add `previous_hash`, `hmac` columns to `audit_log`. Insert trigger fills `previous_hash` from prior row, `hmac` from `HMAC(secret, prior_hash || row_json)`. Block UPDATE/DELETE via SQLite trigger. Nightly chain-verifier job. |
| U1-04 | **Token blacklist + rate limiter + session store are in-memory Maps.** Logout on node A doesn't revoke on node B; restart wipes blacklist; per-replica rate limit lets attacker round-robin. | `server/security/auth.js:43`, `server/security/hipaa-middleware.js:26,37` | Security | Move to Redis (or DB-backed `revoked_tokens(jti, exp)` + `rate_limit(key, count, window)` + `sessions(id, payload, exp)`). Single source of truth. |
| U1-05 | **Prompts are inline string literals, not versioned.** Two-week-old SOAP notes can't be replayed; prompt edits silently change behavior of in-flight encounters. | `server/ai-client.js:670` (extraction), `:827` (SOAP) | AI client | Move prompts to `server/ai-client/prompts/extraction/v1.md` + `prompts/soap/v1.md`. Hash on load. Store `prompt_id`, `prompt_sha256` on every inference row. New version = migration. |
| U1-06 | **Model id `claude-sonnet-4-6` is unversioned alias.** Auto-following minor revisions is a clinical-safety hazard — reproducibility breaks on every server-side model rev. | `server/ai-client.js:866` | AI client | Pin every call site to a dated build. Startup assertion in `getMode()` rejects launch if any call uses an unversioned alias. |
| U1-07 | **Citation-back-to-source absent on AI extractions.** Vitals, meds, problems are extracted with no character offset into the transcript. A clinician can't verify "where did the AI hear me say BP 188/100?" | `server/ai-client.js:686-714` schema | AI client | Extend extraction schema: every value carries `evidence_quote` (verbatim transcript span), `start_offset`, `end_offset`. Reject parsed output where `evidence_quote` isn't a substring of transcript. Persist with inference row. |
| U1-08 | **Penicillin↔cephalosporin cross-reactivity not in allergy class table** (5–10% literature rate); no carbapenem, fluoroquinolone, macrolide, vancomycin, benzo classes. | `server/agents/orders-agent.js:18-27` | Orders | Expand drug-class table. Source class membership from a maintained table (RxNorm RxClass relationships) rather than hardcoded list. |
| U1-09 | **Lab-result trending absent.** All thresholds are point-in-time. No Δ-from-baseline (creatinine doubling = AKI), no Na correction-rate guard (osmotic demyelination on rapid Na correction). | `server/medivault/agents/red-flag-agent.js:40-131`, CDS rules | CDS / MediVault | Lab trend detector that compares latest result to prior values within window. Trigger on Δ thresholds, not absolute values, for AKI/AMS/electrolyte derangement patterns. |
| U1-10 | **CSRF on patient portal cookie auth** — `SameSite=Lax` doesn't block top-level POST navigation; refill, message, triage, appointment booking are CSRF-vulnerable. | `server/services/portal-session-service.js:23-42`, `server/routes/patient-portal.js:120-385` | Patient portal | Double-submit token + `SameSite=Strict` for state-changing endpoints. Origin-header check fallback. |
| U1-11 | **Patient-portal session cookie missing `__Host-` prefix; `Path=/`.** | `server/services/portal-session-service.js` | Patient portal | `__Host-` prefix; `Secure`; `Path=/api/patient-portal`; `HttpOnly`; `SameSite=Strict`. |
| U1-12 | **Provider-learning has no tenant isolation.** `provider_preferences` keys on `provider_name TEXT` only — no `tenant_id`, no FK to `users`. Two clinics in one DB share practice patterns. | `server/database.js:281-294` | Provider learning | Add `tenant_id` (or scope strictly per-deployment with documentation). Composite index `(tenant_id, provider_name)`. |
| U1-13 | **OAuth state stored in module-level Map.** LabCorp OAuth `invalid_state` after restart; not horizontally scalable. | `server/routes/labcorp-routes.js:44,115` | LabCorp | Move to `labcorp_oauth_states` DB table with TTL. |
| U1-14 | **XML parser without `processEntities:false`/`stopNodes`.** External-party lab XML is XXE / billion-laughs surface. fast-xml-parser version bump fixed one CVE; the configuration surface is wider. | `server/integrations/labcorp/parser.js:64-71` | LabCorp | Configure parser: `processEntities: false`, set `stopNodes` for known-large fields, max-depth limit. |
| U1-15 | **Webhook signature has no timestamp/nonce; no SSRF allowlist on subscriber URL.** Admin can register `http://169.254.169.254/...` (cloud metadata). | `server/integrations/event-bus.js:81-128` | Integrations | Sign `timestamp.body`, reject >5 min skew. Block RFC1918 + link-local + metadata IPs. |
| U1-16 | **No SBAR-shaped inter-agent messages.** Handoffs are loose JSON. Reconciliation/translation agents lose clinical context fidelity over multi-hop pipelines. | `server/agents/message-bus.js`, all agents | Inter-agent | Define an SBAR envelope schema: `situation`, `background`, `assessment`, `recommendation`, `provenance`. All Tier-2/Tier-3 messages adopt it. |
| U1-17 | **`Object.assign(context.vitals, extracted.vitals)` on Claude output.** Prototype-pollution surface via `__proto__` key. | `server/server.js:651` | Server | Whitelist copier; reject keys outside the schema. |
| U1-18 | **Migration test file does not exist.** Schema versioning, idempotent re-run, additive-column migrations on populated DB are untested. | `server/database-migrations.js`, `test/unit/` (no `database-migrations.test.js`) | Tests | New `test/unit/database-migrations.test.js`: fresh-DB run, repeated-run idempotency, populated-DB additive-column run, failed-migration rollback. |
| U1-19 | **UI test layer is 0% covered.** No vitest, no @testing-library/react, no Playwright. 8 React pages + dozens of components are dark. | `package.json:44-55`, `src/` | Frontend tests | Vitest + @testing-library/react for `src/components/workflow/` and `src/pages/`. One Playwright smoke test in CI: login → encounter → SOAP draft. |
| U1-20 | **Stress-test scenarios are narratives, not assertions.** Scenario runner CAN check `expected_cds.should_fire`, but `stress-test-scenarios.json` (1743 lines) has zero `expected_cds` blocks. CI doesn't invoke the runner. | `test/scenarios/run-scenario.js:236-258`, `test/scenarios/stress-test-scenarios.json` | Tests | Backfill `expected_cds` on every scenario. CI job: boot server, run `node test/scenarios/run-scenario.js --all`, exit non-zero on failure. |
| U1-21 | **ESLint posture is permissive (3/10).** Multiple `no-*` rules downgraded to `warn`, no security/promise/import plugins. | `.eslintrc.cjs:21-40` | Lint | Tighten downgraded rules to `error`. Add `eslint-plugin-security`, `eslint-plugin-node`, `eslint-plugin-promise`. |
| U1-22 | **No coverage gate, no SAST, no Dependabot.** | `.github/workflows/ci.yml` | CI | c8/nyc with 70% floor on `server/`. CodeQL job. `.github/dependabot.yml` weekly. `dependency-review-action` on PRs. SBOM (cyclonedx). |

### P2 — The AI Trust Ledger (the differentiator)

This is what makes it *the* AI EHR, not just a hardened one. Plan one engineering quarter, then iterate.

| ID | Capability | Target | Owner |
|---|---|---|---|
| U2-01 | **`ai_inferences` table.** Every Claude call writes a row: `request_id`, `ts`, `model`, `model_version`, `system_hash`, `user_hash`, `prompt_template_id`, `retrieval_snapshot_json`, `temperature`, `max_tokens`, `raw_response_json`, `parsed_json`, `input_tokens`, `output_tokens`, `latency_ms`, `encounter_id`, `patient_id`, `fallback_to_mock_bool`, `error`. Inserted in `callClaude` (`ai-client.js:67`). | Every AI inference reproducible from cold storage. | AI client + DB |
| U2-02 | **Versioned prompt registry** (U1-05 done) **+ migration semantics**. New prompt version creates a new template_id; running encounters can opt-in or stay on prior version until clinician closes. | Audit-perfect prompt provenance. | AI client |
| U2-03 | **Confidence + override audit.** Persist confidence per AI-extracted field. `physician_overrides` table (already exists, unwired) gets writes from the transcript-edit handler so corrections feed the learning loop. | Learning loop closes; overrides are first-class data. | UI + AI client |
| U2-04 | **Rule versioning + decision provenance.** `clinical_rules` adds `rule_version`. Every CDS/Domain Logic suggestion stores the `rule_id` + `rule_version` + `evidence_source` it fired against. | Reconstruct any suggestion: which rule, on what data, with what thresholds. | CDS + Domain |
| U2-05 | **Mock-fallback explicit safety event** (U0-08 done). Plus a `degraded_encounters` view for nightly review. | No silent AI degradation. | AI client |
| U2-06 | **Litigation hold** (development-time analogue: "frozen on review hold"). Encounter row gets `frozen_at` timestamp; while frozen, prompts can't be retired, models can't be deprecated, templates can't be edited. Frozen encounters always replay byte-identical. | Frozen reconstruction guarantee. | AI client + DB |
| U2-07 | **Replay Console (the moonshot).** Clinician opens any AI-touched chart artifact (SOAP note, extraction, CDS suggestion). Clicks "Replay." System reconstructs prompt + context + model + sampling from the `ai_inferences` row, re-fires against the pinned snapshot, diffs old vs new output. **No EHR on the market does this. This single capability is what makes it best-in-class.** | Reproducible AI for medico-legal defense + scientific reproducibility. | UI + AI client |

### P3 — Architectural ceiling (next 6–10 weeks)

| ID | Capability | EVID / Target | Owner |
|---|---|---|---|
| U3-01 | **Tenancy decision and execution.** Pick: (a) per-tenant DB row (`tenant_id` everywhere) for multi-tenant SaaS, OR (b) per-deployment hardening (separate volumes, DBs, secrets, MRN scoping documented). Currently straddles both — pick one and execute. | All PHI-bearing tables. | DB / deployment |
| U3-02 | **Postgres adapter end-to-end** (U0-07 done) — translate placeholders, replace SQLite-isms, migration parity test, connection pool. | `server/db/adapters/postgres.js`. | DB |
| U3-03 | **Externalize state to Redis** (U1-04 done) — token blacklist, rate limiter, session store, OAuth state. Prerequisite for >1 replica. | Multiple. | Security / Infra |
| U3-04 | **MessageBus durability**. In-process EventEmitter + queue → outbox pattern (`claimed_by`, `claimed_at`) or Redis Streams / NATS / Postgres LISTEN-NOTIFY. Node crash mid-encounter doesn't lose unacked work. | `server/agents/message-bus.js:131-143`. | Agents / Infra |
| U3-05 | **Observability baseline.** `/metrics` (prom-client), structured logs with `request_id` + `agent_id` + `encounter_id` correlation, OpenTelemetry tracing through the message bus, separate `/healthz` vs `/readyz`, webhook DLQ + replay endpoint. On-call runbook in repo. | `server/server.js`, all agents. | Observability |
| U3-06 | **TLS by default.** `nginx/nginx.conf` HTTPS redirect + 443 server block currently commented out. `setup.js` generates dev certs. Document Let's Encrypt path. | `nginx/nginx.conf:42-44, 97-106`. | Deployment |
| U3-07 | **Backup + restore drill.** SQLite path solid; add Postgres path; document and automate restore drill (anonymized for non-prod). | `scripts/backup.sh`. | Ops |
| U3-08 | **Index coverage + FTS.** Add `patients(last_name, dob)`, `problems(patient_id, status)`, `medications(patient_id, status)`, `encounters(patient_id, encounter_date DESC)`. Full-text search for problem-list and note search. | `server/database.js:386-551`. | DB |

### P4 — Moonshot capabilities ("best AI EHR ever")

These are net-new capabilities. Each is a 1–2 month engineering effort. Pick 2–3 to actually ship; the rest become roadmap.

| ID | Capability | Why it's differentiating |
|---|---|---|
| **U4-01** | **Replay Console** (U2-07 promoted). Time-travel into any AI-touched artifact: prompt, context, model, output, diff. | No EHR has this. Solves the medico-legal-AI problem the entire industry is dodging. |
| **U4-02** | **Continuous-learning Provider Profile**, with explicit consent + per-clinician opt-in. The agent learns the physician's macros, phrasing, dx preferences over time. The clinician can view, edit, freeze, or wipe their profile from a settings page. | Today, every physician trains every model from scratch on every encounter. This is the obvious win every other EHR is too risk-averse to ship. |
| **U4-03** | **Voice-driven chart navigation** beyond capture: "show me her last A1C trend," "compare today's BP to last visit," "draft a referral to ortho for left knee." Built on the same ambient pipeline. | Removes the click count even for non-documentation tasks. |
| **U4-04** | **Patient-side Replay**. Patient logs into MediVault, sees not just their record but **why** the AI surfaced X. Builds patient trust in AI recommendations and meets the emerging "explainable AI" bar from FDA SaMD guidance. | Differentiator for direct-to-consumer / DPC market. |
| **U4-05** | **Specialty-pluggable Domain Logic.** HRT/peptide/functional-med is one specialty. Architect Domain Logic so a cardiologist, endocrinologist, or rheumatologist can publish their own rule pack with the same evidence-source enforcement. Rule packs are signed and versioned; clinic admins enable per-deployment. | Turns this from a great primary-care EHR into a platform. |
| **U4-06** | **Live agent-decision tracing UI** for the clinician. Open a CDS suggestion → see the rule that fired, the data points it considered, the alternative rules it didn't fire, with one-click feedback ("this was wrong because…"). Feedback feeds rule-improvement loop. | Closes the AI-trust feedback loop visibly. Builds physician trust by *showing the work*. |
| **U4-07** | **Coding agent with prospective E&M optimization** + audit-defense bundle. When the encounter is being documented, the coding agent shows what's needed for the next E&M level and what's missing — but also flags upcoding pressure and emits an audit-defense pack (notes + chart references) on every claim. | Aligns revenue-integrity with documentation integrity. Solves the "coder vs clinician" tension structurally. |
| **U4-08** | **Standing-orders engine with per-protocol RBAC tier**. Physician-signed standing-order template required; MA can execute under tier 2 only against a current physician-signed template. Versioning, expiration, audit. | Today MA refill protocols are evaluated like single orders. Real practices live and die on standing orders. |

---

## Sequencing — recommended

```
Week 1–2  : P0 (U0-01 … U0-08)          — close real bugs, prove safety
Week 3–6  : P1 (U1-01 … U1-22)          — reliability, AI trust foundations, tests
Week 7–10 : P2 (U2-01 … U2-06)          — AI Trust Ledger
Week 11   : P2-07 Replay Console MVP    — first moonshot ships
Quarter 2 : P3 (U3-*) + P4 picks        — architecture ceiling + 2-3 moonshots
```

P0 has hard ordering: U0-01 + U0-02 (the prescription backdoor) is the single highest-stakes item; everything else can fan out after that's closed.

P1 has soft ordering: U1-03 (audit immutability) and U1-04 (externalize state) are dependencies for P2 and P3. U1-05/06/07 (prompt versioning, model pinning, citations) are dependencies for U2-*.

P2 is mostly serial — `ai_inferences` table first, then everything else builds on it.

P4 can start in parallel with P3 once U2-01 is in.

---

## What this becomes when shipped

The bar — "best AI EHR ever conceived" — has three legs the rest of the industry is failing at:

1. **Reproducible AI**. Today, every AI EHR's clinical AI output is a one-shot — you can't replay a SOAP note from 6 weeks ago. Once U2-01 + U2-07 ship, this codebase can. **No competitor has this.**
2. **Visible reasoning**. Today, CDS is a black box; clinicians stop trusting alerts because they can't see why. Once U4-06 ships, every alert is one click from "show me your work." **No competitor does this either.**
3. **Specialty extensibility on a safety chassis**. The Domain Logic + evidence-source pattern is a *platform*, not a feature. Once U4-05 ships, this is the substrate any specialty can build on — with the safety guarantees baked in. **No competitor's plugin model has the safety chassis.**

Hardening the existing system (P0 + P1 + P3) makes it a *good* AI EHR. P2 + P4 are what make it the *best ever conceived*. The split is intentional — a skipped P0 caps every later ambition, and a perfectly-hardened-but-undifferentiated EHR is just another EMR.

---

## Open questions / blockages — to revisit

These are the questions I deferred during the iterative review per your instruction. Read at end, decide later.

1. **Tenancy mode** — single-clinic-per-deployment (current implicit) vs `tenant_id`-everywhere multi-tenant. P3 needs the call. **Default if no answer**: keep per-deployment, document the boundary, drop "Postgres-ready" from docs until a real tenancy story exists.
2. **DDI replacement source** — DrugBank (commercial), OpenFDA AERS (free, signal not interaction), self-hosted RXNAV proxy, or licensed feed. Each has cost + latency tradeoffs. P0/U0-04 needs this. **Default**: stand up a self-hosted RXNAV proxy with a cached interactions table and fail-closed mode while we evaluate commercial.
3. **Model pinning policy** — pin to dated build (e.g., `claude-sonnet-4-6-20260301`) and re-validate on each rev, or follow alias and accept silent drift. **Default**: pin every call, re-validate quarterly, refuse to launch on unversioned alias.
4. **Replay Console scope** — full UI (P4) or backend `/api/inference/replay/:id` first (P2). **Default**: backend first, UI later.
5. **Provider-learning consent** — opt-in with default off, opt-out with default on, or off-by-default with a setup flow. Affects U4-02. **Default**: opt-in with explicit consent screen at first login.
6. **Specialty-pack distribution** (U4-05) — in-repo, signed npm package, or a registry service. **Default**: signed npm package, single trusted publisher to start.
7. **Critical-value notification channel** (U0-06) — internal (in-app banner + sound) only, vs SMS/page integration. **Default**: in-app + log unack as Level-1; SMS/page as P4 later.
8. **CSRF token strategy on patient portal** (U1-10) — double-submit cookie or synchronizer-pattern via separate `/csrf-token` endpoint. **Default**: double-submit cookie (simpler, stateless).

---

*Generated 2026-05-08 by 5-agent local ultrareview + cross-verified at source. Supersedes ULTRAREVIEW_04-07-2026.md as the active roadmap. Prior report retained for historical reference.*
