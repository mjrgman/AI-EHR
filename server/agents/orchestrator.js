/**
 * Agentic EHR Agent Orchestrator
 * Coordinates the runtime module graph for each encounter.
 *
 * Encounter execution order (respects dependencies):
 *   Phase 1 (parallel): Scribe + CDS
 *   Phase 2 (parallel): Orders + Coding
 *   Phase 3: Quality
 *
 * The full system includes 9 workflow modules:
 *   Phone Triage, Front Desk, MA, Physician, Scribe, CDS, Orders, Coding, Quality
 *
 * The orchestrator:
 *   1. Builds shared PatientContext from the database
 *   2. Runs agents in dependency order
 *   3. Collects and merges all results
 *   4. Returns a unified AgentPipelineResult
 */

const EventEmitter = require('events');
const { AGENT_STATUS } = require('./base-agent');
const { MessageBus } = require('./message-bus');
const { AgentMemory } = require('./agent-memory');

class AgentOrchestrator extends EventEmitter {
  /**
   * @param {Object} db - Database connection (dbRun, dbGet, dbAll)
   */
  constructor(db) {
    super();
    this.agents = new Map();
    this.pipelineRunning = false;
    this.lastPipelineResult = null;

    // Initialize message bus and memory system
    this.db = db;
    this.messageBus = new MessageBus(db);
    this.agentMemories = new Map(); // agent name → AgentMemory instance

    // Forward message bus events
    this.messageBus.on('message:new', (msg) => this.emit('message:new', msg));
    this.messageBus.on('message:broadcast', (msg) => this.emit('message:broadcast', msg));
    this.messageBus.on('message:delivered', (data) => this.emit('message:delivered', data));
    this.messageBus.on('message:acted_on', (data) => this.emit('message:acted_on', data));
  }

  /**
   * Register an agent with the orchestrator.
   * @param {BaseAgent} agent
   */
  register(agent) {
    this.agents.set(agent.name, agent);

    // Inject message bus and memory into agent
    agent.messageBus = this.messageBus;

    // Create or retrieve agent memory
    if (!this.agentMemories.has(agent.name)) {
      this.agentMemories.set(agent.name, new AgentMemory(agent.name, this.db));
    }
    agent.memory = this.agentMemories.get(agent.name);

    // Forward agent events
    agent.on('status', (data) => this.emit('agent:status', data));
    agent.on('complete', (data) => this.emit('agent:complete', data));
    agent.on('error', (data) => this.emit('agent:error', data));

    return this;
  }

  /**
   * Get registered agent by name.
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Get status of all agents.
   */
  getStatus() {
    const agents = {};
    for (const [name, agent] of this.agents) {
      agents[name] = agent.getInfo();
    }
    return {
      pipelineRunning: this.pipelineRunning,
      agents,
      lastResult: this.lastPipelineResult ? {
        timestamp: this.lastPipelineResult.timestamp,
        totalTimeMs: this.lastPipelineResult.totalTimeMs,
        agentCount: Object.keys(this.lastPipelineResult.results).length
      } : null
    };
  }

  /**
   * Build execution phases from agent dependencies.
   * Returns array of arrays — each inner array can run in parallel.
   */
  _buildPhases() {
    const resolved = new Set();
    const phases = [];
    const remaining = new Map(this.agents);

    let maxIterations = this.agents.size + 1;
    while (remaining.size > 0 && maxIterations-- > 0) {
      const phase = [];
      for (const [name, agent] of remaining) {
        if (!agent.enabled) {
          resolved.add(name);
          remaining.delete(name);
          continue;
        }
        const depsResolved = agent.dependsOn.every(dep => resolved.has(dep));
        if (depsResolved) {
          phase.push(agent);
        }
      }

      if (phase.length === 0 && remaining.size > 0) {
        // Circular dependency or unresolvable — force remaining into a phase
        console.warn('Agent orchestrator: unresolvable dependencies, forcing remaining agents');
        for (const [, agent] of remaining) {
          if (agent.enabled) phase.push(agent);
        }
      }

      for (const agent of phase) {
        resolved.add(agent.name);
        remaining.delete(agent.name);
      }

      if (phase.length > 0) {
        phases.push(phase);
      }
    }

    return phases;
  }

