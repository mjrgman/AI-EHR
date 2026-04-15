# Contributor Backlog

These are intentionally scoped for first-time contributors and should avoid high-risk clinical decision paths unless explicitly approved by a maintainer.

## Good First Issues

- Add field-level empty states and loading skeletons for low-risk dashboard widgets.
- Improve `LoginPage.jsx` form validation and accessibility messaging.
- Add snapshot-style tests for `src/components/common/` presentation components.
- Expand `SUPPORT.md` with platform-specific setup notes for Windows and macOS.
- Add safe sorting and filtering controls to the patient portal messages view.
- Tighten copy and layout consistency in `/portal` without changing API contracts.

## Help Wanted

- Add targeted frontend tests for clinician login bootstrap and redirect handling.
- Add route-level code splitting coverage checks to CI.
- Extract shared patient portal cards into reusable presentational components.
- Improve mock data fixtures for appointment and portal messaging scenarios.

## Maintainer Review Required

- Any change under `server/security`, `server/routes`, `server/fhir`, `server/agents`, `src/api`, `src/context`, `src/hooks`, or `test/`.
