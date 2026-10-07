# Medication screening demo contract

The demo uses synthetic fixtures and a limited curated interaction table. A
curated finding remains visible alongside an incomplete screening warning.
A table miss cannot establish absence of interactions. The retired interaction
endpoint and its unversioned cache stay quarantined regardless of legacy flags;
terminology/forms lookups retain their separate opt-in setting.

Missing or malformed medication history remains incomplete. Record shape and
nonblank identity are validated before completed/discontinued records are
excluded under the existing policy. Only an explicitly empty comparison set
can return `not_applicable`; that describes pairwise comparisons and does not
approve a prescription or complete an overall safety assessment.

`interaction_screening_unavailable` is a distinct stored CDS warning type.
Fresh initialization and the idempotent upgrade both admit it. The upgrade
preserves the existing schema, rows, IDs, foreign keys, indexes, triggers and
AUTOINCREMENT sequence inside a transaction and restores the connection's
foreign-key setting on failure and success.

CDS evaluation returns all independent findings even when one save fails.
Each save outcome is explicit: `persistence.status` is `saved` or `failed`.
Failed items have `status: unsaved`, `approvable: false` and no saved ID. The
CDS UI displays them with disabled approval controls; polling does not erase
them merely because an accepted/rejected historical record has the same title.

The speech prescription route validates and screens the entire proposed batch
before its first write. Each draft is checked against stored active records and
other proposed records, excluding itself. Pair identity uses record positions
and source IDs, so reversed results are deduplicated while repeated medications
and distinct doses remain separate. Findings obtained independently from a
partner check are attached to both relevant drafts, including when one checker
failed. Repeated medication names retain a separate regimen-review alert.

Every generated prescription remains a fresh draft requiring review. The
response includes `review: { status: required, batchFingerprint }`. The SHA-256
fingerprint covers the assembled drafts and original history; changes require
fresh review. It is informational provenance, not a persisted approval token or
an authorization endpoint. Caller-supplied approval/status fields are ignored.

A checker rejection or malformed response becomes an explicit incomplete
state on that draft. The route continues evaluating independent drafts. On a
write failure, HTTP 500 includes `code: BATCH_PERSISTENCE_FAILED`,
`retrySafe: false`, saved `prescriptions` with their real IDs, `failedIndex`,
and `unsavedPrescriptions` with `failed`/`not_attempted` persistence outcomes and
no IDs. It also retains findings, safety and review metadata. The client
preserves this payload, refreshes saved orders and displays the partial result.
The speech POST is never automatically retried after a network failure;
unknown outcomes require inspecting existing drafts before another create.

Regression tests use the application's SQLite adapter and full migrations,
an unchanged old-schema fixture, authenticated Express HTTP requests, synthetic
label fixtures and in-memory React component rendering. The eight handoff
acceptance/control cases are ported to the actual implementation, with added
rollback, malformed-input, pair identity, partial-write, client and UI cases.
Run `npm run test:unit`, `npm test`, `npm run lint`, `npm run build` and
`npm run coverage` on the configured Node 22/24 matrix. Coverage thresholds
are unchanged. No clinical knowledge vendor or pharmacology content was added.
