/**
 * Agentic EHR Base Agent Class
 * Foundation for all clinical AI agents in the 9-agent system.
 *
 * Architecture:
 *   Orchestrator → dispatches encounter context to each agent
 *   Each agent: receives context → processes → returns structured result
 *   All agents share a common PatientContext schema
 *
 * CATC Three-Tier Autonomy Framework (from THE LAB governance):
 *   Tier 1 (Full Autonomy): Scheduling, intake, refill routing, document routing
 *   Tier 2 (Supervised):     Prior auth, billing codes, care transitions, patient outreach
 *   Tier 3 (Physician-in-Loop): Clinical notes, medication changes, diagnostic recommendations
 *
 * Every agent action is audit-logged. Physician override supersedes all AI output.
 * No AI output enters the permanent medical record without explicit human review.
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const { getModuleDefinition } = require('./module-registry');

// ==========================================
// SHARED CONTEXT SCHEMA
// ==========================================

/**
 * PatientContext — the shared data contract all agents consume
 * Built once per encounter, passed to every agent.
 *
 * @typedef {Object} PatientContext
 * @property {Object} patient - Demographics (id, mrn, name, dob, sex, insurance)
 * @property {Object} encounter - Current encounter (id, date, type, chief_complaint, transcript, status, provider)
 * @property {Object} vitals - Current vitals (systolic_bp, diastolic_bp, heart_rate, etc.)
 * @property {Array} problems - Active problem list [{problem_name, icd10_code, status}]
 * @property {Array} medications - Active medications [{medication_name, dose, route, frequency, status}]
 * @property {Array} allergies - Allergies [{allergen, reaction, severity}]
 * @property {Array} labs - Recent lab results [{test_name, result_value, reference_range, result_date}]
 * @property {Array} labOrders - Pending lab orders [{test_name, status, order_date}]
 * @property {Array} imagingOrders - Pending imaging [{study_type, body_part, status}]
 * @property {Array} referrals - Pending referrals [{specialty, reason, status}]
 * @property {Array} prescriptions - Recent prescriptions [{medication_name, dose, status}]
 * @property {Object} workflow - Workflow state {current_state, timestamps}
 * @property {Object} providerPreferences - Learned provider patterns
 */

// Agent states
const AGENT_STATUS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
  WAITING: 'waiting'  // waiting on another agent's output
};

// CATC Three-Tier Autonomy Framework
// Tier determines how much human oversight is required before action takes effect
const AUTONOMY_TIER = {
  TIER_1: 1,  // Full Autonomy — agent acts, human reviews aggregate reports weekly
  TIER_2: 2,  // Supervised — agent acts, human reviews batched outputs or flagged exceptions daily
  TIER_3: 3   // Physician-in-the-Loop — every action requires explicit physician approval
};

// Safety Event Levels (from CATC Risk Register)
const SAFETY_LEVEL = {
  LEVEL_1: { level: 1, label: 'Critical',  response: 'Immediate Medical Director review + 24hr root cause analysis' },
  LEVEL_2: { level: 2, label: 'Major',     response: '48hr investigation by Clinical Lead' },
  LEVEL_3: { level: 3, label: 'Minor',     response: 'QA monitor classification, monthly review' },
  LEVEL_4: { level: 4, label: 'Informational', response: 'Logged for pattern analysis' }
};

// Action types for audit trail
const ACTION_TYPE = {
  RECOMMENDATION: 'recommendation',   // Agent suggests, human decides
  AUTO_EXECUTE: 'auto_execute',        // Tier 1 action — agent executes within guardrails
  ESCALATION: 'escalation',           // Agent escalates to higher authority
  OVERRIDE: 'override',               // Physician overrides agent output
  SAFETY_EVENT: 'safety_event',       // Safety concern flagged
  LEARNING: 'learning'                // Agent learned from correction
};

