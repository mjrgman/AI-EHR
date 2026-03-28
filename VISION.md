# Agentic EHR: Comprehensive System Vision

**Version:** 1.0 — March 22, 2026
**System Name:** Agentic EHR (working title)
**Classification:** Purpose-Built AI-Native Electronic Health Record

---

## I. Core Thesis

Legacy EHR systems — eClinicalWorks, Athena, Epic, Cerner — are template-driven. The provider clicks through rigid forms, selects from dropdown menus, and generates notes that are structurally locked into the template's logic. The result: dead-end restrictive wording, copy-forward bloat, checkbox medicine, and documentation that serves billing before it serves the patient.

This Agentic EHR rejects the template model entirely. There are no templates. There are no dropdowns. There are no click-through forms.

Instead, the system is composed of **purpose-built AI agents** — each one assigned to a role in the clinical workflow, each one learning from its operator, each one communicating with the others through a shared patient context. The agents don't assist the workflow. **The agents are the workflow.**

The physician talks. The MA talks. The patient calls. The agents listen, triage, document, order, schedule, and learn. Every piece of clinical data flows through an agent-driven pipeline that adapts to the practice, the provider, and the patient — not the other way around.

---

## II. What This Replaces

| Legacy EHR | Agentic EHR |
|---|---|
| Template-driven notes | Free-form AI-transcribed documentation |
| Click-through order entry | Voice-driven / agent-generated orders |
| Rigid workflow states | Agent-orchestrated dynamic workflow |
| Copy-forward bloat | Synopsis-style intelligent summaries |
| One-size-fits-all | Provider-adaptive (learns preferences) |
| Phone → sticky note → chart later | Phone → triage agent → chart immediately |
| Manual pre-visit chart prep | Automated pre-visit intelligence briefing |
| Post-visit: provider does everything | Post-visit: agents handle orders, letters, scheduling |

---

## III. Agent Architecture

The system operates through **nine specialized agents**, each mapped to a real human role or clinical function in the practice. Every agent has a defined scope of authority, escalation pathways, and a learning memory. The nine agents are: Phone Triage, Front Desk, MA, Physician (pre-visit), and Scribe, CDS, Orders, Coding, Quality (encounter pipeline).

### Agent 1: Phone Triage Agent

**Role:** First point of contact. Answers incoming calls, triages information, and routes it into the chart.

**Scope of Authority:**
- Answer incoming patient calls (voice AI or text-based)
- Collect reason for call, symptoms, urgency
- Triage using provider-approved protocols (nurse triage algorithms)
- Build a **decision tree** mapping where this call needs to go:
  - Routine question → MA Agent
  - Medication refill → MA Agent (within protocol)
  - Acute symptom → MA Agent with escalation flag to Physician Agent
  - Scheduling request → Front Desk Agent
  - Emergency → Direct patient to 911 / ER, document in chart
- Write the call into the patient's chart immediately (no sticky notes, no callback lists)
- Generate a structured triage note: who called, what they said, what was decided, where it was routed

**Escalation:** Routes to MA Agent or Physician Agent based on triage protocol severity.

**Memory:** Learns call patterns for the practice. Recognizes frequent callers. Adapts triage questions based on patient's known conditions (e.g., diabetic patient calling about blood sugar — agent already knows their A1C history and medication list).

---

### Agent 2: Front Desk Agent

**Role:** Scheduling, patient contact, and pre-visit preparation.

**Scope of Authority:**
- Schedule, reschedule, and add-on appointments per provider availability
- Contact patients to confirm appointments, relay messages
- Respond to scheduling requests from MA Agent or Phone Triage Agent
- **Pre-visit intelligence preparation** (see Section IV below)
- Pull and summarize all medical records before the patient arrives
- Generate the pre-visit briefing document for the provider
- Manage patient check-in workflow

**Escalation:** Scheduling conflicts or unusual requests → human front desk staff or MA Agent.

**Memory:** Learns scheduling patterns. Knows which patients need longer slots. Knows provider preferences for schedule structure.

---

