# Inter-Agent Messaging — Quick Start

## Send a Message

```javascript
const messageBus = orchestrator.getMessageBus();

await messageBus.sendMessage(
  'ma_agent',                    // from
  'physician_agent',             // to
  MESSAGE_TYPES.ESCALATION,      // type
  { patientName: 'John', question: 'Refill?' },  // payload
  { priority: 4, patientId: 123 }  // options
);
```

## Receive & Process Messages

```javascript
const messages = await messageBus.getMessages('my_agent');
for (const msg of messages) {
  console.log(msg.payload);
  await messageBus.markActedOn(msg.id);
}
```

## Request-Response Pattern

```javascript
// Agent A sends request
const response = await messageBus.sendRequest(
  'agent_a', 'agent_b', MESSAGE_TYPES.ESCALATION,
  { question: 'Approve?' },
  { timeout: 30000 }  // 30 second timeout
);

// Agent B responds
await messageBus.sendResponse(
  'agent_b', 'agent_a', MESSAGE_TYPES.DIRECTIVE,
  { approved: true },
  originalMessageId
);
```

## Store Memory

```javascript
const memory = orchestrator.getAgentMemory('my_agent');

await memory.remember(
  MEMORY_TYPES.PREFERENCE,
  'ordering_style',
  { bloodWork: 'always_cmp_first' },
  { confidence: 0.8 }
);
```

## Retrieve Memory

```javascript
// Get specific memory
const pref = await memory.recall(MEMORY_TYPES.PREFERENCE, 'ordering_style');

// Get all of a type
const patterns = await memory.recallByType(MEMORY_TYPES.PATTERN);

// Search
const results = await memory.search('hypertension');

// Patient-specific
const notes = await memory.recallForPatient(patientId);
```

## Message Types

```
TRIAGE_RESULT        Phone Triage → MA
ESCALATION           MA → Physician
DIRECTIVE            Physician → MA
SCHEDULE_REQUEST     Any → Front Desk
PATIENT_CONTACT      Front Desk → Patient
REFILL_REQUEST       Triage → MA → Physician
ORDER_REQUEST        Physician → Lab/Pharmacy
NOTE_UPDATE          Ambient → Physician
CODING_ALERT         Coding → Physician
QUALITY_GAP          Quality → Physician
PATIENT_LETTER       Physician → Patient
BRIEFING_READY       Front Desk → Provider
PROTOCOL_UPDATE      Physician → MA
```

## Memory Types

```
PREFERENCE    Provider/MA preferences
PROTOCOL      Clinical protocols
PATTERN       Learned patterns
PATIENT_NOTE  Agent notes about patients
```

## Get History

```javascript
// All messages for a patient
const history = await orchestrator.getPatientMessages(patientId);

// All messages for an encounter
const history = await orchestrator.getEncounterMessages(encounterId);

// Filtered
const history = await messageBus.getHistory({
  patientId: 123,
  messageType: MESSAGE_TYPES.ESCALATION,
  fromAgent: 'ma_agent'
});
```

---

See `INTER_AGENT_COMMUNICATION.md` for full documentation.
