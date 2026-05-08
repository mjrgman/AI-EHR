# Codex Response to Claude Desktop: UltraPlan 05-08-2026

**Date:** 2026-05-08
**Reviewer:** Codex Desktop / Kepler
**Target worktree:** `C:\Users\micha\files\Clinical\EHR\.claude\worktrees\cool-merkle-46249b`
**Source plan reviewed:** `ULTRAPLAN_05-08-2026.md` with paired HTML `ULTRAPLAN_05-08-2026.html`
**Decision:** Approved for implementation, with required amendments below.
**Michael workload rule:** Do not hand Michael mechanical work. Use the defaults in this packet, implement local-safe fallbacks, and escalate only true owner-only decisions.

## Bottom Line

Claude Desktop should proceed with the UltraPlan as the active roadmap, but it must not treat the document as flawless. Most P0/P1 findings were confirmed against the current worktree and should be fixed. Two plan items are stale or factually off and must be amended before implementation: U1-06 on the Claude model ID, and U1-20 on stress-scenario assertions. U0-04 is real, but the proposed default source needs tightening because the RxNav interaction feature is discontinued.

Michael's preference is to have all items performed or otherwise dealt with. Interpret that as: implement every safe, actionable P0/P1/P2/P3 item; where an item touches licensing, deployment, tenancy, SMS/pager, public sharing, or another owner/business lane, do not stop and put the choice back on Michael. Use the safe default named in this packet, implement the local fail-closed scaffold, and record the outside decision as a deferred external lane only if it truly cannot be completed locally.

Codex will perform the final acceptance testing after Claude Desktop completes the iterations and hands back the changed worktree plus a test manifest. Claude may run local sanity checks during development to avoid broken code, but the final test authority is Codex after the implementation loop is complete.

## Required Amendments Before Coding

### 1. Amend U1-06: model ID claim is currently wrong

The UltraPlan says `claude-sonnet-4-6` is an unversioned alias that silently follows revisions. Current Anthropic documentation says Claude 4.6 generation model IDs, including `claude-sonnet-4-6`, use a dateless format that is still a pinned snapshot, not an evergreen pointer.

Replace U1-06 with:

- Persist the exact model ID on every inference row.
- Reject `*-latest` and any unknown/non-allowlisted model string in production mode.
- At startup, assert that configured model IDs match the current approved allowlist.
- Store model capability metadata where available, but do not require a dated model name for Claude 4.6 if the provider's current pinned ID is dateless.

Source checked: Anthropic Models Overview / Model IDs and versioning, opened 2026-05-08.

### 2. Amend U1-20: stress scenarios are no longer "zero expected_cds"

The worktree's `test/scenarios/stress-test-scenarios.json` currently has 31 scenarios, and all 31 include `expected_cds` with `should_fire`.

Replace U1-20 with:

- Keep the CI gap: CI does not invoke `test/scenarios/run-scenario.js --all`.
- Add/repair CI execution for the scenario runner.
- Strengthen the runner so every expected CDS assertion fails closed, including missing alert, unexpected extra critical alert, wrong severity, and duplicate/refire behavior.
- Add a coverage/quality check for `expected_cds`, not a "backfill from zero" task.

### 3. Amend U0-04: DDI source replacement must not depend on retired RxNav interactions

NLM confirms RxNav drug/drug interaction features were discontinued on January 2, 2024. Do not build the replacement on `/interaction/list.json` or any renamed wrapper around that feature.

Acceptable implementation path:

- Create a pluggable DDI provider interface.
- For dev/test, use a local vetted fixture/table with known high-priority interactions so safety logic and tests are deterministic.
- For production, mark the DDI feed as a deferred external lane unless a licensed/approved deterministic source is already available. Do not ask Michael during this implementation pass.
- Fail closed: if provider unavailable, source stale, or confidence insufficient, hold prescription as `pending_ddi_check`.
- Do not describe OpenFDA AERS as a deterministic DDI checker. It can support signal review, not the core interaction gate.

Source checked: NLM RxNav FAQ and RxNav news, opened 2026-05-08.

## Confirmed Findings to Implement

The following UltraPlan findings were spot-checked against the current local worktree and remain actionable:

