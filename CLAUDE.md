# CLAUDE.md — Clinical\EHR Workspace

Last updated: 2026-05-19 (currency check; four-layer guardrails re-verified)
Root: `C:\Users\micha\files\Clinical\EHR\`
Scope: this working directory and all subdirectories.

## Purpose

EHR (Electronic Health Records) workspace for development, testing, and evaluation artifacts. Inherits global rules from [`~/.claude/CLAUDE.md`](C:\Users\micha\.claude\CLAUDE.md).

## EHR Secrets Cycle — RESOLVED 2026-04-20

Previously a recurring issue where `_eval/SECRETS_FINDINGS.md` would regenerate each cycle and re-expose credentials. Resolution locked in four layers:

1. **Redaction rule**: `C:\Users\micha\files\skills\unified-eval-edit\SKILL.md §7 REDACTION RULE` is the canonical spec. All eval passes must apply this before emitting any `_eval/` output.
2. **Gitignore**: `Clinical\EHR\.gitignore` contains `_eval/` — never commit evaluation artifacts.
3. **PreToolUse hook**: `~/.claude/settings.json` routes all tool calls through `~/.claude/hooks/secret-scrubber.py`, which redacts known secret patterns before write.
4. **OpenBrain directive**: "EHR-SECRETS-CYCLE" saved as a high-priority rule — Claude auto-enforces.

**Do not re-flag** `_eval/SECRETS_FINDINGS.md` unless a guardrail regresses. If a regression occurs: inspect which layer failed, repair that layer specifically, re-verify the other three, then resume.

### Re-verification 2026-05-19

- Layer 1 (redaction rule): `skills/unified-eval-edit/SKILL.md §7` is the canonical spec. Skill present in library.
- Layer 2 (gitignore): `.gitignore` contains `_eval/`, `.env`, `.env.*`. Verified by `Grep` on this file.
- Layer 3 (PreToolUse hook): `~/.claude/hooks/secret-scrubber.py` exists and is wired in `~/.claude/settings.json` under `hooks.PreToolUse` as a python command. Verified by `Grep`.
- Layer 4 (OpenBrain directive): "EHR-SECRETS-CYCLE" directive — re-verify on next `get_directives()` call from a session with the openbrain-memory MCP loaded; this currency check did not re-query OpenBrain.

Historical context and full resolution log: [`C:\Users\micha\.claude\plans\rosy-crunching-aho.md`](C:\Users\micha\.claude\plans\rosy-crunching-aho.md)

## Rules

- **Never commit `_eval/`** — it's gitignored for a reason.
- **Test data only** for development work. Synthetic, anonymized, or explicit-consent samples only.

## Related

- Skill: `ehr-programming` — EHR architecture, clinical data models, FHIR/HL7 integration patterns
- Skill: `dragon-dictation` — Dragon Medical command design and macros
- Project: Clinical/EHR connects to Project Whistle (see `Whistle\CLAUDE.md`) for billing-compliance evidence
