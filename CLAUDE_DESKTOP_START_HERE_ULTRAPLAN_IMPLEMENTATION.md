# Claude Desktop Start Here: Implement UltraPlan Without Michael as Middleman

**Purpose:** This is an execution contract for Claude Desktop, not a task list for Michael.

## Division of Labor

- **Claude Desktop:** implement the UltraPlan work in this worktree.
- **Codex Desktop / Kepler:** review and run final acceptance testing after Claude completes the implementation handoff.
- **Michael:** should not be assigned mechanical coordination, test manifests, implementation ordering, file mapping, or routine technical choices.

## Required Source Files

Read these before coding:

1. `CLAUDE.md`
2. `ULTRAPLAN_05-08-2026.md`
3. `CODEX_RESPONSE_TO_CLAUDE_ULTRAPLAN_05-08-2026.md`
4. `AGENT_SPLIT_NO_MICHAEL_RELAY_05-08-2026.md`

The Codex response is binding for amendments and workload boundaries.

## Operating Rule

Do not ask Michael to decide anything that can be decided safely inside the repo. Use the defaults in `CODEX_RESPONSE_TO_CLAUDE_ULTRAPLAN_05-08-2026.md`.

Only stop for Michael if the next step requires:

- live credentials or secrets,
- a paid/licensed feed,
- public deploy/share,
- external email/SMS/page sending,
- legal/IP posture,
- live clinical or patient-data integration.

For those, implement the local adapter/mock/fail-closed scaffold and record the external lane as deferred. Do not block local implementation on it.

## Work Order

1. Implement all P0 items U0-01 through U0-08 with targeted tests.
2. Implement all P1 items using the Codex amendments for U1-06 and U1-20.
3. Implement the P2 AI Trust Ledger as real schema, write path, provenance, fallback safety event, and backend replay API.
4. Implement P3 local architecture hardening using the per-deployment default unless the code can fully support and test a stronger option.
5. Handle P4 by implementing what is feasible after P0-P3; otherwise write build-ready feature packets and mark them `planned / not implemented`.

## Handoff Back to Codex

When done, create:

`CLAUDE_HANDOFF_TO_CODEX_AFTER_ULTRAPLAN_05-08-2026.md`

Include:

- per-ID ledger for every UltraPlan item,
- changed files grouped by subsystem,
- commands run and results,
- new dependencies and rationale,
- deferred external lanes,
- known risk areas Codex should stress first.

Codex will then run final acceptance testing. Do not send this back to Michael as homework.
