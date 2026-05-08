# Agent Split: No Michael Relay

**Date:** 2026-05-08
**Scope:** `C:\Users\micha\files\Clinical\EHR\.claude\worktrees\cool-merkle-46249b`
**Rule:** Claude and Codex coordinate through files. Michael is not the task router, test runner, or decision relay.

## Ownership

### Claude Desktop Owns Implementation

Claude owns source edits for the UltraPlan implementation in this worktree:

- P0 safety fixes U0-01 through U0-08.
- P1 reliability/correctness fixes using Codex amendments.
- P2 AI Trust Ledger implementation.
- P3 local architecture hardening.
- P4 feasible implementations or build-ready packets marked honestly.
- Local sanity checks during implementation.
- Final handoff file to Codex.

Claude must start from:

- `CLAUDE_DESKTOP_START_HERE_ULTRAPLAN_IMPLEMENTATION.md`
- `CODEX_RESPONSE_TO_CLAUDE_ULTRAPLAN_05-08-2026.md`
- `ULTRAPLAN_05-08-2026.md`
- `CLAUDE.md`

### Codex / Kepler Owns Acceptance

Codex owns post-implementation acceptance after Claude creates:

`CLAUDE_HANDOFF_TO_CODEX_AFTER_ULTRAPLAN_05-08-2026.md`

Codex will then:

- inspect Claude's diff,
- run lint/tests/build/scenario runner,
- add targeted regression tests if needed,
- perform critique/repair recommendations,
- write a final acceptance or blocker packet,
- keep Code Dispatch status current.

Codex does not need Michael to paste commands or manually summarize Claude's work. The handoff file is the relay.

## No-Michael Work Rule

Do not assign Michael:

- implementation ordering,
- file mapping,
- choosing local technical defaults,
- producing handoff/test manifests,
- running test commands,
- comparing source files,
- relaying Claude output into Codex.

Only escalate to Michael for true owner-only approval:

- paid/licensed external feeds,
- credentials/secrets,
- public deploy/share,
- external email/SMS/page sending,
- legal/IP posture,
- live patient/clinical integration.

For all owner-only lanes, implement the local adapter/mock/fail-closed scaffold and mark the outside lane deferred.

## Handoff Protocol

Claude writes:

`CLAUDE_HANDOFF_TO_CODEX_AFTER_ULTRAPLAN_05-08-2026.md`

Codex writes after testing:

`CODEX_ACCEPTANCE_AFTER_CLAUDE_ULTRAPLAN_05-08-2026.md`

If either side is blocked, that side writes a blocker file in this worktree with:

- exact blocker,
- files touched,
- commands attempted,
- safest next action,
- whether the blocker is owner-only or environment-only.

No chat relay through Michael is required for normal work.