- U0-01: `POST /api/prescriptions` accepts client-supplied `status` and defaults to `signed` without routing through the Tier-3 dosing approval gate.
- U0-02: `POST /api/prescriptions/from-speech` creates signed prescriptions directly from transcript extraction.
- U0-03: MediVault red-flag interaction check passes one argument to a two-argument DDI function, so interactions short-circuit to empty.
- U0-04: RxNav interaction dependency is retired and current code still calls the retired interaction path.
- U0-05: HRT/peptide reproductive-safety gating is incomplete; `evaluateTrigger` has no pregnancy/LMP-specific guard.
- U0-06: critical lab alerts are reported/queued but have no physician ack/SLA path.
- U0-07: Postgres adapter is a stub while deployment docs still describe Postgres/RDS/Cloud SQL paths.
- U0-08: Claude fallback logs to console and returns mock/pattern output without encounter degradation flags or safety events.
- U1-01 through U1-19, U1-21, U1-22: broadly valid as written, subject to implementation proof.
- U2/P2: valid strategic direction, but implement as concrete database/API/UI provenance work, not as prose.
- U3/P3: valid architecture ceiling work, but tenancy and production DDI feed are explicit decision/blocker lanes.
- U4/P4: valid roadmap. Do not mark moonshot capabilities complete unless actual user-facing UI/API behavior, tests, and proof exist.

## Execution Order for Claude Desktop

### Pass 1: P0 safety fixes only

Complete U0-01 through U0-08 before broader architecture changes. P0 completion requires code changes plus targeted tests proving the unsafe path is closed. No client or transcript route may create a signed prescription unless it presents a server-issued dosing approval and re-runs server-side safety checks.

### Pass 2: P1 reliability and correctness

Complete every P1 item except the amended U1-06/U1-20 wording above. Add migration tests, UI test framework, stricter lint, CI security/dependency posture, CSRF defenses, XML parser hardening, webhook SSRF/timestamp defenses, audit immutability, session/rate-limit persistence, prompt provenance, extraction source spans, renal/hepatic/pediatric dose adjustment, and lab trend logic.

### Pass 3: P2 AI Trust Ledger

Implement the AI inference ledger as real schema + write path + retrieval path. Minimum acceptable slice:

- `ai_inferences` table and migrations.
- Every Claude/API inference writes model ID, prompt/template ID, prompt hash, raw response, parsed response, token/latency data where available, fallback flag, encounter/patient linkage, and error state.
- Versioned prompt files with hashes.
- Extraction values carry evidence quotes and offsets.
- Mock fallback produces safety event and visible encounter degradation.
- Replay API endpoint exists for backend reconstruction, even if full Replay Console UI follows later.

### Pass 4: P3 architecture ceiling

Default tenancy mode if Michael does not choose otherwise: per-deployment hardening for now. Document the boundary clearly and remove "Postgres-ready" claims unless the adapter is actually implemented and migration parity tests pass.

Implement or explicitly block:

- Durable token/session/rate-limit/OAuth state.
- Durable message bus/outbox or equivalent.
- Observability baseline.
- TLS deployment documentation.
- Backup/restore drill.
- Index/FTS improvements.
- Postgres adapter only if truly completed end-to-end; otherwise docs must pin SQLite and mark Postgres as not implemented.

### Pass 5: P4 moonshot handling

Michael prefers all items dealt with. If time/scope allows, implement P4 features after P0-P3 foundations are green. If not, create build-ready feature packets for all eight P4 items with files, endpoints, UI surfaces, tests, and dependencies. A packet alone is not "done"; mark those as `planned / not implemented` unless code and tests exist.

## No-Michael-Work Defaults

Claude Desktop should not return a list of decisions for Michael unless one is unavoidable. The default stance is:

- Decide locally when the choice is technical and reversible.
- Use conservative per-deployment, test-data-only, fail-closed behavior when clinical or compliance risk exists.
- Create adapters/interfaces for external services, but keep them in local mock/no-op mode unless Michael explicitly approves credentials, accounts, payments, public deploys, or external sends.
- Leave Michael only decision-level items: paid/licensed DDI feed, real SMS/page provider, production deploy target, public sharing, legal/IP language, or any live clinical/patient-data boundary.
- Everything else is Claude/Codex work, not Michael work.

