/**
 * Inter-Agent Message Bus
 * Event-driven communication layer for agent-to-agent messaging with persistence.
 *
 * Features:
 * - Typed message support (TRIAGE_RESULT, ESCALATION, DIRECTIVE, etc.)
 * - SQLite persistence for audit trail
 * - Priority-based message queue
 * - Request-response patterns
 * - Broadcast messaging
 * - Real-time event emission for WebSocket forwarding
 */

const EventEmitter = require('events');

// Message types as defined in Agentic EHR-VISION.md Section VI
const MESSAGE_TYPES = {
  TRIAGE_RESULT: 'TRIAGE_RESULT',         // Phone Triage → MA Agent
  ESCALATION: 'ESCALATION',               // MA Agent → Physician Agent
  DIRECTIVE: 'DIRECTIVE',                 // Physician Agent → MA Agent
  SCHEDULE_REQUEST: 'SCHEDULE_REQUEST',   // Any → Front Desk Agent
  PATIENT_CONTACT: 'PATIENT_CONTACT',     // Front Desk Agent → Patient
  REFILL_REQUEST: 'REFILL_REQUEST',       // Phone Triage → MA Agent → Physician Agent
  ORDER_REQUEST: 'ORDER_REQUEST',         // Physician Agent → Lab/Pharmacy/Imaging
  NOTE_UPDATE: 'NOTE_UPDATE',             // Ambient Agent → Physician Agent
  CODING_ALERT: 'CODING_ALERT',           // Coding Agent → Physician Agent
  QUALITY_GAP: 'QUALITY_GAP',             // Quality Agent → Physician Agent
  PATIENT_LETTER: 'PATIENT_LETTER',       // Physician Agent → Patient
  BRIEFING_READY: 'BRIEFING_READY',       // Front Desk Agent → Provider
  PROTOCOL_UPDATE: 'PROTOCOL_UPDATE'      // Physician Agent → MA Agent
};

// Message statuses
const MESSAGE_STATUS = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  READ: 'read',
  ACTED_ON: 'acted_on'
};

class MessageBus extends EventEmitter {
  /**
   * @param {Object} db - Database connection (dbRun, dbGet, dbAll functions)
   */
  constructor(db) {
    super();
    this.db = db;
    this.messageQueue = [];
    this.requestWaiters = new Map(); // For request-response patterns
    this.setMaxListeners(100); // Allow many concurrent message listeners
  }

