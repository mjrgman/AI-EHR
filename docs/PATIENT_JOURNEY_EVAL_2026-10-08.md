# Patient Journey Evaluation — Entry to Exit

**Date:** 2026-10-08  
**Branch:** `agent/patient-journey-eval-ui-2026-10-08`  
**Baseline:** `main@0bf7573d2bd29fcba6b3abec65e1d1d8edf88a0f`  
**Scope:** Synthetic demo workflow and clinician-facing frontend from appointment/visit entry through terminal visit summary.

## Evaluated path

1. Schedule or start a visit
2. Check-in
3. MA rooming / medication-allergy review / vitals
4. Provider encounter
5. Orders / documentation / decision close-out
6. Review & Sign
7. Checkout / billing / follow-up plan
8. Completed read-only visit summary

## High-impact defects fixed

### Workflow and state integrity

- `vitals-recorded` now resumes in the provider encounter rather than reopening the MA screen.
- `signed` now routes to checkout; only terminal `checked-out` / completed encounters route to the visit summary.
- Appointment UI and persistence use the same `checked-in` vocabulary.
- Appointment check-in status is committed in the same transaction as the workflow transition.
- A schedule row reuses an existing linked encounter instead of creating duplicates when check-in is reopened.
- Scheduled provider identity is carried into encounter creation and workflow assignment.
- Patient encounter history now includes the current workflow state so resume routing is stage-correct.
- MA users opening `orders-pending` work are routed to the Decisions close-out queue.
- MA decision close-out can legally hand `orders-pending -> documentation`.
- Signing is blocked while a decided queue item is still awaiting MA close-out.

### Encounter persistence and timestamps

- Check-in edits to chief complaint and encounter type are now persisted.
- Workflow assignments and timestamps are no longer silently dropped by the database update allowlist.
- Review and Encounter screens consume the canonical workflow timeline shape, restoring check-in/exam timestamps and the provider timer after reload.
- Existing databases receive idempotent migrations for `signed_by`, `signed_at`, `follow_up_date`, and `billing_notes`.

### Signing and checkout

- Signing moved to a server-authoritative, transactional endpoint.
- Signature provenance and the workflow transition to `signed` commit or roll back together.
- Generic encounter PATCH can no longer manufacture signed/completed states.
- Signing is classified as a durable `SIGN` audit action.
- Checkout requires an existing `signed` workflow state.
- Charge finalization, `signed -> checked-out`, encounter completion, follow-up persistence, and linked appointment completion are one transactional operation.
- Physician assistants are recognized consistently as provider-role users.
- Front desk can perform checkout with a read-only coding preview but cannot alter E/M coding or capture a draft charge.

## Frontend improvements

- Queue cards now show **Next required action** and the responsible role.
- Completed checkout exposes a clear **View Completed Visit** action.
- Patient identity remains visible on checkout completion and Visit Summary.
- Visit Summary now loads encounter-specific vitals, orders, CDS decisions, charge information, signature metadata, workflow status, and follow-up due date from their actual data sources.
- Visit Summary uses canonical vital and billing field names.
- Follow-up text says **recommended/due**, not “scheduled,” unless an appointment actually exists.
- Prescription instructions distinguish signed orders from prescriptions whose pharmacy transmission is actually confirmed.
- Schedule cancellation preserves the appointment as `cancelled` rather than deleting history.
- Patient Check-In explicitly loads the prior encounter instead of relying on a nonexistent embedded encounter list.
- New encounters from the patient chart use the authenticated provider rather than a hard-coded provider name.

## Regression coverage

`test/unit/patient-journey-routing.test.js` now guards the major routing, persistence, authorization, sign, close-out, checkout, audit, and terminal-visit contracts. The full integration suite was also updated where older tests encoded superseded behavior, including direct checkout without a signed workflow and front-desk denial of the read-only checkout preview.

## Dependency remediation

All non-breaking `npm audit fix` changes were applied and verified with install, lint, build, and unit tests. The remaining 8 advisories (6 high, 2 moderate) are confined to the development/builder tree rooted in Tailwind CSS 3.x / nodemon and require a breaking Tailwind 4 migration for automatic remediation.

The production Docker stage installs with `--omit=dev`. CI therefore keeps the production dependency tree as a blocking moderate-severity audit gate and reports the development-tree exception separately. The dated exception and exit criterion are recorded in `docs/SYNTHETIC_ONLY_BASELINE.md`.

## Entry-to-exit result

| Stage | Canonical handoff | Result |
|---|---|---|
| Appointment | scheduled/confirmed | Preserved and linked to encounter |
| Check-in | `scheduled -> checked-in` | Transactionally synchronized |
| MA intake | `checked-in -> roomed -> vitals-recorded` | Coherent |
| Provider | `vitals-recorded -> provider-examining` | Correct workspace and timestamps |
| Decisions/orders | `provider-examining -> orders-pending -> documentation` | MA close-out protected |
| Documentation | `provider-examining -> documentation` | Supported |
| Sign | `documentation -> signed` | Server-authoritative + provenance |
| Checkout | `signed -> checked-out` | Transactional |
| Appointment closure | linked appointment -> `completed` | Synchronized at checkout |
| Terminal view | `checked-out/completed -> /visit/:id` | Read-only completed summary |

## Verification

GitHub CI is the executable verification gate for this branch. During remediation, lint, production build, unit tests, full integration tests, coverage, CodeQL, Docker build, dependency review, private-artifact guard, and the synthetic-only boundary have been exercised repeatedly. The final PR merge decision must use the latest head's CI result, not an earlier intermediate run.

## Remaining follow-up

1. Add browser-level E2E coverage for Schedule → Check-In → MA → Encounter → Decisions (when applicable) → Review → Checkout → Visit Summary.
2. Add automated accessibility coverage (axe, keyboard navigation, focus management).
3. Plan the Tailwind 4 / builder-toolchain migration as a separate visually verified change.
4. Consider moving durable audit intent behind authenticated identity resolution so the pre-handler audit row always carries authenticated clinician identity, while retaining fail-closed semantics.

The existing navy/gold visual system remains coherent. The highest-value changes in this pass were state integrity, handoff clarity, and elimination of misleading completion states rather than a cosmetic rebrand.
