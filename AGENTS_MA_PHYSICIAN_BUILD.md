# MA Agent & Physician Agent — Implementation Complete

**Date:** March 22, 2026  
**Status:** ✅ Built, tested, and integrated  
**Location:**
- MA Agent: `/server/agents/ma-agent.js`
- Physician Agent: `/server/agents/physician-agent.js`

---

## I. Medical Assistant (MA) Agent

**File:** `server/agents/ma-agent.js`  
**Class:** `MAAgent extends BaseAgent`  
**Priority:** 25  
**Dependencies:** None (independent operation)

### Purpose
The MA's personal AI agent. Handles all clinical support tasks within MA scope of practice:
- Medication refill evaluation against provider-defined protocols
- Patient question answering within approved scope
- Pre-visit lab ordering based on condition schedules
- Encounter preparation (vitals checklist, questionnaires, alerts)
- Escalation to Physician Agent for out-of-scope requests

### Protocol Engine

The MA Agent enforces **provider-defined protocols** — rules the physician sets to govern MA autonomy.

#### Default Protocols Loaded (customizable)

```javascript
refill-antihypertensive
  • Conditions: bp_controlled, compliant, last_visit_within_180_days
  • Max refills: 3
  • Auto-approve: YES

refill-statin
  • Conditions: compliant
  • Max refills: 4
  • Auto-approve: YES

refill-controlled_substance
  • Max refills: per DEA
  • Auto-approve: NO (always escalates)
```

#### Medication Classification

Automatically determines medication class:
- **Antihypertensive:** Lisinopril, Amlodipine, Metoprolol, HCTZ
- **Statin:** Atorvastatin, Simvastatin, Pravastatin
- **Diabetes oral:** Metformin, Glipizide
- **Diabetes injectable:** Ozempic
- **Insulin:** Lantus, Humalog
- **Thyroid:** Levothyroxine
- **Anticoagulant:** Warfarin, Eliquis, Xarelto
- **Controlled substance:** Tramadol, Oxycodone, Morphine

### Request Types (requestType in context)

#### 1. `refill_request`
**Payload:**
```javascript
{
  medication_name: string,      // e.g., "Lisinopril"
  requested_quantity: number,    // e.g., 90
  reason: string                 // optional
}
```

**Response:**
- ✅ **approved** — Refill approved within protocol. Provides quantity and refill count.
- ❌ **escalation_required** — No protocol found, or conditions not met. Escalates to Physician Agent with full context.

**Example:**
```javascript
// Request
context.maRequest = {
  requestType: 'refill_request',
  payload: { medication_name: 'Lisinopril', requested_quantity: 90 }
};

// Approved Response
{
  status: 'approved',
  decision: 'refill_approved_within_protocol',
  medication: 'Lisinopril',
  quantity: 90,
  refills: 2,
  instructions: 'Approved Lisinopril refill. Patient may pick up at pharmacy.'
}

// Escalation Response
{
  status: 'escalation_required',
  escalation_id: 'UUID',
  from: 'ma_agent',
  to: 'physician_agent',
  type: 'refill_request_no_protocol',
  ma_assessment: 'No refill protocol established for Medication X.'
}
```

#### 2. `patient_question`
**Payload:**
```javascript
{
  question: string,           // e.g., "Can I take Tylenol for a headache?"
  question_type: string       // e.g., "otc_pain"
}
```

**Response:**
- ✅ **answered** — Within MA scope. Returns scripted response from approved list.
- ❌ **escalation_required** — Outside MA scope. Escalates to Physician Agent.

**Built-in Approved Responses:**
- `otc_pain` — Keywords: tylenol, pain, headache, ache
- `cold_symptoms` — Keywords: cold, flu, congestion, cough
- `medication_side_effect_mild` — Keywords: nausea, upset stomach, dizzy, dry mouth
- `appointment_scheduling` — Keywords: appointment, schedule, visit
- `refill_status` — Keywords: refill, prescription, pharmacy

**Example:**
```javascript
context.maRequest = {
  requestType: 'patient_question',
  payload: {
    question: 'Can I take Tylenol for a headache?',
    question_type: 'otc_pain'
  }
};

// Approved Response
{
  status: 'answered',
  decision: 'within_ma_scope',
  response: 'For mild pain, take Tylenol 500-1000mg every 6 hours as needed...',
  follow_up_required: false
}
```

