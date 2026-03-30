# Inter-Agent Communication & Persistent Memory System

## Overview

This document describes the inter-agent message bus and persistent memory system for the Agentic EHR 9-module runtime.

**Status:** ✅ Production-ready (all tests pass)

**Files:**
- `/server/agents/message-bus.js` - Event-driven message bus with SQLite persistence
- `/server/agents/agent-memory.js` - Persistent memory system for agents
- `/server/agents/base-agent.js` - Updated with message bus and memory helpers
- `/server/agents/orchestrator.js` - Updated to initialize and manage messaging/memory
- `/server/database.js` - Updated with `agent_messages` and `agent_memory` tables
- `/server/agents/test-message-bus-memory.js` - Comprehensive integration tests

---

## Message Bus

### Purpose

The **MessageBus** enables agents to communicate with each other without direct coupling. All inter-agent communication is:
- **Typed** (13 defined message types from the vision doc)
- **Persistent** (audit trail in SQLite)
- **Priority-ordered** (1-5, higher priority first)
- **Event-driven** (for WebSocket/real-time forwarding)

### Message Types

All message types defined in Section VI of Agentic EHR-VISION.md:

```javascript
TRIAGE_RESULT     // Phone Triage → MA Agent
ESCALATION        // MA Agent → Physician Agent
DIRECTIVE         // Physician Agent → MA Agent
SCHEDULE_REQUEST  // Any → Front Desk Agent
PATIENT_CONTACT   // Front Desk Agent → Patient
REFILL_REQUEST    // Phone Triage → MA Agent → Physician Agent
ORDER_REQUEST     // Physician Agent → Lab/Pharmacy/Imaging
NOTE_UPDATE       // Scribe Agent -> Physician Agent
CODING_ALERT      // Coding Agent → Physician Agent
QUALITY_GAP       // Quality Agent → Physician Agent
PATIENT_LETTER    // Physician Agent → Patient
BRIEFING_READY    // Front Desk Agent → Provider
PROTOCOL_UPDATE   // Physician Agent → MA Agent
```

### Usage

#### Basic Point-to-Point Messaging

```javascript
const messageBus = orchestrator.getMessageBus();

// MA Agent sends message to Physician Agent
const msg = await messageBus.sendMessage(
  'ma',                            // from
  'physician',                     // to
  MESSAGE_TYPES.ESCALATION,        // type
  {
    patientName: 'John Doe',
    question: 'Can I refill Lisinopril?',
    dosage: '20mg'
  },
  {
    priority: 4,                   // 1-5, higher=urgent
    patientId: 123,
    encounterId: 456
  }
);

console.log(msg.id);  // "msg_1774209821351_13j07p7mo"
```

#### Broadcast Messaging

Send a message to all agents (e.g., "Pre-visit briefing ready"):

```javascript
await messageBus.sendMessage(
  'front_desk',
  'broadcast',                     // Special recipient for broadcast
  MESSAGE_TYPES.BRIEFING_READY,
  { briefingUrl: '/briefing/456' },
  { priority: 5 }
);
```

#### Retrieving Messages

```javascript
// Get all messages for an agent
const messages = await messageBus.getMessages('physician');

// Get only pending messages
const pending = await messageBus.getMessages('physician', {
  status: 'pending'
});

// Get messages from specific sender
const fromMA = await messageBus.getMessages('physician', {
  fromAgent: 'ma'
});

// Apply limit
const recent = await messageBus.getMessages('physician', {
  limit: 10
});
```

#### Message Status Tracking

```javascript
// Physician Agent reads a message
await messageBus.markRead(messageId);

// Physician Agent acts on a message
await messageBus.markActedOn(messageId);

// Check message status
const msg = await messageBus.getHistory({ limit: 1 });
// msg.status: 'pending' | 'delivered' | 'read' | 'acted_on'
```

#### Request-Response Pattern

```javascript
// MA Agent sends a request and waits for response (with timeout)
try {
  const response = await messageBus.sendRequest(
  'ma',                          // from
  'physician',                   // to
    MESSAGE_TYPES.ESCALATION,      // request type
    { question: 'Refill authorization?' },
    { timeout: 30000 }             // wait up to 30 seconds
  );

  console.log('Got response:', response.payload);
} catch (err) {
  console.error('Request timed out:', err.message);
}
```

```javascript
// Physician Agent responds to the request
await messageBus.sendResponse(
  'physician',                     // from
  'ma',                            // to
  MESSAGE_TYPES.DIRECTIVE,         // response type
  { decision: 'Approved', refills: 3 },
  requestMessageId                 // link to original request
);
```

