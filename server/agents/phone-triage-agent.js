/**
 * Agentic EHR Phone Triage Agent
 * Answers incoming calls and triages information into the chart.
 *
 * Capabilities:
 *   - Symptom assessment engine with urgency classification
 *   - Call routing logic (Front Desk, MA, Physician, Emergency)
 *   - Decision tree builder for each call
 *   - 15+ triage protocols (chest pain, fever, medication refill, etc.)
 *   - Triage note generation for the patient chart
 *
 * The agent works in "mock mode" without requiring the message bus.
 * It accepts context objects and returns structured triage results.
 */

const { BaseAgent } = require('./base-agent');

// Urgency levels with routing
const URGENCY_LEVELS = {
  EMERGENCY: { level: 0, label: 'Emergency (911/ER)', ttl: '0 min' },
  URGENT: { level: 1, label: 'Urgent (same-day)', ttl: '30 min' },
  SEMI_URGENT: { level: 2, label: 'Semi-urgent (next-day)', ttl: '24 hours' },
  ROUTINE: { level: 3, label: 'Routine (schedule normally)', ttl: '1-7 days' }
};

// Default routing table
const ROUTING_TABLE = {
  emergency: { route: 'emergency_dispatch', handler: 'emergency_services' },
  urgent: { route: 'physician_agent', handler: 'physician_direct' },
  semi_urgent: { route: 'ma_agent', handler: 'ma_escalation_queue' },
  routine: { route: 'front_desk_agent', handler: 'scheduling_queue' }
};

class PhoneTriageAgent extends BaseAgent {
  constructor(options = {}) {
    super('phone_triage', {
      description: 'Answers incoming calls and triages information into the chart',
      dependsOn: [],
      priority: 5, // Very high priority — may be the first entry point to system
      autonomyTier: 1, // Tier 1: Intake routing — autonomous within triage protocols
      ...options
    });

    // Triage protocols library
    this.protocols = this._buildProtocols();

    // Keywords for symptom detection
    this.emergencyKeywords = [
      'chest pain', 'chest pressure', 'crushing', 'breath', 'shortness of breath', 'can\'t breathe',
      'stroke', 'slurred speech', 'weakness', 'one side', 'facial droop',
      'severe bleeding', 'uncontrolled bleeding', 'blood loss',
      'unconscious', 'unresponsive', 'fainting', 'syncope',
      'severe allergic', 'anaphylaxis', 'difficulty swallowing', 'throat closing'
    ];

    this.urgentKeywords = [
      'fever', 'chest', 'severe pain', 'acute pain', 'vomiting blood',
      'difficulty breathing', 'abdominal', 'migraine', 'severe headache',
      'unable to', 'can\'t', 'not improving'
    ];
  }