class BaseAgent extends EventEmitter {
  /**
   * @param {string} name - Agent identifier (e.g., 'scribe', 'cds', 'orders', 'coding', 'quality')
   * @param {Object} options - Agent configuration
   * @param {string} options.description - Human-readable description
   * @param {string[]} options.dependsOn - Agent names this agent waits for
   * @param {number} options.priority - Execution priority (lower = earlier, default 50)
   * @param {boolean} options.enabled - Whether agent is active
   * @param {MessageBus} options.messageBus - Inter-agent message bus
   * @param {AgentMemory} options.memory - Persistent agent memory
   */
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.description = options.description || '';
    this.dependsOn = options.dependsOn || [];
    this.priority = options.priority || 50;
    this.enabled = options.enabled !== false;
    this.status = AGENT_STATUS.IDLE;
    this.lastResult = null;
    this.lastError = null;
    this.executionTimeMs = 0;
    this.runCount = 0;

    // CATC Governance
    this.autonomyTier = options.autonomyTier || AUTONOMY_TIER.TIER_2;
    this.auditTrail = [];          // In-memory audit log (flushed to DB when available)
    this.safetyEvents = [];        // Safety event buffer
    this.overrideCount = 0;        // Tracks physician overrides for learning
    this.requiresApproval = options.requiresApproval !== false && this.autonomyTier === AUTONOMY_TIER.TIER_3;
    this.moduleDefinition = options.moduleDefinition || getModuleDefinition(name);

