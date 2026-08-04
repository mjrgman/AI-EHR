# CLAUDE.md — Clinical\EHR Workspace

## No-HTML Output And Nate Sentinel Policy (2026-06-03)

- Do not create HTML reports, dashboards, previews, rendered pages, or browser-opened proof for routine work in this project. Default closeout is concise Markdown/status plus proof artifacts.
- Existing `.html`, web-app, JSX/TSX, and browser-based project source files are source assets only; maintaining source is not permission to render or open HTML output.
- Only a current-turn Michael instruction for a visible UI, browser, or page can change this for that run, and the run must record the exact file/runtime proof.
- Nate is the local always-on LLM Sentinel and APL-style packet liaison for GSD. Nate lives locally, searches GSD/Code Dispatch status surfaces, keeps Sentinel moving, and makes sure Codex, Claude/Opus, Gemini/Antigravity, and other visible frontier lanes receive clear packets and return proof.
- Nate may prepare routing nudges, context packs, queue summaries, and packet reminders, but Nate is not a hidden frontier worker, not a paid API lane, and not proof of completion.
- Every model lane still needs file-backed evidence before pickup or completion is claimed: `status.json`, `result.md` or `progress.md`, outbox return, queue digest, heartbeat, or current runtime proof.
- If this file conflicts with Code Dispatch `AGENTS.md`, `CODEX_BRAIN.md`, or current local evidence, current local evidence wins.


Last updated: 2026-06-03 (currency check; four-layer guardrails re-verified)
Root: `C:\Users\micha\files\A_active_projects\Clinical\EHR\`
Scope: this working directory and all subdirectories.

## Purpose

EHR (Electronic Health Records) workspace for development, testing, and evaluation artifacts. Inherits global rules from [`~/.claude/CLAUDE.md`](C:\Users\micha\.claude\CLAUDE.md).

## EHR Secrets Cycle — RESOLVED 2026-04-20

Previously a recurring issue where `_eval/SECRETS_FINDINGS.md` would regenerate each cycle and re-expose credentials. Resolution locked in four layers:

1. **Redaction rule**: `C:\Users\micha\files\skills\unified-eval-edit\SKILL.md §7 REDACTION RULE` is the canonical spec. All eval passes must apply this before emitting any `_eval/` output.
2. **Gitignore**: `Clinical\EHR\.gitignore` excludes `_eval/`, `_dispatch_archive/`, `00_*.md` and `HAL_ITERATION_*.md` from THIS repository, because its remote `mjrgman/AI-EHR` is **PUBLIC** (confirmed by Michael 2026-08-04; every other repo in the workspace is private).

   Those trees hold internal security-review and remediation records. Michael's 2026-08-03 correction settled the patient-data question — this project is demo data and contains no PHI, consistent with the 2026-07-18 owner decision in canonical-facts. Publishing a security audit to a public repository is a separate question, and the answer was no.

   **The documents are backed up, just not published.** Commit `c07f46a` added all 32 and is preserved on the local-only branch `local-archive/eval-docs`, which is captured by the nightly offsite `git bundle` (`--all` covers every branch). Do not push that branch. If this repository is ever made private, the exclusions can be lifted and `local-archive/eval-docs` merged forward.

   Layer 1 (redaction) remains the control that actually prevents credential exposure; Layer 2 is defence in depth. Every recovered file was scanned before commit: the only two secret-shaped matches were quoted grep *patterns* inside reports concluding "No new hardcoded secrets in source code", and 5 redaction markers were present.
3. **PreToolUse hook**: `~/.claude/settings.json` routes all tool calls through `~/.claude/hooks/secret-scrubber.py`, which redacts known secret patterns before write.
4. **OpenBrain directive**: "EHR-SECRETS-CYCLE" saved as a high-priority rule — Claude auto-enforces.

**Do not re-flag** `_eval/SECRETS_FINDINGS.md` unless a guardrail regresses. If a regression occurs: inspect which layer failed, repair that layer specifically, re-verify the other three, then resume.

### Re-verification 2026-05-19

- Layer 1 (redaction rule): `skills/unified-eval-edit/SKILL.md §7` is the canonical spec. Skill present in library.
- Layer 2 (gitignore): `.gitignore` contains `_eval/`, `.env`, `.env.*`. Verified by `Grep` on this file.
- Layer 3 (PreToolUse hook): `~/.claude/hooks/secret-scrubber.py` exists and is wired in `~/.claude/settings.json` under `hooks.PreToolUse` as a python command. Verified by `Grep`.
- Layer 4 (OpenBrain directive): "EHR-SECRETS-CYCLE" directive — **unverified since 2026-06-30** in this runtime (no OpenBrain-capable session available here); refresh this file after running `get_directives()` in the next OpenBrain-capable session.

Historical context and full resolution log: See `AUDIT_ITERATION_PLAN.md` in this repo for the current iteration plan and resolution notes.

## Rules

- **`_eval/` and `_dispatch_archive/` are NOT committed to this repository**, because its remote is public. They live on the local-only branch `local-archive/eval-docs` and in the nightly offsite bundle. Never push that branch. Decided 2026-08-04; supersedes the 2026-08-03 change that committed them here.
- **Test data only** for development work. This project is demo data and contains no PHI. Synthetic, anonymized, or explicit-consent samples only.

## Related

- Skill: `ehr-programming` — EHR architecture, clinical data models, FHIR/HL7 integration patterns
- Skill: `dragon-dictation` — Dragon Medical command design and macros
- Project: Clinical/EHR connects to Project Whistle (see `Whistle\CLAUDE.md`) for billing-compliance evidence
