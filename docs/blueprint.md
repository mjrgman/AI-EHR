# TRUE AI EHR: THE MASTER BLUEPRINT
**Architectural Specification & Technical Reference**

**Version:** 1.0 (Enterprise Ambient Edition)
**Date:** December 14, 2025
**Author:** True AI Architecture Team
**Reference Implementation:** `TrueAI_Final` (Installer v1.0)

---

# TABLE OF CONTENTS

**1.0 EXECUTIVE SUMMARY**
   1.1 The Unraveling System
   1.2 The True AI Solution
   1.3 Economic Thesis (451% ROI)

**2.0 SYSTEM ARCHITECTURE**
   2.1 The Dual-Repository Pattern
   2.2 Operational Repository (ACID)
   2.3 Analytical Repository (OLAP)
   2.4 The Event-Driven Sync Mechanism

**3.0 THE "CAST": FUNCTIONAL PERSONAS**
   3.1 Dr. Dollitle (Clinical Scribe)
   3.2 Nurse Racket (Utilization Management)
   3.3 Tech Drac (Fulfillment & Analytics)
   3.4 Grimm (Revenue Cycle)
   3.5 Hal (System Administration)

**4.0 INTELLIGENCE ENGINE SPECIFICATION**
   4.1 Context-Aware Routing
   4.2 Prompt Engineering & Constraints
   4.3 Legacy Safeguards (ECW Compliance)

**5.0 DATA MODEL REFERENCE**
   5.1 Patient Entity & State Machine
   5.2 Encounter & Transcript Objects
   5.3 Order Fulfillment Lifecycle
   5.4 Claims & Revenue Objects

**6.0 WORKFLOW & PATIENT JOURNEY**
   6.1 Stage 1: Telephony (Pre-Arrival)
   6.2 Stage 2: Reception (Ambient Check-In)
   6.3 Stage 3: The Exam (Ambient CPOE)
   6.4 Stage 4: The Lab (Ambient Fulfillment)
   6.5 Stage 5: Billing (Ambient Scrubbing)

**7.0 GOVERNANCE & SECURITY**
   7.1 DAIM: Department of AI in Medicine
   7.2 Audit Trails & Hallucination Management

---

# 1.0 EXECUTIVE SUMMARY

## 1.1 The Unraveling System
Modern healthcare is collapsing under the weight of administrative data entry. Physicians effectively work two jobs: providing care during the day and performing data entry at night ("Pajama Time"). Legacy Electronic Health Records (EHRs) act as passive digital filing cabinets, requiring explicit keyboard input for every action, turning high-value clinicians into data clerks.

## 1.2 The True AI Solution
True AI is an **Ambient Operating System**. It does not require a keyboard. It uses an "Always-Listening" architecture (where privacy permitted) to capture clinical intent from natural conversation. It transforms unstructured audio into structured SQL data automatically.

## 1.3 Economic Thesis
The system targets a **451% ROI** through three levers:
1.  **Revenue Recovery:** Automated claims scrubbing (Grimm) prevents denials before submission.
2.  **Capacity Expansion:** Eliminating documentation time allows providers to see 2-3 more patients daily.
3.  **Staff Efficiency:** Automated order tracking (Tech Drac) eliminates inter-departmental phone tag.

---

# 2.0 SYSTEM ARCHITECTURE

## 2.1 The Dual-Repository Pattern
Legacy EHRs fail because they use a single database for both high-speed transactions (Patient Care) and heavy analytics (Reporting). True AI splits these functions physically and logically.

## 2.2 Operational Repository (`operational.db`)
* **Role:** The "Body" of the system.
* **Technology:** SQLite (Pilot) / PostgreSQL (Production).
* **Characteristics:** Normalized (3NF), Transactional, Low-Latency.
* **Responsibility:** Stores the "Source of Truth" for patient care. It is the only place where clinical data is written.
* **Critical Constraints:** No complex queries allowed. Writes must be sub-millisecond.

