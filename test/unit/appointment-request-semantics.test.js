/**
 * Appointment request semantics.
 *
 * A patient asking for a slot is a REQUEST. Staff have not agreed to it, it is
 * not on the schedule, and the patient must not be told otherwise.
 *
 * Before this, a portal booking persisted as status='scheduled' -- the same
 * value as an appointment staff had actually accepted -- and the portal listed
 * it among the patient's upcoming appointments. The system told the patient
 * they had an appointment nobody had agreed to. In a real clinic that is
 * someone taking time off work and driving to a visit that does not exist.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { FrontDeskAgent } = require('../../server/agents/front-desk-agent');

// A repository stub that records what status the agent asked to persist.
function stubRepository(captured) {
  return {
    async insertAppointment(row) {
      captured.push(row);
      return { id: 4242 };
    },
    async findAvailableSlots() { return []; },
  };
}

// Minimal slot the agent can resolve by id.
function withStubSlot(agent, slotId) {
  agent._findSlotById = async () => ({
    slotId,
    dateTime: new Date('2026-09-01T15:00:00Z').toISOString(),
    dateTimeFormatted: 'Sep 1, 2026 3:00 PM',
    duration: 20,
  });
  return agent;
}

describe('a patient booking enters as a request', () => {
  test("initialStatus:'requested' persists status='requested'", async () => {
    const captured = [];
    const agent = withStubSlot(new FrontDeskAgent({ repository: stubRepository(captured) }), 's1');

    const result = await agent._scheduleAppointment(
      { patient: { id: 7, first_name: 'Test', last_name: 'Patient' } },
      { action: 'schedule', slotId: 's1', appointmentType: 'follow_up', initialStatus: 'requested' }
    );

    const persisted = captured[captured.length - 1];
    assert.ok(persisted, 'the agent must have attempted a persist');
    assert.equal(persisted.status, 'requested', 'a patient request must not persist as scheduled');
    // result.status is the agent envelope ('complete'); the appointment's own
    // status is what the caller and the portal read.
    assert.equal(result.appointment.status, 'requested',
      'the returned appointment must report itself as a request');
  });

  test('the confirmation message does not tell the patient it is booked', async () => {
    const captured = [];
    const agent = withStubSlot(new FrontDeskAgent({ repository: stubRepository(captured) }), 's4');

    const result = await agent._scheduleAppointment(
      { patient: { id: 10, first_name: 'Test', last_name: 'Patient' } },
      { action: 'schedule', slotId: 's4', appointmentType: 'follow_up', initialStatus: 'requested' }
    );

    const message = String(result.confirmationMessage || '');
    assert.ok(
      !/\b(is confirmed|has been confirmed|is scheduled|has been scheduled|is booked)\b/i.test(message),
      `a request must not be described as confirmed or scheduled; got: ${message}`
    );
  });

  test('staff booking still persists status=scheduled by default', async () => {
    const captured = [];
    const agent = withStubSlot(new FrontDeskAgent({ repository: stubRepository(captured) }), 's2');

    await agent._scheduleAppointment(
      { patient: { id: 8, first_name: 'Test', last_name: 'Patient' } },
      { action: 'schedule', slotId: 's2', appointmentType: 'follow_up' }
    );

    assert.equal(captured[captured.length - 1].status, 'scheduled',
      'omitting initialStatus must preserve the existing staff behavior');
  });

  test('an unrecognised initialStatus falls back to scheduled, not through', async () => {
    const captured = [];
    const agent = withStubSlot(new FrontDeskAgent({ repository: stubRepository(captured) }), 's3');

    await agent._scheduleAppointment(
      { patient: { id: 9, first_name: 'Test', last_name: 'Patient' } },
      { action: 'schedule', slotId: 's3', appointmentType: 'follow_up', initialStatus: 'confirmed' }
    );

    assert.equal(captured[captured.length - 1].status, 'scheduled',
      'a caller must not be able to self-confirm by passing an arbitrary status');
  });
});

describe('the schema and queries admit the new states', () => {
  test('both schema definitions allow requested and declined', () => {
    for (const rel of ['server/database.js', 'server/database-migrations.js']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const block = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS appointments'));
      assert.ok(block.includes("'requested'"), `${rel} must allow 'requested'`);
      assert.ok(block.includes("'declined'"), `${rel} must allow 'declined'`);
    }
  });

  test('a declined request is excluded from upcoming appointments', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/repositories/patient-portal-repository.js'), 'utf8');
    const fn = src.slice(src.indexOf('function getUpcomingAppointments'));
    assert.ok(/NOT IN \([^)]*'declined'/.test(fn), 'declined must not appear as upcoming');
  });

  test('the portal payload flags confirmation state explicitly', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/repositories/patient-portal-repository.js'), 'utf8');
    assert.ok(src.includes('awaiting_staff_confirmation'),
      'the client must not have to infer confirmation from a status string');
    assert.ok(src.includes('is_confirmed'));
  });

  test('the portal route requests, it does not book', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/routes/patient-portal.js'), 'utf8');
    const handler = src.slice(src.indexOf("router.post('/appointments/request'"));
    assert.ok(/initialStatus:\s*'requested'/.test(handler),
      'the portal booking route must mark its bookings as requests');
  });
});

describe('the patient-facing UI does not imply a confirmed booking', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/pages/PatientPortal.jsx'), 'utf8');

  test('an unconfirmed request is labelled as such, not "Next appointment"', () => {
    assert.ok(ui.includes('awaiting_staff_confirmation'), 'the UI must read the explicit flag');
    assert.ok(/Requested\s*—\s*not yet confirmed/.test(ui) || ui.includes('not yet confirmed'),
      'the heading must distinguish a request from a booking');
  });

  test('the patient is told not to travel for an unconfirmed visit', () => {
    assert.ok(/do not travel/i.test(ui),
      'the consequence of an unconfirmed slot must be stated in plain language');
  });

  test('check-in stays gated to accepted appointments', () => {
    assert.ok(/\['scheduled', 'confirmed'\]\.includes\(appointment\.status\)/.test(ui),
      'a requested slot must not offer check-in');
  });

  test('the status pill renders requested distinctly and legibly', () => {
    assert.ok(/requested:\s*'bg-gold/.test(ui), 'requested must not share the calm booked tone');
    assert.ok(ui.includes('Awaiting confirmation'), 'the pill needs a plain-language label');
  });
});