    // Communication and memory
    this.messageBus = options.messageBus || null;
    this.memory = options.memory || null;
  }

  /**
   * Main execution method — override in subclasses.
   * @param {PatientContext} context - Shared patient context
   * @param {Object} _agentResults - Results from previously-run agents (keyed by agent name)
   * @returns {Promise<Object>} Agent-specific result object
   */
  async process(context, _agentResults = {}) {
    throw new Error(`${this.name}: process() must be implemented by subclass`);
  }

  /**
   * Run the agent with timing, status tracking, and error handling.
   */
  async run(context, agentResults = {}) {
    if (!this.enabled) {
      return { agent: this.name, status: 'disabled', result: null };
    }

    this.status = AGENT_STATUS.PROCESSING;
    this.emit('status', { agent: this.name, status: this.status });

    const start = Date.now();
    try {
      const result = await this.process(context, agentResults);
      this.executionTimeMs = Date.now() - start;
      this.status = AGENT_STATUS.COMPLETE;
      this.lastResult = result;
      this.lastError = null;
      this.runCount++;

      this.emit('complete', {
        agent: this.name,
        result,
        executionTimeMs: this.executionTimeMs
      });

      return {
        agent: this.name,
        status: 'complete',
        result,
        executionTimeMs: this.executionTimeMs
      };
    } catch (err) {
      this.executionTimeMs = Date.now() - start;
      this.status = AGENT_STATUS.ERROR;
      this.lastError = err.message;

      this.emit('error', {
        agent: this.name,
        error: err.message,
        executionTimeMs: this.executionTimeMs
      });

      return {
        agent: this.name,
        status: 'error',
        error: err.message,
        executionTimeMs: this.executionTimeMs
      };
    }
  }

  /**
   * Get agent metadata for the frontend panel.
   */
  getInfo() {
    const tierLabels = { 1: 'Full Autonomy', 2: 'Supervised', 3: 'Physician-in-the-Loop' };
    return {
      name: this.name,
      description: this.description,
      status: this.status,
      enabled: this.enabled,
      priority: this.priority,
      dependsOn: this.dependsOn,
      runCount: this.runCount,
      lastExecutionTimeMs: this.executionTimeMs,
      lastError: this.lastError,
      module: this.moduleDefinition,
      governance: {
        autonomyTier: this.autonomyTier,
        tierLabel: tierLabels[this.autonomyTier] || 'Unknown',
        requiresApproval: this.requiresApproval,
        overrideCount: this.overrideCount
      }
    };
  }

  /**
   * Reset agent state between encounters.
   */
  reset() {
    this.status = AGENT_STATUS.IDLE;
    this.lastResult = null;
    this.lastError = null;
    this.executionTimeMs = 0;
  }

  // ==========================================
  // CATC GOVERNANCE & AUDIT
  // ==========================================

  /**
   * Log an action to the audit trail.
   * Every agent action is recorded — no exceptions.
   * @param {string} actionType - From ACTION_TYPE
   * @param {Object} details - Action details
   * @param {Object} context - Patient/encounter context
   */
  audit(actionType, details, context = {}) {
    const entry = {
      id: `audit_${crypto.randomUUID()}`,
      agent: this.name,
      autonomyTier: this.autonomyTier,
      actionType,
      details,
      patientId: context.patient?.id || null,
      encounterId: context.encounter?.id || null,
      timestamp: new Date().toISOString(),
      requiresApproval: this.requiresApproval && actionType === ACTION_TYPE.RECOMMENDATION,
      approved: actionType === ACTION_TYPE.AUTO_EXECUTE ? true : null  // Tier 1 auto-approved
    };

    this.auditTrail.push(entry);
    this.emit('audit', entry);

    // Keep in-memory trail manageable (last 1000 entries) (A-M2)
    if (this.auditTrail.length > 1000) {
      const droppedCount = this.auditTrail.length - 1000;
      this.emit('audit:truncated', {
        agent: this.name,
        droppedCount,
        message: `Audit trail truncated: ${droppedCount} oldest entries dropped (in-memory limit 1000)`
      });
      console.warn(`[${this.name}] Audit trail truncated: ${droppedCount} entries dropped`);
      this.auditTrail = this.auditTrail.slice(-1000);
    }

    return entry;
  }

  /**
   * Report a safety event per CATC 4-level classification.
   * Level 1 (Critical) triggers immediate notification.
   * @param {number} level - 1=Critical, 2=Major, 3=Minor, 4=Info
   * @param {string} description - What happened
   * @param {Object} context - Patient/encounter context
   */
  reportSafetyEvent(level, description, context = {}) {
    const safetyLevel = Object.values(SAFETY_LEVEL).find(s => s.level === level) || SAFETY_LEVEL.LEVEL_4;

    const event = {
      id: `safety_${crypto.randomUUID()}`,
      agent: this.name,
      level: safetyLevel.level,
      label: safetyLevel.label,
      description,
      response: safetyLevel.response,
      patientId: context.patient?.id || null,
      encounterId: context.encounter?.id || null,
      timestamp: new Date().toISOString(),
      resolved: false
    };

    this.safetyEvents.push(event);
    this.emit('safety_event', event);

    // Level 1 — immediate escalation
    if (level === 1) {
      this.emit('critical_safety_event', event);
      console.error(`[SAFETY CRITICAL] ${this.name}: ${description}`);
    }

    return event;
  }

  /**
   * Record a physician override of this agent's output.
   * Overrides feed the learning system — corrections make the agent smarter.
   * @param {string} originalOutput - What the agent recommended
   * @param {string} override - What the physician chose instead
   * @param {string} reason - Why (optional but encouraged)
   */
  recordOverride(originalOutput, override, reason = '') {
    this.overrideCount++;

    const entry = this.audit(ACTION_TYPE.OVERRIDE, {
      originalOutput,
      override,
      reason,
      overrideNumber: this.overrideCount
    });

    this.emit('override', entry);

    // Feed learning system if memory is available
    if (this.memory) {
      this.remember('PATTERN', `override_${this.name}_${Date.now()}`, {
        original: originalOutput,
        corrected: override,
        reason,
        agent: this.name
      }).catch(() => {}); // Non-blocking
    }

    return entry;
  }

  /**
   * Check if this agent's output requires physician approval before acting.
   * Tier 3 agents always require approval. Tier 2 requires approval for flagged items.
   * @param {Object} result - Agent's output
   * @returns {Object} { requiresApproval, tier, reason }
   */
  checkApprovalRequired(result) {
    if (this.autonomyTier === AUTONOMY_TIER.TIER_3) {
      return {
        requiresApproval: true,
        tier: 3,
        reason: 'Tier 3 — all clinical actions require physician approval'
      };
    }

    if (this.autonomyTier === AUTONOMY_TIER.TIER_2) {
      // Tier 2 — check for flagged exceptions
      const isFlagged = result?.escalation_required || result?.safety_concern || result?.high_risk;
      return {
        requiresApproval: isFlagged || false,
        tier: 2,
        reason: isFlagged ? 'Tier 2 — flagged exception requires review' : 'Tier 2 — within supervised scope'
      };
    }

    // Tier 1 — autonomous within guardrails
    return {
      requiresApproval: false,
      tier: 1,
      reason: 'Tier 1 — autonomous execution within protocol'
    };
  }

  /**
   * Request physician approval for a dosing change.
   *
   * Specialized Tier 3 gate for HRT / peptide / functional-medicine dosing adjustments
   * where safety margins are narrow and errors have significant consequences. Use this
   * helper instead of a raw `sendRequest` so every dosing decision is audited with the
   * same structure and every rejection is recorded as a safety event.
   *
   * Flow:
   *   1. Validate that the dosing change carries medication, proposedDose, and rationale
   *   2. Audit the escalation via ACTION_TYPE.ESCALATION
   *   3. Send DOSING_REVIEW_REQUEST to the physician agent (priority 5, routed via bus)
   *   4. Await the physician's response (default 1 hour)
   *   5. On approval: audit as RECOMMENDATION approved, broadcast DOSING_APPROVED to orders
   *   6. On rejection: report LEVEL_1 safety event, broadcast DOSING_REJECTED to medivault_redflag
   *   7. On timeout / bus error: report LEVEL_2 safety event, return approved=false (fail-safe)
   *
   * @param {Object} dosingChange - { medication, currentDose, proposedDose, route, frequency, rationale, evidenceSource }
   * @param {Object} context - Patient/encounter context ({ patient, encounter, ... })
   * @param {Object} options - { timeoutMs: number (default 3600000 = 1 hour) }
   * @returns {Promise<{ approved: boolean, approvalId: string, response: Object }>}
   */
  async requestDosingApproval(dosingChange, context = {}, options = {}) {
    const { timeoutMs = 3_600_000 } = options;

    // Validate required fields — a dosing change without these is dangerous
    const requiredFields = ['medication', 'proposedDose', 'rationale'];
    for (const field of requiredFields) {
      if (!dosingChange || !dosingChange[field]) {
        throw new Error(`${this.name}.requestDosingApproval: missing required field "${field}"`);
      }
    }

    // Evidence source is strongly encouraged — flag (but don't block) its absence
    if (!dosingChange.evidenceSource) {
      this.reportSafetyEvent(
        3,
        `Dosing approval requested without evidence source for ${dosingChange.medication}`,
        context
      );
    }

    // Refuse to silently bypass Tier 3 — warn if called from a lower-tier agent
    if (this.autonomyTier !== AUTONOMY_TIER.TIER_3) {
      console.warn(
        `[${this.name}] requestDosingApproval called from Tier ${this.autonomyTier} agent — ` +
        `forcing physician approval regardless of agent tier`
      );
    }

    // Audit the escalation before sending — so we have a record even if the request times out
    const auditEntry = this.audit(
      ACTION_TYPE.ESCALATION,
      {
        reason: 'dosing_change_requires_physician_approval',
        dosingChange,
        requestedBy: this.name,
        tier: this.autonomyTier
      },
      context
    );

    if (!this.messageBus) {
      throw new Error(`${this.name}: messageBus not initialized — cannot request dosing approval`);
    }

    try {
      const response = await this.sendRequest(
        'physician',
        'DOSING_REVIEW_REQUEST',
        {
          requestingAgent: this.name,
          auditEntryId: auditEntry.id,
          dosingChange,
          context: {
            patientId: context.patient?.id,
            encounterId: context.encounter?.id
          }
        },
        {
          timeout: timeoutMs,
          priority: 5, // Highest — dosing reviews are time-sensitive
          patientId: context.patient?.id,
          encounterId: context.encounter?.id
        }
      );

      const payload = response?.payload
        ? (typeof response.payload === 'string' ? JSON.parse(response.payload) : response.payload)
        : {};
      const approved = Boolean(payload.approved);

      if (approved) {
        // Physician approved — record and broadcast so Orders agent can execute
        this.audit(
          ACTION_TYPE.RECOMMENDATION,
          {
            status: 'approved_by_physician',
            dosingChange,
            approverId: payload.approverId || null,
            approvalNotes: payload.notes || null
          },
          context
        );

        await this.sendMessage(
          'orders',
          'DOSING_APPROVED',
          {
            dosingChange,
            approvedBy: payload.approverId || null,
            originalAuditEntryId: auditEntry.id
          },
          {
            patientId: context.patient?.id,
            encounterId: context.encounter?.id,
            priority: 5
          }
        );
      } else {
        // Physician rejected — LEVEL_1 safety event + broadcast to red flag tracking
        const rejectionReason = payload.reason || 'no_reason_provided';
        this.reportSafetyEvent(
          1,
          `Dosing change rejected by physician: ${dosingChange.medication} ` +
          `${dosingChange.currentDose || 'n/a'} → ${dosingChange.proposedDose}. ` +
          `Reason: ${rejectionReason}`,
          context
        );

        await this.sendMessage(
          'medivault_redflag',
          'DOSING_REJECTED',
          {
            dosingChange,
            rejectedBy: payload.approverId || null,
            reason: rejectionReason,
            originalAuditEntryId: auditEntry.id
          },
          {
            patientId: context.patient?.id,
            encounterId: context.encounter?.id,
            priority: 4
          }
        );
      }

      return {
        approved,
        approvalId: auditEntry.id,
        response: payload
      };
    } catch (err) {
      // Timeout or bus error — fail safe (treat as rejection) and log the error
      this.reportSafetyEvent(
        2,
        `Dosing approval request failed (treating as rejection): ${err.message}`,
        context
      );
      return {
        approved: false,
        approvalId: auditEntry.id,
        response: { error: err.message }
      };
    }
  }

  /**
   * Get governance info for the frontend.
   */
  getGovernanceInfo() {
    const tierLabels = { 1: 'Full Autonomy', 2: 'Supervised', 3: 'Physician-in-the-Loop' };
    return {
      agent: this.name,
      autonomyTier: this.autonomyTier,
      tierLabel: tierLabels[this.autonomyTier] || 'Unknown',
      requiresApproval: this.requiresApproval,
      overrideCount: this.overrideCount,
      auditEntryCount: this.auditTrail.length,
      safetyEventCount: this.safetyEvents.length,
      recentAuditEntries: this.auditTrail.slice(-10),
      unresolvedSafetyEvents: this.safetyEvents.filter(e => !e.resolved)
    };
  }

  // ==========================================
  // MESSAGE BUS HELPERS
  // ==========================================

  /**
   * Send a message to another agent
   * @param {string} toAgent - Target agent name (or 'broadcast')
   * @param {string} messageType - Message type (from MESSAGE_TYPES)
   * @param {Object} payload - Message payload
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Message object
   */
  async sendMessage(toAgent, messageType, payload, options = {}) {
    if (!this.messageBus) {
      console.warn(`${this.name}: messageBus not initialized`);
      return null;
    }
    return this.messageBus.sendMessage(this.name, toAgent, messageType, payload, options);
  }

  /**
   * Get messages addressed to this agent
   * @param {Object} options - Query options (status, fromAgent, limit)
   * @returns {Promise<Array>} Messages
   */
  async getMessages(options = {}) {
    if (!this.messageBus) {
      console.warn(`${this.name}: messageBus not initialized`);
      return [];
    }
    return this.messageBus.getMessages(this.name, options);
  }

  /**
   * Send a request and wait for response
   * @param {string} toAgent - Agent to request from
   * @param {string} messageType - Request type
   * @param {Object} payload - Request payload
   * @param {Object} options - Additional options (timeout, etc.)
   * @returns {Promise<Object>} Response message
   */
  async sendRequest(toAgent, messageType, payload, options = {}) {
    if (!this.messageBus) {
      throw new Error(`${this.name}: messageBus not initialized`);
    }
    return this.messageBus.sendRequest(this.name, toAgent, messageType, payload, options);
  }

  /**
   * Send a response to a request
   * @param {string} toAgent - Agent that made the request
   * @param {string} messageType - Response type
   * @param {Object} payload - Response payload
   * @param {string} requestId - ID of the request being responded to
   * @returns {Promise<Object>} Response message
   */
  async sendResponse(toAgent, messageType, payload, requestId, options = {}) {
    if (!this.messageBus) {
      throw new Error(`${this.name}: messageBus not initialized`);
    }
    return this.messageBus.sendResponse(this.name, toAgent, messageType, payload, requestId, options);
  }

  /**
   * Mark a message as read by this agent
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async markMessageRead(messageId) {
    if (!this.messageBus) {
      console.warn(`${this.name}: messageBus not initialized`);
      return;
    }
    return this.messageBus.markRead(messageId);
  }

  /**
   * Mark a message as acted upon
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async markMessageActedOn(messageId) {
    if (!this.messageBus) {
      console.warn(`${this.name}: messageBus not initialized`);
      return;
    }
    return this.messageBus.markActedOn(messageId);
  }

  // ==========================================
  // MEMORY HELPERS
  // ==========================================

  /**
   * Store a memory entry
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key
   * @param {*} value - Memory value
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Memory entry
   */
  async remember(memoryType, key, value, options = {}) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return null;
    }
    return this.memory.remember(memoryType, key, value, options);
  }

  /**
   * Retrieve a memory entry
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key
   * @returns {Promise<Object|null>} Memory entry or null
   */
  async recall(memoryType, key) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return null;
    }
    return this.memory.recall(memoryType, key);
  }

  /**
   * Retrieve all memories of a type
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Memory entries
   */
  async recallByType(memoryType, options = {}) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return [];
    }
    return this.memory.recallByType(memoryType, options);
  }

  /**
   * Search memories
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching memories
   */
  async searchMemory(query, options = {}) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return [];
    }
    return this.memory.search(query, options);
  }

  /**
   * Get memories for a patient
   * @param {string} patientId - Patient ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Memories
   */
  async recallPatientMemories(patientId, options = {}) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return [];
    }
    return this.memory.recallForPatient(patientId, options);
  }

  /**
   * Forget a memory
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key
   * @returns {Promise<number>} Rows deleted
   */
  async forget(memoryType, key) {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return 0;
    }
    return this.memory.forget(memoryType, key);
  }

  /**
   * Get memory statistics for this agent
   * @returns {Promise<Object>} Statistics
   */
  async getMemoryStats() {
    if (!this.memory) {
      console.warn(`${this.name}: memory not initialized`);
      return null;
    }
    return this.memory.getStats();
  }
}

/**
 * Shared age calculator — available as static method and instance method (L1).
 * @param {string} dob - Date of birth string
 * @returns {number} Age in years, or 0 if dob is falsy
 */
BaseAgent._age = function(dob) {
  if (!dob) return 0;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
};

// Also available as instance method via prototype
BaseAgent.prototype._age = function(dob) {
  return BaseAgent._age(dob);
};

module.exports = { BaseAgent, AGENT_STATUS, AUTONOMY_TIER, SAFETY_LEVEL, ACTION_TYPE };
