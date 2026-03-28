/**
 * Agentic EHR Front Desk Agent
 * Handles scheduling, patient contact, and pre-visit preparation.
 *
 * Capabilities:
 *   - Appointment scheduling engine (find slots, schedule, reschedule, add-on)
 *   - Pre-visit intelligence briefing generator (CRITICAL per Vision Section IV)
 *   - Patient contact management (confirmations, reminders, notifications)
 *   - Check-in workflow support
 *
 * The agent works in "mock mode" without requiring a real scheduling system.
 * It generates synthetic provider availability and schedules appointments.
 */

const { BaseAgent } = require('./base-agent');

// Appointment types with default durations
const APPOINTMENT_TYPES = {
  new_patient: { name: 'New Patient', duration: 60 },
  follow_up: { name: 'Follow-Up', duration: 20 },
  annual_wellness: { name: 'Annual Wellness', duration: 40 },
  urgent: { name: 'Urgent', duration: 30 },
  procedure: { name: 'Procedure', duration: 45 }
};

// Default provider hours
const PROVIDER_HOURS = {
  monday: { start: 8, end: 17, slotIntervalMinutes: 20 },
  tuesday: { start: 8, end: 17, slotIntervalMinutes: 20 },
  wednesday: { start: 8, end: 17, slotIntervalMinutes: 20 },
  thursday: { start: 8, end: 17, slotIntervalMinutes: 20 },
  friday: { start: 8, end: 17, slotIntervalMinutes: 20 },
  saturday: null,
  sunday: null
};

class FrontDeskAgent extends BaseAgent {
  constructor(options = {}) {
    super('front_desk', {
      description: 'Scheduling, patient contact, and pre-visit preparation',
      dependsOn: [],
      priority: 20,
      autonomyTier: 1, // Tier 1: Scheduling and briefing — autonomous within protocols
      ...options
    });

    this.appointmentTypes = APPOINTMENT_TYPES;
    this.providerHours = options.providerHours || PROVIDER_HOURS;
    this.bookedAppointments = []; // In-memory appointment list for mock mode
  }

  /**
   * Main process method — routes to scheduling or briefing depending on context.
   *
   * @param {PatientContext} context
   * @param {Object} agentResults
   * @param {Object} requestInfo - { action, appointmentType, dateRange, urgency, etc. }
   * @returns {Promise<Object>}
   */
  async process(context, agentResults = {}, requestInfo = {}) {
    // Support action from either requestInfo (direct call) or context.frontDeskRequest (pipeline)
    const fdReq = context.frontDeskRequest || {};
    const action = requestInfo.action || fdReq.action || 'find_slots';

    switch (action) {
      case 'schedule':
        return this._scheduleAppointment(context, requestInfo);
      case 'reschedule':
        return this._rescheduleAppointment(context, requestInfo);
      case 'find_slots':
        return this._findAvailableSlots(context, requestInfo);
      case 'briefing':
        return this._generatePreVisitBriefing(context, requestInfo);
      case 'contact':
        return this._generatePatientContact(context, requestInfo);
      case 'check_in':
        return this._processCheckIn(context, requestInfo);
      default:
        throw new Error(`Unknown Front Desk action: ${action}`);
    }
  }

  /**
   * Find available appointment slots.
   */
  _findAvailableSlots(context, requestInfo) {
    const appointmentType = requestInfo.appointmentType || 'follow_up';
    const duration = this.appointmentTypes[appointmentType]?.duration || 20;
    const dateRangeStart = requestInfo.dateRangeStart || new Date();
    const dateRangeEnd = requestInfo.dateRangeEnd || new Date(dateRangeStart.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days out

    const slots = [];
    const current = new Date(dateRangeStart);

    // Generate available slots
    while (current <= dateRangeEnd && slots.length < 10) {
      const dayName = current.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const hours = this.providerHours[dayName];

      if (hours) {
        // Generate slots for this day
        for (let hour = hours.start; hour < hours.end; hour++) {
          for (let minute = 0; minute < 60; minute += hours.slotIntervalMinutes) {
            // Check if slot is available (not booked)
            const slotTime = new Date(current);
            slotTime.setHours(hour, minute, 0, 0);
            const slotEndTime = new Date(slotTime.getTime() + duration * 60000);

            if (this._isSlotAvailable(slotTime, slotEndTime)) {
              slots.push({
                slotId: `slot_${slotTime.getTime()}`,
                dateTime: slotTime.toISOString(),
                dateTimeFormatted: slotTime.toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                }),
                duration,
                appointmentType,
                available: true
              });

              if (slots.length >= 10) break;
            }
          }
          if (slots.length >= 10) break;
        }
      }

      current.setDate(current.getDate() + 1);
    }