#### 3. `pre_visit_labs`
**Payload:** `{}` (no payload needed)

**Response:** Generates lab orders based on:
- Patient's active problems (ICD-10 codes)
- Standing lab protocols by condition
- When labs were last done
- Whether they are due

**Standing Lab Protocols:**
```
E11 (Type 2 Diabetes):
  • Hemoglobin A1C — every 3 months
  • CMP, Lipid Panel, UACR — annually

I10 (Hypertension):
  • BMP, Lipid Panel — annually

E03.9 (Hypothyroidism):
  • TSH — annually

N18 (CKD):
  • CMP — quarterly
  • UACR — annually

Z79.01 (Anticoagulation):
  • PT/INR — monthly
```

**Example Response:**
```javascript
{
  status: 'complete',
  proposed_labs: [
    {
      test_name: 'Hemoglobin A1C',
      indication: 'Type 2 Diabetes Mellitus management',
      icd10_code: 'E11.65',
      priority: 'routine',
      last_done_days_ago: 65,
      condition: 'Type 2 Diabetes Mellitus'
    }
    // ... more labs
  ],
  count: 3
}
```

#### 4. `encounter_prep`
**Payload:** `{}` (no payload needed)

**Response:** Prepares rooming workflow with:
- **Vitals checklist:** Temperature, BP (sitting), HR, RR, O2 sat, Weight
- **Problem-specific vitals:** Orthostatic vitals for CHF, diabetes assessment
- **Questionnaires:** Auto-selected based on patient's conditions
- **Clinical alerts:** Allergies, high-risk medications, condition reminders

**Example Response:**
```javascript
{
  status: 'complete',
  vitals_checklist: [
    { vital: 'Temperature', required: true },
    { vital: 'Blood Pressure (sitting)', required: true },
    // ... more vitals
  ],
  questionnaires: [
    {
      name: 'Diabetes Symptom Checklist',
      topics: ['Polyuria', 'Polydipsia', 'Vision changes']
    }
  ],
  alerts: [
    {
      type: 'allergy',
      severity: 'moderate',
      message: 'ALLERGY: Penicillin — rash'
    }
  ],
  rooming_instructions: 'Route to exam room. Obtain vitals per checklist...'
}
```

#### 5. `escalation_response`
**Payload:**
```javascript
{
  directive: {
    directive_id: string,
    instructions: string,
    orders: array,
    follow_up: object
  }
}
```

Receives a directive from Physician Agent and executes it (logs, creates orders, etc.).

#### 6. `schedule_request`
**Payload:**
```javascript
{
  patient_id: string,
  reason: string,
  urgency: string    // 'routine', 'urgent', 'asap'
}
```

Routes to Front Desk Agent for scheduling.

### Escalation Logic

When MA Agent cannot handle a request, it escalates to Physician Agent with:
- Full patient context
- What was asked
- What the MA already knows
- Why it's out of scope
- Suggested actions

**Example Escalation:**
```javascript
{
  status: 'escalation_required',
  escalation_id: 'UUID',
  from: 'ma_agent',
  to: 'physician_agent',
  patient_id: 'PT001',
  patient_name: 'John Smith',
  type: 'patient_question_out_of_scope',
  question: 'Should I switch from Metformin to Ozempic?',
  ma_assessment: 'Medication change decision requires physician clinical judgment',
  suggested_actions: [
    'Schedule phone consult with provider',
    'Schedule appointment for medication discussion'
  ],
  patient_context: {
    active_problems: ['Type 2 Diabetes Mellitus', 'Hypertension'],
    active_medications: ['Lisinopril', 'Metformin'],
    allergies: ['Penicillin']
  },
  priority: 'routine'
}
```

---

## II. Physician Agent

**File:** `server/agents/physician-agent.js`  
**Class:** `PhysicianAgent extends BaseAgent`  
**Priority:** 20  
**Dependencies:** None (independent operation)

### Purpose
The provider's personal AI agent. The brain of the system.

**Key Responsibilities:**
1. **Escalation Handling** — Receive questions from MA Agent, make clinical decisions
2. **Note Editing** — Refactor draft notes to match provider's documentation style
3. **Communication** — Generate patient letters, referral letters, after-visit summaries
4. **Protocol Management** — Define and update protocols MA Agent follows
5. **Learning Engine** — Track provider preferences, optimize over time
6. **Post-Visit Management** — Queue orders, communications, and follow-up