  /**
   * Send a message from one agent to another
   * @param {string} fromAgent - Sending agent name
   * @param {string} toAgent - Receiving agent name (or 'broadcast')
   * @param {string} messageType - Type from MESSAGE_TYPES
   * @param {Object} payload - Message content
   * @param {Object} options - Additional options
   * @param {number} options.priority - Message priority 1-5 (5=highest, default 3)
   * @param {string} options.patientId - Associated patient ID
   * @param {string} options.encounterId - Associated encounter ID
   * @param {number} options.requestId - If this is a response to a request
   * @returns {Promise<Object>} Message object with id
   */
  async sendMessage(fromAgent, toAgent, messageType, payload, options = {}) {
    const {
      priority = 3,
      patientId = null,
      encounterId = null,
      requestId = null
    } = options;

    if (!MESSAGE_TYPES[messageType]) {
      throw new Error(`Invalid message type: ${messageType}`);
    }

    const message = {
      id: this._generateMessageId(),
      from_agent: fromAgent,
      to_agent: toAgent,
      message_type: messageType,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      priority: Math.max(1, Math.min(5, priority)),
      status: MESSAGE_STATUS.PENDING,
      patient_id: patientId,
      encounter_id: encounterId,
      request_id: requestId,
      created_at: new Date().toISOString(),
      delivered_at: null,
      acted_on_at: null
    };

    try {
      // Persist to database
      const result = await this.db.dbRun(
        `INSERT INTO agent_messages
          (id, from_agent, to_agent, message_type, payload, priority, status, patient_id, encounter_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id, message.from_agent, message.to_agent, message.message_type,
          message.payload, message.priority, message.status, message.patient_id,
          message.encounter_id, message.request_id, message.created_at
        ]
      );

      // Add to in-memory queue
      this.messageQueue.push(message);
      this.messageQueue.sort((a, b) => b.priority - a.priority);

      // Emit event for real-time forwarding
      this.emit('message:new', message);

      // Emit agent-specific event
      if (toAgent !== 'broadcast') {
        this.emit(`message:to:${toAgent}`, message);
      } else {
        this.emit('message:broadcast', message);
      }

      return message;
    } catch (err) {
      console.error('MessageBus.sendMessage error:', err);
      throw err;
    }
  }

  /**
   * Get messages for an agent (respects status filters)
   * @param {string} agentName - Agent to retrieve messages for
   * @param {Object} options - Query options
   * @param {string} options.status - Filter by status (pending/delivered/read/acted_on)
   * @param {string} options.fromAgent - Filter by sender
   * @param {number} options.limit - Max results (default 50)
   * @returns {Promise<Array>} Messages
   */
  async getMessages(agentName, options = {}) {
    const {
      status = null,
      fromAgent = null,
      limit = 50
    } = options;

    let query = 'SELECT * FROM agent_messages WHERE to_agent = ? OR to_agent = "broadcast"';
    const params = [agentName];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (fromAgent) {
      query += ' AND from_agent = ?';
      params.push(fromAgent);
    }

    query += ' ORDER BY priority DESC, created_at ASC LIMIT ?';
    params.push(limit);

    try {
      const messages = await this.db.dbAll(query, params);
      return messages.map(m => ({
        ...m,
        payload: typeof m.payload === 'string' ? JSON.parse(m.payload) : m.payload
      }));
    } catch (err) {
      console.error('MessageBus.getMessages error:', err);
      return [];
    }
  }

  /**
   * Mark a message as delivered
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async markDelivered(messageId) {
    const now = new Date().toISOString();
    await this.db.dbRun(
      'UPDATE agent_messages SET status = ?, delivered_at = ? WHERE id = ?',
      [MESSAGE_STATUS.DELIVERED, now, messageId]
    );
    this.emit('message:delivered', { messageId, deliveredAt: now });
  }

  /**
   * Mark a message as read
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async markRead(messageId) {
    await this.db.dbRun(
      'UPDATE agent_messages SET status = ? WHERE id = ?',
      [MESSAGE_STATUS.READ, messageId]
    );
    this.emit('message:read', { messageId });
  }

  /**
   * Mark a message as acted upon
   * @param {string} messageId - Message ID
   * @returns {Promise<void>}
   */
  async markActedOn(messageId) {
    const now = new Date().toISOString();
    await this.db.dbRun(
      'UPDATE agent_messages SET status = ?, acted_on_at = ? WHERE id = ?',
      [MESSAGE_STATUS.ACTED_ON, now, messageId]
    );
    this.emit('message:acted_on', { messageId, actedOnAt: now });
  }

  /**
   * Send a request and wait for a response
   * @param {string} fromAgent - Requesting agent
   * @param {string} toAgent - Agent to request from
   * @param {string} messageType - Request type
   * @param {Object} payload - Request payload
   * @param {Object} options - Additional options (priority, patientId, etc.)
   * @param {number} options.timeout - Timeout in ms (default 30000)
   * @returns {Promise<Object>} Response message
   */
  async sendRequest(fromAgent, toAgent, messageType, payload, options = {}) {
    const { timeout = 30000, ...msgOptions } = options;

    // Send the request
    const requestMsg = await this.sendMessage(fromAgent, toAgent, messageType, payload, msgOptions);

    // Create a promise that resolves when response arrives
    return new Promise((resolve, reject) => {
      const waitKey = requestMsg.id;
      const timer = setTimeout(() => {
        this.requestWaiters.delete(waitKey);
        reject(new Error(`Request timeout after ${timeout}ms for message ${requestMsg.id}`));
      }, timeout);

      this.requestWaiters.set(waitKey, (response) => {
        clearTimeout(timer);
        this.requestWaiters.delete(waitKey);
        resolve(response);
      });
    });
  }

  /**
   * Send a response to a request
   * @param {string} fromAgent - Responding agent
   * @param {string} toAgent - Original requester
   * @param {string} messageType - Response type
   * @param {Object} payload - Response payload
   * @param {string} requestId - ID of the request being responded to
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response message
   */
  async sendResponse(fromAgent, toAgent, messageType, payload, requestId, options = {}) {
    const response = await this.sendMessage(
      fromAgent,
      toAgent,
      messageType,
      payload,
      { ...options, requestId }
    );

    // If someone is waiting on this request, notify them
    // requestId should be the ORIGINAL request message ID
    if (this.requestWaiters.has(requestId)) {
      const waiter = this.requestWaiters.get(requestId);
      waiter(response);
      this.requestWaiters.delete(requestId);
    }

    return response;
  }

  /**
   * Get message history (audit trail)
   * @param {Object} filters - Filter options
   * @param {string} filters.patientId - Filter by patient
   * @param {string} filters.encounterId - Filter by encounter
   * @param {string} filters.fromAgent - Filter by sender
   * @param {string} filters.toAgent - Filter by recipient
   * @param {string} filters.messageType - Filter by type
   * @param {number} filters.limit - Max results (default 100)
   * @returns {Promise<Array>} Messages
   */
  async getHistory(filters = {}) {
    const {
      patientId = null,
      encounterId = null,
      fromAgent = null,
      toAgent = null,
      messageType = null,
      limit = 100
    } = filters;

    let query = 'SELECT * FROM agent_messages WHERE 1=1';
    const params = [];

    if (patientId) {
      query += ' AND patient_id = ?';
      params.push(patientId);
    }
    if (encounterId) {
      query += ' AND encounter_id = ?';
      params.push(encounterId);
    }
    if (fromAgent) {
      query += ' AND from_agent = ?';
      params.push(fromAgent);
    }
    if (toAgent) {
      query += ' AND to_agent = ?';
      params.push(toAgent);
    }
    if (messageType) {
      query += ' AND message_type = ?';
      params.push(messageType);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    try {
      const messages = await this.db.dbAll(query, params);
      return messages.map(m => ({
        ...m,
        payload: typeof m.payload === 'string' ? JSON.parse(m.payload) : m.payload
      }));
    } catch (err) {
      console.error('MessageBus.getHistory error:', err);
      return [];
    }
  }

  /**
   * Clear queue (e.g., when pipeline completes)
   */
  clearQueue() {
    this.messageQueue = [];
  }

  /**
   * Get queue status
   * @returns {Object} Queue statistics
   */
  getQueueStatus() {
    const pending = this.messageQueue.filter(m => m.status === MESSAGE_STATUS.PENDING).length;
    return {
      totalMessages: this.messageQueue.length,
      pendingMessages: pending,
      avgPriority: this.messageQueue.length > 0
        ? (this.messageQueue.reduce((sum, m) => sum + m.priority, 0) / this.messageQueue.length).toFixed(2)
        : 0
    };
  }

  /**
   * Internal: Generate unique message ID
   * @returns {string}
   */
  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  MessageBus,
  MESSAGE_TYPES,
  MESSAGE_STATUS
};
