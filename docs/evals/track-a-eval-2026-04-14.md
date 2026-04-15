# Track A Eval Report

Date: 2026-04-14

## Scope

- Track A hardening: clinician auth, patient portal session boundaries, portal persistence fixes.
- Contributor-readiness baseline: governance docs, CODEOWNERS, balanced CI gating.
- Targeted Track B and Track C slices landed in support of Track A:
  - exportable server startup
  - route-level lazy loading
  - patient symptom triage portal flow

## Verification

- `npm test`: passed, 266/266.
- `npm run build`: passed.
- Added HTTP regression coverage for:
  - login, me, logout, refresh rotation, logout-all
  - patient portal verify/session/messages/triage/voice intent
  - clinician/portal boundary isolation

## Risk x Effort Matrix

| ID | Finding | Bucket | Owner | Due Window | Status | Retest |
|---|---|---|---|---|---|---|
| A-01 | Clinician auth endpoints were not mounted and refresh was blocked behind global `/api` auth. | R1E1 | Maintainer | Closed in this pass | Closed | Verified in HTTP tests |
| A-02 | Frontend auth was still demo-only with fake role switching and no refresh-aware session bootstrap. | R1E1 | Maintainer | Closed in this pass | Closed | Verified by build + auth HTTP tests |
| A-03 | Patient portal trusted client-supplied identity and was mounted behind clinician auth instead of a portal session. | R1E1 | Maintainer | Closed in this pass | Closed | Verified in session boundary tests |
| A-04 | Portal verification/persistence was broken by field mismatches, appointment schema mismatches, and missing `patient_messages`. | R1E1 | Maintainer | Closed in this pass | Closed | Verified in portal HTTP tests |
| A-05 | `server/server.js` auto-started on `require()`, making route-level HTTP regression tests brittle. | R2E1 | Maintainer | Closed in this pass | Closed | Verified in test harness |
| A-06 | `server/database.js` still mixes schema, migrations, and repository responsibilities in one oversized module. | R2E2 | Maintainer | Track B | Open | Not yet re-tested after extraction |
| A-07 | `src/pages/EncounterPage.jsx` remains oversized and should be split into bounded feature slices. | R2E2 | Maintainer | Track B | Open | Not started |
| A-08 | Frontend auth and portal UX flows now work, but component-level browser tests are still missing. | R2E1 | Maintainer | Next maintenance PR | Open | Not yet added |
| A-09 | Contributor labeling and issue seeding exist as docs, but there is no automated label sync or project board bootstrap. | R2E1 | Maintainer | Next maintenance PR | Open | Not applicable |

## Closure Policy Check

- All `R1E1` findings identified for Track A are closed.
- No unresolved `R1E2` findings block Track A sign-off in this pass.
- Open `R2E1` and `R2E2` items are documented above and should move into Track B / maintenance work.

## Next Fix Tiers

1. Track B:
   Extract database repositories from `server/database.js` and split `EncounterPage.jsx` into documentation, orders, CDS, and autosave slices.
2. Track B:
   Add frontend integration coverage around `/login`, protected-route redirects, and `/portal` session bootstrap.
3. Track C:
   Expand the portal symptom-triage slice with acknowledgement timelines, routing status, and safe follow-up instructions.