### Agent 3: Medical Assistant (MA) Agent

**Role:** The MA's personal AI agent. Handles the clinical support tasks that fall within MA scope.

**Scope of Authority:**
- Answer patient questions within MA scope of practice
- Schedule appointments per MA direction (routes to Front Desk Agent)
- **Refill medications within provider-established protocols** — the provider presets refill parameters (e.g., "Lisinopril 20mg, authorized for 3 refills, no dose change without my approval"), and the MA Agent executes within those bounds
- Give medical advice to patients within approved protocols (e.g., "You can take Tylenol for mild headache, call back if fever exceeds 101°F")
- Develop lab orders for upcoming visits based on chronic disease protocols and preventive care schedules
- Send lab orders to the lab for specimen collection
- Route scheduling needs to Front Desk Agent
- **Only escalate to Physician Agent when a question exceeds MA protocol scope**

**What the MA Agent does NOT do:**
- Change medication doses without physician approval
- Diagnose
- Order imaging or referrals without physician direction
- Override triage protocols

**Escalation:** Questions outside protocol scope → Physician Agent. The escalation includes full context: patient name, condition, what was asked, what the MA Agent already knows, and a recommended action if applicable.

**Memory:** Learns the MA's workflow habits. Knows which patients the MA handles regularly. Adapts communication style to the MA's preferences.

---

### Agent 4: Physician Agent

**Role:** The provider's personal AI agent. The brain of the system. Handles clinical decision support, note editing, order management, and communication.

**Scope of Authority:**
- **Protocol management:** Sets the rules that MA Agent and Phone Triage Agent follow. "For hypertension refills, approve if BP was <140/90 at last visit and patient is compliant." These protocols are the Physician Agent's directives.
- **Escalation handling:** Receives questions from MA Agent that exceed protocol scope. Reviews context, makes decisions, sends directives back.
- **Communication:** Sends letters to patients via portal, email, or text. Generates after-visit summaries. Writes referral letters to specialists.
- **During-visit functions** (in coordination with Ambient Agent):
  - Real-time note editing as the visit progresses
  - Edits transcription output to match provider's preferred documentation style
  - Ensures diagnoses, treatment plans, and orders land in the correct SOAP note section
  - Suggests orders, referrals, and follow-up based on the encounter
- **Post-visit functions:**
  - Ensures all medications are sent to pharmacy
  - Ensures imaging orders are transmitted
  - Ensures referral letters are generated and sent to the correct specialist
  - Generates the patient's after-visit summary
  - Updates the problem list based on the encounter
- **Learning and memory:** Over time, the Physician Agent learns the provider's:
  - Documentation style (sentence structure, level of detail, preferred phrasing)
  - Ordering patterns (which labs for which conditions, preferred imaging modalities)
  - Treatment preferences (first-line medications, dosing habits, referral thresholds)
  - Communication style (formal vs. conversational patient letters)

**This is the most important agent in the system.** Its memory is the EHR's memory. As it learns the provider, it becomes a true clinical copilot — not replacing judgment, but eliminating friction.

---

### Agent 5: Ambient/Scribe Agent

**Role:** Real-time transcription and clinical data extraction during the encounter.

**Scope of Authority:**
- Listen to the entire encounter (provider-patient conversation)
- Transcribe in real time
- **Place transcribed content in the correct SOAP note section automatically:**
  - Patient's complaints, history → Subjective
  - Exam findings stated by provider → Objective / Physical Exam
  - Provider's clinical reasoning → Assessment
  - Orders, prescriptions, follow-up discussed → Plan
- Extract structured data from natural language:
  - Vitals mentioned → Vitals section
  - Medications discussed → Medication list and Plan
  - Diagnoses stated → Assessment with ICD-10 codes
  - Lab orders mentioned → Plan / Orders
  - Referrals discussed → Plan / Referrals
- Feed extracted data to Physician Agent for real-time review and editing
- Generate the draft SOAP note at encounter end

