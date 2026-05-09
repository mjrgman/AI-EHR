# Patient Voice + Encounter Voice

**Status:** Phase 3a-b (HRT/peptide voice routing) + Phase 3 (patient portal voice)
**Authoritative code:** `src/hooks/usePatientVoice.js`, `src/hooks/useSpeechRecognition.js`, `src/hooks/useHRTKeywords.js`, `src/utils/hrt-keywords.mjs`, `src/components/PatientVoice.jsx`, `src/PatientVoice.jsx` (top-level pass-through), `server/integrations/patient-voice.js`

---

## Why this doc exists

There are **two distinct voice subsystems** in this repo. Both use Web Speech API in the browser today, but they serve different audiences and route to different backends. Conflating them is the most common confusion. This doc separates them.

---

## Subsystem 1 — Clinician encounter voice (`useSpeechRecognition`)

**Audience:** physician + medical assistant during a clinical encounter.
**Hook:** `src/hooks/useSpeechRecognition.js` (78 lines, generic Web Speech API wrapper).
**Consumed by:** `src/pages/EncounterPage.jsx` and any other clinician-side surface that needs continuous transcription.
**Server-side destination:** Scribe agent — the transcript becomes the SOAP note draft via the encounter pipeline.

### Behavior

- Initializes `webkitSpeechRecognition` (or `SpeechRecognition`) on mount.
- `continuous=true`, `interimResults=true`, `lang='en-US'` by default (overridable via hook options).
- Maintains two separate state slices: `transcript` (only finalized phrases, accumulated across the session) and `interimTranscript` (the in-progress speculative text from the engine).
- `startListening()` / `stopListening()` are imperative — the hook does not auto-listen.
- `onend` handler auto-restarts when `_shouldListen` is true, so a 30-second silence doesn't terminate the session.
- Errors other than `no-speech` halt listening; `no-speech` is silently absorbed because it's expected during quiet moments in an encounter.

### Companion: HRT keyword detector

`src/hooks/useHRTKeywords.js` is a **stateless** `useMemo` wrapper around `detectHrtCategories()` from `src/utils/hrt-keywords.mjs`. EncounterPage feeds it the accumulated transcript from `useSpeechRecognition` and uses the result to auto-focus the HRT/Peptide tab when hormone or peptide terms are heard (testosterone, estradiol, progesterone, semaglutide, tirzepatide, sermorelin, BPC-157, etc.).