  /**
   * Process an incoming call.
   *
   * @param {PatientContext} context
   * @param {Object} callInfo - { reason, symptoms[], callerType, patientId, transcript }
   * @returns {Promise<TriageResult>}
   */
  async process(context, agentResults = {}, callInfo = {}) {
    const callId = callInfo.callId || `call_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const reason = callInfo.reason || 'General inquiry';
    const symptoms = callInfo.symptoms || [];
    const callerType = callInfo.callerType || 'patient'; // patient | guardian | family
    const transcript = callInfo.transcript || '';

    // --- Step 1: Classify urgency ---
    const urgency = this._classifyUrgency(reason, symptoms, transcript, context);

    // --- Step 2: Match triage protocol ---
    const protocol = this._matchProtocol(reason, symptoms);

    // --- Step 3: Ask protocol-specific questions ---
    const questionsAsked = this._conductTriage(protocol, symptoms, context);

    // --- Step 4: Build decision tree ---
    const triageDecision = this._buildDecisionTree(urgency, reason, protocol, symptoms);

    // --- Step 5: Generate triage note ---
    const triageNote = this._generateTriageNote(callId, timestamp, context, reason, urgency, triageDecision, questionsAsked);

    return {
      status: 'complete',
      callId,
      timestamp,
      patientId: context.patient?.id,
      callerType,
      reason,
      symptoms,
      urgency: urgency.label,
      urgencyLevel: urgency.level,
      estimatedResponseTime: urgency.ttl,
      protocol: protocol?.name || 'general_inquiry',
      questionsAsked,
      triageDecision,
      triageNote,
      routing: ROUTING_TABLE[Object.keys(URGENCY_LEVELS).find(k => URGENCY_LEVELS[k].label === urgency.label)?.toLowerCase() || 'routine'],
      documentationReady: true
    };
  }

  /**
   * Classify urgency from chief complaint and symptoms.
   */
  _classifyUrgency(reason, symptoms, transcript, context) {
    const combined = `${reason} ${symptoms.join(' ')} ${transcript}`.toLowerCase();

    // Emergency check
    if (this.emergencyKeywords.some(kw => combined.includes(kw))) {
      // Verify with additional heuristics
      const emergencyPhrases = [
        'chest pain', 'stroke', 'difficulty breathing', 'unconscious',
        'severe bleeding', 'anaphylaxis', 'unable to move', 'facial droop'
      ];
      if (emergencyPhrases.some(phrase => combined.includes(phrase))) {
        return URGENCY_LEVELS.EMERGENCY;
      }
    }

    // Urgent check
    if (this.urgentKeywords.some(kw => combined.includes(kw))) {
      const urgentPhrases = [
        'fever >101.5', '101.5', '102', '103',
        'severe pain', 'acute', 'vomiting blood', 'can\'t breathe', 'difficulty breathing'
      ];
      if (
        urgentPhrases.some(phrase => combined.includes(phrase)) ||
        symptoms.length >= 2
      ) {
        return URGENCY_LEVELS.URGENT;
      }
    }

    // Check if patient has high-risk conditions that lower urgency threshold
    const problems = context.problems || [];
    const isHighRisk = problems.some(p => {
      const icd = p.icd10_code || '';
      return icd.startsWith('I2') || // Hypertension/HTN complications
             icd.startsWith('I4') || // Arrhythmias
             icd.startsWith('I5') || // Heart failure
             icd.startsWith('E1'); // Diabetes
    });

    if (isHighRisk && symptoms.length >= 1 && this.urgentKeywords.some(kw => combined.includes(kw))) {
      return URGENCY_LEVELS.SEMI_URGENT;
    }

    // Default: routine
    return URGENCY_LEVELS.ROUTINE;
  }

  /**
   * Match the call reason to a triage protocol.
   */
  _matchProtocol(reason, symptoms) {
    const combined = `${reason} ${symptoms.join(' ')}`.toLowerCase();

    for (const protocol of this.protocols) {
      for (const keyword of protocol.keywords) {
        if (combined.includes(keyword.toLowerCase())) {
          return protocol;
        }
      }
    }

    return null; // No protocol matched
  }

  /**
   * Conduct triage by asking protocol-specific questions.
   */
  _conductTriage(protocol, symptoms, context) {
    const questions = [];

    if (!protocol) {
      // Generic question set
      questions.push({
        order: 1,
        question: 'What is the main reason for your call today?',
        category: 'chief_complaint'
      });
      questions.push({
        order: 2,
        question: 'When did this start?',
        category: 'onset'
      });
      questions.push({
        order: 3,
        question: 'How severe is this on a scale of 1-10?',
        category: 'severity'
      });
      return questions;
    }

    // Protocol-specific questions
    if (protocol.questions) {
      protocol.questions.forEach((q, idx) => {
        questions.push({
          order: idx + 1,
          question: q,
          category: protocol.name
        });
      });
    }

    return questions;
  }

  /**
   * Build decision tree for routing and documentation.
   */
  _buildDecisionTree(urgency, reason, protocol, symptoms) {
    const urgencyKey = Object.keys(URGENCY_LEVELS).find(
      k => URGENCY_LEVELS[k].label === urgency.label
    );
    const urgencyLower = urgencyKey.toLowerCase();
    const routing = ROUTING_TABLE[urgencyLower] || ROUTING_TABLE.routine;

    let decision = {
      urgency: urgency.label,
      reason: reason,
      protocolMatched: protocol?.name || 'unmatched',
      route: routing.route,
      handler: routing.handler,
      rationale: this._generateRationale(urgency, protocol, symptoms),
      escalation: null
    };

    // Add escalation logic
    if (urgency.level <= URGENCY_LEVELS.URGENT.level) {
      decision.escalation = {
        target: 'physician_agent',
        reason: 'High-urgency call requires physician review',
        priority: 'immediate'
      };
    }

    if (urgency.level === URGENCY_LEVELS.EMERGENCY.level) {
      decision.escalation = {
        target: 'emergency_dispatch',
        reason: 'Emergency symptoms detected',
        priority: 'critical',
        action: 'Patient should call 911 immediately'
      };
    }

    return decision;
  }

  /**
   * Generate rationale for the triage decision.
   */
  _generateRationale(urgency, protocol, symptoms) {
    let rationale = '';

    if (urgency.level === URGENCY_LEVELS.EMERGENCY.level) {
      rationale = 'Emergency symptoms detected. Patient requires immediate evaluation.';
    } else if (urgency.level === URGENCY_LEVELS.URGENT.level) {
      rationale = `Urgent presentation (${symptoms.length} symptoms reported). Same-day evaluation recommended.`;
    } else if (urgency.level === URGENCY_LEVELS.SEMI_URGENT.level) {
      rationale = 'Multiple symptoms or worsening condition. Next-day appointment recommended.';
    } else {
      rationale = 'Routine inquiry. Standard scheduling applies.';
    }

    if (protocol?.rationale) {
      rationale += ` Protocol: ${protocol.rationale}`;
    }

    return rationale;
  }

  /**
   * Generate a structured triage note for the patient chart.
   */
  _generateTriageNote(callId, timestamp, context, reason, urgency, triageDecision, questionsAsked) {
    const patient = context.patient || {};
    const date = new Date(timestamp);
    const dateFormatted = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const timeFormatted = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const note = `PHONE TRIAGE NOTE — ${dateFormatted} ${timeFormatted}
Call ID: ${callId}

CALLER
Patient: ${patient.first_name} ${patient.last_name} (MRN: ${patient.mrn})
Relationship: ${context.caller?.type || 'Patient'}

REASON FOR CALL
${reason}

SYMPTOMS / CHIEF COMPLAINT
${context.symptoms?.join('\n') || '(No additional symptoms reported)'}

DURATION
${context.symptomDuration || '(Not specified)'}

URGENCY ASSESSMENT
Level: ${urgency.label}
Rationale: ${triageDecision.rationale}

TRIAGE PROTOCOL
Protocol Applied: ${triageDecision.protocolMatched}
Questions Asked: ${questionsAsked.length}
${questionsAsked.map((q, i) => `  ${i + 1}. ${q.question}`).join('\n')}

ROUTING DECISION
Route: ${triageDecision.route}
Handler: ${triageDecision.handler}
${triageDecision.escalation ? `
ESCALATION REQUIRED
  Target: ${triageDecision.escalation.target}
  Priority: ${triageDecision.escalation.priority}
  Reason: ${triageDecision.escalation.reason}
  ${triageDecision.escalation.action ? `Action: ${triageDecision.escalation.action}` : ''}
` : ''}

ACTION TAKEN
${this._generateAction(triageDecision)}

DISPOSITION
${this._generateDisposition(triageDecision)}

Triaged By: Phone Triage Agent (AI-assisted)
Status: Complete`;

    return note;
  }

  /**
   * Generate action summary for triage note.
   */
  _generateAction(triageDecision) {
    switch (triageDecision.route) {
      case 'emergency_dispatch':
        return 'Patient advised to call 911 immediately. Emergency routing triggered.';
      case 'physician_agent':
        return 'Call escalated to physician for direct evaluation. Physician will contact patient.';
      case 'ma_agent':
        return 'Call routed to MA Agent for initial assessment and scheduling. MA will follow up.';
      case 'front_desk_agent':
        return 'Call routed to Front Desk Agent for scheduling. Appointment offered.';
      default:
        return 'Call processed and routed per protocol.';
    }
  }

  /**
   * Generate disposition/next steps.
   */
  _generateDisposition(triageDecision) {
    const ttl = Object.values(URGENCY_LEVELS).find(
      u => u.label === triageDecision.urgency
    )?.ttl || '1-7 days';

    return `Estimated Response Time: ${ttl}
Follow-up: Standard protocol per triage level
Documented in Chart: Yes
Ready for Provider Review: Yes`;
  }

  /**
   * Build the comprehensive protocols library.
   */
  _buildProtocols() {
    return [
      {
        name: 'chest_pain_protocol',
        keywords: ['chest', 'chest pain', 'chest pressure', 'chest tightness'],
        rationale: 'Rapid assessment for acute coronary syndrome vs. benign etiology',
        questions: [
          'Is the pain constant or intermittent?',
          'Does it radiate to your arm, neck, or jaw?',
          'Are you having any shortness of breath?',
          'Do you have any nausea, sweating, or dizziness?',
          'Have you ever had a heart attack or cardiac event?',
          'What were you doing when the pain started?'
        ]
      },
      {
        name: 'shortness_of_breath_protocol',
        keywords: ['breath', 'shortness of breath', 'can\'t breathe', 'difficulty breathing', 'wheezing', 'dyspnea'],
        rationale: 'Assess for life-threatening causes: pulmonary embolism, pneumothorax, severe asthma, heart failure',
        questions: [
          'When did the shortness of breath start?',
          'Is it worse when lying down?',
          'Do you have any chest pain?',
          'Are you wheezing or coughing?',
          'Do you have a history of asthma, COPD, or heart disease?',
          'Are your lips or fingertips blue?'
        ]
      },
      {
        name: 'fever_protocol',
        keywords: ['fever', 'temperature', 'feels hot', 'chills', 'elevated temperature'],
        rationale: 'Age-stratified fever assessment (adults vs. pediatric)',
        questions: [
          'What is your current temperature?',
          'How long have you had the fever?',
          'Are you experiencing chills or sweating?',
          'Do you have a cough, sore throat, or body aches?',
          'Any recent sick contacts?',
          'Are you on any antibiotics?'
        ]
      },
      {
        name: 'abdominal_pain_protocol',
        keywords: ['abdominal', 'stomach', 'belly', 'stomach pain', 'abdominal pain'],
        rationale: 'Localize and characterize pain; rule out surgical emergencies',
        questions: [
          'Where exactly is the pain? (point if possible)',
          'Is it sharp, dull, crampy, or constant?',
          'When did it start?',
          'Is there any vomiting or diarrhea?',
          'Any recent trauma or injury?',
          'For females: could you be pregnant?'
        ]
      },
      {
        name: 'headache_protocol',
        keywords: ['headache', 'migraine', 'head pain', 'headaches'],
        rationale: 'Assess for migraine vs. tension vs. secondary (concerning) causes',
        questions: [
          'On a scale of 1-10, how severe is the headache?',
          'Is this a new type of headache?',
          'Do you have any vision changes, weakness, or numbness?',
          'Is there any fever, stiff neck, or rash?',
          'Any recent head trauma?',
          'When did this start? (minutes, hours, days)'
        ]
      },
      {
        name: 'medication_refill_protocol',
        keywords: ['refill', 'medication', 'medicine', 'prescription', 'ran out'],
        rationale: 'Verify patient identity, drug, dose, pharmacy; route per MA or physician protocol',
        questions: [
          'Which medication do you need refilled?',
          'What is your current dose and frequency?',
          'Who is your pharmacy?',
          'Is this your first refill or a continuing prescription?',
          'Any side effects or issues with this medication?'
        ]
      },
      {
        name: 'medication_side_effect_protocol',
        keywords: ['side effect', 'reaction', 'adverse', 'not feeling well on', 'rash from'],
        rationale: 'Assess severity and timing of adverse reaction; escalate if serious',
        questions: [
          'Which medication are you taking?',
          'When did you start it?',
          'What symptoms are you experiencing?',
          'How severe is the reaction? (1-10)',
          'Do you have any breathing difficulty or swelling of lips/tongue?',
          'Any previous allergies to this class of drug?'
        ]
      },
      {
        name: 'blood_sugar_protocol',
        keywords: ['blood sugar', 'glucose', 'diabetes', 'diabetic', 'blood glucose'],
        rationale: 'For known diabetic; assess for hypoglycemia vs. hyperglycemia vs. sick day management',
        questions: [
          'What is your current blood sugar reading?',
          'Are you experiencing symptoms: shakiness, sweating, confusion (low) or thirst, frequent urination (high)?',
          'When was your last insulin or diabetes medication dose?',
          'Have you eaten recently?',
          'Are you sick or experiencing any infection?',
          'Are you maintaining your usual diet?'
        ]
      },
      {
        name: 'blood_pressure_protocol',
        keywords: ['blood pressure', 'high blood pressure', 'hypertension', 'low blood pressure'],
        rationale: 'Assess for symptomatic hypertension or hypotension; rule out stroke/MI symptoms',
        questions: [
          'What is your current blood pressure reading?',
          'Are you experiencing any headache, dizziness, or vision changes?',
          'Any chest pain or shortness of breath?',
          'When was your last blood pressure medication dose?',
          'Have you been under any unusual stress?',
          'Any recent medication changes?'
        ]
      },
      {
        name: 'wound_injury_protocol',
        keywords: ['wound', 'injury', 'cut', 'laceration', 'bleed', 'burn', 'wound care'],
        rationale: 'Assess wound severity and bleeding; determine if ER/urgent care needed',
        questions: [
          'How long ago did the injury occur?',
          'How deep/severe is the wound?',
          'Is it still actively bleeding?',
          'Any dirt, foreign objects, or contamination?',
          'When was your last tetanus shot?',
          'Do you have any numbness or inability to move affected area?'
        ]
      },
      {
        name: 'urinary_symptoms_protocol',
        keywords: ['urinary', 'uti', 'dysuria', 'burning', 'urination', 'frequency', 'urgency'],
        rationale: 'Assess for UTI vs. STI vs. other urologic pathology',
        questions: [
          'Are you having pain or burning with urination?',
          'How often are you urinating?',
          'Is your urine cloudy, dark, or bloody?',
          'Do you have any lower abdominal or back pain?',
          'Any fever or chills?',
          'For females: any unusual vaginal discharge?'
        ]
      },
      {
        name: 'mental_health_crisis_protocol',
        keywords: ['suicide', 'suicidal', 'harm', 'self-harm', 'depressed', 'depression', 'anxiety', 'crisis'],
        rationale: 'Immediate assessment for safety; suicide/homicide risk; ER vs. crisis line routing',
        questions: [
          'Are you having thoughts of harming yourself or others?',
          'Do you have a plan to hurt yourself?',
          'Do you have access to means (pills, weapons, etc.)?',
          'Are you currently safe?',
          'Is there someone with you right now?',
          'Do you have mental health provider or recent psych hospitalizations?'
        ]
      },
      {
        name: 'post_procedure_concern_protocol',
        keywords: ['surgery', 'procedure', 'operation', 'post-op', 'after surgery', 'incision'],
        rationale: 'Assess for post-procedure complication: infection, bleeding, dehiscence, pain',
        questions: [
          'What procedure did you have and when?',
          'What specific concern do you have?',
          'Is the incision red, draining, or opening up?',
          'Are you running a fever?',
          'Are you experiencing severe pain or swelling?',
          'Any chest pain, shortness of breath, or severe bleeding?'
        ]
      },
      {
        name: 'lab_result_inquiry_protocol',
        keywords: ['lab', 'lab result', 'test result', 'results', 'biopsy', 'culture'],
        rationale: 'Provide result info; escalate if abnormal or requires action',
        questions: [
          'Which lab test are you inquiring about?',
          'When was the test performed?',
          'Have you been notified of your results?',
          'Do you have any questions about the results?'
        ]
      },
      {
        name: 'general_follow_up_scheduling_protocol',
        keywords: ['appointment', 'follow up', 'schedule', 'visit', 'see the doctor'],
        rationale: 'Route to Front Desk Agent for scheduling; determine urgency and appointment type',
        questions: [
          'What is the reason for your visit?',
          'When would you like to be seen?',
          'Is this for a routine follow-up or a new concern?',
          'Do you prefer morning or afternoon appointments?'
        ]
      }
    ];
  }
}

module.exports = { PhoneTriageAgent };
