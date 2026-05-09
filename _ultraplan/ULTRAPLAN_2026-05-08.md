# UltraPlan - Clinical EHR

**Date:** 2026-05-08
**Project path:** `C:\Users\micha\files\Clinical\EHR`
**UltraPlan path:** `C:\Users\micha\files\Clinical\EHR\_ultraplan\ULTRAPLAN_2026-05-08.md`
**Kind:** registry-active-project
**Status:** active private/dev repo

## Current State

- Registry row: `clinical` / Clinical EHR / lane `clinical-ip` / priority `P1`.
- Current next action: QA/review fork should reconcile open fixes, run tests, and keep MediVault/FHIR boundaries visible.
- Finish criteria: Assessment or patch packet names repo root, tests, dirty tree state, and patient-safety boundaries.

## Open Fixes From UltrareView

- [ ] UR-017: dirty or drifted worktree needs project-specific QA before any done/live claim.

## Next Safe Iteration

1. Load this UltraPlan and the project-local authority file if present.
2. Verify the path and current status before claiming work is active or complete.
3. Take the first unchecked item above that does not require owner approval, counsel, external account access, deploy, send, cleanup, archive, move, or deletion.
4. Save proof in this project folder, not in Code Dispatch, unless the artifact is a short dispatch summary.

## Blockers Needing Michael

- Any move, quarantine, archive, dedupe, delete, external send, external deploy, account login, counsel/IP action, or public-sharing step.

## Verification Commands

```powershell
Test-Path -LiteralPath 'C:\Users\micha\files\Clinical\EHR'
```
```powershell
Test-Path -LiteralPath 'C:\Users\micha\files\Clinical\EHR\_ultraplan\ULTRAPLAN_2026-05-08.md'
```
```powershell
git -c safe.directory=C:/Users/micha/files/Clinical/EHR -C 'C:\Users\micha\files\Clinical\EHR' status --short --branch
```

## Local Proof Paths

- This UltraPlan: `C:\Users\micha\files\Clinical\EHR\_ultraplan\ULTRAPLAN_2026-05-08.md`
- All-project UltrareView: `C:\Users\micha\files\GSD\Code Dispatch\out\UltrareView_All_Projects_2026-05-08.md`

## Do Not Boundaries

- PHI-capable clinical code; private/dev only
- Do not use Code Dispatch as a storage shelf for this project's artifacts.
- Do not start old HTTP Dispatch Desk, hidden Claude/Opus CLI, paid API jobs, sends, deploys, or cleanup actions without explicit approval.

## Rollout Status

- Created or refreshed by the Code Dispatch UltraPlan rollout on 2026-05-08.
- This file is an iteration plan, not proof that fixes have been applied.