  /**
   * Run the full agent pipeline for an encounter.
   *
   * @param {PatientContext} context - Shared patient context
   * @param {Object} options - Pipeline options
   * @param {string[]} options.only - Run only these agents (optional)
   * @param {string[]} options.skip - Skip these agents (optional)
   * @returns {Promise<AgentPipelineResult>}
   */
  async runPipeline(context, options = {}) {
    if (this.pipelineRunning) {
      throw new Error('Pipeline already running for this orchestrator instance');
    }

    this.pipelineRunning = true;
    this.emit('pipeline:start', { encounterId: context.encounter?.id });

    const pipelineStart = Date.now();
    const agentResults = {};

    // Apply only/skip filters
    if (options.only) {
      for (const [name, agent] of this.agents) {
        agent.enabled = options.only.includes(name);
      }
    }
    if (options.skip) {
      for (const name of options.skip) {
        const agent = this.agents.get(name);
        if (agent) agent.enabled = false;
      }
    }

    // Reset all agents
    for (const [, agent] of this.agents) {
      agent.reset();
    }

    const phases = this._buildPhases();

    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        this.emit('pipeline:phase', {
          phase: i + 1,
          totalPhases: phases.length,
          agents: phase.map(a => a.name)
        });

        // Run agents in this phase in parallel with timeout protection
        const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS, 10) || 10000;
        const phaseResults = await Promise.all(
          phase.map(agent => {
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error(`Agent "${agent.name}" timed out after ${AGENT_TIMEOUT_MS}ms`)), AGENT_TIMEOUT_MS);
            });
            return Promise.race([
              agent.run(context, agentResults),
              timeoutPromise
            ]).then(result => {
              clearTimeout(timeoutId);
              return result;
            }).catch(err => {
              clearTimeout(timeoutId);
              return {
                agent: agent.name,
                status: 'timeout',
                error: err.message,
                result: null,
                timeMs: AGENT_TIMEOUT_MS,
                timedOut: true
              };
            });
          })
        );

        // Collect results
        for (const result of phaseResults) {
          agentResults[result.agent] = result;
          // Track timed-out or failed agents for downstream awareness
          if (result.timedOut || result.status === 'error') {
            this.emit('agent:timeout', { agent: result.agent, error: result.error });
          }
        }
      }
    } finally {
      this.pipelineRunning = false;
    }

    const totalTimeMs = Date.now() - pipelineStart;

    this.lastPipelineResult = {
      encounterId: context.encounter?.id,
      patientId: context.patient?.id,
      timestamp: new Date().toISOString(),
      totalTimeMs,
      results: agentResults,
      summary: this._buildSummary(agentResults)
    };

    this.emit('pipeline:complete', this.lastPipelineResult);
    return this.lastPipelineResult;
  }

  /**
   * Run a single agent (for incremental updates).
   */
  async runAgent(agentName, context, existingResults = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent not found: ${agentName}`);
    return agent.run(context, existingResults);
  }

  /**
   * Build a human-readable summary from all agent results.
   */
  _buildSummary(agentResults) {
    const summary = {
      alerts: [],
      documentation: null,
      orders: [],
      coding: null,
      qualityGaps: []
    };

    // Scribe output
    const scribe = agentResults.scribe?.result;
    if (scribe) {
      summary.documentation = {
        soapNote: scribe.soapNote ? 'Generated' : 'Not generated',
        extractedVitals: Object.keys(scribe.vitals || {}).length,
        extractedProblems: (scribe.problems || []).length,
        extractedMedications: (scribe.medications || []).length,
        extractedLabs: (scribe.labOrders || []).length,
        rosCategories: Object.keys(scribe.ros || {}).length,
        peFindings: Object.keys(scribe.physicalExam || {}).length
      };
    }

    // CDS output
    const cds = agentResults.cds?.result;
    if (cds) {
      summary.alerts = (cds.suggestions || []).map(s => ({
        type: s.suggestion_type,
        priority: s.priority,
        title: s.title,
        category: s.category
      }));
    }

    // Orders output
    const orders = agentResults.orders?.result;
    if (orders) {
      summary.orders = orders.proposedOrders || [];
    }

    // Coding output
    const coding = agentResults.coding?.result;
    if (coding) {
      summary.coding = {
        emLevel: coding.emLevel,
        icd10Codes: (coding.icd10Codes || []).length,
        completenessScore: coding.completenessScore,
        missingElements: coding.missingElements || []
      };
    }

    // Quality output
    const quality = agentResults.quality?.result;
    if (quality) {
      summary.qualityGaps = (quality.gaps || []).map(g => ({
        measure: g.measureName,
        status: g.status,
        action: g.suggestedAction
      }));
    }

    return summary;
  }

  // ==========================================
  // MESSAGE BUS ACCESSORS
  // ==========================================

  /**
   * Get message bus instance (for direct access)
   */
  getMessageBus() {
    return this.messageBus;
  }

  /**
   * Get message history for an encounter
   * @param {string} encounterId - Encounter ID
   * @returns {Promise<Array>} Messages
   */
  async getEncounterMessages(encounterId) {
    return this.messageBus.getHistory({ encounterId });
  }

  /**
   * Get message history for a patient
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} Messages
   */
  async getPatientMessages(patientId) {
    return this.messageBus.getHistory({ patientId });
  }

  /**
   * Get message bus queue status
   */
  getMessageQueueStatus() {
    return this.messageBus.getQueueStatus();
  }

  /**
   * Clear message queue (after pipeline completes)
   */
  clearMessageQueue() {
    this.messageBus.clearQueue();
  }

  // ==========================================
  // AGENT MEMORY ACCESSORS
  // ==========================================

  /**
   * Get memory instance for an agent
   * @param {string} agentName - Agent name
   * @returns {AgentMemory}
   */
  getAgentMemory(agentName) {
    if (!this.agentMemories.has(agentName)) {
      this.agentMemories.set(agentName, new AgentMemory(agentName, this.db));
    }
    return this.agentMemories.get(agentName);
  }

  /**
   * Get memory statistics for all agents
   * @returns {Promise<Object>} Stats by agent
   */
  async getAllAgentMemoryStats() {
    const stats = {};
    for (const [agentName, memory] of this.agentMemories) {
      stats[agentName] = await memory.getStats();
    }
    return stats;
  }

  /**
   * Export all memories for backup
   * @returns {Promise<Object>} Memories by agent
   */
  async exportAllMemories() {
    const backup = {};
    for (const [agentName, memory] of this.agentMemories) {
      backup[agentName] = await memory.export();
    }
    return backup;
  }

  /**
   * Import memories from backup
   * @param {Object} backup - Backup object (agent name → memories array)
   * @returns {Promise<Object>} Import counts by agent
   */
  async importAllMemories(backup) {
    const results = {};
    for (const [agentName, memories] of Object.entries(backup)) {
      const memory = this.getAgentMemory(agentName);
      results[agentName] = await memory.import(memories);
    }
    return results;
  }
}

module.exports = { AgentOrchestrator };
