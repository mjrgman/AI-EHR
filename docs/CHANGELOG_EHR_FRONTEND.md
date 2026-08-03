# CHANGELOG — EHR Frontend

All notable front-end UI changes are documented here.

Per the AutoBetter cycle, each entry corresponds to one controlled pass.
The latest per-pass inspection report lives at
[`./AUTOBETTER_EHR_FRONTEND_REPORT.md`](./AUTOBETTER_EHR_FRONTEND_REPORT.md).

---

## 2026-04-28 — Pass 1: demo-safety banner

### Changed

- `src/components/layout/AppShell.jsx` — added a persistent sticky sub-header banner reading *"Synthetic EHR Demo · No PHI · Not for clinical use"*, rendered on every authenticated route beneath the role-themed header.

### Why

Closes the most prominent gap identified by AutoBetter Pass 1 inspection. The
operating prompt's §Section 1 #9-#10, §Safety Requirements, and §Acceptance
Criteria #7 all require a visible *"this is not a live EHR"* warning. None
existed. The amber strip is the user-facing analog of the codebase's
fail-closed safety invariants documented in `ARCHITECTURE.md`.

### Implementation notes

- 10 lines of additive JSX + Tailwind utilities — no behavior change, no API contract change, no security touch.
- ARIA `role="status"` with `aria-live="off"` (persistent informational, not announced on every render).
- Stacking: `sticky top-14 z-40` — sits flush beneath the `h-14 sticky top-0 z-50` header. Mobile sidebar drawer (`z-50`) and its backdrop (`z-40 fixed inset-0`) still overlay correctly when opened.
- Color: amber (`bg-amber-50` / `text-amber-900` / `border-amber-200`) — caution affordance, not danger. Contrasts with the role themes (blue / purple / emerald) without competing.

### Verification

- `npx eslint src/components/layout/AppShell.jsx` — exit 0, clean.
- `npm run build` — succeeds in 2.96s, 85 modules transformed.
- New build artifacts: `dist/assets/index-BYSL5_sF.js` (400.96 kB raw, 120.81 kB gzip), CSS `index-E9dgLy2L.css` (54.10 kB raw, 9.46 kB gzip).
- Pre-existing `postcss.config.js` MODULE_TYPELESS_PACKAGE_JSON warning unaffected by this change.

### Boundary check

`src/components/layout/` is outside every path in `contributor-backlog.md`
"Maintainer Review Required" (which scopes `server/security`, `server/routes`,
`server/fhir`, `server/agents`, `src/api`, `src/context`, `src/hooks`,
`test/`).

### Files

- Edited: 1 (`src/components/layout/AppShell.jsx`)
- Created: 2 (`docs/AUTOBETTER_EHR_FRONTEND_REPORT.md`, this file)
- Archived: 0

### Recommended manual smoke check

```powershell
npm run dev
# then in browser:
#   1. Login at /login
#   2. Banner visible on / (Dashboard)
#   3. Banner persists on route change to /audit, /schedule
#   4. Banner visible on /encounter/:id
#   5. Mobile viewport (≤lg breakpoint): banner does not collide with sidebar overlay
```

### Next pass candidates (from inspection report §13)

- **Pass 2** — build `/settings` page (stub OK), covers prompt §File Safety and Settings + Acceptance Criteria #6.
- **Pass 3** — build `/file-safety` page (stub OK).
- **Pass 4** — expand left-nav (currently mobile-only, 3 items; prompt expects 13).
- **Compliance follow-up** — `test/scenarios/clinical-scenarios.json` line 3 is now explicitly synthetic wording and policy-aligned, with periodic fixture wording checks included in future pass candidates.
- **Cosmetic** — relocate `src/components/PatientVoice.jsx` into `patient/` or `encounter/` subfolder.


