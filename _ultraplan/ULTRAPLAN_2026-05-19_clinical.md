# UltraPlan - Clinical EHR

Date: 2026-05-19
Project ID: clinical
Priority: P1
Lane: clinical-ip
Canonical path: C:\Users\micha\files\Clinical\EHR
Source registry: C:\Users\micha\files\GSD\Code Dispatch\data\project_command_center.json
Classification: planning only (IP-aware v2)

## Current Role

`Clinical EHR` (clinical) - clinical-ip lane - priority P1.

Registry status text: `active private/dev repo`.

Local `CLAUDE.md` present (first 160 lines read). Synopsis: # CLAUDE.md — Clinical\EHR Workspace Last updated: 2026-04-23 Root: `C:\Users\micha\files\Clinical\EHR\` Scope: this working directory and all subdirectories. ## Purpose EHR (Electronic Health Records) workspace for development, testing, and evaluation artifacts. Inherits global rules from [`~/.claude/CLAUDE.md`](C:\Users\micha\.claude\CLAUDE.md). ## EHR Secrets Cycle — RESOLVED 2026-04-20 Previously a recurring issue where `_eval/SECRETS_FINDINGS.md` would regenerate each cycle and re-expose credentials. Resolution locked in four layers: 1. **Redaction rule**: `C:\Users\micha\files\skills\uni...

## Boundary

**In scope:**
- Read-only inventory and structural review of `C:\Users\micha\files\Clinical\EHR`.
- Generate or update planning markdown in `_ultraplan/` only.
- Cross-reference the registry row, local CLAUDE.md / AGENTS.md, and any project-local strategy notes.
- Reason internally about the project's IP / clinical-IP context, strategic options, protectable surface, and sequencing - planning artifacts may engage with the substance, not just the metadata.

**Out of scope:**
- Source code changes outside of `_ultraplan/`.
- Running servers, HTTP endpoints, or external CLIs as part of this plan.
- Sending email, deploying, publishing, or external API calls.
- Browser rendering of artifacts in this run.
- External publication, sharing, release, or third-party submission of IP / clinical-IP content (planning reasoning over the content is in scope; outward movement of it is not).

**Unsafe without Michael approval:**
- Moving, deleting, archiving, or renaming any project file.
- Exposing or echoing secrets, .env, OpenBrain credentials, or DataRoom contents in plan text or tool output.
- Treating illustrative or framework numbers as live clinical/operational data; surface assumptions explicitly when reasoning with them.
- Cross-project IP/positioning decisions that would change framing in any other workspace - run the `clinical-ai-portfolio-director` skill before committing.

## IP Context

From the project's local `CLAUDE.md` (first lines, shallow read):

> # CLAUDE.md — Clinical\EHR Workspace Last updated: 2026-04-23 Root: `C:\Users\micha\files\Clinical\EHR\` Scope: this working directory and all subdirectories. ## Purpose EHR (Electronic Health Records) workspace for development, testing, and evaluation artifacts. Inherits global rules from [`~/.claude/CLAUDE.md`](C:\Users\micha\.claude\CLAUDE.md). ## EHR Secrets Cycle — RESOLVED 2026-04-20 Previously a recurring issue where `_eval/SECRETS_FINDINGS.md` would regenerate each cycle and re-expose credentials. Resolution locked in four layers: 1. **Redaction rule**: `C:\Users\micha\files\skills\unified-eval-edit\SKILL.md §7 REDACTION RULE` is the canonical spec. All eval passes must apply this be...

- Clinical EHR workspace: active private/dev repo. CLAUDE.md governs PHI redaction rules.
- Cross-cuts with MediVault (Tier-3 module), Athena/eCW skill workflows, and the broader Agentic EHR posture; portfolio coherence enforced via `clinical-ai-portfolio-director`.

## Current Evidence Checked

