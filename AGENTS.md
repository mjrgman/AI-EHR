# AGENTS.md — Clinical\EHR Workspace

Last updated: 2026-06-03
Root: `C:\Users\micha\files\A_active_projects\Clinical\EHR\`
Scope: this working directory and all subdirectories.

## No-HTML Output And Nate Sentinel Policy (2026-06-03)

- Do not create HTML reports, dashboards, rendered pages, or browser-opened proof for routine work in this project. Default closeout is concise Markdown/status plus proof artifacts.
- Existing `.html`, web-app, JSX/TSX, and browser-based project source files are source assets only; maintaining source is not permission to render or open HTML output.
- Only a current-turn Michael instruction for a visible UI, browser, or page can change this for that run, and the run must record the exact file/runtime proof.
- Nate is the local always-on LLM Sentinel and APL-style packet liaison for GSD. Nate searches GSD/Code Dispatch status surfaces and routes packets between visible lanes.
- Nate may prepare routing nudges, context packs, and packet reminders, but Nate is not a hidden frontier worker, not a paid API lane, and not proof of completion.
- Every model lane still needs file-backed evidence before pickup or completion is claimed.

## Purpose

EHR (Electronic Health Records) workspace for development, testing, and evaluation artifacts. Inherits global rules from [`~/.claude/AGENTS.md`](C:\Users\micha\.claude\AGENTS.md).

## EHR Secrets Cycle — RESOLVED 2026-04-20

Previously a recurring issue where `_eval/SECRETS_FINDINGS.md` would regenerate each cycle and re-expose credentials. Resolution locked in four layers:

1. **Redaction rule**: `C:\Users\micha\files\skills\unified-eval-edit\SKILL.md Â§7 REDACTION RULE` is the canonical spec. All eval passes must apply this before emitting any `_eval/` output.
2. **Gitignore**: `Clinical\EHR\.gitignore` contains `_eval/` â€” never commit evaluation artifacts.
3. **PreToolUse hook**: `~/.claude/settings.json` routes all tool calls through `~/.claude/hooks/secret-scrubber.py`, which redacts known secret patterns before write.
4. **OpenBrain directive**: "EHR-SECRETS-CYCLE" saved as a high-priority rule â€” Codex auto-enforces.

**Do not re-flag** `_eval/SECRETS_FINDINGS.md` unless a guardrail regresses. If a regression occurs: inspect which layer failed, repair that layer specifically, re-verify the other three, then resume.

Current iteration context is tracked in `result.md` / `progress.md`; legacy notes stay in historical PR or packet artifacts.

## Rules

- **Never commit `_eval/`** â€” it's gitignored for a reason.
- **Use synthetic-only patient data** for all development work, fixtures, and test inputs; no real patient records or identifiers.
- **Avoid committed patient identifiers** unless the file explicitly owns required clinical metadata and is marked per project policy.

## Model Handoff Guard (5.3 / 5.4 / 5.5)

- For any future "plan" request, Codex 5.3 and 5.4 should treat recommendations as a pre-review draft and route findings to 5.5 for decision before claiming final completion.
- Codex 5.3 and 5.4 must not finalize a plan unless 5.5 has explicitly returned a completion decision.
- In this branch, strict physician-review enforcement is not a default for non-5.5 contexts unless explicitly directed by 5.5.
## Related

- Skill: `ehr-programming` â€” EHR architecture, clinical data models, FHIR/HL7 integration patterns
- Skill: `dragon-dictation` â€” Dragon Medical command design and macros
- Project: Clinical/EHR connects to Project Whistle (see `Whistle\AGENTS.md`) for billing-compliance evidence