## 2.3 Analytical Repository (`analytical.db`)
* **Role:** The "Brain" of the system.
* **Technology:** SQLite / Vector DB / Snowflake.
* **Characteristics:** Denormalized, Read-Optimized, Columnar.
* **Responsibility:** Stores logs, metrics, audit trails, and population health vectors.
* **Usage:** Used by "Hal" and "Tech Drac" for deep insights without slowing down the operational database.

## 2.4 Event-Driven Sync
When the Application Controller (`app.py`) writes a new Order to the Operational DB, it creates a "Shadow Record" in the Analytical DB. This decoupling ensures that running a massive population health report never slows down a doctor trying to sign a note.

---

# 3.0 THE "CAST": FUNCTIONAL PERSONAS

To manage the complexity of an entire hospital operating system, True AI anthropomorphizes its modules into "Personas."

## 3.1 Dr. Dollitle (The Scribe)
* **Domain:** The Exam Room.
* **Function:** Listens to the doctor-patient dialogue.
* **Output:** Generates the SOAP Note and CPOE (Computerized Physician Order Entry) commands.
* **Key Behavior:** "I talk to the AI so you don't have to."

## 3.2 Nurse Racket (The Gatekeeper)
* **Domain:** Authorization & Triage.
* **Function:** Compares pending orders against insurance payer rules.
* **Output:** `APPROVED` or `DENIED` status on orders.
* **Key Behavior:** "No denials allowed." She catches documentation errors *before* the order is sent.

## 3.3 Tech Drac (Fulfillment)
* **Domain:** The Laboratory & Analytics.
* **Function:** Listens for "fulfillment cues" (e.g., "Drawing blood").
* **Output:** Updates order status from `ORDERED` to `COLLECTED`.
* **Key Behavior:** "I don't suck blood, I extract data."

## 3.4 Grimm (Revenue)
* **Domain:** Billing Office.
* **Function:** Monitors the `Claims` queue.
* **Output:** Scrubs claims for bundling errors (e.g., Missing Modifier 25) and submits them.
* **Key Behavior:** "The Reaper of Revenue." He ensures the practice gets paid.

## 3.5 Hal (Admin)
* **Domain:** The C-Suite.
* **Function:** Monitors system health, AI token usage, and ROI.
* **Output:** Executive Dashboards.

---

# 4.0 INTELLIGENCE ENGINE SPECIFICATION

The `EnterpriseBrain` class (`intelligence.py`) is the cognitive core. It uses a **Router Pattern** to direct transcripts to the correct Persona.

## 4.1 Context-Aware Routing
The system does not use one giant prompt. It selects a specialized "System Prompt" based on the `context` argument passed by the Workflow Controller.
* `process_ambient("CLINICAL", ...)` -> Activates Dr. Dollitle.
* `process_ambient("BILLING", ...)` -> Activates Grimm.

## 4.2 Prompt Engineering & Constraints
The prompts are engineered to return **Strict JSON** to allow for direct SQL injection.

**Example Clinical Prompt:**
> "Role: Medical Scribe. Task: SOAP Note + CPOE Orders.
> Output JSON: {'soap': '...', 'orders': [{'test': '...', 'priority': '...'}]}"

## 4.3 Legacy Safeguards (ECW Compliance)
A critical requirement is compatibility with legacy systems like eClinicalWorks (ECW).
* **The Em-Dash Rule:** ECW HL7 interfaces often break when parsing the em-dash character (--).
* **The Fix:** The `EnterpriseBrain` includes a hard-coded sanitizer that runs *after* the AI generates text but *before* it reaches the database: `.replace("--", "-")`. This guarantees 100% legacy compliance.

---

# 5.0 DATA MODEL REFERENCE

