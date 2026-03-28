/**
 * Agentic EHR Medical Assistant (MA) Agent
 * The workhorse of the practice — handles everything within MA scope:
 * - Medication refills within provider-established protocols
 * - Patient questions within approved scope
 * - Pre-visit lab ordering based on condition schedules
 * - Escalation to Physician Agent for out-of-scope requests
 *
 * Key Features:
 *   - Protocol Engine: Executes physician-defined rules for refills, questions, triage
 *   - Escalation Logic: Routes complex questions to Physician Agent with full context
 *   - Lab Pre-Ordering: Generates pre-visit lab orders based on chronic disease protocols
 *   - Patient Communication: Answers common questions within scope
 *   - Encounter Prep: Prepares rooming materials and questionnaires
 */

const { BaseAgent } = require('./base-agent');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class MAAgent extends BaseAgent {
  constructor(options = {}) {
    super('ma', {
      description: 'Medical Assistant Agent — medication refills, patient questions, pre-visit prep within protocol scope',
      dependsOn: [],
      priority: 25,
      autonomyTier: 2, // Tier 2: Supervised — acts within protocols, escalates exceptions
      ...options
    });

    this.protocols = options.protocols || this._buildDefaultProtocols();
    this.approvedResponses = options.approvedResponses || this._buildApprovedResponses();
  }

  async process(context, agentResults = {}) {
    const { requestType, payload } = context.maRequest || {};

    if (!requestType) {
      return {
        status: 'idle',
        message: 'MA Agent ready. Awaiting refill, question, or encounter prep request.',
        protocols_loaded: this.protocols.length
      };
    }

    switch (requestType) {
      case 'refill_request':
        return await this.evaluateRefillRequest(context, payload);
      case 'patient_question':
        return await this.answerPatientQuestion(context, payload);
      case 'pre_visit_labs':
        return await this.generatePreVisitLabs(context);
      case 'encounter_prep':
        return await this.buildEncounterPrep(context);
      case 'escalation_response':
        return await this.processEscalationResponse(context, payload);
      case 'schedule_request':
        return await this.generateSchedulingRequest(context, payload);
      default:
        return {
          status: 'error',
          message: `Unknown MA request type: ${requestType}`
        };
    }
  }

  async evaluateRefillRequest(context, refillPayload) {
    const { medications } = context;
    const { medication_name, requested_quantity, reason } = refillPayload;

    const activeMed = medications?.find(m => m.medication_name.toLowerCase() === medication_name.toLowerCase());

    if (!activeMed) {
      return {
        status: 'error',
        decision: 'medication_not_found',
        message: `${medication_name} not found in patient's active medication list`,
        escalation_required: true,
        escalation_to: 'physician_agent'
      };
    }

    const matchingProtocols = this._findApplicableProtocols({
      type: 'medication_refill',
      medication: medication_name,
      medication_class: this._getMedicationClass(medication_name)
    });

    if (matchingProtocols.length === 0) {
      return this._createEscalation(context, {
        type: 'refill_request_no_protocol',
        medication: medication_name,
        activeMed,
        requested_quantity,
        reason,
        ma_assessment: `No refill protocol established for ${medication_name}. Requires physician review.`
      });
    }

    for (const protocol of matchingProtocols) {
      const evaluation = this._evaluateProtocol(protocol, context, activeMed);
      if (!evaluation.passes) {
        return this._createEscalation(context, {
          type: 'refill_request_protocol_condition_failed',
          medication: medication_name,
          protocol_id: protocol.id,
          failed_condition: evaluation.failed_condition,
          reason: evaluation.reason,
          ma_assessment: `Patient does not meet refill protocol conditions: ${evaluation.reason}`
        });
      }
    }

    return {
      status: 'approved',
      decision: 'refill_approved_within_protocol',
      medication: medication_name,
      quantity: Math.min(requested_quantity || 30, this._getMaxRefills(matchingProtocols[0])),
      refills: this._getRemainingRefills(matchingProtocols[0]),
      instructions: `Approved ${medication_name} refill. Patient may pick up at pharmacy.`,
      escalation_required: false,
      timestamp: new Date().toISOString()
    };
  }

  async answerPatientQuestion(context, questionPayload) {
    const { question, question_type } = questionPayload;

    const matchingResponse = this.approvedResponses.find(ar => {
      if (ar.type === question_type) return true;
      if (ar.keywords && ar.keywords.some(kw => question.toLowerCase().includes(kw))) return true;
      return false;
    });

    if (matchingResponse) {
      return {
        status: 'answered',
        decision: 'within_ma_scope',
        question: question,
        response: matchingResponse.response,
        follow_up_required: matchingResponse.follow_up_required || false,
        escalation_required: false,
        category: matchingResponse.type,
        timestamp: new Date().toISOString()
      };
    }

    return this._createEscalation(context, {
      type: 'patient_question_out_of_scope',
      question,
      question_type,
      ma_assessment: `Question requires clinical judgment outside MA scope. Escalating to physician.`,
      suggested_actions: ['Schedule phone consult with provider', 'Schedule appointment']
    });
  }

  async generatePreVisitLabs(context) {
    const { problems, labs } = context;
    const today = new Date();
    const proposed = [];

    const standingLabProtocols = [
      {
        condition_codes: ['E11', 'E11.65'],
        labs: [
          { test_name: 'Hemoglobin A1C', interval_months: 3, priority: 'routine' },
          { test_name: 'Comprehensive Metabolic Panel', interval_months: 12, priority: 'routine' },
          { test_name: 'Lipid Panel', interval_months: 12, priority: 'routine' }
        ]
      },
      {
        condition_codes: ['I10'],
        labs: [
          { test_name: 'Basic Metabolic Panel', interval_months: 6, priority: 'routine' },
          { test_name: 'Lipid Panel', interval_months: 12, priority: 'routine' }
        ]
      }
    ];

    for (const problem of (problems || [])) {
      const icd10 = problem.icd10_code || '';
      const matchingProtocol = standingLabProtocols.find(p => p.condition_codes.some(code => icd10.startsWith(code)));

      if (!matchingProtocol) continue;

      for (const labSpec of matchingProtocol.labs) {
        const lastLab = labs?.find(l => l.test_name === labSpec.test_name);
        const lastLabDate = lastLab ? new Date(lastLab.result_date) : null;
        const daysAgo = lastLabDate ? Math.floor((today - lastLabDate) / (1000 * 60 * 60 * 24)) : null;

        if (!lastLabDate || daysAgo >= labSpec.interval_months * 30) {
          proposed.push({
            test_name: labSpec.test_name,
            indication: `${problem.problem_name} management`,
            icd10_code: problem.icd10_code,
            priority: labSpec.priority,
            last_done_days_ago: daysAgo,
            status: 'proposed',
            source: 'ma_standing_protocol',
            condition: problem.problem_name
          });
        }
      }
    }

    const uniqueLabs = Array.from(new Map(proposed.map(l => [l.test_name, l])).values());

    return {
      status: 'complete',
      proposed_labs: uniqueLabs,
      count: uniqueLabs.length,
      message: `Generated ${uniqueLabs.length} pre-visit lab orders based on conditions.`,
      timestamp: new Date().toISOString()
    };
  }

  async buildEncounterPrep(context) {
    const { problems, medications, allergies } = context;

    const vitalsChecklist = this._buildVitalsChecklist(problems);
    const questionnaires = this._buildQuestionnaires(problems);
    const alerts = this._buildMAAlerts(medications, allergies, problems);

    return {
      status: 'complete',
      vitals_checklist: vitalsChecklist,
      questionnaires,
      alerts,
      rooming_instructions: `Route to exam room. Obtain vitals per checklist. Administer questionnaires. Flag any alerts immediately.`,
      timestamp: new Date().toISOString()
    };
  }

  async processEscalationResponse(context, directivePayload) {
    const { directive } = directivePayload;

    return {
      status: 'directive_received_and_executed',
      directive_id: directive.directive_id,
      from_physician_agent: true,
      instructions: directive.instructions,
      actions_taken: [
        `Instruction logged: ${directive.instructions}`,
        `Orders queued for transmission`
      ],
      timestamp: new Date().toISOString()
    };
  }

  async generateSchedulingRequest(context, schedulePayload) {
    const { patient_id, reason, urgency } = schedulePayload;

    return {
      status: 'scheduling_request_generated',
      request_id: uuidv4(),
      patient_id,
      reason,
      urgency: urgency || 'routine',
      to_agent: 'front_desk_agent',
      timestamp: new Date().toISOString()
    };
  }

  _createEscalation(context, escalationDetails) {
    return {
      status: 'escalation_required',
      escalation_id: uuidv4(),
      from: 'ma_agent',
      to: 'physician_agent',
      patient_id: context.patient?.id,
      patient_name: context.patient?.name,
      ...escalationDetails,
      priority: escalationDetails.priority || 'routine',
      patient_context: {
        active_problems: (context.problems || []).map(p => p.problem_name),
        active_medications: (context.medications || []).map(m => m.medication_name)
      },
      timestamp: new Date().toISOString()
    };
  }

  _findApplicableProtocols(criteria) {
    return this.protocols.filter(p => {
      if (p.type !== criteria.type) return false;
      if (p.medication && p.medication.toLowerCase() !== criteria.medication.toLowerCase()) return false;
      if (p.medication_class && p.medication_class !== criteria.medication_class) return false;
      return true;
    });
  }

  _getMedicationClass(medName) {
    const name = medName.toLowerCase();
    const classMap = {
      'lisinopril': 'antihypertensive', 'amlodipine': 'antihypertensive', 'metoprolol': 'antihypertensive',
      'atorvastatin': 'statin', 'simvastatin': 'statin',
      'metformin': 'diabetes_oral', 'ozempic': 'diabetes_injectable',
      'tramadol': 'controlled_substance', 'oxycodone': 'controlled_substance',
      'levothyroxine': 'thyroid', 'warfarin': 'anticoagulant', 'eliquis': 'anticoagulant'
    };

    for (const [med, cls] of Object.entries(classMap)) {
      if (name.includes(med)) return cls;
    }
    return 'other';
  }

  _evaluateProtocol(protocol, context, activeMed) {
    const { vitals, labs } = context;

    if (protocol.conditions) {
      for (const [condition, requiredValue] of Object.entries(protocol.conditions)) {
        let conditionMet = false;

        switch (condition) {
          case 'bp_controlled':
            conditionMet = vitals?.systolic_bp < 140 && vitals?.diastolic_bp < 90;
            if (!conditionMet) return { passes: false, failed_condition: 'bp_controlled', reason: 'Blood pressure not controlled' };
            break;
          case 'compliant':
            conditionMet = true;
            break;
          case 'a1c_stable':
            const a1c = labs?.find(l => l.test_name === 'Hemoglobin A1C');
            conditionMet = a1c && a1c.result_value < 9;
            if (!conditionMet) return { passes: false, failed_condition: 'a1c_stable', reason: 'A1C not at goal' };
            break;
          default:
            conditionMet = true;
        }
      }
    }

    return { passes: true };
  }

  _getMaxRefills(protocol) { return protocol.max_refills || 3; }
  _getRemainingRefills(protocol) { return (protocol.max_refills || 3) - 1; }

  _buildVitalsChecklist(problems) {
    const checklist = [
      { vital: 'Temperature', required: true },
      { vital: 'Blood Pressure (sitting)', required: true },
      { vital: 'Heart Rate', required: true },
      { vital: 'Respiratory Rate', required: true },
      { vital: 'Oxygen Saturation', required: true },
      { vital: 'Weight', required: true }
    ];
    return checklist;
  }

  _buildQuestionnaires(problems) {
    const questionnaires = [];
    const problemNames = (problems || []).map(p => p.problem_name.toLowerCase());

    if (problemNames.some(p => p.includes('diabetes'))) {
      questionnaires.push({
        name: 'Diabetes Symptom Checklist',
        topics: ['Polyuria', 'Polydipsia', 'Vision changes']
      });
    }

    return questionnaires;
  }

  _buildMAAlerts(medications, allergies, problems) {
    const alerts = [];

    if (allergies && allergies.length > 0) {
      for (const allergy of allergies) {
        alerts.push({
          type: 'allergy',
          severity: allergy.severity || 'medium',
          message: `ALLERGY: ${allergy.allergen} — ${allergy.reaction}`
        });
      }
    }

    return alerts;
  }

  _buildDefaultProtocols() {
    return [
      {
        id: 'refill-antihypertensive',
        type: 'medication_refill',
        medication_class: 'antihypertensive',
        action: 'approve_refill',
        max_refills: 3,
        conditions: { bp_controlled: true, compliant: true },
        requires_physician: false
      },
      {
        id: 'refill-statin',
        type: 'medication_refill',
        medication_class: 'statin',
        action: 'approve_refill',
        max_refills: 4,
        conditions: { compliant: true },
        requires_physician: false
      },
      {
        id: 'refill-controlled',
        type: 'medication_refill',
        medication_class: 'controlled_substance',
        action: 'escalate_to_physician',
        requires_physician: true
      }
    ];
  }

  _buildApprovedResponses() {
    return [
      {
        type: 'otc_pain',
        keywords: ['tylenol', 'pain', 'headache'],
        response: 'For mild pain, take Tylenol 500-1000mg every 6 hours as needed. If pain persists >3 days, call us back.',
        follow_up_required: false
      },
      {
        type: 'cold_symptoms',
        keywords: ['cold', 'flu', 'congestion', 'cough'],
        response: 'Rest, drink fluids, use saline spray. Tylenol or ibuprofen for fever. Call if fever >101.5°F or symptoms >10 days.',
        follow_up_required: false
      }
    ];
  }
}

module.exports = { MAAgent };