    return {
      status: 'complete',
      action: 'find_slots',
      appointmentType,
      slotsRequested: 10,
      slotsFound: slots.length,
      slots,
      dateRange: {
        start: dateRangeStart.toLocaleDateString(),
        end: dateRangeEnd.toLocaleDateString()
      }
    };
  }

  /**
   * Schedule an appointment.
   */
  _scheduleAppointment(context, requestInfo) {
    const appointmentId = `appt_${Date.now()}`;
    const patientId = context.patient?.id;
    const appointmentType = requestInfo.appointmentType || 'follow_up';
    const slotId = requestInfo.slotId;
    const reason = requestInfo.reason || 'Follow-up';

    // Find the slot
    const slot = this._findSlotById(slotId);
    if (!slot) {
      return {
        status: 'error',
        message: 'Slot not found or no longer available'
      };
    }

    const appointment = {
      appointmentId,
      patientId,
      patientName: `${context.patient?.first_name} ${context.patient?.last_name}`,
      appointmentType,
      reason,
      dateTime: slot.dateTime,
      dateTimeFormatted: slot.dateTimeFormatted,
      duration: slot.duration,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      confirmationSent: false,
      reminderSent: false
    };

    // Add to booked appointments
    this.bookedAppointments.push(appointment);

    // Generate confirmation message
    const confirmationMessage = this._generateConfirmationMessage(appointment, context);

    return {
      status: 'complete',
      action: 'schedule',
      appointmentId,
      appointment,
      confirmationMessage,
      nextStep: 'confirmation_sent_to_patient'
    };
  }

  /**
   * Reschedule an existing appointment.
   */
  _rescheduleAppointment(context, requestInfo) {
    const appointmentId = requestInfo.appointmentId;
    const newSlotId = requestInfo.newSlotId;

    const existingAppt = this.bookedAppointments.find(a => a.appointmentId === appointmentId);
    if (!existingAppt) {
      return { status: 'error', message: 'Appointment not found' };
    }

    const newSlot = this._findSlotById(newSlotId);
    if (!newSlot) {
      return { status: 'error', message: 'New slot not found or unavailable' };
    }

    // Update appointment
    existingAppt.dateTime = newSlot.dateTime;
    existingAppt.dateTimeFormatted = newSlot.dateTimeFormatted;
    existingAppt.status = 'rescheduled';
    existingAppt.rescheduledAt = new Date().toISOString();

    const reschedulingMessage = this._generateReschedulingMessage(existingAppt, context);

    return {
      status: 'complete',
      action: 'reschedule',
      appointmentId,
      appointment: existingAppt,
      reschedulingMessage,
      nextStep: 'notification_sent_to_patient'
    };
  }

  /**
   * Generate pre-visit intelligence briefing (CRITICAL — Section IV of Vision).
   */
  _generatePreVisitBriefing(context, requestInfo) {
    const patient = context.patient || {};
    const encounter = context.encounter || {};
    const problems = context.problems || [];
    const medications = context.medications || [];
    const allergies = context.allergies || [];
    const labs = context.labs || [];
    const referrals = context.referrals || [];
    const vitals = context.vitals || {};

    // 1. Patient Identity & Demographics
    const identity = {
      name: `${patient.first_name} ${patient.last_name}`,
      mrn: patient.mrn,
      dob: patient.dob,
      age: this._calculateAge(patient.dob),
      sex: patient.sex,
      insurance: patient.insurance_carrier,
      insuranceId: patient.insurance_id,
      phone: patient.phone,
      email: patient.email,
      preferredContact: requestInfo.preferredContact || 'portal'
    };

    // 2. Reason for Visit
    const reasonForVisit = {
      scheduled: encounter.chief_complaint || requestInfo.reason || 'Routine visit',
      visitType: requestInfo.appointmentType || 'Follow-Up'
    };

    // 3. Active Problem Synopsis (NOT exhaustive history)
    const activeProblemsSynopsis = this._buildActiveProblemsSynopsis(problems, context, labs);

    // 4. Surgical History (brief)
    const surgicalHistory = this._extractSurgicalHistory(context.surgicalHistory || []);

    // 5. Post-Hospitalization Summary (if applicable)
    const postHospitalizationSummary = this._generatePostHospitalizationSummary(context.recentHospitalization);

    // 6. Current Medications
    const currentMedications = medications
      .filter(m => m.status === 'active')
      .map(m => ({
        medication: m.medication_name,
        dose: m.dose,
        frequency: m.frequency,
        prescriber: m.prescriber || 'PCP',
        indication: m.indication || 'per problem list'
      }));

    // 7. Allergies
    const allergyList = allergies.map(a => ({
      allergen: a.allergen,
      reaction: a.reaction,
      severity: a.severity
    }));

    // 8. Prior Physical Exam (most recent as template)
    const priorPhysicalExam = context.lastPhysicalExam || {
      date: 'Not on file',
      findings: 'Unremarkable'
    };

    // 9. Preventive Care Status
    const preventiveCareStatus = this._assessPreventiveCareStatus(patient, labs, referrals);

    // 10. Treatment Plan Carryforward
    const treatmentPlanCarryforward = this._buildTreatmentPlanCarryforward(problems, medications);

    // Assemble the briefing document
    const briefing = {
      patientId: patient.id,
      appointmentId: requestInfo.appointmentId,
      generatedAt: new Date().toISOString(),
      briefingFormat: 'markdown',
      sections: {
        identity,
        reasonForVisit,
        activeProblemsSynopsis,
        surgicalHistory,
        postHospitalizationSummary,
        currentMedications,
        allergies: allergyList,
        priorPhysicalExam,
        preventiveCareStatus,
        treatmentPlanCarryforward
      },
      briefingDocument: this._renderBriefingDocument(
        identity,
        reasonForVisit,
        activeProblemsSynopsis,
        surgicalHistory,
        postHospitalizationSummary,
        currentMedications,
        allergyList,
        preventiveCareStatus,
        treatmentPlanCarryforward
      )
    };

    return {
      status: 'complete',
      action: 'briefing',
      briefing,
      readyForProvider: true
    };
  }

  /**
   * Build Active Problems Synopsis — only relevant, current conditions.
   */
  _buildActiveProblemsSynopsis(problems, context, labs) {
    return problems
      .filter(p => p.status === 'active' || p.status === 'chronic')
      .slice(0, 10) // Top 10 active problems
      .map(p => {
        // Find last relevant lab for this problem
        let lastRelevantLab = null;
        if (p.icd10_code === 'E11' || p.icd10_code?.startsWith('E11')) {
          lastRelevantLab = labs.find(l => l.test_name?.toLowerCase().includes('a1c'));
        }

        return {
          condition: p.problem_name,
          icdCode: p.icd10_code,
          status: p.status,
          managedBy: p.managedBy || 'PCP',
          currentTreatment: context.medications
            ?.filter(m => m.status === 'active')
            ?.map(m => `${m.medication_name} ${m.dose} ${m.frequency}`)
            ?.join('; ') || 'No active medications',
          lastRelevantResult: lastRelevantLab ? `${lastRelevantLab.test_name}: ${lastRelevantLab.result_value} (${lastRelevantLab.result_date})` : null,
          nextActionNeeded: `Follow-up per plan. ${p.notes || ''}`
        };
      });
  }

  /**
   * Extract surgical history (brief).
   */
  _extractSurgicalHistory(surgicalHistory) {
    if (!surgicalHistory || surgicalHistory.length === 0) {
      return [{ note: 'No prior surgical history on file' }];
    }

    return surgicalHistory.slice(0, 5).map(sh => ({
      procedure: sh.procedure_name,
      date: sh.procedure_date,
      indication: sh.indication || 'Not specified'
    }));
  }

  /**
   * Generate post-hospitalization summary (1-2 paragraphs).
   */
  _generatePostHospitalizationSummary(recentHospitalization) {
    if (!recentHospitalization) {
      return null;
    }

    return {
      admissionDate: recentHospitalization.admission_date,
      dischargeDate: recentHospitalization.discharge_date,
      summary: `${recentHospitalization.reason_for_admission || 'Hospitalization'}. Treated by ${recentHospitalization.consultants?.join(', ') || 'medical team'}. Discharged on ${recentHospitalization.discharge_date} with diagnosis of ${recentHospitalization.discharge_diagnosis || 'per hospital records'}. Follow-up instructions: ${recentHospitalization.followup_instructions || 'Standard care per discharge summary'}. Pending diagnostics: ${recentHospitalization.pending_diagnostics?.join(', ') || 'None noted'}.`
    };
  }

  /**
   * Assess preventive care status.
   */
  _assessPreventiveCareStatus(patient, labs, referrals) {
    const age = this._calculateAge(patient.dob);
    const status = [];

    // Colonoscopy (age 45+)
    if (age >= 45) {
      const lastColo = labs.find(l => l.test_name?.toLowerCase().includes('colonoscopy'));
      status.push({
        screening: 'Colorectal Cancer Screening',
        age: `Age ${age}`,
        due: !lastColo,
        lastCompleted: lastColo?.result_date || 'Never'
      });
    }

    // Mammogram (women 40+)
    if (patient.sex === 'F' && age >= 40) {
      const lastMammo = labs.find(l => l.test_name?.toLowerCase().includes('mammogram'));
      status.push({
        screening: 'Breast Cancer Screening (Mammography)',
        age: `Age ${age}`,
        due: !lastMammo,
        lastCompleted: lastMammo?.result_date || 'Never'
      });
    }

    // Pap Smear (women 21-65)
    if (patient.sex === 'F' && age >= 21 && age <= 65) {
      const lastPap = labs.find(l => l.test_name?.toLowerCase().includes('pap'));
      status.push({
        screening: 'Cervical Cancer Screening (Pap)',
        age: `Age ${age}`,
        due: !lastPap,
        lastCompleted: lastPap?.result_date || 'Never'
      });
    }

    // Lipid panel (age 40+)
    if (age >= 40) {
      const lastLipid = labs.find(l => l.test_name?.toLowerCase().includes('lipid'));
      status.push({
        screening: 'Lipid Panel',
        age: `Age ${age}`,
        due: !lastLipid,
        lastCompleted: lastLipid?.result_date || 'Never'
      });
    }

    return status;
  }

  /**
   * Build treatment plan carryforward.
   */
  _buildTreatmentPlanCarryforward(problems, medications) {
    const activeConditions = problems.filter(p => p.status === 'active' || p.status === 'chronic');
    const activeMeds = medications.filter(m => m.status === 'active');

    return activeConditions.slice(0, 5).map(condition => {
      const relatedMeds = activeMeds.filter(m =>
        m.indication?.toLowerCase().includes(condition.problem_name.toLowerCase()) ||
        m.medication_name.toLowerCase().includes('bp') || // heuristic for HTN
        m.medication_name.toLowerCase().includes('metformin') // heuristic for diabetes
      );

      return {
        condition: condition.problem_name,
        standing_treatment: relatedMeds.map(m => `Continue ${m.medication_name} ${m.dose} ${m.frequency}`).join('; ') || 'Continue current regimen',
        next_action: `${condition.problem_name} management continues. Assess response to current therapy.`
      };
    });
  }

  /**
   * Render the briefing as a markdown document.
   */
  _renderBriefingDocument(identity, reasonForVisit, problems, surgicalHistory, postHospital, meds, allergies, preventive, carryforward) {
    let doc = `# Pre-Visit Intelligence Briefing

**Generated:** ${new Date().toLocaleString()}

---

## Patient Identity & Demographics

**Name:** ${identity.name}
**MRN:** ${identity.mrn}
**DOB:** ${identity.dob} (Age: ${identity.age})
**Sex:** ${identity.sex}
**Insurance:** ${identity.insurance} (ID: ${identity.insuranceId})
**Contact:** ${identity.phone} | ${identity.email}
**Preferred Contact:** ${identity.preferredContact}

---

## Reason for Visit

**Scheduled:** ${reasonForVisit.scheduled}
**Visit Type:** ${reasonForVisit.visitType}

---

## Active Problems (Synopsis)

${problems.map(p => `### ${p.condition} (${p.icdCode})

- **Status:** ${p.status}
- **Managed By:** ${p.managedBy}
- **Current Treatment:** ${p.currentTreatment}
${p.lastRelevantResult ? `- **Last Result:** ${p.lastRelevantResult}` : ''}
- **Next Action:** ${p.nextActionNeeded}
`).join('\n')}

---

## Current Medications

${meds.map(m => `- **${m.medication}** ${m.dose} ${m.frequency} (prescribed by ${m.prescriber})`).join('\n') || 'No active medications on file'}

---

## Allergies

${allergies.map(a => `- **${a.allergen}** → ${a.reaction} (Severity: ${a.severity})`).join('\n') || 'No known allergies'}

---

## Preventive Care Status

${preventive.map(p => `- **${p.screening}** (${p.age}): ${p.due ? 'DUE' : 'Current'} — Last: ${p.lastCompleted}`).join('\n')}

---

## Standing Treatment Plan (Carryforward)

${carryforward.map(c => `### ${c.condition}

- **Ongoing:** ${c.standing_treatment}
- **Next Step:** ${c.next_action}
`).join('\n')}

---

**Ready for Provider Review**
`;

    if (postHospital) {
      doc += `\n---\n## Recent Hospitalization\n\n${postHospital.summary}\n`;
    }

    return doc;
  }

  /**
   * Generate patient contact message (confirmation/reminder/notification).
   */
  _generatePatientContact(context, requestInfo) {
    const messageType = requestInfo.messageType || 'confirmation'; // confirmation, reminder_1day, reminder_1hour, notification
    const appointment = requestInfo.appointment || {};
    const patient = context.patient || {};

    let message = '';
    let subject = '';

    switch (messageType) {
      case 'confirmation':
        subject = `Appointment Confirmation - ${patient.first_name}`;
        message = this._generateConfirmationMessage(appointment, context);
        break;
      case 'reminder_1day':
        subject = `Reminder: Your appointment tomorrow with ${patient.first_name}`;
        message = `Hello ${patient.first_name}, this is a reminder that you have an appointment tomorrow at ${appointment.dateTimeFormatted}. Please arrive 10 minutes early. Reply CONFIRM or DECLINE.`;
        break;
      case 'reminder_1hour':
        subject = `Reminder: Your appointment in 1 hour`;
        message = `Hello ${patient.first_name}, your appointment is in 1 hour at ${appointment.dateTimeFormatted}. Please head to our office now.`;
        break;
      case 'notification':
        subject = `Important: Scheduling change`;
        message = `Hello ${patient.first_name}, your appointment has been rescheduled to ${appointment.dateTimeFormatted}. Please confirm receipt of this message.`;
        break;
    }

    return {
      status: 'complete',
      action: 'contact',
      messageType,
      recipient: {
        name: patient.first_name,
        email: patient.email,
        phone: patient.phone
      },
      subject,
      message,
      channels: ['portal', 'email', 'text'],
      readyToSend: true
    };
  }

  /**
   * Process check-in workflow.
   */
  _processCheckIn(context, requestInfo) {
    const patient = context.patient || {};
    const appointmentId = requestInfo.appointmentId;

    return {
      status: 'complete',
      action: 'check_in',
      checkInData: {
        patientId: patient.id,
        patientName: `${patient.first_name} ${patient.last_name}`,
        appointmentId,
        checkedInAt: new Date().toISOString(),
        tasks: [
          { task: 'Verify insurance information', completed: false },
          { task: 'Confirm demographics', completed: false },
          { task: 'Check for outstanding forms/questionnaires', completed: false },
          { task: 'Obtain chief complaint', completed: false }
        ]
      },
      nextStep: 'MA rooming'
    };
  }

  /**
   * Helper: Generate confirmation message.
   */
  _generateConfirmationMessage(appointment, context) {
    const patient = context.patient || {};
    return `Hello ${patient.first_name},

Your appointment has been confirmed!

**Date & Time:** ${appointment.dateTimeFormatted}
**Appointment Type:** ${appointment.appointmentType}
**Reason:** ${appointment.reason}
**Duration:** ${appointment.duration} minutes

Please arrive 10 minutes early to check in. Bring your insurance card and any relevant medical records.

If you need to reschedule, please call us at least 24 hours in advance.

Thank you,
Front Desk Team`;
  }

  /**
   * Helper: Generate rescheduling message.
   */
  _generateReschedulingMessage(appointment, context) {
    const patient = context.patient || {};
    return `Hello ${patient.first_name},

Your appointment has been rescheduled.

**New Date & Time:** ${appointment.dateTimeFormatted}

Please confirm receipt of this message.

Thank you,
Front Desk Team`;
  }

  /**
   * Helper: Check if a slot is available (not already booked).
   */
  _isSlotAvailable(slotStart, slotEnd) {
    return !this.bookedAppointments.some(appt => {
      const apptStart = new Date(appt.dateTime);
      const apptEnd = new Date(apptStart.getTime() + appt.duration * 60000);

      // Check for overlap
      return !(slotEnd <= apptStart || slotStart >= apptEnd);
    });
  }

  /**
   * Helper: Find slot by ID.
   */
  _findSlotById(slotId) {
    // Generate slots dynamically (in real system, would query database)
    const slotsNeeded = this._findAvailableSlots({}, { dateRangeStart: new Date() });
    return slotsNeeded.slots.find(s => s.slotId === slotId);
  }

  /**
   * Helper: Calculate age from DOB.
   */
  _calculateAge(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }
}

module.exports = { FrontDeskAgent };
