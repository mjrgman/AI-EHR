# CLAUDE.md — Clinical\EHR Workspace

Last updated: 2026-04-23
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

Historical context and full resolution log: [`C:\Users\micha\.claude\plans\rosy-crunching-aho.md`](C:\Users\micha\.claude\plans\rosy-crunching-aho.md)

## Rules

- **Never commit `_eval/`** — it's gitignored for a reason.
- **Never include PHI** (patient health information) in any committed file, commit message, or AI prompt. Real patient data stays in the EHR, period.
- **Test data only** for development work. Synthetic, anonymized, or explicit-consent samples only.
- **HIPAA rules apply** — minimum necessary, audit-logged, encrypted at rest and in transit.

## Related

- Skill: `ehr-programming` — EHR architecture, clinical data models, FHIR/HL7 integration patterns
- Skill: `dragon-dictation` — Dragon Medical command design and macros
- Project: Clinical/EHR connects to Project Whistle (see `Whistle\CLAUDE.md`) for billing-compliance evidence
