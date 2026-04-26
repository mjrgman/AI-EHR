'use strict';

// Unit tests for the front-desk agent's scheduling refactor.
// Two properties are pinned here:
//   1. The slot-ID determinism contract — mock mode and db mode MUST produce
//      identical slot IDs from the same input date, because _getSlotById
//      re-generates the grid and matches on slotId.
//   2. The notification `channels` honesty — front-desk MUST never claim a
//      delivery channel that isn't actually wired up. Today only 'portal'
//      is implemented; email/sms must appear under pendingChannels with an
//      explicit 'not_configured' marker.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { FrontDeskAgent } = require('../../server/agents/front-desk-agent');

// In-memory stub repository implementing the same surface as
// server/repositories/scheduling-repository.js — no DB, no SQL.
function makeStubRepository(initialBooked = []) {
  // initialBooked: [{date: 'YYYY-MM-DD', time: 'HH:MM:SS', duration_minutes}]
  const booked = [...initialBooked];
  const inserted = [];

  return {
    booked,
    inserted,
    async findBookedSlots(_providerName, { startDate, endDate }) {
      return booked.filter((row) => row.date >= startDate && row.date <= endDate);
    },
    async insertAppointment(appt) {
      inserted.push(appt);
      const id = inserted.length;
      booked.push({
        date: appt.appointment_date,
        time: appt.appointment_time,
        duration_minutes: appt.duration_minutes,
      });
      return { id };
    },
    async updateAppointmentStatus(_id, _newStatus) {
      return true;
    },
    async findAppointmentByIdForPatient(_id, _patientId) {
      return null;
    },
    async rescheduleAppointment(_id, _patientId, _update) {
      return true;
    },
  };
}

describe('FrontDeskAgent: notification channels honesty', () => {
  test('_generatePatientContact never claims unimplemented channels', async () => {
    const agent = new FrontDeskAgent();
    const result = await agent.process(
      { patient: { first_name: 'Test', last_name: 'Patient', email: 'test@example.invalid', phone: '555-0100' } },
      { /* agentResults */ },
    );
    // The default action is find_slots; call _generatePatientContact directly via process('contact')
    const contact = await agent.process(
      {
        patient: { first_name: 'Test', last_name: 'Patient', email: 'test@example.invalid', phone: '555-0100' },
        requestInfo: { action: 'contact', messageType: 'confirmation', appointment: { dateTimeFormatted: 'Mon, Jan 1, 09:00 AM' } },
      },
      {},
    );
    assert.deepEqual(contact.channels, ['portal'], 'channels must claim ONLY portal — email/SMS are TODO');
    assert.ok(contact.pendingChannels, 'pendingChannels must surface the gap');
    assert.equal(contact.pendingChannels.email, 'not_configured');
    assert.equal(contact.pendingChannels.sms, 'not_configured');
    assert.match(contact.deliveryNote, /TODO/, 'deliveryNote must explain the gap');

    // Defensive: every entry in `channels` must correspond to a real, working delivery path.
    const ALLOWED = new Set(['portal']);
    for (const ch of contact.channels) {
      assert.ok(ALLOWED.has(ch), `channels must not include unimplemented channel "${ch}" — this is the lying-code regression we're guarding against`);
    }
  });
});

describe('FrontDeskAgent: slot-ID determinism (mock vs db parity)', () => {
  // Use a fixed seed date so both agents traverse the same date grid.
  // 2026-04-27 is a Monday — picked to land on a weekday the synthetic
  // PROVIDER_HOURS table covers (Mon-Fri).
  const SEED = new Date('2026-04-27T00:00:00Z');

  test('mock-mode and db-mode produce identical slot IDs for the same input date', async () => {
    const mockAgent = new FrontDeskAgent();
    const dbAgent = new FrontDeskAgent({ repository: makeStubRepository([]) });

    const mockResult = await mockAgent._findAvailableSlots({}, { dateRangeStart: new Date(SEED) });
    const dbResult = await dbAgent._findAvailableSlots({}, { dateRangeStart: new Date(SEED) });

    assert.equal(mockResult.slots.length, dbResult.slots.length, 'both modes must find the same number of slots');
    const mockIds = mockResult.slots.map((s) => s.slotId);
    const dbIds = dbResult.slots.map((s) => s.slotId);
    assert.deepEqual(mockIds, dbIds, 'slot IDs must be byte-identical across modes — this contract is load-bearing for _getSlotById');
  });

  test('a booked slot in db mode is excluded from the next find_slots call', async () => {
    const repository = makeStubRepository([]);
    const agent = new FrontDeskAgent({ repository });

    // First call: get the available slots, pick the first one.
    const before = await agent._findAvailableSlots({}, { dateRangeStart: new Date(SEED) });
    assert.ok(before.slots.length > 0, 'sanity: there must be at least one open slot');
    const targetSlot = before.slots[0];

    // Schedule the appointment via the repo.
    const scheduleResult = await agent._scheduleAppointment(
      { patient: { id: 999999, first_name: 'Test', last_name: 'Patient' } },
      { action: 'schedule', slotId: targetSlot.slotId, appointmentType: 'follow_up', reason: 'unit-test booking' },
    );
    assert.equal(scheduleResult.status, 'complete');
    assert.equal(repository.inserted.length, 1, 'repository.insertAppointment must have been called');

    // Re-query: the booked slot should no longer appear (overlap detection must fire)
    const after = await agent._findAvailableSlots({}, { dateRangeStart: new Date(SEED) });
    assert.equal(after.slots.find((s) => s.slotId === targetSlot.slotId), undefined,
      'the freshly-booked slot must be excluded from subsequent slot queries');
  });
});

describe('FrontDeskAgent: scheduling pre-conditions', () => {
  test('db-mode schedule fails clearly when patient_id is missing', async () => {
    const agent = new FrontDeskAgent({ repository: makeStubRepository([]) });
    // Find a slot first so we have a valid slotId
    const before = await agent._findAvailableSlots({}, { dateRangeStart: new Date('2026-04-27T00:00:00Z') });
    const slotId = before.slots[0].slotId;

    const result = await agent._scheduleAppointment(
      { patient: {} }, // no id
      { action: 'schedule', slotId, appointmentType: 'follow_up', reason: 'test' },
    );
    assert.equal(result.status, 'error');
    assert.match(result.message, /patient_id is required/);
  });

  test('schedule with unknown slotId returns an error', async () => {
    const agent = new FrontDeskAgent();
    const result = await agent._scheduleAppointment(
      { patient: { id: 999999 } },
      { action: 'schedule', slotId: 'slot_doesnotexist', appointmentType: 'follow_up', reason: 'test' },
    );
    assert.equal(result.status, 'error');
    assert.match(result.message, /Slot not found/);
  });
});