**What the Ambient Agent does NOT do:**
- Make clinical decisions
- Finalize the note (Physician Agent reviews and signs)
- Send orders (Physician Agent authorizes)

**Relationship with Physician Agent:** The Ambient Agent is the ears. The Physician Agent is the brain. The Ambient Agent captures everything; the Physician Agent shapes it into the provider's preferred documentation.

---

### Agent 6: Coding/Quality Agent

**Role:** E&M coding, ICD-10 validation, MIPS/HEDIS quality tracking, and billing compliance.

**Scope of Authority:**
- Calculate E&M level from the completed note (2021 MDM-based guidelines)
- Validate ICD-10 code specificity and accuracy
- Flag HCC-relevant codes for risk adjustment
- Track MIPS quality measures in real time during the encounter
- Identify care gaps (screenings due, chronic disease monitoring overdue)
- Score documentation completeness
- Alert the Physician Agent to missing elements before note signing
- Generate coding summary for billing staff

**Runs after:** Ambient Agent and Physician Agent complete the note.

---

## IV. Pre-Visit Intelligence Briefing

When a patient is scheduled, the system begins preparing **before the patient arrives.** This is not a chart review. This is an AI-generated intelligence briefing.

### What the Briefing Contains

**1. Patient Identity & Demographics**
- Name, DOB, age, sex, insurance, PCP, preferred pharmacy
- Contact information, emergency contact
- Preferred communication method (portal, email, text, phone)

**2. Reason for Visit**
- Scheduled reason (from scheduling notes or Phone Triage Agent notes)
- If follow-up: what was the previous encounter about, what was the plan, was the plan completed

**3. Active Problem Synopsis** (NOT an exhaustive history)

This is the critical departure from legacy EHRs. The briefing does NOT regurgitate the entire medical history. It presents a **synopsis** — only what is relevant to the primary care provider giving care today.

For each active condition:
- Condition name and ICD-10 code
- **Who is managing it** (the consultant's name if it's specialist-managed)
- Current status (stable, worsening, newly diagnosed)
- Current treatment (medication, dose)
- Last relevant lab or diagnostic result
- Next action needed (if any)

**Example:**
> **Type 2 Diabetes Mellitus (E11.65)** — Managed by PCP
> Current: Metformin 1000mg BID, Ozempic 1mg weekly
> Last A1C: 7.8% (01/15/2026) — improved from 8.2%
> Next: Repeat A1C due April 2026. Continue current regimen.
>
> **Atrial Fibrillation (I48.91)** — Managed by Dr. Sarah Kim, Cardiology
> Current: Eliquis 5mg BID, Metoprolol 50mg BID
> Last echo: EF 55% (11/2025). Rate controlled per cardiology.
> Next: Follow-up with Dr. Kim scheduled 04/2026.

The PCP does not need to re-document the cardiologist's full workup. The PCP needs to know: what it is, who owns it, where it stands, and what's next. That's it.

**4. Surgical History** — Brief list. Relevant only.

**5. Post-Hospitalization Summary** (if applicable)

If the patient was recently hospitalized, the briefing includes a **1-2 paragraph summary:**
- Why they were admitted
- What was done (procedures, treatments)
- Who saw them (consultants)
- Discharge diagnosis
- Discharge medications (with changes from prior)
- Follow-up instructions and pending diagnostics

This is not a discharge summary copy-paste. This is a distilled briefing for the PCP.

**6. Current Medications** — Active list with prescriber, dose, frequency, indication.

**7. Allergies** — With reaction type and severity.

**8. Prior Physical Exam** — The most recent complete physical exam, pulled forward as a starting template that the provider edits during the current visit.

**9. Preventive Care Status**
- Which screenings are due (colonoscopy, mammogram, A1C, etc.)
- Which immunizations are due
- Which quality measures apply to this patient and their current status

**10. Treatment Plan Carryforward**

For chronic conditions, the standing treatment plan carries forward automatically:
- "Continue Lisinopril 20mg daily for hypertension"
- "Continue Metformin 1000mg BID for diabetes"
- "Annual diabetic eye exam due — last completed 03/2025"

