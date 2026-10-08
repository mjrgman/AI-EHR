# Patient Journey Evaluation — Entry to Exit

**Date:** 2026-10-08  
**Branch:** `agent/patient-journey-eval-ui-2026-10-08`  
**Baseline:** `main@0bf7573d2bd29fcba6b3abec65e1d1d8edf88a0f`  
**Scope:** Synthetic demo workflow and clinician-facing frontend from appointment/visit entry through terminal visit summary.

## Evaluation path

The evaluated patient journey is:

1. Schedule or start a new visit
2. Check-in
3. MA rooming and intake
4. Provider encounter
5. Documentation / Review & Sign
6. Check-out / billing / follow-up
7. Completed read-only visit summary

The evaluation traced route definitions, workflow state transitions, queue resume behavior, screen-to-screen navigation, and the existing UI verification screenshots.

## High-impact findings

### 1. Signed encounters bypassed checkout — fixed

The shared state router treated `signed` as terminal and routed directly to `/visit/:id`. `ReviewPage` also navigated directly to the visit summary immediately after signing.

That skipped the actual checkout screen where this application performs billing finalization, follow-up capture, patient instructions, and the `signed -> checked-out` transition.

**Fix:** `signed -> /checkout/:id`; only `checked-out -> /visit/:id`. Review & Sign now hands off to Check-Out.

### 2. Provider handoff reopened in the MA screen — fixed

After the MA records vitals, the workflow is at `vitals-recorded` and the MA navigates to the provider encounter. However, the shared resume router mapped `vitals-recorded` back to `/ma/:id`.

A provider opening that encounter from the queue could therefore land in the wrong workspace.

**Fix:** `vitals-recorded -> /encounter/:id`. The provider workspace already exposes the explicit **Start Exam** action that advances to `provider-examining`.

### 3. Schedule status vocabulary did not match persisted state — fixed

The appointment schema and check-in handler use `checked-in`, while the Schedule UI expected an unsupported `arrived` status for its reopen action.

**Fix:** Schedule now renders `checked-in` as **Checked In** and exposes **Open Encounter** for a checked-in appointment with an encounter id.

### 4. Review signing used a brittle linear state chain — fixed

The workflow permits `provider-examining -> documentation` directly or `provider-examining -> orders-pending -> documentation`. The previous sign code modeled one linear chain and could begin from an invalid index when the current state was `orders-pending`.

**Fix:** Review & Sign now selects a legal path to `signed` for each supported current workflow state.

## Frontend enhancements

- Added a clear **View Completed Visit** primary action after successful checkout.
- Preserved the patient banner on the checkout-complete screen.
- Added the patient banner to the read-only Visit Summary for continuity across the full encounter.
- Visit Summary now distinguishes **Completed** from merely **Signed**.
- Aligned schedule status text and actions with the canonical workflow vocabulary.
- Preserved existing WorkflowTracker, patient safety banner, global patient search, and responsive shell rather than duplicating navigation patterns.

## Regression coverage added

`test/unit/patient-journey-routing.test.js` asserts:

- checked-in appointments can be reopened from Schedule;
- `vitals-recorded` resumes in the provider encounter;
- `signed` routes to checkout;
- `checked-out` routes to the read-only visit summary;
- Review & Sign does not bypass checkout;
- the `orders-pending` sign path is supported;
- checkout exposes the terminal visit summary;
- completed visits retain patient context and completion status.

## Entry-to-exit result

| Stage | Route / state | Result after changes |
|---|---|---|
| Appointment / new visit | Schedule or Dashboard -> encounter | Coherent |
| Check-in | `scheduled -> checked-in` | Coherent |
| MA intake | `checked-in -> roomed -> vitals-recorded` | Coherent |
| Provider handoff | `vitals-recorded -> /encounter/:id` | Fixed |
| Provider exam | `provider-examining` | Coherent |
| Documentation | `documentation` or via `orders-pending` | Hardened |
| Sign | `documentation -> signed` | Coherent |
| Checkout | `signed -> checked-out` | Restored |
| Terminal view | `checked-out -> /visit/:id` | Coherent |

## Verification status

Static source and route/state evaluation is complete. The existing checked-in UI reference set was inspected for Dashboard, Check-In, MA, Encounter, Review, Check-Out, Patient, and Schedule.

A local repository checkout could not be established in the current execution environment because outbound DNS access to GitHub was unavailable, so `npm run test:unit`, `npm run build`, and `npm run lint` have **not** been claimed as run here. The branch includes regression tests intended for CI/local execution before merge.

## Recommended next frontend pass

The next highest-value UI pass should be workflow-density rather than a visual rebrand:

1. keep the patient identity / allergy context sticky throughout every encounter stage;
2. add a compact “Next required action” treatment beside WorkflowTracker;
3. make queue cards expose both current state and the next role/action;
4. add browser-level E2E coverage for the synthetic path: Schedule -> Check-In -> MA -> Encounter -> Review -> Check-Out -> Visit Summary;
5. verify responsive behavior at desktop, tablet, and mobile widths.

The existing navy/gold design system is internally consistent; the larger opportunity is reducing ambiguity at handoffs rather than replacing the visual language.
