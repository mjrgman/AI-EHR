'use strict';

const db = require('../database');

async function getPatientSessionProfile(patientId) {
  const patient = await db.getPatientById(patientId);
  if (!patient) return null;

  return {
    id: patient.id,
    mrn: patient.mrn,
    first_name: patient.first_name,
    last_name: patient.last_name,
    dob: patient.dob,
  };
}

async function getUpcomingAppointments(patientId) {
  return db.dbAll(
    `SELECT a.id, a.provider_name, a.appointment_date, a.appointment_time,
            a.duration_minutes, a.appointment_type, a.status, a.chief_complaint, a.notes
     FROM appointments a
     WHERE a.patient_id = ?
       AND a.appointment_date >= date('now')
       AND a.status NOT IN ('cancelled', 'no-show')
     ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
    [patientId]
  );
}

async function getActiveMedications(patientId) {
  const medications = await db.dbAll(
    `SELECT m.id, m.medication_name, m.generic_name, m.dose, m.route, m.frequency,
            m.start_date, m.end_date, m.status, m.prescriber
     FROM medications m
     WHERE m.patient_id = ? AND m.status = 'active'
     ORDER BY m.medication_name ASC`,
    [patientId]
  );

  return Promise.all(medications.map(async (medication) => {
    const lastRefill = await db.dbGet(
      `SELECT created_at, status
       FROM patient_messages
       WHERE patient_id = ? AND message_type = 'refill_notification' AND content LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [patientId, `%${medication.medication_name}%`]
    );

    return {
      ...medication,
      last_refill_request: lastRefill ? lastRefill.created_at : null,
      refill_status: lastRefill ? lastRefill.status : null,
    };
  }));
}

async function getLabResults(patientId) {
  return db.dbAll(
    `SELECT id, test_name, result_value, reference_range, units, result_date,
            status, abnormal_flag, notes
     FROM labs
     WHERE patient_id = ?
     ORDER BY result_date DESC`,
    [patientId]
  );
}

async function getMessages(patientId) {
  return db.dbAll(
    `SELECT id, message_type, subject, content, plain_language_content,
            status, tier, created_at, sent_at
     FROM patient_messages
     WHERE patient_id = ?
     ORDER BY created_at DESC`,
    [patientId]
  );
}

async function createMessage(patientId, fields) {
  const {
    message_type = 'general',
    subject = null,
    content,
    plain_language_content = null,
    status = 'draft',
    tier = 2,
    sent_at = null,
  } = fields;

  const result = await db.dbRun(
    `INSERT INTO patient_messages (patient_id, message_type, subject, content, plain_language_content, status, tier, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, message_type, subject, content, plain_language_content, status, tier, sent_at]
  );

  return { id: result.lastID };
}

async function checkInAppointment(patientId, appointmentId) {
  const appointment = await db.dbGet(
    `SELECT id, status, appointment_date, encounter_id
     FROM appointments
     WHERE id = ? AND patient_id = ?`,
    [appointmentId, patientId]
  );
  if (!appointment) return null;

  if (appointment.status !== 'scheduled' && appointment.status !== 'confirmed' && appointment.status !== 'checked-in') {
    return { appointment, updated: false, invalidStatus: true };
  }

  if (appointment.status !== 'checked-in') {
    await db.dbRun(
      `UPDATE appointments
       SET status = 'checked-in', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [appointmentId]
    );

    if (appointment.encounter_id) {
      await db.dbRun(
        `UPDATE workflow_state
         SET current_state = 'checked-in', check_in_time = CURRENT_TIMESTAMP
         WHERE encounter_id = ?`,
        [appointment.encounter_id]
      ).catch(() => {});
    }
  }

  return { appointment: { ...appointment, status: 'checked-in' }, updated: true, invalidStatus: false };
}

module.exports = {
  checkInAppointment,
  createMessage,
  getActiveMedications,
  getLabResults,
  getMessages,
  getPatientSessionProfile,
  getUpcomingAppointments,
};