#### Message History & Audit

```javascript
// Get all messages for a patient
const patientHistory = await messageBus.getHistory({
  patientId: 123
});

// Get messages for an encounter
const encounterHistory = await messageBus.getHistory({
  encounterId: 456
});

// Get specific message type
const escalations = await messageBus.getHistory({
  messageType: MESSAGE_TYPES.ESCALATION
});

// Combined filters
const history = await messageBus.getHistory({
  patientId: 123,
  fromAgent: 'ma',
  toAgent: 'physician',
  messageType: MESSAGE_TYPES.REFILL_REQUEST,
  limit: 50
});
```

#### Queue Status

```javascript
const status = messageBus.getQueueStatus();
// {
//   totalMessages: 15,
//   pendingMessages: 3,
//   avgPriority: "3.4"
// }
```

#### Clear Queue

After pipeline completes:

```javascript
orchestrator.clearMessageQueue();
```

---

## Agent Memory

### Purpose

The **AgentMemory** system enables agents to persist and learn from experience over time. Each agent has its own memory namespace with four types:

### Memory Types

```javascript
PREFERENCE   // Provider/MA preferences (documentation style, ordering patterns)
PROTOCOL     // Clinical protocols set by physician (refill rules, escalation triggers)
PATTERN      // Learned patterns (common orders for conditions, communication style)
PATIENT_NOTE // Agent-specific notes about patients (frequent caller, prefers phone)
```

### Usage

#### Store a Memory

```javascript
const memory = orchestrator.getAgentMemory('physician');

const pref = await memory.remember(
  MEMORY_TYPES.PREFERENCE,         // type
  'ordering_style',                // key (unique per agent+type+key)
  {
    bloodWork: 'always_cmp_first',
    imaging: 'prefer_xray_before_ct'
  },
  {
    confidence: 0.8,               // 0-1 (optional, default 0.3)
    patientId: 123                 // optional, for patient-specific notes
  }
);

console.log(pref.id);              // database ID
console.log(pref.confidence);      // 0.8
console.log(pref.access_count);    // 1
```

#### Retrieve a Memory

```javascript
const pref = await memory.recall(
  MEMORY_TYPES.PREFERENCE,
  'ordering_style'
);

if (pref) {
  console.log(pref.value);         // { bloodWork: ..., imaging: ... }
  console.log(pref.confidence);    // 0.8 (or higher if accessed multiple times)
  console.log(pref.access_count);  // incremented each time recalled
}
```

#### Get All Memories of a Type

```javascript
// Get all preferences with confidence >= 0.5
const patterns = await memory.recallByType(
  MEMORY_TYPES.PATTERN,
  {
    minConfidence: 0.5,
    limit: 50
  }
);

// Returns array of memory objects sorted by confidence desc
```

#### Search Memories

```javascript
// Search by key or value
const results = await memory.search('hypertension', {
  memoryType: MEMORY_TYPES.PATTERN,  // optional filter
  limit: 20
});

// Supports wildcards: search('*refill*')
```

#### Get Patient-Specific Memories

```javascript
// Get all memories this agent has about a specific patient
const patientMemories = await memory.recallForPatient(123, {
  limit: 50
});
```

#### Forget a Memory

```javascript
// Delete a specific memory
const deleted = await memory.forget(
  MEMORY_TYPES.PREFERENCE,
  'ordering_style'
);

// Delete all memories of a type
const deletedCount = await memory.forgetByType(MEMORY_TYPES.PATTERN);
```

#### Confidence Scoring

Confidence increases with repeated access (up to 1.0):

```javascript
// First time: confidence = 0.3
await memory.remember(MEMORY_TYPES.PROTOCOL, 'key1', value);

// Second time accessed: confidence increases to 0.4
await memory.recall(MEMORY_TYPES.PROTOCOL, 'key1');

// Third time: confidence = 0.5
await memory.recall(MEMORY_TYPES.PROTOCOL, 'key1');

// Maximum: 1.0
```

#### Export/Import (Backup)

```javascript
// Export all memories for an agent
const backup = await memory.export();
// Returns array of all memory objects

// Export specific type only
const protocolBackup = await memory.export(MEMORY_TYPES.PROTOCOL);

// Import memories from another agent
const imported = await memory.import(backup);
console.log(imported);  // Number of memories imported
```

#### Memory Statistics