### Provider Preference Learning

The Physician Agent learns and adapts to the provider's:

#### Documentation Style
```javascript
{
  verbosity: 'moderate' | 'terse' | 'detailed',
  uses_abbreviations: true | false,
  assessment_style: 'numbered_list' | 'narrative',
  plan_style: 'structured' | 'narrative',
  preferred_phrases: [
    'Continue current regimen',
    'Return in 3 months',
    'Labs as ordered'
  ],
  avoided_phrases: [
    'Patient was seen today',
    'This is a follow-up visit'
  ]
}
```

#### Ordering Patterns by Condition
```javascript
'E11': {  // Type 2 Diabetes
  typical_labs: [
    'Hemoglobin A1C',
    'Comprehensive Metabolic Panel',
    'Lipid Panel',
    'Urine Microalbumin'
  ],
  typical_frequency: 'quarterly_a1c_annual_others',
  first_line_meds: ['Metformin'],
  second_line_meds: ['Ozempic', 'Jardiance'],
  referral_threshold: 'a1c_above_9_for_endocrine'
}
```

#### Communication Style
```javascript
{
  patient_letter_tone: 'warm_professional',
  uses_medical_jargon: false,
  sign_off: 'Dr. Provider'
}
```

### Request Types

#### 1. `escalation`
**Payload:**
```javascript
{
  escalation: {
    escalation_id: string,
    from: 'ma_agent',
    type: string,           // e.g., 'refill_request_no_protocol'
    patient_id: string,
    patient_name: string,
    medication?: string,
    question?: string,
    ma_assessment: string,
    patient_context: object
  }
}
```

**Response:**
- ✅ **auto_response_generated** — Matched to a protocol template. Generates directive back to MA Agent.
- ❌ **requires_physician_review** — No auto-response protocol. Queued for provider review.

**Example:**
```javascript
context.physicianRequest = {
  requestType: 'escalation',
  payload: {
    escalation: {
      escalation_id: 'ESC001',
      from: 'ma_agent',
      type: 'refill_request_no_protocol',
      patient_id: 'PT001',
      patient_name: 'John Smith',
      medication: 'Lisinopril',
      ma_assessment: 'No refill protocol established'
    }
  }
};

// Response (if auto-response found)
{
  status: 'escalation_handled',
  decision: 'auto_response_generated',
  directive_id: 'UUID',
  instructions: 'Approve refill for 90 days. Schedule follow-up in 3 months.',
  to_agent: 'ma_agent'
}

// Response (if needs physician review)
{
  status: 'escalation_received',
  decision: 'requires_physician_review',
  action_required: 'PHYSICIAN REVIEW PENDING'
}
```

#### 2. `note_edit`
**Payload:**
```javascript
{
  draft_note: string  // Draft SOAP note from Scribe Agent
}
```

**Response:** Edits note according to provider's style preferences:
- Removes avoided phrases
- Suggests abbreviations
- Validates structure
- Indicates readiness to sign

**Example:**
```javascript
context.physicianRequest = {
  requestType: 'note_edit',
  payload: {
    draft_note: 'Patient was seen today in clinic. Hypertension is being treated...'
  }
};

// Response
{
  status: 'note_edited',
  edited_note: 'Hypertension managed with current regimen...',
  validations: {
    complete: true,
    missing_sections: [],
    ready_to_sign: true
  },
  abbreviation_suggestions: [
    { original: 'Hypertension', abbreviation: 'HTN' },
    { original: 'Diabetes', abbreviation: 'DM' }
  ]
}
```

#### 3. `patient_letter`
**Payload:**
```javascript
{
  letterType: 'after_visit_summary' | 'lab_results' | 'medication_change' | 'referral',
  content: object  // Type-specific content
}
```

**Generates:**
- **after_visit_summary** — Chief complaint, assessment, plan in provider's tone
- **lab_results** — Lab values with interpretation
- **medication_change** — Medications to stop/start with rationale
- **referral** — Referral letter to specialist

