/**
 * Agentic EHR Agent System — Entry Point
 *
 * 9-Agent Clinical Pipeline:
 *
 *   PRE-VISIT AGENTS (run on-demand, before patient arrives):
 *     Phone Triage Agent — call handling, symptom triage, routing
 *     Front Desk Agent — scheduling, pre-visit briefing, patient contact
 *     MA Agent — protocol execution, refills, pre-visit labs, escalation
 *     Physician Agent — protocol management, escalation handling, learning
 *
 *   ENCOUNTER AGENTS (run during/after the visit):
 *     Phase 1 (parallel): Scribe + CDS
 *     Phase 2 (parallel): Orders + Coding
 *     Phase 3: Quality
 *
 *   POST-VISIT:
 *     Physician Agent — post-visit orchestration (Rx, labs, referrals, letters)
 *
 * Usage:
 *   const agents = require('./agents');
 *
 *   // Run encounter pipeline
 *   const result = await agents.runPipeline(patientId, encounterId, db);
 *
 *   // Run single agent
 *   const triage = await agents.runAgent('phone_triage', patientId, encounterId, db);
 *
 *   // Direct agent access
 *   const triageAgent = agents.orchestrator.getAgent('phone_triage');
 *   const result = await triageAgent.run(context);
 */

const { AgentOrchestrator } = require('./orchestrator');
const { PhoneTriageAgent } = require('./phone-triage-agent');
const { FrontDeskAgent } = require('./front-desk-agent');
const { MAAgent } = require('./ma-agent');
const { PhysicianAgent } = require('./physician-agent');
const { ScribeAgent } = require('./scribe-agent');
const { CDSAgent } = require('./cds-agent');
const { OrdersAgent } = require('./orders-agent');
const { CodingAgent } = require('./coding-agent');
const { QualityAgent } = require('./quality-agent');

// ==========================================
// SINGLETON ORCHESTRATOR
// ==========================================

const orchestrator = new AgentOrchestrator();

// Register all 9 agents
// Pre-visit agents (no encounter dependencies — run on-demand)
orchestrator
  .register(new PhoneTriageAgent())
  .register(new FrontDeskAgent())
  .register(new MAAgent())
  .register(new PhysicianAgent());

// Encounter pipeline agents (dependency-ordered)
orchestrator
  .register(new ScribeAgent())       // Phase 1 — no deps
  .register(new CDSAgent())          // Phase 1 — no deps
  .register(new OrdersAgent())       // Phase 2 — depends on scribe + cds
  .register(new CodingAgent())       // Phase 2 — depends on scribe + cds
  .register(new QualityAgent());     // Phase 3 — depends on all above

// ==========================================
// EVENT LOGGING
// ==========================================

orchestrator.on('pipeline:start', (data) => {
  console.log(`[Agents] Pipeline started for encounter ${data.encounterId}`);
});

orchestrator.on('pipeline:phase', (data) => {
  console.log(`[Agents] Phase ${data.phase}/${data.totalPhases}: ${data.agents.join(', ')}`);
});

orchestrator.on('agent:complete', (data) => {
  console.log(`[Agents] ${data.agent} completed in ${data.executionTimeMs}ms`);
});

orchestrator.on('agent:error', (data) => {
  console.error(`[Agents] ${data.agent} error: ${data.error}`);
});

orchestrator.on('pipeline:complete', (data) => {
  console.log(`[Agents] Pipeline complete: ${data.totalTimeMs}ms total, ${Object.keys(data.results).length} agents`);
});

// ==========================================
// CONTEXT BUILDER
// ==========================================

/**
 * Build a PatientContext from the database.
 * This is the shared data contract consumed by all agents.
 */
async function buildContext(patientId, encounterId, db) {
  const [patient, problems, medications, allergies, labs, vitals, encounter] = await Promise.all([
    db.getPatientById(patientId),
    db.getPatientProblems(patientId),
    db.getPatientMedications(patientId),
    db.getPatientAllergies(patientId),
    db.getPatientLabs(patientId),
    db.getPatientVitals(patientId),
    encounterId ? db.getEncounterById(encounterId) : null
  ]);

  // Get pending orders if available
  let labOrders = [];
  let imagingOrders = [];
  let referrals = [];
  let prescriptions = [];

  try {
    if (db.getEncounterLabOrders) labOrders = await db.getEncounterLabOrders(encounterId) || [];
    if (db.getEncounterImagingOrders) imagingOrders = await db.getEncounterImagingOrders(encounterId) || [];
    if (db.getEncounterReferrals) referrals = await db.getEncounterReferrals(encounterId) || [];
    if (db.getEncounterPrescriptions) prescriptions = await db.getEncounterPrescriptions(encounterId) || [];
  } catch (err) {
    console.log('[Agents] Some order queries not available:', err.message);
  }

  // Get workflow state
  let workflow = null;
  try {
    if (db.getWorkflowState) workflow = await db.getWorkflowState(encounterId);
  } catch (err) {
    // Workflow may not exist for this encounter
  }

  return {
    patient: patient || {},
    encounter: encounter || {},
    vitals: (Array.isArray(vitals) && vitals.length > 0) ? vitals[0] : (vitals || {}),
    problems: problems || [],
    medications: medications || [],
    allergies: allergies || [],
    labs: labs || [],
    labOrders,
    imagingOrders,
    referrals,
    prescriptions,
    workflow
  };
}

/**
 * Run the full encounter pipeline (Scribe → CDS → Orders → Coding → Quality).
 */
async function runEncounterPipeline(patientId, encounterId, db, options = {}) {
  const context = await buildContext(patientId, encounterId, db);
  // Only run encounter agents by default
  const encounterAgents = ['scribe', 'cds', 'orders', 'coding', 'quality'];
  return orchestrator.runPipeline(context, { only: encounterAgents, ...options });
}

/**
 * Run the full pipeline including all agents.
 */
async function runPipeline(patientId, encounterId, db, options = {}) {
  const context = await buildContext(patientId, encounterId, db);
  return orchestrator.runPipeline(context, options);
}

/**
 * Run a single agent with fresh context.
 */
async function runAgent(agentName, patientId, encounterId, db, existingResults = {}) {
  const context = await buildContext(patientId, encounterId, db);
  return orchestrator.runAgent(agentName, context, existingResults);
}

module.exports = {
  orchestrator,
  buildContext,
  runPipeline,
  runEncounterPipeline,
  runAgent,
  // Export classes for testing / customization
  PhoneTriageAgent,
  FrontDeskAgent,
  MAAgent,
  PhysicianAgent,
  ScribeAgent,
  CDSAgent,
  OrdersAgent,
  CodingAgent,
  QualityAgent,
  AgentOrchestrator
};