## 5.1 Patient Entity (`patients`)
* `id`: Unique MRN/UUID.
* `journey_stage`: A State Machine tracking the patient.
    * `PRE-REG`: Phone call complete, patient not on site.
    * `CHECKED-IN`: Patient in waiting room.
    * `IN-EXAM`: Patient with Provider.
    * `IN-LAB`: Patient with Tech Drac.
    * `CHECKED-OUT`: Visit complete.

## 5.2 Encounter (`encounters`)
* `type`: The context of the interaction (`CLINICAL`, `PHONE`, `LAB`).
* `transcript`: The raw "Ambient Audio" text.
* `notes`: The structured AI output (SOAP Note).

## 5.3 LabOrder (`lab_orders`)
* `status`: State Machine.
    * `ORDERED`: Created by Dr. Dollitle.
    * `COLLECTED`: Updated by Tech Drac (via Ambient Audio).
    * `RESULTED`: Final State.
* `specimen_id`: Generated only when status moves to `COLLECTED`.

## 5.4 Claim (`claims`)
* `status`: State Machine.
    * `QUEUED`: Generated by Dr. Dollitle.
    * `SUBMITTED`: Processed by Grimm.
* `ai_audit_note`: Stores the logic used by Grimm to justify code changes (e.g., "Added Modifier 25").

---

# 6.0 WORKFLOW & PATIENT JOURNEY

## 6.1 Stage 1: Telephony (Pre-Arrival)
1.  **Input:** Patient calls: "Hi, this is Bruce. Hurt my arm."
2.  **AI:** Extracts Intent=`APPOINTMENT`, Name=`Bruce Wayne`.
3.  **Action:** System creates `Patient` record if none exists. Sets status to `PRE-REG`.

## 6.2 Stage 2: Reception (Ambient Check-In)
1.  **Input:** Patient walks in: "I moved to Mountain Drive."
2.  **AI:** Detects `Address Update` intent.
3.  **Action:** Updates `Patient.address` in SQL. Sets status to `CHECKED-IN`.

## 6.3 Stage 3: The Exam (Ambient CPOE)
1.  **Input:** Dr. Dollitle hears: "Ordering X-Ray and CBC."
2.  **AI:**
    * Generates SOAP Note.
    * Extracts `CBC` and `X-Ray` as Orders.
    * Extracts `99214` as Billing Code.
3.  **Action:**
    * Writes 1 `Encounter` row.
    * Writes 2 `LabOrder` rows (`ORDERED`).
    * Writes 1 `Claim` row (`QUEUED`).
    * Sets status to `IN-EXAM`.

## 6.4 Stage 4: The Lab (Ambient Fulfillment)
1.  **Input:** Tech Drac hears: "Drawing the CBC now."
2.  **AI:** Matches spoken "CBC" to the pending SQL order for this patient.
3.  **Action:** Updates `LabOrder` status to `COLLECTED`. Generates a Specimen ID. Sets status to `IN-LAB`.

## 6.5 Stage 5: Billing (Ambient Scrubbing)
1.  **Input:** Grimm wakes up (Triggered by Checkout).
2.  **AI:** Scans `Claims` queue. Notices `99214` + `20610` (Joint Injection) billed together.
3.  **Action:** "Modifier 25 Required." Grimm appends the modifier, updates status to `SUBMITTED`, and logs the revenue saved.

---

# 7.0 GOVERNANCE & SECURITY

## 7.1 DAIM: Department of AI in Medicine
The DAIM module acts as the "Internal Affairs" for the AI.
* **Audit Logging:** Every prompt sent to Google Gemini and every response received is hashed and logged in `analytical.db`.
* **Hallucination Checks:** A secondary AI pass (The "Auditor") can optionally review generated notes for clinical accuracy before the physician signs.

## 7.2 Audit Trails
Every database change carries a lineage:
* Who spoke? (Transcript)
* What did the AI hear? (Intent)
* What did the DB change? (SQL Update)
This creates a forensic trail for every medical decision.