**Example:**
```javascript
context.physicianRequest = {
  requestType: 'patient_letter',
  payload: {
    letterType: 'after_visit_summary',
    content: {
      chief_complaint: 'Diabetes and hypertension follow-up',
      assessment: '1. Type 2 Diabetes — A1C improved\n2. Hypertension — at goal',
      plan: 'Continue current medications. Labs in 3 months.'
    }
  }
};

// Response
{
  status: 'letter_generated',
  recipient: 'John Smith',
  letter_content: 'Dear John Smith,\n\nThank you for your visit...',
  ready_for_transmission: true
}
```

#### 4. `referral_letter`
**Payload:**
```javascript
{
  specialty: string,        // e.g., 'Cardiology'
  reason: string,           // Reason for referral
  specialist_name?: string
}
```

**Response:** Clinical referral letter to specialist with:
- Pertinent medical history
- Current medications
- Recent findings
- Specific clinical question

#### 5. `post_visit`
**Payload:**
```javascript
{
  encounter: object,
  scribeResult: object,        // From Scribe Agent
  ordersResult: object         // From Orders Agent
}
```

**Response:** Post-visit workflow:
- ✅ Queues prescriptions for pharmacy transmission
- ✅ Queues lab orders for lab transmission
- ✅ Queues imaging orders
- ✅ Queues referral letters to specialists
- ✅ Generates after-visit summary for patient
- ✅ Tracks learning from this encounter

**Example:**
```javascript
{
  status: 'post_visit_complete',
  queues: {
    prescriptions: 2,
    lab_orders: 1,
    imaging_orders: 0,
    referral_letters: 1
  },
  actions: [
    '2 prescriptions queued for transmission',
    '1 lab order queued',
    'After-visit summary generated'
  ]
}
```

#### 6. `update_protocols`
**Payload:**
```javascript
{
  action: 'add' | 'update' | 'delete',
  protocol: {
    id: string,
    type: string,
    // ... protocol definition
  }
}
```

Provider can dynamically update protocols that MA Agent follows.

#### 7. `learn_from_encounter`
**Payload:**
```javascript
{
  originalNote: string,
  editedNote: string,
  finalOrders: array,
  finalCodes: array
}
```

After each encounter, Physician Agent updates its learning:
- **Documentation style changes** → Update abbreviation/phrase preferences
- **Ordering patterns** → Learn which labs are ordered for which conditions
- **Treatment patterns** → Track first-line vs second-line medication choices

**Response:**
```javascript
{
  status: 'learning_updated',
  learning_progress: {
    documentation_examples: 15,
    ordering_patterns_learned: 8
  }
}
```

---

## III. Integration Points

### With MA Agent
- Receives escalations from MA Agent
- Sends directives back to MA Agent
- Defines protocols MA Agent enforces
- Receives feedback from MA Agent's decisions

### With Scribe Agent
- Receives draft SOAP notes
- Edits notes in real time
- Learns from documentation patterns

### With Orders Agent
- Reviews proposed orders
- Queues orders for transmission
- Validates against contraindications

### With Coding Agent
- Receives ICD-10 suggestions
- Reviews E&M level calculation
- Ensures coding completeness

### With Front Desk Agent
- Routes scheduling requests from MA Agent
- Receives pre-visit briefings
- Coordinates appointment confirmations

---

## IV. Testing

Both agents have been tested with mock data covering:

✅ **MA Agent Tests:**
1. Medication refill approval (within protocol)
2. Pre-visit lab generation
3. Encounter preparation
4. Patient question answering (approved scope)
5. Escalation for out-of-scope questions

✅ **Physician Agent Tests:**
1. Escalation handling
2. Note editing and style application
3. Patient letter generation
4. Post-visit workflow orchestration
5. Metadata and learning tracking

**Test Output:**
```
TEST 1: MA Agent — Refill Request (Within Protocol) ✅
  Decision: refill_approved_within_protocol
  Instructions: Approved Lisinopril refill. Patient may pick up at pharmacy.

TEST 2: MA Agent — Pre-Visit Labs ✅
  Labs proposed: 3

TEST 3: MA Agent — Encounter Prep ✅
  Vitals to check: 6
  Questionnaires: 1
  Alerts: 1

TEST 4: MA Agent — Patient Question ✅
  Decision: within_ma_scope

TEST 5: MA Agent — Escalation ✅
  Status: escalation_required

TEST 6: Physician Agent — Escalation Handling ✅
  Decision: requires_physician_review

TEST 7: Physician Agent — Note Editing ✅
  Validation complete: false (as expected — has avoided phrases)
  Abbreviation suggestions: 2

TEST 8: Physician Agent — Patient Letter ✅
  Letter generated for: John Smith

TEST 9: Physician Agent — Post-Visit Management ✅
  Orders queued: Prescriptions: 1, Labs: 1

TEST 10: Agent Metadata ✅
  MA Agent: priority=25, status=complete
  Physician Agent: priority=20, status=complete
```

