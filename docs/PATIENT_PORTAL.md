# Patient Portal

**Status:** Phase 3 (landed across `safety: harden auth and patient portal boundaries` and follow-on commits)
**Authoritative code:** `server/routes/patient-portal.js`, `server/services/portal-session-service.js`, `server/repositories/patient-portal-repository.js`, `server/integrations/patient-voice.js`, `src/pages/PatientPortal.jsx`, `src/components/PatientVoice.jsx` + `src/hooks/usePatientVoice.js`
**Related modules in registry:** `patient_app` (Tier 1) and `patient_link` (Tier 2) — see `MODULE_CATALOG.md`

---

## Why this doc exists

The patient portal landed across multiple commits with a hardened access boundary. Architectural details are spread across three server files and two frontend pages. This doc collapses them into one read for a developer touching portal code or a reviewer wanting the threat model.

---

## Architecture: dual-repository pattern

The portal is built on **two repositories**, not a single provider abstraction:

1. **`patient-portal-repository.js`** — portal-owned reads. Returns the portal-shaped patient session profile, upcoming appointments (filters out cancelled/no-show), active medications (with last refill request joined from `patient_messages`), lab results (raw rows passed through `buildLabExplanation()` in the route handler for plain-language wrapping), portal messages, and the `createMessage()` write used for refill requests, secure messages, and symptom-triage submissions.

2. **`scheduling-repository.js`** (via `FrontDeskAgent`) — cross-cutting appointment writes. Patient-initiated booking goes through the same `FrontDeskAgent.process()` that the clinician-side schedule uses, so the booking semantics (status='scheduled', front-desk confirms via clinician UI) are identical regardless of who initiated. The portal route instantiates a fresh `FrontDeskAgent` per request because in `SCHEDULER_MODE=db` all state lives in the appointments table.

This split keeps portal-specific data shapes (plain-language labs, joined refill state, session-shaped patient profile) inside the portal repository, while reusing the EHR's authoritative scheduling layer for writes that have to compose with clinician workflows.

```
                                ┌─────────────────────────────────────────┐
   GET /api/patient-portal/*    │      patient-portal-repository.js       │
   (reads + portal-message      │  • getPatientSessionProfile             │
    writes)                     │  • getUpcomingAppointments              │
       ─────────────────────►   │  • getActiveMedications (+ refill join) │
                                │  • getLabResults                        │
                                │  • getMessages / createMessage          │
                                └─────────────────────────────────────────┘

                                ┌─────────────────────────────────────────┐
   POST /api/patient-portal/    │           FrontDeskAgent                │
   appointments/{find-slots,    │              ↓                          │
   request, checkin}            │      scheduling-repository.js           │
       ─────────────────────►   │  (same path as clinician schedule)      │
                                └─────────────────────────────────────────┘
```

`requirePortalSession` middleware (registered after `/verify` and `/logout`, before all other routes) sets `req.portalPatient`, `req.portalSession`, and a synthesized `req.user = { sub, username: 'patient:<id>', role: 'patient', fullName }`. From that point on, every handler reads `req.portalPatient.id` — never trusting a body field.

---

## Authentication flow

### 1. Verification — `POST /api/patient-portal/verify`

| Field | Required | Notes |
|---|---|---|
| `first_name`, `last_name`, `dob` | Always | 401 if no patient matches |
| `mrn` | Production only | Required if `PATIENT_PORTAL_REQUIRE_MRN=true` OR `NODE_ENV=production` (unless override `PATIENT_PORTAL_REQUIRE_MRN=false`). The dev default omits MRN to keep test scenarios lightweight; production demands it. |

`verifyPatient()` (in `server/integrations/patient-voice.js`, despite the name — used by the voice path AND the form path) does the lookup. On success: a session is created and the cookie attached.

### 2. Session — `portal-session-service.js`

- **Token:** 48 random bytes hex (96 hex chars).
- **Storage:** sha256(token) in `patient_portal_sessions` table — the raw token never touches the DB. Lookup compares hashes.
- **TTL:** `PATIENT_PORTAL_SESSION_TTL_HOURS` env var (default 8).
- **Cookie:** `portal_session=<token>; HttpOnly; SameSite=Lax; Path=/; Expires=<TTL>`. `Secure` flag is added when `NODE_ENV=production`.
- **Sliding refresh:** every authenticated request bumps `last_activity` on the session row.
- **Expiry handling:** when `expires_at <= now()`, the row is marked `revoked=1` and the request returns 401.
- **Logout:** marks `revoked=1` on the session row and emits a `Set-Cookie` with `Max-Age=0` to clear the browser cookie.

### 3. Header fallback

Cookies are the canonical session carrier, but `X-Portal-Session: <token>` is accepted as a fallback for non-browser clients (testing, mobile WebView). The fallback uses the same hash lookup.

### 4. CSRF posture (current limitation)

Portal-write endpoints sit behind `HttpOnly` + `SameSite=Lax` cookies only. There is **no CSRF token validation** on POST endpoints today. Comment at `routes/patient-portal.js:148-152` flags this gap explicitly. SameSite=Lax does block cross-origin form posts in modern browsers, but a same-site sub-app or a misconfigured CORS allow-list could still hit a write endpoint. Track this as a known gap until a CSRF token middleware lands.

