# AutoBetter EHR Frontend Report — Pass 1

**Date**: 2026-04-28
**Pass**: 1 (inspection only — no patches applied)
**Project root**: `C:\Users\micha\files\Clinical\EHR`
**Operating prompt**: `00_CLAUDE_CODE_EHR_AUTOBETTER_PROMPT.md`
**Pass-1 status:** **Pass-1 COMPLETE (2026-04-28)** — confirmed in [`CHANGELOG_EHR_FRONTEND.md`](./CHANGELOG_EHR_FRONTEND.md).

---

## Headline finding

This is **not a placeholder demo**. It is `mjr-ehr-interactive` v1.0.0 — the
14-module agentic EHR documented in [`ARCHITECTURE.md`](./ARCHITECTURE.md):
**76 server files, 51 frontend files, 308+ test scenarios** (per the current test baseline),
mock-mode safety defaults across AI / LabCorp / scheduler, fail-closed
guardrails wired through `BaseAgent` and the orchestrator's `dependsOn`
graph.

The AutoBetter prompt's framing of "convert placeholder screens" does not
match reality. Pass-1 does not rewrite — it identifies the smallest
prompt-aligned safety improvement and stops for approval.

**Recommended pass-1 patch**: add the prompt-mandated *"Synthetic EHR Demo
· No PHI · Not for clinical use"* banner to `src/components/layout/AppShell.jsx`.
One file, ~10–15 lines, safe surface (front-end layout — outside the
maintainer-review boundaries declared in `contributor-backlog.md`).

---

## 1. Project root path

