/**
 * Canonical module registry for the Agentic EHR runtime.
 *
 * The system is implemented as agents, but the product is better understood as
 * a set of clinical workflow modules with explicit human ownership, handoffs,
 * and safety boundaries.
 */

const MODULE_ORDER = [
  'phone_triage',
  'front_desk',
  'ma',
  'physician',
  'scribe',
  'cds',
  'orders',
  'coding',
  'quality'
];

const MODULE_REGISTRY = Object.freeze({
  phone_triage: Object.freeze({
    key: 'phone_triage',
    displayName: 'Phone Triage',
    workflowBand: 'access',
    humanCounterpart: 'phone triage / nurse intake',
    autonomyTier: 1,
    summary: 'Turns inbound calls into urgency-classified chart events and routing decisions.',
    primaryInputs: ['caller reason', 'symptoms', 'call transcript', 'patient context'],
    primaryOutputs: ['triage note', 'urgency level', 'routing target'],
    primaryHandoff: 'ma, physician, or front_desk',
    patientControlBoundary: 'Uses verified caller context and approved triage protocols; emergencies are escalated explicitly.'
  }),
  front_desk: Object.freeze({
    key: 'front_desk',
    displayName: 'Front Desk',
    workflowBand: 'access_and_pre_visit',
    humanCounterpart: 'front desk / scheduling',
    autonomyTier: 1,
    summary: 'Handles scheduling, patient contact, and pre-visit briefing assembly.',
    primaryInputs: ['scheduling requests', 'patient demographics', 'visit context'],
    primaryOutputs: ['appointments', 'pre-visit briefings', 'patient contact tasks'],
    primaryHandoff: 'patient, physician, or ma',
    patientControlBoundary: 'Respects contact preferences and scheduling context; does not make clinical decisions.'
  }),
  ma: Object.freeze({
    key: 'ma',
    displayName: 'Medical Assistant',
    workflowBand: 'protocol_execution',
    humanCounterpart: 'medical assistant',
    autonomyTier: 2,
    summary: 'Executes refill, lab, and patient-support workflows inside clinician-defined protocols.',
    primaryInputs: ['triage handoffs', 'refill requests', 'protocol rules', 'patient context'],
    primaryOutputs: ['protocol actions', 'lab prep', 'escalations'],
    primaryHandoff: 'front_desk or physician',
    patientControlBoundary: 'Acts only within approved protocol scope and escalates anything that changes clinical judgment.'
  }),
  physician: Object.freeze({
    key: 'physician',
    displayName: 'Physician',
    workflowBand: 'clinical_governance',
    humanCounterpart: 'physician',
    autonomyTier: 3,
    summary: 'Owns protocol setting, clinical escalation handling, note shaping, and final clinical authority.',
    primaryInputs: ['ma escalations', 'scribe note draft', 'cds suggestions', 'post-visit tasks'],
    primaryOutputs: ['directives', 'signed clinical decisions', 'patient/referral communications'],
    primaryHandoff: 'ma, orders, patient, or chart',
    patientControlBoundary: 'Retains final human authority over any Tier 3 action or output.'
  }),
  scribe: Object.freeze({
    key: 'scribe',
    displayName: 'Scribe',
    workflowBand: 'encounter_capture',
    humanCounterpart: 'ambient scribe',
    autonomyTier: 3,
    summary: 'Captures the encounter, extracts structure, and drafts the SOAP note.',
    primaryInputs: ['encounter transcript', 'patient context', 'provider cues'],
    primaryOutputs: ['soap draft', 'structured clinical facts', 'note updates'],
    primaryHandoff: 'physician, cds, orders, coding, and quality',
    patientControlBoundary: 'Draft-only module; no note content becomes part of the permanent record without clinician review.'
  }),
  cds: Object.freeze({
    key: 'cds',
    displayName: 'Clinical Decision Support',
    workflowBand: 'encounter_support',
    humanCounterpart: 'clinical decision support',
    autonomyTier: 2,
    summary: 'Surfaces alerts, care gaps, medication risks, and evidence-based suggestions.',
    primaryInputs: ['patient context', 'labs', 'medications', 'scribe output'],
    primaryOutputs: ['alerts', 'recommendations', 'suggested orders or referrals'],
    primaryHandoff: 'physician, orders, or quality',
    patientControlBoundary: 'Recommendation-only module; never diagnoses, treats, or silently changes care.'
  }),
  orders: Object.freeze({
    key: 'orders',
    displayName: 'Orders',
    workflowBand: 'clinical_execution',
    humanCounterpart: 'ordering workflow',
    autonomyTier: 3,
    summary: 'Consolidates labs, imaging, referrals, and prescriptions into structured orders.',
    primaryInputs: ['scribe output', 'cds suggestions', 'physician intent'],
    primaryOutputs: ['order packets', 'prescription drafts', 'referral requests'],
    primaryHandoff: 'physician approval and downstream services',
    patientControlBoundary: 'Prepares orders but does not transmit them without physician authorization.'
  }),
  coding: Object.freeze({
    key: 'coding',
    displayName: 'Coding',
    workflowBand: 'revenue_and_documentation',
    humanCounterpart: 'coding / billing review',
    autonomyTier: 2,
    summary: 'Calculates E&M support, ICD-10 mapping, and coding completeness from the finalized encounter picture.',
    primaryInputs: ['scribe output', 'cds results', 'problem list', 'orders context'],
    primaryOutputs: ['coding summary', 'documentation gaps', 'billing alerts'],
    primaryHandoff: 'physician or billing staff',
    patientControlBoundary: 'Supports accurate coding but cannot distort clinical truth to optimize reimbursement.'
  }),
  quality: Object.freeze({
    key: 'quality',
    displayName: 'Quality',
    workflowBand: 'oversight_and_population_health',
    humanCounterpart: 'quality / compliance operations',
    autonomyTier: 2,
    summary: 'Monitors care gaps, measure compliance, and readiness for quality programs.',
    primaryInputs: ['scribe output', 'cds results', 'orders', 'coding', 'patient history'],
    primaryOutputs: ['quality gaps', 'measure status', 'compliance checks'],
    primaryHandoff: 'physician, ma, or quality operations',
    patientControlBoundary: 'Flags gaps and oversight concerns; does not auto-order care or override clinician judgment.'
  })
});

function getModuleDefinition(name) {
  return MODULE_REGISTRY[name] || null;
}

function listModules() {
  return MODULE_ORDER
    .map((name) => MODULE_REGISTRY[name])
    .filter(Boolean);
}

module.exports = {
  MODULE_ORDER,
  MODULE_REGISTRY,
  getModuleDefinition,
  listModules
};
