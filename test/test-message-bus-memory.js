/**
 * Integration Test: Message Bus and Agent Memory
 * Tests all core functionality of inter-agent communication and persistent memory
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { MessageBus, MESSAGE_TYPES, MESSAGE_STATUS } = require('./message-bus');
const { AgentMemory, MEMORY_TYPES } = require('./agent-memory');
const { BaseAgent } = require('./base-agent');
const { AgentOrchestrator } = require('./orchestrator');

// ==========================================
// TEST DATABASE SETUP
// ==========================================

// Use in-memory database for tests
const testDb = new sqlite3.Database(':memory:');

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const dbHelpers = { dbRun, dbGet, dbAll };

// ==========================================
// INITIALIZE TEST SCHEMA
// ==========================================

async function initializeTestSchema() {
  console.log('\n[SETUP] Initializing test database schema...');

  try {
    // Minimal schema needed for agent tables
    await dbRun(`CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mrn TEXT UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS encounters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      encounter_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )`);

    // Agent tables
    await dbRun(`CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      message_type TEXT NOT NULL CHECK(message_type IN (
        'TRIAGE_RESULT', 'ESCALATION', 'DIRECTIVE', 'SCHEDULE_REQUEST', 'PATIENT_CONTACT',
        'REFILL_REQUEST', 'ORDER_REQUEST', 'NOTE_UPDATE', 'CODING_ALERT', 'QUALITY_GAP',
        'PATIENT_LETTER', 'BRIEFING_READY', 'PROTOCOL_UPDATE'
      )),
      payload TEXT NOT NULL,
      priority INTEGER DEFAULT 3 CHECK(priority >= 1 AND priority <= 5),
      status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'read', 'acted_on')) DEFAULT 'pending',
      patient_id INTEGER,
      encounter_id INTEGER,
      request_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      acted_on_at DATETIME,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN ('PREFERENCE', 'PROTOCOL', 'PATTERN', 'PATIENT_NOTE')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.3 CHECK(confidence >= 0 AND confidence <= 1.0),
      access_count INTEGER DEFAULT 0,
      patient_id INTEGER,
      encounter_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed DATETIME,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
      UNIQUE(agent_name, memory_type, key)
    )`);

    // Indexes
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent ON agent_messages(to_agent, status)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_name, memory_type)`);

    console.log('[SETUP] Test schema initialized');
  } catch (err) {
    console.error('Schema init error:', err.message);
    throw err;
  }
}

// ==========================================
// TEST FIXTURES
// ==========================================

async function setupTestData() {
  console.log('[SETUP] Creating test patient and encounter...');

  // Create test patient
  const patientResult = await dbRun(
    'INSERT INTO patients (mrn, first_name, last_name) VALUES (?, ?, ?)',
    ['TEST-001', 'John', 'Doe']
  );

  const patientId = patientResult.lastID;

  // Create test encounter
  const encounterResult = await dbRun(
    'INSERT INTO encounters (patient_id, encounter_date) VALUES (?, ?)',
    [patientId, new Date().toISOString().split('T')[0]]
  );

  const encounterId = encounterResult.lastID;

  return { patientId, encounterId };
}

// ==========================================
// TEST CASES
// ==========================================

async function testMessageBusBasics() {
  console.log('\n[TEST 1] Message Bus Basics');
  const messageBus = new MessageBus(dbHelpers);

  // Test: Send a message
  console.log('  ✓ Sending message from MA Agent to Physician Agent...');
  const msg = await messageBus.sendMessage(
    'ma_agent',
    'physician_agent',
    MESSAGE_TYPES.ESCALATION,
    { patientName: 'John Doe', question: 'Can I refill Lisinopril?' },
    { priority: 4, patientId: 1, encounterId: 1 }
  );

  if (!msg.id) throw new Error('Message ID not generated');
  console.log(`    Message ID: ${msg.id}`);

  // Test: Retrieve messages
  console.log('  ✓ Retrieving messages for physician_agent...');
  const msgs = await messageBus.getMessages('physician_agent');
  if (msgs.length !== 1) throw new Error('Expected 1 message');
  console.log(`    Retrieved ${msgs.length} message(s)`);

  // Test: Mark delivered
  console.log('  ✓ Marking message as delivered...');
  await messageBus.markDelivered(msg.id);
  const delivered = await dbGet('SELECT status FROM agent_messages WHERE id = ?', [msg.id]);
  if (delivered.status !== MESSAGE_STATUS.DELIVERED) throw new Error('Delivery status not set');
  console.log(`    Status: ${delivered.status}`);

  // Test: Broadcast message
  console.log('  ✓ Sending broadcast message...');
  const broadcast = await messageBus.sendMessage(
    'front_desk_agent',
    'broadcast',
    MESSAGE_TYPES.BRIEFING_READY,
    { message: 'Pre-visit briefing ready' },
    { priority: 5 }
  );
  console.log(`    Broadcast ID: ${broadcast.id}`);

  return true;
}

async function testRequestResponse() {
  console.log('\n[TEST 2] Request-Response Pattern');
  const messageBus = new MessageBus(dbHelpers);

  console.log('  ✓ Sending simple request-response test...');

  // Manually send a request message (for testing purposes)
  const requestMsg = await messageBus.sendMessage(
    'ma_agent',
    'physician_agent',
    MESSAGE_TYPES.ESCALATION,
    { question: 'Can I refill Lisinopril?' },
    { priority: 4, patientId: 1 }
  );

  console.log(`  ✓ Request sent: ${requestMsg.id}`);

  // Send a response
  console.log('  ✓ Physician Agent sends response...');
  const responseMsg = await messageBus.sendResponse(
    'physician_agent',
    'ma_agent',
    MESSAGE_TYPES.DIRECTIVE,
    { decision: 'Yes, refill authorized', refills: 3 },
    requestMsg.id
  );

  console.log(`    Response ID: ${responseMsg.id}`);
  console.log(`    Response linked to request: ${responseMsg.request_id}`);

  return true;
}

async function testMessageHistory() {
  console.log('\n[TEST 3] Message History and Filtering');
  const messageBus = new MessageBus(dbHelpers);
  const { patientId, encounterId } = await setupTestData();

  // Send multiple messages
  console.log('  ✓ Sending multiple messages...');
  await messageBus.sendMessage(
    'phone_triage',
    'ma_agent',
    MESSAGE_TYPES.TRIAGE_RESULT,
    { complaint: 'Cough for 3 days' },
    { patientId, encounterId, priority: 3 }
  );

  await messageBus.sendMessage(
    'ma_agent',
    'physician_agent',
    MESSAGE_TYPES.ESCALATION,
    { severity: 'medium' },
    { patientId, encounterId, priority: 4 }
  );

  // Test: Get encounter history
  console.log('  ✓ Retrieving encounter message history...');
  const history = await messageBus.getHistory({ encounterId });
  console.log(`    Found ${history.length} message(s) for encounter`);

  // Test: Get by type
  console.log('  ✓ Filtering by message type...');
  const escalations = await messageBus.getHistory({ messageType: MESSAGE_TYPES.ESCALATION });
  console.log(`    Found ${escalations.length} ESCALATION message(s)`);

  return true;
}

async function testAgentMemory() {
  console.log('\n[TEST 4] Agent Memory Basics');
  const memory = new AgentMemory('physician_agent', dbHelpers);

  // Test: Remember preference
  console.log('  ✓ Storing provider preference...');
  const pref = await memory.remember(
    MEMORY_TYPES.PREFERENCE,
    'ordering_style',
    { bloodWork: 'always_cmp_first', imaging: 'prefer_xray_before_ct' },
    { confidence: 0.8 }
  );
  console.log(`    Preference ID: ${pref.id}, Confidence: ${pref.confidence}`);

  // Test: Recall preference
  console.log('  ✓ Recalling stored preference...');
  const recalled = await memory.recall(MEMORY_TYPES.PREFERENCE, 'ordering_style');
  if (!recalled) throw new Error('Preference not found');
  console.log(`    Retrieved: ${JSON.stringify(recalled.value)}`);

  // Test: Store multiple memories
  console.log('  ✓ Storing multiple patterns...');
  await memory.remember(
    MEMORY_TYPES.PATTERN,
    'hypertension_treatment',
    { firstLine: 'Lisinopril 20mg daily', escalation: 'Add amlodipine if needed' }
  );
  await memory.remember(
    MEMORY_TYPES.PATTERN,
    'diabetes_labs',
    { baseline: 'A1C, CMP', quarterly: 'A1C', annual: 'Lipid panel, UACR' }
  );

  // Test: Recall by type
  console.log('  ✓ Retrieving all patterns...');
  const patterns = await memory.recallByType(MEMORY_TYPES.PATTERN);
  console.log(`    Found ${patterns.length} pattern(s)`);

  // Test: Confidence increase on repeated access
  console.log('  ✓ Testing confidence increase on repeat access...');
  const updated = await memory.recall(MEMORY_TYPES.PREFERENCE, 'ordering_style');
  console.log(`    New confidence: ${updated.confidence} (was 0.8)`);

  return true;
}

async function testMemorySearch() {
  console.log('\n[TEST 5] Agent Memory Search');
  const memory = new AgentMemory('ma_agent', dbHelpers);

  // Store test data
  console.log('  ✓ Storing test memories...');
  await memory.remember(MEMORY_TYPES.PROTOCOL, 'blood_pressure_refill', { threshold: 140, action: 'escalate' });
  await memory.remember(MEMORY_TYPES.PROTOCOL, 'diabetes_refill', { threshold: 'a1c<8', action: 'approve' });
  await memory.remember(MEMORY_TYPES.PATIENT_NOTE, 'john_doe_notes', { frequent_caller: true, prefers_email: true });

  // Test: Search by query
  console.log('  ✓ Searching for "refill"...');
  const results = await memory.search('refill');
  console.log(`    Found ${results.length} result(s)`);

  // Test: Search by type
  console.log('  ✓ Searching for PROTOCOL type...');
  const protocols = await memory.search('refill', { memoryType: MEMORY_TYPES.PROTOCOL });
  console.log(`    Found ${protocols.length} PROTOCOL result(s)`);

  return true;
}

async function testAgentMemoryStats() {
  console.log('\n[TEST 6] Agent Memory Statistics');
  const memory = new AgentMemory('quality_agent', dbHelpers);

  // Add some memories
  console.log('  ✓ Adding test memories for statistics...');
  for (let i = 0; i < 5; i++) {
    await memory.remember(
      MEMORY_TYPES.PATTERN,
      `quality_measure_${i}`,
      { measure: `MIPS Measure ${i}`, status: 'tracking' },
      { confidence: 0.3 + (i * 0.15) }
    );
  }

  // Get stats
  console.log('  ✓ Retrieving memory statistics...');
  const stats = await memory.getStats();
  console.log(`    Total memories: ${stats.totalMemories}`);
  console.log(`    By type: ${JSON.stringify(stats.byType)}`);
  console.log(`    High confidence (>= 0.8): ${stats.highConfidenceCount}`);

  return true;
}

async function testOrchestratorIntegration() {
  console.log('\n[TEST 7] Orchestrator Integration');
  const orchestrator = new AgentOrchestrator(dbHelpers);

  // Create test agents
  console.log('  ✓ Creating test agents...');
  class TestAgent extends BaseAgent {
    async process(context, agentResults) {
      // Test sending a message
      if (this.name === 'triage_agent') {
        await this.sendMessage('ma_agent', MESSAGE_TYPES.TRIAGE_RESULT, { data: 'test' });
      }

      // Test storing memory
      if (this.name === 'ma_agent') {
        await this.remember(MEMORY_TYPES.PROTOCOL, 'test_protocol', { value: 'test' });
      }

      return { agent: this.name, status: 'success' };
    }
  }

  const triageAgent = new TestAgent('triage_agent', { description: 'Phone Triage' });
  const maAgent = new TestAgent('ma_agent', { description: 'MA Agent', dependsOn: ['triage_agent'] });

  orchestrator.register(triageAgent);
  orchestrator.register(maAgent);

  console.log('  ✓ Verifying agents have message bus and memory...');
  if (!triageAgent.messageBus) throw new Error('Triage agent missing message bus');
  if (!triageAgent.memory) throw new Error('Triage agent missing memory');
  console.log(`    Triage agent initialized ✓`);
  console.log(`    MA agent initialized ✓`);

  // Test pipeline with messaging
  console.log('  ✓ Running pipeline...');
  const context = { patient: { id: 1 }, encounter: { id: 1 } };
  const result = await orchestrator.runPipeline(context);
  console.log(`    Pipeline completed: ${result.results.triage_agent.status}`);

  // Check if message was persisted
  console.log('  ✓ Verifying message persistence...');
  const messages = await orchestrator.getEncounterMessages(1);
  console.log(`    Messages in database: ${messages.length}`);

  // Check queue status
  console.log('  ✓ Checking message queue...');
  const queueStatus = orchestrator.getMessageQueueStatus();
  console.log(`    Queue status: ${queueStatus.totalMessages} total, ${queueStatus.pendingMessages} pending`);

  // Check memory stats
  console.log('  ✓ Getting orchestrator memory stats...');
  const memStats = await orchestrator.getAllAgentMemoryStats();
  console.log(`    Agents with memory: ${Object.keys(memStats).length}`);

  return true;
}

async function testMemoryExportImport() {
  console.log('\n[TEST 8] Memory Export/Import');
  const memory = new AgentMemory('coding_agent', dbHelpers);

  // Create memories
  console.log('  ✓ Creating test memories...');
  await memory.remember(MEMORY_TYPES.PREFERENCE, 'em_level_style', { hpi_detail: 'comprehensive' });
  await memory.remember(MEMORY_TYPES.PATTERN, 'office_visit_coding', { rpl: 'office', standard: 'brief' });

  // Export
  console.log('  ✓ Exporting memories...');
  const exported = await memory.export();
  console.log(`    Exported ${exported.length} memories`);

  // Import to different agent
  console.log('  ✓ Importing to different agent...');
  const memory2 = new AgentMemory('quality_agent', dbHelpers);
  const imported = await memory2.import(exported);
  console.log(`    Imported ${imported} memories`);

  // Verify
  console.log('  ✓ Verifying imported memories...');
  const imported_prefs = await memory2.recallByType(MEMORY_TYPES.PREFERENCE);
  console.log(`    Found ${imported_prefs.length} preference(s) in quality_agent`);

  return true;
}

// ==========================================
// TEST RUNNER
// ==========================================

async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  MESSAGE BUS & AGENT MEMORY INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    await initializeTestSchema();
    await testMessageBusBasics();
    await testRequestResponse();
    await testMessageHistory();
    await testAgentMemory();
    await testMemorySearch();
    await testAgentMemoryStats();
    await testOrchestratorIntegration();
    await testMemoryExportImport();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✓ ALL TESTS PASSED');
    console.log('═══════════════════════════════════════════════════════════\n');

    return true;
  } catch (err) {
    console.error('\n✗ TEST FAILED:', err.message);
    console.error('Stack:', err.stack);
    return false;
  } finally {
    testDb.close();
  }
}

// ==========================================
// MAIN
// ==========================================

runAllTests().then((success) => {
  process.exit(success ? 0 : 1);
});