```javascript
const stats = await memory.getStats();
// {
//   totalMemories: 25,
//   byType: [
//     { memory_type: 'PREFERENCE', count: 5, avg_confidence: 0.75 },
//     { memory_type: 'PATTERN', count: 10, avg_confidence: 0.62 }
//   ],
//   highConfidenceCount: 12,  // >= 0.8
//   agentName: 'physician'
// }
```

---

## BaseAgent Integration

All agents automatically have message bus and memory helpers:

```javascript
class MyAgent extends BaseAgent {
  async process(context, agentResults) {
    // Send a message
    await this.sendMessage('other_agent', MESSAGE_TYPES.ESCALATION, { data: 'test' });

    // Get messages addressed to this agent
    const msgs = await this.getMessages({ status: 'pending' });

    // Send a request and wait for response
    const response = await this.sendRequest('other_agent', MESSAGE_TYPES.ESCALATION, payload);

    // Store a memory
    await this.remember(MEMORY_TYPES.PATTERN, 'key', value, { confidence: 0.8 });

    // Retrieve a memory
    const memory = await this.recall(MEMORY_TYPES.PREFERENCE, 'ordering_style');

    // Search memories
    const results = await this.searchMemory('hypertension');

    // Get patient memories
    const patientMems = await this.recallPatientMemories(patientId);

    return { agent: this.name, status: 'success' };
  }
}
```

---

## Orchestrator Integration

### Initialize

The **AgentOrchestrator** automatically initializes message bus and memory when agents are registered:

```javascript
const orchestrator = new AgentOrchestrator(dbHelpers);

// Register agents (they automatically get messageBus and memory injected)
orchestrator.register(new PhoneTriageAgent(...));
orchestrator.register(new MAAgent(...));
orchestrator.register(new PhysicianAgent(...));
```

### Access Message Bus

```javascript
const messageBus = orchestrator.getMessageBus();

// Get messages for an encounter
const encounterMessages = await orchestrator.getEncounterMessages(encounterId);

// Get messages for a patient
const patientMessages = await orchestrator.getPatientMessages(patientId);

// Get queue status
const status = orchestrator.getMessageQueueStatus();
```

### Access Memory

```javascript
// Get memory instance for a specific agent
const memory = orchestrator.getAgentMemory('physician');

// Get stats for all agents
const allStats = await orchestrator.getAllAgentMemoryStats();

// Export all memories for backup
const allMemories = await orchestrator.exportAllMemories();

// Import memories from backup
await orchestrator.importAllMemories(allMemories);
```

### Listen to Events

```javascript
orchestrator.on('message:new', (msg) => {
  console.log(`New message from ${msg.from_agent} to ${msg.to_agent}`);
});

orchestrator.on('message:broadcast', (msg) => {
  console.log('Broadcast:', msg.message_type);
});

orchestrator.on('message:delivered', (data) => {
  console.log(`Message delivered: ${data.messageId}`);
});

orchestrator.on('message:acted_on', (data) => {
  console.log(`Message acted on: ${data.messageId}`);
});
```

---

## Database Schema

### agent_messages Table

```sql
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON string
  priority INTEGER DEFAULT 3 CHECK(priority >= 1 AND priority <= 5),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'read', 'acted_on')),
  patient_id INTEGER,
  encounter_id INTEGER,
  request_id TEXT,  -- For linking responses to requests
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  acted_on_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (encounter_id) REFERENCES encounters(id)
);

-- Indexes
CREATE INDEX idx_agent_messages_to_agent ON agent_messages(to_agent, status);
CREATE INDEX idx_agent_messages_from_agent ON agent_messages(from_agent, created_at);
CREATE INDEX idx_agent_messages_patient ON agent_messages(patient_id, created_at);
CREATE INDEX idx_agent_messages_encounter ON agent_messages(encounter_id, created_at);
CREATE INDEX idx_agent_messages_type ON agent_messages(message_type, created_at);
```

### agent_memory Table

```sql
CREATE TABLE agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK(memory_type IN ('PREFERENCE', 'PROTOCOL', 'PATTERN', 'PATIENT_NOTE')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,  -- JSON string
  confidence REAL DEFAULT 0.3 CHECK(confidence >= 0 AND confidence <= 1.0),
  access_count INTEGER DEFAULT 0,
  patient_id INTEGER,
  encounter_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (encounter_id) REFERENCES encounters(id),
  UNIQUE(agent_name, memory_type, key)
);

-- Indexes
CREATE INDEX idx_agent_memory_agent ON agent_memory(agent_name, memory_type);
CREATE INDEX idx_agent_memory_key ON agent_memory(agent_name, key);
CREATE INDEX idx_agent_memory_confidence ON agent_memory(agent_name, confidence DESC);
CREATE INDEX idx_agent_memory_patient ON agent_memory(agent_name, patient_id);
```

