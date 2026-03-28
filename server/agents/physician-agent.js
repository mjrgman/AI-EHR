/**
 * Agentic EHR Physician Agent
 * The brain of the system. The provider's personal AI agent.
 */

const { BaseAgent } = require('./base-agent');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class PhysicianAgent extends BaseAgent {
  constructor(options = {}) {
    super('physician', {
      description: 'Physician Agent — clinical decision support, note editing, order management, learning engine',
      dependsOn: [],
      priority: 20,
      autonomyTier: 3, // Tier 3: Physician-in-the-Loop — all actions require physician approval
      ...options
    });

    this.preferences = this._initializePreferences(options.providerName || 'Dr. Provider');
    this.protocols = options.protocols || this._buildDefaultProtocols();
    this.escalationResponses = this._buildEscalationResponses();
    this.decisionLog = [];
  }

  async process(context, agentResults = {}) {
    const { requestType, payload } = context.physicianRequest || {};

    if (!requestType) {
      return {
        status: 'idle',
        message: 'Physician Agent ready. Awaiting escalation, note edit, or order request.',
        learning_stage: this._assessLearningStage()
      };
    }

    switch (requestType) {
      case 'escalation':
        return await this.handleEscalation(context, payload);
      case 'note_edit':
        return await this.editNote(context, payload);
      case 'patient_letter':
        return await this.generatePatientLetter(context, payload);
      case 'referral_letter':
        return await this.generateReferralLetter(context, payload);
      case 'post_visit':
        return await this.managePostVisit(context, payload);
      case 'update_protocols':
        return await this.updateProtocols(context, payload);
      case 'learn_from_encounter':
        return await this.learnFromEncounter(context, payload);
      default:
        return {
          status: 'error',
          message: `Unknown physician request type: ${requestType}`
        };
    }
  }

  async handleEscalation(context, escalationPayload) {
    const { escalation } = escalationPayload;

    const autoResponse = this._findAutoResponseForEscalation(escalation.type);

    if (autoResponse) {
      const directive = this._generateDirective(escalation, autoResponse, context);
      
      return {
        status: 'escalation_handled',
        decision: 'auto_response_generated',
        escalation_id: escalation.escalation_id,
        directive_id: directive.directive_id,
        instructions: directive.instructions,
        to_agent: 'ma_agent',
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'escalation_received',
      decision: 'requires_physician_review',
      escalation_id: escalation.escalation_id,
      escalation_type: escalation.type,
      patient_name: escalation.patient_name,
      context: escalation.patient_context,
      action_required: 'PHYSICIAN REVIEW PENDING',
      timestamp: new Date().toISOString()
    };
  }

  _generateDirective(escalation, responseTemplate, context) {
    const directive = {
      directive_id: uuidv4(),
      in_response_to: escalation.escalation_id,
      from: 'physician_agent',
      to: 'ma_agent',
      instructions: responseTemplate.instructions,
      orders: responseTemplate.orders || [],
      timestamp: new Date().toISOString()
    };

    this.decisionLog.push({
      type: 'escalation_response',
      escalation_type: escalation.type,
      decision: responseTemplate.template_id,
      timestamp: directive.timestamp
    });

    return directive;
  }

  async editNote(context, notePayload) {
    const { draft_note } = notePayload;

    if (!draft_note) {
      return {
        status: 'error',
        message: 'No draft note provided for editing'
      };
    }

    const edited = this._applyStylePreferences(draft_note, this.preferences);
    const validation = this._validateNote(edited);
    const abbreviationEdits = this.preferences.uses_abbreviations ? this._suggestAbbreviations(edited) : [];

    return {
      status: 'note_edited',
      original_length: draft_note.length,
      edited_length: edited.length,
      edited_note: edited,
      validations: validation,
      abbreviation_suggestions: abbreviationEdits,
      style_applied: {
        verbosity: this.preferences.documentation_style.verbosity,
        uses_abbreviations: this.preferences.uses_abbreviations
      },
      timestamp: new Date().toISOString()
    };
  }

  async generatePatientLetter(context, letterPayload) {
    const { patient } = context;
    const { letterType, content } = letterPayload;

    const signature = this.preferences.communication_style.sign_off;
    let letterContent = '';

    switch (letterType) {
      case 'after_visit_summary':
        letterContent = `Dear ${patient.name},\n\nThank you for your visit. Here is a summary:\n\n${content.assessment}\n\n${content.plan}\n\n${signature}`;
        break;
      case 'lab_results':
        letterContent = `Dear ${patient.name},\n\nYour lab results: ${content.results}\n\n${signature}`;
        break;
      default:
        letterContent = `${content}\n\n${signature}`;
    }

    return {
      status: 'letter_generated',
      letter_type: letterType,
      recipient: patient.name,
      letter_content: letterContent,
      ready_for_transmission: true,
      timestamp: new Date().toISOString()
    };
  }

  async generateReferralLetter(context, letterPayload) {
    const { patient, problems } = context;
    const { specialty, reason, specialist_name } = letterPayload;
    const signature = this.preferences.communication_style.sign_off;

    const letterContent = `
TO: ${specialist_name || specialty}
FROM: ${signature}
RE: ${patient.name} (MRN: ${patient.mrn})

REASON FOR REFERRAL:
${reason}

ACTIVE PROBLEMS:
${(problems || []).map(p => `- ${p.problem_name}`).join('\n')}

${signature}
    `;

    return {
      status: 'referral_letter_generated',
      specialty,
      patient_name: patient.name,
      letter_content: letterContent,
      ready_for_transmission: true,
      timestamp: new Date().toISOString()
    };
  }

  async managePostVisit(context, postVisitPayload) {
    const { ordersResult } = postVisitPayload;

    const prescriptionQueue = (ordersResult?.prescriptions || []).map(rx => ({ ...rx, status: 'queued_for_transmission' }));
    const labOrderQueue = (ordersResult?.labOrders || []).map(order => ({ ...order, status: 'queued_for_transmission' }));
    const imagingOrderQueue = (ordersResult?.imagingOrders || []).map(order => ({ ...order, status: 'queued_for_transmission' }));
    const referralLetterQueue = (ordersResult?.referrals || []).map(ref => ({ ...ref, status: 'queued_for_transmission' }));

    return {
      status: 'post_visit_complete',
      queues: {
        prescriptions: prescriptionQueue.length,
        lab_orders: labOrderQueue.length,
        imaging_orders: imagingOrderQueue.length,
        referral_letters: referralLetterQueue.length
      },
      actions: [
        `${prescriptionQueue.length} prescriptions queued`,
        `${labOrderQueue.length} lab orders queued`,
        `${imagingOrderQueue.length} imaging orders queued`,
        `${referralLetterQueue.length} referral letters queued`
      ],
      timestamp: new Date().toISOString()
    };
  }

  async updateProtocols(context, updatePayload) {
    const { action, protocol } = updatePayload;

    switch (action) {
      case 'add':
        this.protocols.push({ ...protocol, created_date: new Date().toISOString() });
        return { status: 'protocol_added', protocol_id: protocol.id };
      case 'update':
        const index = this.protocols.findIndex(p => p.id === protocol.id);
        if (index >= 0) {
          this.protocols[index] = { ...this.protocols[index], ...protocol };
          return { status: 'protocol_updated', protocol_id: protocol.id };
        }
        return { status: 'error', message: 'Protocol not found' };
      default:
        return { status: 'error', message: `Unknown action: ${action}` };
    }
  }

  async learnFromEncounter(context, learningPayload) {
    const { originalNote, editedNote, finalOrders } = learningPayload;

    if (originalNote && editedNote) {
      this._learnDocumentationStyle(originalNote, editedNote);
    }

    return {
      status: 'learning_updated',
      encounter_learned: true,
      learning_progress: {
        documentation_examples: this.preferences.documentation_examples.length,
        ordering_patterns_learned: Object.keys(this.preferences.ordering_patterns).length
      },
      timestamp: new Date().toISOString()
    };
  }

  _initializePreferences(providerName) {
    return {
      provider_name: providerName,
      documentation_style: {
        verbosity: 'moderate',
        uses_abbreviations: true,
        assessment_style: 'numbered_list'
      },
      uses_abbreviations: true,
      ordering_patterns: {
        'E11': { typical_labs: ['Hemoglobin A1C', 'CMP', 'Lipid Panel'] },
        'I10': { typical_labs: ['BMP', 'Lipid Panel'] }
      },
      communication_style: {
        patient_letter_tone: 'warm_professional',
        sign_off: providerName + ', M.D.'
      },
      documentation_examples: []
    };
  }

  _buildDefaultProtocols() {
    return [
      { id: 'refill-antihypertensive', type: 'medication_refill', medication_class: 'antihypertensive', auto_approve: true },
      { id: 'refill-statin', type: 'medication_refill', medication_class: 'statin', auto_approve: true },
      { id: 'refill-controlled', type: 'medication_refill', medication_class: 'controlled_substance', auto_approve: false }
    ];
  }

  _buildEscalationResponses() {
    return [
      { template_id: 'bp_uncontrolled', escalation_type: 'refill_request_protocol_condition_failed', instructions: 'BP not at goal. Schedule appointment. Do not refill.' }
    ];
  }

  _findAutoResponseForEscalation(escalationType) {
    const template = this.escalationResponses.find(r => r.escalation_type === escalationType);
    return template || null;
  }

  _applyStylePreferences(note, prefs) {
    let edited = note;
    for (const phrase of prefs.documentation_style.avoided_phrases || []) {
      edited = edited.replace(new RegExp(phrase, 'gi'), '');
    }
    return edited;
  }

  _validateNote(note) {
    const requiredSections = ['Subjective', 'Objective', 'Assessment', 'Plan'];
    const missing = requiredSections.filter(s => !note.includes(s));
    return {
      complete: missing.length === 0,
      missing_sections: missing,
      ready_to_sign: missing.length === 0 && !note.includes('[')
    };
  }

  _suggestAbbreviations(note) {
    const suggestions = [];
    if (note.includes('Hypertension')) suggestions.push({ original: 'Hypertension', abbreviation: 'HTN' });
    if (note.includes('Diabetes')) suggestions.push({ original: 'Diabetes', abbreviation: 'DM' });
    return suggestions;
  }

  _learnDocumentationStyle(original, edited) {
    this.preferences.documentation_examples.push({
      original: original.substring(0, 100),
      edited: edited.substring(0, 100),
      timestamp: new Date().toISOString()
    });
  }

  _assessLearningStage() {
    const examplesCount = this.preferences.documentation_examples.length;
    if (examplesCount < 10) return 'early_learning';
    if (examplesCount < 50) return 'developing';
    return 'experienced';
  }
}

module.exports = { PhysicianAgent };