`C:\Users\micha\files\Clinical\EHR\`

## 2. Detected technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (per ARCHITECTURE.md, tested on 18 / 20 / 22) |
| Backend | Express 4 (`server/server.js`) |
| Frontend | React 18 + Vite 6 |
| Styling | Tailwind CSS + PostCSS + autoprefixer |
| Routing | react-router-dom v7 (BrowserRouter, lazy-loaded routes) |
| Auth | bcryptjs + jsonwebtoken (JWT + refresh tokens) |
| Security mw | helmet + cors + custom HIPAA middleware + RBAC |
| Database | SQLite3 (WAL); PostgreSQL adapter present, dormant |
| AI | `@anthropic-ai/sdk` ^0.39.0; default `AI_MODE=mock` (no API calls) |
| Lab integration | LabCorp OAuth2 (default `LABCORP_MODE=mock`) |
| Tests | Node `--test` (unit) + custom scenario harness (E2E) |
| Build | Vite (`dist/` exists; chunks align with `src/pages/`) |

Authoritative sources: `package.json`, `vite.config.js`, `.env.example`, [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 3. Main entry files

| Layer | Entry |
|---|---|
| Server | `server/server.js` (`npm start`) |
| Client (dev) | `index.html` → `src/main.jsx` → `src/App.jsx` |
| Build | `npm run build` → `dist/` |
| Dev orchestration | `npm run dev` (concurrently server + client) |
| Setup | `scripts/setup.js` |
| User creation | `scripts/create-user.js` |

## 4. Current front-end files (51)

- `src/App.jsx` — router shell + ErrorBoundary + provider stack (Auth → Toast → Encounter)
- `src/main.jsx` — React root; BrowserRouter wrapper
- `src/index.css` — Tailwind entry
- `src/pages/` — 11 lazy-loaded pages (Dashboard, Schedule, Audit, CheckIn, MA, Encounter, Review, CheckOut, Patient, Login, PatientPortal)
- `src/components/`
  - `auth/ProtectedRoute.jsx`
  - `layout/AppShell.jsx` — header + role badge + queue counts + mobile sidebar
  - `common/` — TouchButton, Card, Badge, LoadingSpinner, EmptyState, Toast, Modal (7)
  - `patient/` — PatientBanner, AllergyBadges, LabResults, MedList, ProblemList, VitalsDisplay (6)
  - `encounter/` — CDSSuggestionCard, CDSSuggestionList, HRTRegimenCard, PeptideCalculator, HRTPanel (5)
  - `workflow/` — WorkflowTracker, QueueDashboard (2)
  - `agents/` — AgentPanel, PreVisitPanel (2)
  - `PatientVoice.jsx` (top-level — see §9 issue 2)
- `src/hooks/` — useEncounter, useWorkflow, useCDS, usePatient, useSpeechRecognition, useHRTKeywords, usePatientVoice (7)
- `src/context/` — AuthContext, EncounterContext (2)
- `src/api/` — client.js, medivault.js (2)
- `src/utils/` — peptide-math.mjs, hrt-keywords.mjs (native ESM)

## 5. Current backend files (76)

Authoritative module map: [`ARCHITECTURE.md`](./ARCHITECTURE.md). Top-level layout:

- `server/agents/` — 14 agents + `base-agent.js` + `index.js` + `module-registry.js` + `message-bus.js` + `agent-memory.js`
- `server/medivault/agents/` — 5 specialized agents + `index.js`
- `server/fhir/` — mappers (8) + inbound (3) + smart auth (3) + utils (3) + capability-statement + router
- `server/domain/` — knowledge-base, functional-med-engine, rules (HRT / peptide / functional-med)
- `server/security/` — auth, hipaa-middleware, phi-encryption, rbac, refresh-tokens
- `server/integrations/` — cds-hooks, event-bus, labcorp/, patient-voice
- `server/pharma/` — rxnorm-service, drug-safety-service, dosing-service
- `server/repositories/` — scheduling, patient-portal
- `server/routes/` — auth, labcorp, medivault, patient-portal
- `server/services/` — portal-session-service
- Top-level engines: `server.js`, `database.js`, `database-migrations.js`, `ai-client.js`, `audit-logger.js`, `billing-engine.js`, `cds-engine.js`, `provider-learning.js`, `workflow-engine.js`

## 6. Mock and demo data

- `test/scenarios/clinical-scenarios.json` — clinical scenario fixtures (see §9 issue 6)
- `test/scenarios/stress-test-scenarios.json`
- `test/scenarios/functional-med-scenarios.json`
- `test/scenarios/labcorp-scenarios.json`
- `test/scenarios/results/` — 11 historical run JSON files (2026-02 → 2026-04)
- `server/integrations/labcorp/mock-responses/` (per ARCHITECTURE) — LabCorp PDF/XML fixtures
- `.env.example` defaults: `AI_MODE=mock`, `LABCORP_MODE=mock`, `SCHEDULER_MODE=mock`

No frontend-side `data/` folder. Pages fetch via `src/api/client.js` against the Express backend.

## 7. Current routing

Authenticated (wrapped by `ProtectedRoute` + `AppShell`):

| Path | Page |
|---|---|
| `/` | DashboardPage |
| `/patient/:patientId` | PatientPage |
| `/checkin/:encounterId` | CheckInPage |
| `/ma/:encounterId` | MAPage |
| `/encounter/:encounterId` | EncounterPage |
| `/review/:encounterId` | ReviewPage |
| `/checkout/:encounterId` | CheckOutPage |
| `/audit` | AuditPage |
| `/schedule` | SchedulePage |

Public:

- `/login` — LoginPage
- `/portal` — PatientPortal

**Missing per AutoBetter prompt** (§Left Navigation, §Acceptance Criteria #6): `/settings`, `/file-safety`. Neither route nor page exists. See §13 for proposed pass-2/pass-3 work.

## 8. Styling

Tailwind CSS via `tailwind.config.js` + PostCSS + autoprefixer; entry `src/index.css`. Pattern observed in `AppShell.jsx`: utility-first, role-themed (blue/purple/emerald per `ROLE_COLORS`), responsive (`hidden md:flex`, `lg:hidden`), mobile-first sidebar drawer with focus-trap overlay, sticky top header (`sticky top-0 z-50`).

## 9. Known broken or incomplete areas

| # | Issue | Severity | Boundary |
|---|---|---|---|
| 1 | **AppShell.jsx has no demo-safety banner.** Header shows "MJR-EHR / Intelligent Clinical Agent" with no "Synthetic / No PHI / Not for clinical use" warning anywhere visible. Prompt §Section 1, §Safety Requirements, §Acceptance Criteria #7 require this. | High | Safe (front-end layout) |
| 2 | `PatientVoice.jsx` lives at `src/components/PatientVoice.jsx` (top of components tree) — orphan from the otherwise-organized `common/` / `patient/` / `encounter/` / `workflow/` / `agents/` taxonomy. Suggests an unfinished move. | Low | Safe |
| 3 | Sidebar nav (mobile-only via `lg:hidden`) has only 3 items: Dashboard, Schedule, Audit Log. Prompt §Left Navigation lists 13 expected. **Desktop has no visible nav at all** above the `lg` breakpoint. | Medium | Safe (UI) |
| 4 | No `/settings` route, no Settings page. Prompt-required. | Medium | Front-end safe; small backend wiring may follow |
| 5 | No `/file-safety` route, no File Safety page. Prompt-required. | Medium | Mostly front-end safe |
| 6 | `clinical-scenarios.json` line 3 self-describes as *"Synthetic clinical presentations for end-to-end testing."* The data shape (478-555-XXXX phone using fictional 555 exchange, `@email.com` placeholder domain, generic insurance IDs like `BCBS-7742901`) is synthetic and aligned with demo requirements. | Compliance cleared | No action required |
| 7 | `dist/` build artifacts exist with chunk names aligned to `src/pages/`, but freshness vs. current `src/` cannot be verified without rebuild. | Low | Resolve via `npm run build` after first patch |

## 10. Duplicates or stale files

None found. The src/ taxonomy is clean. Single canonical entries for each concern. `dist/` is build output (not duplicate code). No `_archive/` needed in pass-1.

## 11. Files that should not be touched in pass-1

Per [`contributor-backlog.md`](./contributor-backlog.md) "Maintainer Review Required":

- `server/security/**`
- `server/routes/**`
- `server/fhir/**`
- `server/agents/**`
- `src/api/**`
- `src/context/**`
- `src/hooks/**`
- `test/**`

Plus per global rules and `Clinical\EHR\CLAUDE.md`:

- `.env` — real credentials; secret-scrubber hook applies anyway. Not read.
- `_eval/` — gitignored, redaction-protected. Does not appear to exist; `docs/evals/` is a different, committed folder.
- `node_modules/`, `dist/`, `.git/`
- `docs/BOOK_SSOT_V14_8.md` — book SSOT, EVAL-SENSITIVE per global CLAUDE.md.

## 12. Recommended canonical files

All current canonical files are appropriate. No re-canonicalization needed.

## 13. Proposed first patch set

**Pass-1 patch (recommended for approval and immediate execution)**

> **Add a persistent demo-safety banner sub-header to `src/components/layout/AppShell.jsx`**, displaying *"Synthetic EHR Demo · No PHI · Not for clinical use"* below the main header bar, visible on every authenticated route. Style: amber/yellow strip, ~24-28px tall, contrasts with the role-colored header above it. ARIA: `role="status" aria-live="off"` (persistent informational, not announced).

- **Files edited**: `src/components/layout/AppShell.jsx` only
- **Files created**: none
- **Files archived**: none
- **Surface area**: ~10-15 lines of JSX + Tailwind classes
- **Risk**: very low — additive, no behavior change, no API contract change, no security/auth touch
- **Boundary check**: `src/components/layout/` is NOT in the maintainer-review list
- **Verifies prompt sections**: §Section 1 #9 ("No-PHI warning"), §Section 1 #10 ("Clear visual distinction this is not a live EHR"), §Safety Requirements visible-warning mandate, §Acceptance Criteria #7
- **Smoke test**: `npm run dev` → load `/`, `/audit`, `/schedule`, any `/encounter/:id` page → verify banner persists across route changes

**Deferred to later passes**

- *Pass 2*: Build `/settings` page (stub OK) — covers prompt §File Safety and Settings + Acceptance Criteria #6.
- *Pass 3*: Build `/file-safety` page (stub OK) — same prompt section.
- *Pass 4*: Expand left navigation to additional prompt-listed items as the corresponding routes/pages mature. Many items (Messages, Tasks, Orders, Results, Medications, Documents, Billing Preview, Quality Gaps) exist conceptually in the agent layer but have no front-end view yet — each is its own controlled pass.
- *Pass N*: Move `src/components/PatientVoice.jsx` into the appropriate subfolder (`patient/` or `encounter/`) — cosmetic, non-urgent.
*Compliance follow-up*: periodic fixture reviews continue, and `clinical-scenarios.json` is now explicitly marked as synthetic data.

## 14. Tests / smoke checks available

- `npm test` — runs `node test/run-tests.js` (custom scenario harness)
- `npm run test:unit` — Node `--test` over `test/unit/*.test.js` (6 files: audit-logger, dosing-approval, front-desk-agent, phi-encryption, rbac, scheduling-repository)
- `npm run lint` — ESLint over `server` + `src` (.js/.jsx/.mjs)
- `npm run build` — Vite production build
- **Smoke check protocol (manual, post-patch)**:
  1. App loads (`npm run dev`) without console-breaking errors
  2. Banner visible on `/` after login
  3. Banner persists on route change to `/audit`, `/schedule`
  4. Banner visible on encounter page (`/encounter/:id`)
  5. Mobile viewport: banner does not collide with mobile sidebar overlay
  6. Build still succeeds (`npm run build`)
  7. Lint clean (`npm run lint -- src/components/layout/AppShell.jsx`)

## 15. Immediate blockers

**None blocking pass-1 execution.**

Soft flags requiring acknowledgement before pass-1 patch:

- (a) Clinical scenarios wording per §9 issue 6 � resolved (synthetic wording confirmed in `test/scenarios/clinical-scenarios.json`) and non-blocking for AppShell patch.
- (b) Confirmation that frontend-layout edits are within scope (they are, per `contributor-backlog.md` — confirming explicitly).

---

## Pause for approval

Per the AutoBetter prompt's "controlled pass" discipline (Part 2 §Cycle steps 7–8), I am stopping here. The next action requires explicit approval:

> **Approve pass-1 patch?** (Add demo-safety banner to `src/components/layout/AppShell.jsx`, then `npm run build`, smoke-check, document in `docs/CHANGELOG_EHR_FRONTEND.md`, and stop.)

Reply **`approve`** to proceed, **`change <X>`** to redirect, or **`hold`** to pause.