- Registry row read: `C:\Users\micha\files\GSD\Code Dispatch\data\project_command_center.json`
- Project path existence: confirmed (Test-Path passed in baseline).
- Read local `CLAUDE.md` (first 160 lines).
- Read local `AGENTS.md` (first 160 lines).
- Noted local `README.md` present (not read in this pass).
- Existing `_ultraplan/` artifact count: 12
- Top-level listing (truncated at 25):
  - `DIR _eval`
  - `DIR _ultraplan`
  - `DIR data`
  - `DIR dist`
  - `DIR docs`
  - `DIR logs`
  - `DIR nginx`
  - `DIR node_modules`
  - `DIR research`
  - `DIR scripts`
  - `DIR server`
  - `DIR src`
  - `DIR test`
  - `DIR test-results`
  - `FILE 00_CLAUDE_CODE_EHR_AUTOBETTER_PROMPT.md`
  - `FILE 00_CODEX_STRESS_TEST_PROMPT_05-04-2026.md`
  - `FILE 00_OPUS_EHR_HARDEN_VERIFY_FULL_ITERATION_PLAN_2026-05-03.md`
  - `FILE _codex_audit_run.log`
  - `FILE AGENTS.md`
  - `FILE AGENTS_MA_PHYSICIAN_BUILD.md`
  - `FILE AUDIT_ITERATION_PLAN.md`
  - `FILE CLAUDE.md`
  - `FILE CODE_OF_CONDUCT.md`
  - `FILE CONTRIBUTING.md`
  - `FILE CREATIVE_PIPELINE_CONNECTOR.md`
  - `... (truncated at 25)`

Shallow read only; deeper subdirectory scan deferred to a follow-up Claude Code run.

## Work To Do

**Next safe local action:**
- Re-read project `CLAUDE.md` and confirm it still reflects current state; flag drift in a follow-up note.
- Compare this plan against the prior `_ultraplan/` artifacts (12 existing files) and note resolved vs. still-open items.

**Implementation candidates:**
- Confirm the next concrete deliverable on the active lane; capture as a tracked sub-task.
- Surface the current IP posture for this project in plain prose (what's protectable, what's published, what's gated) so a follow-up planning run inherits the context without re-reading every CLAUDE.md.
- Identify any IP / positioning decisions that conflict with adjacent projects (book vs. CATC vs. EHR vs. MediVault) and route them through `clinical-ai-portfolio-director`.

**Review-only items:**
- Consider a short `STATUS.md` at the project root for at-a-glance state (deferred until reviewed by Michael).

**Owner blockers:**
- None identified from registry signals; flag any new blocker the next read surfaces.

**Environment blockers:**
- None identified from registry signals.

## Verification Plan

- `Test-Path -LiteralPath 'C:\Users\micha\files\Clinical\EHR'` returns true.
- `Test-Path -LiteralPath 'C:\Users\micha\files\Clinical\EHR\_ultraplan\ULTRAPLAN_2026-05-19_clinical.md'` returns true after this plan is written.
- Re-run baseline registry verification before any implementation action keyed off this plan.
- Re-read local `CLAUDE.md` and confirm it still describes the project state when the next Claude Code run begins.
- Before any outward movement of IP/clinical-IP content, re-confirm with Michael in the chat (per `[[feedback_decisions_to_hcc_with_context]]`).

## Claude Code Execution Notes

- Next concrete read: open `C:\Users\micha\files\Clinical\EHR` top-level + `_ultraplan/` and the most recent prior plan in that folder.
- Treat the existing `CLAUDE.md` at this path as the authoritative briefing; do not overwrite without a confirmation read.
- Honor the handoff packet's scope-out (no servers, no API, no email/deploy, no destructive ops).
- IP reasoning is in scope inside this plan; IP movement (external publishing, sharing, licensing) is NOT.
- Stop condition: pause and surface to Michael if any read reveals registry-vs-reality drift, or if any action would move IP/clinical-IP material outward from `C:\Users\micha\files\Clinical\EHR`.

## Status

review-only