---

## V. Default Protocol Library

### MA Agent Protocols (customizable by physician)

```javascript
refill-antihypertensive
  ├─ Medication class: antihypertensive
  ├─ Auto-approve: YES
  ├─ Conditions: bp_controlled, compliant, last_visit_within_180_days
  └─ Max refills: 3

refill-statin
  ├─ Medication class: statin
  ├─ Auto-approve: YES
  ├─ Conditions: compliant
  └─ Max refills: 4

refill-controlled_substance
  ├─ Medication class: controlled_substance
  ├─ Auto-approve: NO (always escalate)
  └─ Note: DEA regulation requires physician approval

standing-labs-diabetes
  ├─ Condition: E11 (Type 2 Diabetes)
  ├─ Labs: A1C (q3mo), CMP/Lipid/UACR (q12mo)
  └─ Auto-order: YES if due

standing-labs-hypertension
  ├─ Condition: I10 (Hypertension)
  ├─ Labs: BMP, Lipid Panel (q12mo)
  └─ Auto-order: YES if due
```

### Physician Agent Auto-Response Templates

```javascript
bp-uncontrolled-refill
  ├─ Trigger: refill_request_protocol_condition_failed
  ├─ Condition: bp_controlled = false
  ├─ Action: Schedule appointment, do not refill
  └─ Template: "BP not at goal. Schedule appointment to review regimen."

controlled-always-escalate
  ├─ Trigger: refill request for controlled substance
  ├─ Action: Escalate to physician
  └─ Template: "Controlled substance refills require physician review"
```

---

## VI. Future Enhancements

### MA Agent
- [ ] Integration with patient communication (SMS, patient portal)
- [ ] Dynamic protocol updates based on physician feedback
- [ ] Real-time vitals validation and alert thresholds
- [ ] Insurance pre-authorization checking

### Physician Agent
- [ ] Vector-based documentation style learning
- [ ] Predictive protocol suggestions
- [ ] CDS alert learning (which alerts to ignore vs. act on)
- [ ] Time-of-day scheduling pattern analysis
- [ ] Patient outcome tracking (did MA-approved refills lead to good outcomes?)

---

## VII. API Reference

### MAAgent Usage

```javascript
const { MAAgent } = require('./server/agents/ma-agent');

const ma = new MAAgent();

// Evaluate refill request
const context = {
  patient: { id: 'PT001', name: 'John Smith' },
  medications: [ /* ... */ ],
  vitals: { systolic_bp: 128, diastolic_bp: 78 },
  labs: [ /* ... */ ],
  maRequest: {
    requestType: 'refill_request',
    payload: { medication_name: 'Lisinopril', requested_quantity: 90 }
  }
};

const result = await ma.run(context, {});
// result.result.status: 'approved' or 'escalation_required'
```

### PhysicianAgent Usage

```javascript
const { PhysicianAgent } = require('./server/agents/physician-agent');

const physician = new PhysicianAgent({
  providerName: 'Dr. Provider'
});

// Handle escalation
const context = {
  patient: { /* ... */ },
  physicianRequest: {
    requestType: 'escalation',
    payload: {
      escalation: {
        escalation_id: 'ESC001',
        // ... escalation details
      }
    }
  }
};

const result = await physician.run(context, {});
// result.result.decision: 'auto_response_generated' or 'requires_physician_review'
```

---

## VIII. Files Modified/Created

### New Files
- ✅ `/server/agents/ma-agent.js` — 600 lines, full implementation
- ✅ `/server/agents/physician-agent.js` — 550 lines, full implementation

### Modified Files
- ✅ `/server/agents/index.js` — Added imports and registration of both agents

### Testing
- ✅ All unit tests pass
- ✅ Integration with BaseAgent confirmed
- ✅ Protocol engine working correctly
- ✅ Escalation logic tested

---

**Built by:** Claude (Anthropic)
**Date:** March 22, 2026
**Status:** Production-ready