The deliberate design choice (per the hook's own header comment): keep it stateless. The consumer owns "fire only once per encounter" UI policy. Resetting the transcript naturally resets the matched categories. The unit tests for `detectHrtCategories` cover the hook's only logic.

The same keyword list is mirrored server-side in `server/agents/domain-logic-agent.js` `DOMAIN_KEYWORDS` — the test suite enforces parity. The browser-side detection is for instant UI feedback only; the `DomainLogicAgent` is the authoritative classifier.

---

## Subsystem 2 — Patient portal voice (`usePatientVoice`)

**Audience:** patients using the portal voice-first surface.
**Hook:** `src/hooks/usePatientVoice.js` (239 lines, opinionated portal-aware wrapper).
**Consumed by:** `src/components/PatientVoice.jsx` (full UI) and `src/PatientVoice.jsx` (top-level pass-through).
**Server-side destination:** `processVoiceIntent` in `server/integrations/patient-voice.js`, exposed via `POST /api/patient-portal/voice-intent` (Tier 1-2 depending on classified intent).

### What it does that the encounter hook does not

| Concern | encounter hook | patient hook |
|---|:---:|:---:|
| Web Speech API recognition | ✅ | ✅ |
| Auto-restart on idle | ✅ | ✅ |
| Silence-detection timer (post-speech) | — | ✅ 2-second silence auto-submits |
| Portal session bootstrap | — | ✅ calls `portalApi.getSession()` on mount |
| Server-side intent dispatch | — | ✅ `portalApi.processVoiceIntent(text)` after silence |
| Spoken response (TTS) | — | ✅ `SpeechSynthesisUtterance` with preferred voice (Google English first) |
| Portal verification helper | — | ✅ `verifyPatient(first, last, dob, mrn)` |
| Session reset (logout + state clear) | — | ✅ `resetSession()` |

The patient hook is the heavier abstraction because it owns the full conversation loop: listen → debounce → dispatch → speak.

---

## Server-side intent classification

`server/integrations/patient-voice.js` `classifyIntent(text)` runs the transcript against an ordered list of regex patterns. **Order matters** — `request_appointment` is checked before `check_appointments` because both match `/appointment/i` and the verb-based patterns (book/request/make/new) are narrower.

### Intent table

| Intent | Tier | Trigger examples | Handler |
|---|:---:|---|---|
| `request_appointment` | 1 | "book an appointment", "schedule a visit", "make a new appointment" | Returns guidance: directs caller to the Appointments tab UI for slot selection (no NL date parsing) |
| `check_appointments` | 1 | "appointment", "when do I see…", "schedule", "next visit" | Reads upcoming appointments from `appointments` table, formats as friendly date+time+provider |
| `request_refill` | 2 | "refill", "more medicine", "running out" | (See `handleRequestRefill`) Routes to physician review via `patient_messages` |
| `check_lab_results` | 2 | "lab result", "blood work", "my results" | Returns recent labs |
| `send_records` | 2 | "send records", "transfer records" | Records request flow |
| `check_medications` | 1 | "medication", "what am I taking" | Reads active meds |
| `visit_prep` | 1 | "what should I bring to my visit" | Returns prep guidance |
| `symptom_report` | 2 | "I'm feeling…", "symptom", "pain", "hurts" | Routes to triage flow |
| `general_question` | 1 | (catch-all) | Falls through with low confidence |

A few notes that matter:

- **No NL date parsing.** Voice booking returns guidance ("use the Appointments tab to pick a time"). Real booking goes through `POST /api/patient-portal/appointments/request` with a `slotId` chosen via UI. This is deliberate — parsing dates from natural language is a separate effort with its own ambiguity tax.
- **Tier translates to physician-review status.** Tier-2 intents (refill, triage) write to `patient_messages` with `status='physician_review'`. The physician review flow is the same path as for any portal message.
- **All voice traffic sits behind the portal session.** The route is registered after `requirePortalSession`, so an unverified caller cannot hit the intent endpoint.

---

## Architecture diagram

```
ENCOUNTER VOICE                                    PATIENT PORTAL VOICE
─────────────────                                  ────────────────────
EncounterPage.jsx                                  PatientVoice.jsx
       │                                                  │
       ▼                                                  ▼
useSpeechRecognition()                             usePatientVoice()
       │                                                  │
       │ transcript                                       │ transcript (debounced 2s)
       ▼                                                  ▼
useHRTKeywords() ──► auto-focus HRT tab            POST /api/patient-portal/voice-intent
       │                                                  │
       │ (clinician interaction with tabs)                ▼
       │                                           classifyIntent() in
       ▼                                           integrations/patient-voice.js
Scribe agent (server-side)                                │
       │                                                  ▼
       ▼                                           handler (per intent) →
SOAP note draft → DomainLogicAgent →               patient-portal-repository
                  Physician approval               (e.g., createMessage for refill)
                                                          │
                                                          ▼
                                                   SpeechSynthesis ◄── response text
                                                   (browser TTS)
```

---

## File map

| Concern | File |
|---|---|
| Generic Web Speech wrapper (clinician) | `src/hooks/useSpeechRecognition.js` |
| Portal-aware voice hook (full conversation loop) | `src/hooks/usePatientVoice.js` |
| Stateless HRT/peptide keyword detector | `src/hooks/useHRTKeywords.js` |
| Keyword list (browser-side, mirrored server-side) | `src/utils/hrt-keywords.mjs` ↔ `server/agents/domain-logic-agent.js` `DOMAIN_KEYWORDS` |
| Patient voice UI | `src/components/PatientVoice.jsx` |
| Top-level voice route | `src/PatientVoice.jsx` (thin re-export) |
| Server intent classifier + handlers | `server/integrations/patient-voice.js` |
| Route mount (with portal-session enforcement) | `server/routes/patient-portal.js` (POST `/voice-intent` line ~bottom) |
| Encounter consumer | `src/pages/EncounterPage.jsx` |

---

## Adding a new patient-voice intent

1. **Edit `INTENT_PATTERNS`** in `server/integrations/patient-voice.js`. Pick a tier (1 = info read; 2 = action that needs physician review). Order matters — narrower regex first.
2. **Add a handler function** (e.g., `handleNewIntent(patientId, text)`) returning `{ text, data?, followUp? }`. Keep `text` at a 6th-grade reading level for TTS comprehension.
3. **Wire it in `processVoiceIntent`** (the dispatch switch) so the new intent routes to your handler.
4. **Tier-2 intents must persist via `patient-portal-repository.createMessage`** with appropriate `message_type` and `status='physician_review'`. Don't write directly to other tables from the voice path — keep the write surface concentrated.
5. **Add a Patient Portal HTTP scenario test** in `test/run-tests.js` exercising the new intent through the actual HTTP route. Test 272 (`voice intent can answer appointment requests with an active portal session`) is the model.

## Adding a new HRT/peptide keyword

1. **Append to `src/utils/hrt-keywords.mjs`** `HRT_KEYWORDS` (or the per-category sub-array if categorization matters).
2. **Mirror to `server/agents/domain-logic-agent.js`** `DOMAIN_KEYWORDS`. The test suite enforces parity — failing to mirror will break a scenario test.
3. **Add a positive test case** in `test/scenarios/functional-med-scenarios.json` if the keyword should trigger a Domain Logic rule.
