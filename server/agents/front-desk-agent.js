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
 * Scheduling backend is selected by SCHEDULER_MODE env (or `repository` option):
 *   mock  — synthetic provider availability, in-memory appointment list
 *   db    — appointments persisted to the SQLite `appointments` table via
 *           server/repositories/scheduling-repository.js
 *
 * Slot-ID determinism: slot IDs are generated in this agent (not the
 * repository) so mock and db modes produce identical IDs from the same input
 * date — `_findSlotById` re-generates the grid and matches on slotId, so this
 * contract must be preserved.
 *
 * NOTE (latent issue, flagged in CLAUDE.md plan §Safety): the pre-visit
 * briefing this agent generates contains medications/labs/problems, but the
 * `front_desk` RBAC role only has `phiScope: ['demographics']`. There is no
 * current internal route that exposes the briefing to front-desk staff, so
 * this is latent — but a future "share briefing with front desk" route MUST
 * use a role with broader phiScope (physician/NP) or apply field-level
 * filtering before exposing the briefing.
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

    // Repository injection. Explicit option wins (used by tests). Otherwise read
    // SCHEDULER_MODE: 'db' loads the persistence repository, anything else
    // (default 'mock') keeps in-memory state and leaves repository null.
    if (options.repository !== undefined) {
      this.repository = options.repository;
    } else if (process.env.SCHEDULER_MODE === 'db') {
      this.repository = require('../repositories/scheduling-repository');
    } else {
      this.repository = null;
    }
    this.providerName = options.providerName || process.env.PROVIDER_NAME || 'Dr. Provider';
  }

  /**
   * Main process method — routes to scheduling or briefing depending on context.
   * Request info is extracted from context.requestInfo (A-H5: matches base class 2-param contract).
   *
   * @param {PatientContext} context - Must include context.requestInfo for front desk actions
   * @param {Object} agentResults - Results from previously-run agents
   * @returns {Promise<Object>}
   */
  async process(context, agentResults = {}) {
    const requestInfo = context.requestInfo || {};
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
   * Build a unified "booked appointments" list that _isSlotAvailable can iterate.
   * In mock mode, returns the in-memory array. In db mode, queries the
   * scheduling repository for the date window and normalizes to the same shape.
   */
  async _getBookedAppointments(dateRangeStart, dateRangeEnd) {
    if (!this.repository) return this.bookedAppointments;

    const startStr = dateRangeStart.toISOString().slice(0, 10);
    const endStr = dateRangeEnd.toISOString().slice(0, 10);
    const rows = await this.repository.findBookedSlots(this.providerName, {
      startDate: startStr,
      endDate: endStr,
    });
    // _scheduleAppointment writes appointment_date/appointment_time using the
    // UTC components of the slot's ISO string (slice(0,10) and slice(11,19)).
    // The Z suffix on read forces UTC interpretation so the round-tripped
    // dateTime byte-matches the slot grid's getTime() — without Z, the Date
    // constructor would reinterpret as local time and shift by the offset.
    return rows.map((r) => ({
      dateTime: new Date(`${r.date}T${r.time}Z`).toISOString(),
      duration: r.duration_minutes,
    }));
  }

  /**
   * Find available appointment slots.
   * Async because in db mode we query the scheduling repository for booked rows.
   * Slot IDs are generated from the slot's UTC start time so mock and db
   * modes produce identical IDs from the same input date — _findSlotById
   * relies on this contract.
   */
  async _findAvailableSlots(context, requestInfo) {
    const appointmentType = requestInfo.appointmentType || 'follow_up';
    const duration = this.appointmentTypes[appointmentType]?.duration || 20;
    const dateRangeStart = requestInfo.dateRangeStart || new Date();
    const dateRangeEnd = requestInfo.dateRangeEnd || new Date(dateRangeStart.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days out

    const booked = await this._getBookedAppointments(dateRangeStart, dateRangeEnd);

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

            if (this._isSlotAvailable(slotTime, slotEndTime, booked)) {
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
   * In db mode the appointment is persisted via the scheduling repository and
   * the returned `appointmentId` reflects the persisted row id (`appt_<id>`).
   * In mock mode the appointment is appended to in-memory state with a
   * timestamp-derived id.
   */
  async _scheduleAppointment(context, requestInfo) {
    const patientId = context.patient?.id;
    const appointmentType = requestInfo.appointmentType || 'follow_up';
    const slotId = requestInfo.slotId;
    const reason = requestInfo.reason || 'Follow-up';
    const chiefComplaint = requestInfo.chief_complaint || requestInfo.chiefComplaint || null;

    // Find the slot
    const slot = await this._findSlotById(slotId);
    if (!slot) {
      return {
        status: 'error',
        message: 'Slot not found or no longer available'
      };
    }

    let appointmentId = `appt_${Date.now()}`;
    let persistedId = null;

    if (this.repository) {
      if (!patientId) {
        return { status: 'error', message: 'patient_id is required for db-mode scheduling' };
      }
      const slotDate = new Date(slot.dateTime);
      const persisted = await this.repository.insertAppointment({
        patient_id: patientId,
        provider_name: this.providerName,
        appointment_date: slotDate.toISOString().slice(0, 10),
        appointment_time: slotDate.toISOString().slice(11, 19), // HH:MM:SS in UTC
        duration_minutes: slot.duration,
        appointment_type: appointmentType,
        chief_complaint: chiefComplaint,
        status: 'scheduled',
        notes: reason,
      });
      persistedId = persisted.id;
      appointmentId = `appt_${persisted.id}`;
    }

    const appointment = {
      appointmentId,
      persistedId,
      patientId,
      patientName: `${context.patient?.first_name} ${context.patient?.last_name}`,
      appointmentType,
      reason,
      chiefComplaint,
      dateTime: slot.dateTime,
      dateTimeFormatted: slot.dateTimeFormatted,
      duration: slot.duration,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      confirmationSent: false,
      reminderSent: false
    };

    if (!this.repository) {
      // Mock mode: maintain in-memory state for _isSlotAvailable lookups
      this.bookedAppointments.push(appointment);
    }

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
   * In db mode, the appointment is looked up by id+patient_id (so a stolen
   * appointmentId from another patient cannot be moved), date/time updated,
   * and status set to 'rescheduled'. In mock mode the in-memory record is
   * mutated in place.
   */
  async _rescheduleAppointment(context, requestInfo) {
    const appointmentId = requestInfo.appointmentId;
    const newSlotId = requestInfo.newSlotId;
    const patientId = context.patient?.id;

    const newSlot = await this._findSlotById(newSlotId);
    if (!newSlot) {
      return { status: 'error', message: 'New slot not found or unavailable' };
    }

    if (this.repository) {
      if (!patientId) {
        return { status: 'error', message: 'patient_id is required for db-mode rescheduling' };
      }
      // appointmentId may be the persisted id (number) or `appt_<id>` string.
      const numericId = typeof appointmentId === 'string' && appointmentId.startsWith('appt_')
        ? parseInt(appointmentId.slice(5), 10)
        : parseInt(appointmentId, 10);
      if (!Number.isFinite(numericId)) {
        return { status: 'error', message: 'Appointment not found' };
      }
      const slotDate = new Date(newSlot.dateTime);
      const updated = await this.repository.rescheduleAppointment(numericId, patientId, {
        date: slotDate.toISOString().slice(0, 10),
        time: slotDate.toISOString().slice(11, 19),
        duration_minutes: newSlot.duration,
      });
      if (!updated) {
        return { status: 'error', message: 'Appointment not found' };
      }
      const appointment = {
        appointmentId,
        persistedId: numericId,
        dateTime: newSlot.dateTime,
        dateTimeFormatted: newSlot.dateTimeFormatted,
        duration: newSlot.duration,
        status: 'rescheduled',
        rescheduledAt: new Date().toISOString(),
      };
      const reschedulingMessage = this._generateReschedulingMessage(appointment, context);
      return {
        status: 'complete',
        action: 'reschedule',
        appointmentId,
        appointment,
        reschedulingMessage,
        nextStep: 'notification_sent_to_patient'
      };
    }

    // Mock mode: in-memory mutation (preserves prior behavior exactly)
    const existingAppt = this.bookedAppointments.find(a => a.appointmentId === appointmentId);
    if (!existingAppt) {
      return { status: 'error', message: 'Appointment not found' };
    }
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
      age: this._age(patient.dob),
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
    const age = this._age(patient.dob);
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

    // Notification delivery channels — only declare what is actually wired up.
    // Email/SMS delivery requires Twilio + SendGrid integration (TODO, separate PR);
    // until those land, advertising them here would be a false promise to patients
    // who depend on these notifications for appointments and refills.
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
      channels: ['portal'],
      pendingChannels: { email: 'not_configured', sms: 'not_configured' },
      deliveryNote: 'Only portal in-app delivery is implemented. ' +
                    'Email/SMS delivery requires Twilio + SendGrid integration (TODO).',
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
   * Accepts an explicit `booked` array so the same predicate works for
   * both mock-mode (this.bookedAppointments) and db-mode (rows from the
   * scheduling repository, normalized to {dateTime, duration}).
   */
  _isSlotAvailable(slotStart, slotEnd, booked = null) {
    const source = booked !== null ? booked : this.bookedAppointments;
    return !source.some(appt => {
      const apptStart = new Date(appt.dateTime);
      const apptEnd = new Date(apptStart.getTime() + appt.duration * 60000);

      // Check for overlap
      return !(slotEnd <= apptStart || slotStart >= apptEnd);
    });
  }

  /**
   * Helper: Find slot by ID. Async because _findAvailableSlots is async.
   *
   * The slotId format is `slot_<unix_ms>` — we parse the timestamp out and
   * use the start-of-day for that slot as the search window. Without this,
   * the 10-slot cap in _findAvailableSlots excludes any slot more than a
   * day or two out from "now" (a pre-existing bug in mock mode).
   */
  async _findSlotById(slotId) {
    if (typeof slotId !== 'string') return null;
    const match = /^slot_(\d+)$/.exec(slotId);
    if (!match) return null;
    const slotMs = parseInt(match[1], 10);
    if (!Number.isFinite(slotMs)) return null;

    const startOfDay = new Date(slotMs);
    startOfDay.setHours(0, 0, 0, 0);

    const slotsNeeded = await this._findAvailableSlots({}, { dateRangeStart: startOfDay });
    return slotsNeeded.slots.find(s => s.slotId === slotId);
  }

  // _calculateAge replaced by _age() inherited from BaseAgent (L1)
}

module.exports = { FrontDeskAgent };
