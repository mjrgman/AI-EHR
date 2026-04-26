'use strict';

/**
 * Scheduling repository — DB-backed appointment access for the front-desk agent.
 *
 * The front-desk agent calls into this repository ONLY when SCHEDULER_MODE=db.
 * In mock mode (the default for scenario tests + dev), the agent keeps its
 * synthetic in-memory state and never reaches this module.
 *
 * Slot ID generation deliberately stays in the agent layer, not here. Both
 * mock and DB modes must produce identical `slot_${getTime()}` IDs from the
 * same input date so the agent's _getSlotById() lookup behaves identically.
 * This module's only job is to surface "what's already booked" and to
 * persist new bookings — slot identity is the agent's contract.
 */

const db = require('../database');

/**
 * Find appointment rows that overlap a given date window for a provider.
 *
 * @param {string} providerName - Provider name to filter on
 * @param {Object} window - { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * @returns {Promise<Array<{date: string, time: string, duration_minutes: number}>>}
 */
async function findBookedSlots(providerName, { startDate, endDate }) {
  if (!providerName) return [];
  const rows = await db.dbAll(
    `SELECT appointment_date AS date,
            appointment_time AS time,
            duration_minutes
     FROM appointments
     WHERE provider_name = ?
       AND appointment_date >= ?
       AND appointment_date <= ?
       AND status NOT IN ('cancelled', 'no-show')`,
    [providerName, startDate, endDate]
  );
  return rows;
}

/**
 * Insert a new appointment row.
 *
 * @param {Object} appointment - Required: patient_id, provider_name, appointment_date,
 *   appointment_time, duration_minutes, appointment_type. Optional: chief_complaint,
 *   status (defaults to 'scheduled'), notes.
 * @returns {Promise<{id: number}>}
 */
async function insertAppointment(appointment) {
  const required = ['patient_id', 'provider_name', 'appointment_date', 'appointment_time', 'appointment_type'];
  for (const field of required) {
    if (appointment[field] === undefined || appointment[field] === null) {
      throw new Error(`scheduling-repository.insertAppointment: missing required field "${field}"`);
    }
  }

  const result = await db.dbRun(
    `INSERT INTO appointments
       (patient_id, provider_name, appointment_date, appointment_time,
        duration_minutes, appointment_type, chief_complaint, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      appointment.patient_id,
      appointment.provider_name,
      appointment.appointment_date,
      appointment.appointment_time,
      appointment.duration_minutes ?? 20,
      appointment.appointment_type,
      appointment.chief_complaint ?? null,
      appointment.status ?? 'scheduled',
      appointment.notes ?? null,
    ]
  );
  return { id: result.lastID };
}

/**
 * Update an appointment's status. Used for reschedule (-> 'rescheduled')
 * and cancel/check-in transitions if needed.
 *
 * @param {number} id - Appointment id
 * @param {string} newStatus - One of the schema-allowed status values
 * @returns {Promise<boolean>} true if a row was updated
 */
async function updateAppointmentStatus(id, newStatus) {
  const result = await db.dbRun(
    `UPDATE appointments
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [newStatus, id]
  );
  return (result.changes || 0) > 0;
}

/**
 * Patient-scoped appointment lookup. Always read via patient_id so the
 * portal session boundary is enforced at the query level — never trust
 * a request body to override the patient.
 *
 * @param {number} id - Appointment id
 * @param {number} patientId - Patient id from req.portalPatient.id
 * @returns {Promise<Object|null>}
 */
async function findAppointmentByIdForPatient(id, patientId) {
  return db.dbGet(
    `SELECT * FROM appointments WHERE id = ? AND patient_id = ?`,
    [id, patientId]
  );
}

/**
 * Patient-scoped reschedule: update date/time/duration on an existing row,
 * mark status='rescheduled'. Returns true if a row was updated. Use the
 * patient_id guard so a stolen/forged appointmentId from another patient
 * cannot be moved.
 *
 * @param {number} id - Appointment id
 * @param {number} patientId - Patient id from req.portalPatient.id
 * @param {Object} update - { date: 'YYYY-MM-DD', time: 'HH:MM:SS', duration_minutes }
 * @returns {Promise<boolean>}
 */
async function rescheduleAppointment(id, patientId, { date, time, duration_minutes }) {
  const result = await db.dbRun(
    `UPDATE appointments
     SET appointment_date = ?,
         appointment_time = ?,
         duration_minutes = ?,
         status = 'rescheduled',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND patient_id = ?`,
    [date, time, duration_minutes, id, patientId]
  );
  return (result.changes || 0) > 0;
}

module.exports = {
  findBookedSlots,
  insertAppointment,
  updateAppointmentStatus,
  findAppointmentByIdForPatient,
  rescheduleAppointment,
};