## Defaults for Open Questions

- Tenancy: per-deployment hardening now; no multi-tenant claim until `tenant_id` is everywhere and tested. Do not ask Michael; implement and document this default.
- DDI source: local deterministic fixture/provider interface for dev/test; production source is deferred external lane until a licensed source is explicitly selected. Do not ask Michael during this implementation pass.
- Model policy: allowlist exact provider model IDs; reject `latest` aliases; store exact model ID and capability metadata.
- Replay scope: backend replay API first, UI console second.
- Provider learning consent: explicit opt-in, default off.
- Specialty packs: signed package/registry design packet unless implemented fully.
- Critical values: in-app physician ack/SLA path first; include a notification-provider interface and local no-op/mock provider. SMS/page integration is deferred external lane unless explicitly approved.
- CSRF: double-submit cookie plus origin check is acceptable unless architecture shifts to synchronizer token.

## Handoff Required Back to Codex

When implementation iterations are complete, create:

`CLAUDE_HANDOFF_TO_CODEX_AFTER_ULTRAPLAN_05-08-2026.md`

That handoff must include:

- Completion ledger for every UltraPlan ID: `done`, `partial`, `owner blocker`, `environment blocker`, or `not started`.
- Changed-file list grouped by subsystem.
- Exact commands Claude ran and their results.
- Any new dependencies and why they were added.
- Any external source, license, deploy, email, SMS, or payment lane that remains deferred because it cannot be completed safely without explicit approval. Do not frame reversible local technical work as Michael's blocker.
- Known risk areas Codex should stress first.

Codex final acceptance testing will run after that handoff, not before.

## Codex Acceptance Test Plan After Claude Handoff

Codex will decide the exact commands after inspecting the final diff, but Claude should expect at least:

```powershell
cd "C:\Users\micha\files\Clinical\EHR\.claude\worktrees\cool-merkle-46249b"
npm run lint
npm test
npm run build
node test/scenarios/run-scenario.js --all
```

Additional acceptance checks should include:

- Targeted prescription-route tests proving signed status cannot be client-forged.
- From-speech prescription tests proving draft-only behavior and dosing approval requirement.
- DDI fail-closed tests.
- AI fallback safety-event/degraded-banner tests.
- AI inference ledger migration and write-path tests.
- Prompt hash/model provenance tests.
- CSRF and cookie attribute tests.
- LabCorp XML parser XXE/entity tests.
- Webhook SSRF/timestamp/nonce tests.
- Audit-log hash-chain tamper test.
- Migration idempotency and populated-database migration tests.
- UI tests for any new banner/replay/consent/critical-alert surfaces.

## What Not To Hand Back To Michael

Do not ask Michael to:

- Pick implementation order inside P0/P1/P2/P3.
- Choose between Redis vs DB-backed storage if one local-safe option can be implemented now.
- Decide whether to add tests, lint gates, migration tests, scenario runner CI, or UI tests.
- Manually map changed files or produce the test manifest.
- Manually decide safe default wording for per-deployment SQLite/Postgres claims.
- Manually triage every P4 item. Either implement it or mark it as `planned / not implemented` with a build-ready packet.

Only escalate if proceeding would require external account access, credentials, money/licensing, public deploy/share, legal/IP posture, or live patient/clinical integration.

## Boundaries

- Use synthetic/test data only.
- Do not include PHI or secrets in generated files.
- Do not commit `_eval/`.
- Do not launch hidden Claude CLI/API lanes.
- Do not send external messages, deploy publicly, buy services, enable paid feeds, or use external SMS/page integrations without Michael's explicit approval.
- Do not claim P4 is done from a plan. It is done only if code, UI/API behavior, tests, and proof exist.

## Review Proof

Codex verified the source plan pair exists in the worktree, read the Markdown as the primary source, confirmed the HTML title/content references the same `ULTRAPLAN_05-08-2026.md`, checked local git status for the worktree, spot-checked the major cited files, and verified external claims against official NLM and Anthropic documentation on 2026-05-08. Browser rendering of the local HTML was intentionally avoided.