These only appear if they are still active and relevant. If the provider discontinued a medication last visit, it does not carry forward. The system is intelligent about what persists and what doesn't.

---

## V. During-Visit Workflow

### Step 1: Patient Arrives
- Front Desk Agent confirms arrival
- Pre-visit briefing is ready on the provider's screen
- Workflow state: Checked In

### Step 2: MA Rooms the Patient
- MA Agent assists with rooming workflow
- Vitals are recorded (voice or manual entry)
- Chief complaint is captured
- MA Agent updates the encounter context
- Workflow state: Roomed → Vitals Recorded

### Step 3: Provider Enters
- Ambient Agent activates (listening)
- Provider reviews the pre-visit briefing (already prepared)
- Provider begins the encounter — talking to the patient, examining, discussing plan
- Ambient Agent transcribes everything in real time
- Ambient Agent places content in the correct SOAP sections
- Physician Agent edits the note in real time according to provider style
- Workflow state: Provider Examining

### Step 4: During the Encounter
- As the provider mentions medications → Physician Agent queues prescription orders
- As the provider mentions labs → Physician Agent queues lab orders
- As the provider mentions referrals → Physician Agent drafts referral letters
- Coding Agent calculates E&M level in real time as documentation builds
- Quality Agent flags any care gaps that could be addressed during this visit
- CDS alerts fire if vital signs are abnormal, drug interactions detected, etc.

### Step 5: Provider Wraps Up
- Physician Agent presents the complete note for review
- Provider makes final edits (voice or manual)
- Coding Agent presents final E&M level and ICD-10 codes
- Quality Agent shows which measures were addressed
- Provider signs the note
- Workflow state: Signed

### Step 6: Post-Visit
- Physician Agent sends prescriptions to pharmacy
- Physician Agent transmits lab orders to lab
- Physician Agent sends referral letters to specialists
- Physician Agent generates after-visit summary for the patient (portal/email/text)
- Front Desk Agent schedules follow-up per the plan
- MA Agent generates any standing orders for the next visit
- Workflow state: Checked Out

---

## VI. Inter-Agent Communication Model

Agents do not operate in silos. They communicate through a **shared patient context** and a **message bus.**

```
Phone Triage Agent ──→ MA Agent ──→ Physician Agent
         │                │               │
         ▼                ▼               ▼
  Front Desk Agent ←──────┘               │
         │                                │
         ▼                                ▼
  Patient Contact              Ambient Agent (during visit)
                                          │
                                          ▼
                                 Coding/Quality Agent
```

**Message types between agents:**
- `TRIAGE_RESULT` — Phone Triage → MA Agent (patient call triaged)
- `ESCALATION` — MA Agent → Physician Agent (question exceeds protocol)
- `DIRECTIVE` — Physician Agent → MA Agent (answer to escalation)
- `SCHEDULE_REQUEST` — MA Agent → Front Desk Agent (schedule/reschedule)
- `PATIENT_CONTACT` — Front Desk Agent → Patient (appointment confirmation)
- `REFILL_REQUEST` — Phone Triage → MA Agent → Physician Agent (if outside protocol)
- `ORDER_REQUEST` — Physician Agent → Lab/Pharmacy/Imaging (during or post-visit)
- `NOTE_UPDATE` — Ambient Agent → Physician Agent (real-time transcription)
- `CODING_ALERT` — Coding Agent → Physician Agent (missing documentation)
- `QUALITY_GAP` — Quality Agent → Physician Agent (care gap identified)
- `PATIENT_LETTER` — Physician Agent → Patient (via portal/email/text)
- `BRIEFING_READY` — Front Desk Agent → Provider screen (pre-visit prep complete)

---

## VII. Memory and Learning

This is not a stateless system. Every agent has persistent memory.

**Physician Agent Memory:**
- Documentation style preferences (learned over time)
- Ordering patterns by condition
- Treatment preferences (first-line choices, dosing patterns)
- Communication tone for patient letters
- Which CDS alerts the provider consistently accepts vs. dismisses
- Time-of-day patterns (e.g., runs behind in afternoon — adjust scheduling)