---

## RBAC — patient role boundary

The portal session synthesizes `req.user.role = 'patient'`. The clinician-side RBAC layer (`server/security/rbac.js`) has a corresponding `patient` role with read-only scopes on the patient's own resources.

The boundary tests in `test/run-tests.js` (Test 273 `portal session cannot access clinician APIs`, Test 274 `clinician bearer token cannot impersonate a portal session`) are the regression guarantees. Both pass as of 2026-05-03.

In particular:
- Portal sessions cannot fetch `/api/patients/:id/medications` directly (Test 262 — front desk is also blocked, by the same RBAC).
- Portal sessions cannot read the audit log, billing data, or any clinical content not on their own record.
- Clinician bearer tokens (issued by `/api/auth/login`) cannot be used to access `/api/patient-portal/*` — those routes require the cookie-based portal session specifically.

---

## Route map

All routes are mounted under `/api/patient-portal`. `*` = auth required (sits behind `requirePortalSession`).

| Method | Path | Repository | Handler |
|---|---|---|---|
| POST | `/verify` | (verifyPatient → patients table direct) | Open. Sets cookie on success. |
| POST | `/logout` | session service | Open. Revokes session. |
| GET  | `/session` * | patient-portal-repo | Returns session-shaped profile + expiry |
| GET  | `/appointments` * | patient-portal-repo | Upcoming, filtered |
| POST | `/appointments/checkin` * | patient-portal-repo | Sets status=checked_in |
| POST | `/appointments/find-slots` * | scheduling-repo (via FrontDeskAgent) | Slot search |
| POST | `/appointments/request` * | scheduling-repo (via FrontDeskAgent) | Booking → status=scheduled |
| GET  | `/medications` * | patient-portal-repo | Active meds + refill state |
| GET  | `/labs` * | patient-portal-repo | Wrapped through `buildLabExplanation()` for plain-language H/L flag prose |
| GET  | `/messages` * | patient-portal-repo | All portal messages |
| POST | `/message` * | patient-portal-repo | New portal message (tier 2) |
| POST | `/refill-request` * | patient-portal-repo | message_type='refill_notification', status='physician_review' |
| POST | `/symptom-triage` * | patient-portal-repo | Severity 1-10; routes to phone_triage if ≥4, urgency=stat if ≥7 |
| POST | `/voice-intent` * | patient-voice integration | See PATIENT_VOICE.md |

---

## Frontend

Two surfaces consume the portal:

1. **`src/pages/PatientPortal.jsx`** — full multi-tab portal (Dashboard / Appointments / Medications / Labs / Messages / Symptom Triage / Visit Prep). Form-driven. Uses `portalApi` from `src/api/client.js` for every call.

2. **`src/components/PatientVoice.jsx`** — voice-first entry point. Uses `usePatientVoice` hook (`src/hooks/usePatientVoice.js`) which combines Web Speech API recognition + `processVoiceIntent` server call + `SpeechSynthesis` for spoken response. Falls back to typed text input where speech recognition isn't supported.

Both surfaces share the same `portalApi.getSession()` bootstrap, so a verified session works across both.

---

## File map

| Concern | File |
|---|---|
| HTTP routes + lab plain-language wrapper | `server/routes/patient-portal.js` |
| Session lifecycle (create / get / revoke / cookie helpers / `requirePortalSession` middleware) | `server/services/portal-session-service.js` |
| Portal-shaped reads + `createMessage` write | `server/repositories/patient-portal-repository.js` |
| Cross-cutting appointment writes | `server/agents/front-desk-agent.js` (with `server/repositories/scheduling-repository.js`) |
| Voice intent classification + handlers | `server/integrations/patient-voice.js` |
| Multi-tab portal UI | `src/pages/PatientPortal.jsx` |
| Voice-first portal UI | `src/components/PatientVoice.jsx` + `src/hooks/usePatientVoice.js` |
| Portal API client | `src/api/client.js` (`portalApi` namespace) |
| Boundary regression tests | `test/run-tests.js` (Tests 267-274) |
| Module registry entries | `server/agents/module-registry.js` keys: `patient_app`, `patient_link` |

---

## Adding a new portal endpoint

1. **Pick the right repository.** Read-only or portal-only write → `patient-portal-repository.js`. Anything that has to compose with clinician scheduling → `FrontDeskAgent.process(...)` (and let `scheduling-repository.js` own the write).
2. **Mount the route in `server/routes/patient-portal.js`** under the existing router. Place it AFTER `router.use(requirePortalSession)` unless it's `/verify` or `/logout`.
3. **Read patient ID from `req.portalPatient.id`** — never trust a body field for patient identity.
4. **Audit registration:** if the endpoint touches PHI, ensure it's covered by the global `audit-logger.js` `PHI_ROUTES`. The current portal routes are already registered via the patient-portal route prefix.
5. **Add a boundary test** under `test/run-tests.js` Patient Portal HTTP section — new endpoints inherit the access-boundary regression suite via the same harness.