---

## Testing

Run the comprehensive test suite:

```bash
# From project root:
node test/test-message-bus-memory.js
```

Tests cover:
- ✅ Message bus basics (send, retrieve, mark delivered)
- ✅ Request-response pattern
- ✅ Message history and filtering
- ✅ Agent memory (store, recall, search)
- ✅ Memory statistics and confidence
- ✅ Orchestrator integration
- ✅ Memory export/import

---

## Real-World Example: Refill Request Flow

```javascript
// 1. Phone Triage Agent receives call
await messageBus.sendMessage(
  'phone_triage',
  'ma',
  MESSAGE_TYPES.TRIAGE_RESULT,
  {
    patientName: 'John Doe',
    complaint: 'Refill Lisinopril',
    dosage: '20mg daily'
  },
  { priority: 3, patientId: 123, encounterId: 456 }
);

// 2. MA Agent checks protocol (from memory)
const protocol = await memory.recall(
  MEMORY_TYPES.PROTOCOL,
  'hypertension_refill'
);

// 3. MA Agent escalates to Physician
const response = await messageBus.sendRequest(
  'ma',
  'physician',
  MESSAGE_TYPES.ESCALATION,
  {
    patientName: 'John Doe',
    question: 'Can I refill Lisinopril 20mg?',
    lastBP: '135/85',
    frequency: 'Once daily'
  },
  { timeout: 30000, patientId: 123, priority: 4 }
);

// 4. Physician Agent responds
await messageBus.sendResponse(
  'physician',
  'ma',
  MESSAGE_TYPES.DIRECTIVE,
  {
    decision: 'Approved',
    refills: 3,
    notes: 'Recheck BP at next visit'
  },
  response.id  // Link to original request
);

// 5. MA Agent creates prescription and logs to memory
await memory.remember(
  MEMORY_TYPES.PATTERN,
  'lisinopril_refills_approved',
  {
    count: 1,
    lastApproved: new Date().toISOString()
  },
  { patientId: 123, confidence: 0.6 }
);

// 6. Physician Agent sends patient letter
await messageBus.sendMessage(
  'physician',
  'broadcast',  // or 'patient_portal_agent'
  MESSAGE_TYPES.PATIENT_LETTER,
  {
    patientId: 123,
    subject: 'Prescription Refill Approved',
    body: 'Your blood pressure medication has been refilled...'
  }
);

// 7. Audit trail: retrieve all messages in this flow
const history = await messageBus.getHistory({
  patientId: 123,
  encounterId: 456
});
```

---

## Performance Considerations

- **Message Queue:** In-memory queue sorted by priority, cleared after pipeline completes
- **Database Indexes:** 9 indexes optimize common query patterns
- **Memory Cache:** Per-agent (1000 entry limit for in-memory cache if needed)
- **Confidence Decay:** Optional time-decay factor (0.98/day) to downweight old memories
- **SQLite:** Full-text search supported on payload and memory values

---

## Error Handling

```javascript
try {
  const response = await messageBus.sendRequest(
  'ma',
  'physician',
    MESSAGE_TYPES.ESCALATION,
    { question: 'Can I refill?' },
    { timeout: 30000 }
  );
} catch (err) {
  if (err.message.includes('timeout')) {
    console.error('Physician did not respond in time');
  } else {
    console.error('Request failed:', err.message);
  }
}
```

---

## Next Steps

1. **WebSocket Integration:** Forward `message:new` events to connected clients for real-time UI updates
2. **Message Signing:** Add HMAC signatures to messages for security auditing
3. **Retry Logic:** Add automatic retry with exponential backoff for failed message deliveries
4. **Message Compression:** Compress large payloads before storing
5. **Archive Strategy:** Move old messages (>30 days) to archive table for performance

---

## Files Modified

1. **`/server/agents/message-bus.js`** (NEW) - 280 lines
2. **`/server/agents/agent-memory.js`** (NEW) - 420 lines
3. **`/server/agents/base-agent.js`** - Added 8 message/memory helper methods
4. **`/server/agents/orchestrator.js`** - Added initialization, forwarding, and accessor methods
5. **`/server/database.js`** - Added 2 new tables, 9 indexes
6. **`/server/agents/test-message-bus-memory.js`** (NEW) - 500+ line integration test suite

---

**All tests pass. System is ready for integration with the 9-module clinical workflow.**