**MA Agent Memory:**
- Which refill requests are routine vs. require escalation for this practice
- Patient communication preferences
- Common triage resolutions
- Provider protocol library (what the physician has authorized)

**Phone Triage Agent Memory:**
- Frequent callers and their conditions
- Common call reasons by time of year
- Triage protocol refinements based on outcomes

**Front Desk Agent Memory:**
- Scheduling patterns and preferences
- No-show patterns by patient
- Provider availability preferences
- Insurance verification patterns

**The memory IS the EHR.** As the system runs, it gets better. It learns the practice. It learns the provider. It learns the patients. This is the fundamental advantage over legacy EHR systems, which are static template engines that never learn anything.

---

## VIII. What Makes This Different

1. **No templates.** Documentation is generated from natural language, shaped by AI, edited by the provider. The note is as detailed or as brief as the encounter demands.

2. **No click-through workflows.** The agents handle the workflow. The provider talks to the patient. Period.

3. **Synopsis, not exhaustive history.** The system presents what matters, not everything. A 65-year-old with 20 years of medical history does not need all 20 years on screen. They need what is active, who is managing it, and what is next.

4. **Agents learn.** The system adapts to the practice. Day one, it follows protocols. Day 365, it anticipates what the provider wants before they ask.

5. **Communication is native.** Patient letters, portal messages, lab orders, referral letters, appointment scheduling — all handled by agents, all documented in the chart, all auditable.

6. **The provider's time is protected.** The physician does two things: see patients and make clinical decisions. Everything else — documentation, orders, letters, scheduling, coding, quality reporting — is handled by agents operating within physician-defined protocols.

---

## IX. Technical Foundation

**Current Stack:**
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js / Express
- Database: SQLite (development) → PostgreSQL (production)
- AI: Claude API (Anthropic) for clinical reasoning, with pattern-matching fallback
- Voice: Web Speech API (development) → production-grade ASR (Whisper, Deepgram, or equivalent)

**Agent Framework (built):**
- Base agent class with status tracking, timing, event emission
- Orchestrator with dependency-aware parallel execution
- Shared patient context schema
- 5 initial agents operational (Scribe, CDS, Orders, Coding, Quality)

**To be built:**
- Phone Triage Agent (voice AI integration)
- Front Desk Agent (scheduling engine, pre-visit briefing generator)
- MA Agent (protocol engine, refill automation, escalation logic)
- Physician Agent (learning engine, style adaptation, order management)
- Inter-agent message bus
- Persistent agent memory (knowledge graph or vector store)
- FHIR interoperability layer (for external record ingestion)
- Production voice pipeline (real-time ASR + speaker diarization)

---

## X. Development Phases

**Phase 1 — Foundation (Complete)**
Core EHR data model, workflow engine, CDS rule engine, audit logging, SOAP note generation, 5-agent pipeline.

**Phase 2 — Agent Intelligence (Current)**
Physician Agent learning engine, MA Agent protocol system, pre-visit briefing generator, inter-agent communication bus.

**Phase 3 — Voice Pipeline**
Production-grade ambient transcription, speaker diarization (distinguish provider vs. patient), real-time streaming to Ambient Agent.

**Phase 4 — Front Office**
Phone Triage Agent (voice AI), Front Desk Agent (scheduling automation), patient contact automation (portal/email/text).

**Phase 5 — Memory and Adaptation**
Persistent agent memory, provider style learning, practice-level analytics, quality reporting dashboards.

**Phase 6 — Interoperability**
FHIR R4 integration, external record ingestion (hospital discharge summaries, specialist notes), lab interface (HL7), e-prescribing (NCPDP SCRIPT).

**Phase 7 — Production Hardening**
HIPAA compliance audit, penetration testing, PostgreSQL migration, cloud deployment, disaster recovery, user authentication (OAuth2/SAML).

---

*This document is the north star for Agentic EHR development. Every feature, every agent, every line of code should trace back to this vision.*
