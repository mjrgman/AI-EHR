import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Pill, FlaskConical, MessageSquare, Stethoscope,
  ClipboardCheck, CheckCircle2, LogOut, ShieldCheck, Send, RefreshCw, Search,
  Download, FileText,
} from 'lucide-react';
import { portalApi } from '../api/client';
import StatTile from '../components/workflow/StatTile';
import PatientVoice from '../components/PatientVoice';
import DemoBanner from '../components/common/DemoBanner';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'medications', label: 'Medications' },
  { key: 'labs', label: 'Labs' },
  { key: 'messages', label: 'Messages' },
  { key: 'triage', label: 'Symptom Triage' },
  { key: 'prep', label: 'Visit Prep' },
  { key: 'medivault', label: 'My Records' },  // C1: MediVault export
  { key: 'voice', label: 'Voice' },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [hourText, minuteText] = timeStr.split(':');
  const hour = Number(hourText);
  const minute = minuteText || '00';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function StatusPill({ status }) {
  const palette = {
    // 'requested' gets the attention tone, not the calm navy of a booked slot:
    // it is an open ask, and it must not read as settled.
    requested: 'bg-gold-50 text-gold-700 border border-gold-200',
    declined: 'bg-danger-50 text-danger-700 border border-danger-200',
    scheduled: 'bg-navy-50 text-navy-700 border border-navy-100',
    confirmed: 'bg-navy-50 text-navy-700 border border-navy-100',
    checked_in: 'bg-success-50 text-success-700 border border-success-100',
    completed: 'bg-ivory-200 text-slate-600 border border-slate-100',
    submitted: 'bg-gold-50 text-gold-700 border border-gold-200',
    physician_review: 'bg-gold-50 text-gold-700 border border-gold-200',
    sent: 'bg-success-50 text-success-700 border border-success-100',
    read: 'bg-ivory-200 text-slate-600 border border-slate-100',
    abnormal: 'bg-danger-50 text-danger-700 border border-danger-200',
    normal: 'bg-success-50 text-success-700 border border-success-100',
  };

  // "requested" alone is ambiguous to a patient reading a pill in isolation.
  const LABELS = { requested: 'Awaiting confirmation', declined: 'Not available' };
  const label = LABELS[status] || String(status || 'unknown').replace(/[_-]/g, ' ');
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${palette[status] || 'bg-ivory-200 text-slate-600 border border-slate-100'}`}>
      {label}
    </span>
  );
}

function VerifyIdentity({ loading, error, onVerify }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', dob: '', mrn: '' });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onVerify(form);
  };

  return (
    <>
      <DemoBanner className="sticky top-0 z-40" />
      <div className="min-h-screen bg-ivory-200 px-4 py-12">
      <div className="mc-reveal mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-xl md:grid md:grid-cols-[1.1fr_0.9fr] md:gap-10 md:p-10">
        <section className="mb-8 md:mb-0">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-gold-700">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
            Patient Portal
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-navy-700">Verify your identity to access appointments, labs, and messages.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
            Portal access runs on a dedicated patient session. Once verified, every refill request, secure message, and triage submission is tied to your server-side portal identity.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-navy-100 bg-navy-50 p-4 shadow-mc">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100 text-navy-700">
                <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-700">Appointments</p>
              <p className="mt-2 text-sm text-slate-600">Check upcoming visits and self check-in when available.</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-navy-50 p-4 shadow-mc">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100 text-navy-700">
                <MessageSquare size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-700">Messaging</p>
              <p className="mt-2 text-sm text-slate-600">Secure refill and care-team requests persist into the shared workflow.</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-navy-50 p-4 shadow-mc">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-navy-100 text-navy-700">
                <Stethoscope size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-700">Triage</p>
              <p className="mt-2 text-sm text-slate-600">Report symptoms with a severity score so the team can route urgent follow-up.</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-ivory-100 p-8 shadow-mc-lg">
          <h2 className="font-display text-2xl font-semibold text-navy-700">Verify identity</h2>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {[
              ['first_name', 'First name', 'text'],
              ['last_name', 'Last name', 'text'],
              ['dob', 'Date of birth', 'date'],
              ['mrn', 'MRN', 'text'],
            ].map(([key, label, type]) => (
              <label className="block" key={key}>
                <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(event) => update(key, event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-offWhite-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
                  required
                />
              </label>
            ))}

            {error ? (
              <div className="rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mc-btn-fill mc-btn-navy flex w-full items-center justify-center gap-2 rounded-2xl bg-navy-600 px-4 py-3 text-base font-semibold text-white transition-all hover:bg-navy-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
            >
              <ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />
              {loading ? 'Verifying...' : 'Continue to Portal'}
            </button>
          </form>
        </section>
      </div>
    </div>
    </>
  );
}

function DashboardView({ appointments, medications, labs, patientName }) {
  const upcoming = appointments[0];
  const abnormalLabs = labs.filter((lab) => lab.flag_level === 'abnormal');
  const refillPending = medications.filter((medication) => medication.refill_status === 'physician_review');

  return (
    <div className="space-y-4">
      {/* Warm welcome card — gold eyebrow + a generous next-appointment beat */}
      <div className="mc-reveal relative overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-lg sm:p-8">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
        <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-gold-100/50 to-transparent opacity-70 blur-2xl" aria-hidden="true" />
        <p className="mc-section-label">Your health, in one place</p>
        <h3 className="font-display text-2xl font-semibold text-navy-700 sm:text-3xl">Welcome back, {patientName}</h3>
        {/* A requested appointment is NOT booked. Labelling it "Next
            appointment" would tell the patient staff had agreed to a time
            nobody has agreed to, so the heading and the copy both change. */}
        {upcoming ? (
          <div className={`mt-5 inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
            upcoming.awaiting_staff_confirmation
              ? 'border-gold-200 bg-gold-50'
              : 'border-navy-100 bg-navy-50'
          }`}>
            <span
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${
                upcoming.awaiting_staff_confirmation
                  ? 'bg-gold-100 text-gold-700 ring-gold-200'
                  : 'bg-navy-100 text-navy-700 ring-navy-200'
              }`}
              aria-hidden="true"
            >
              <CalendarDays size={18} strokeWidth={2} />
            </span>
            <div>
              <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                upcoming.awaiting_staff_confirmation ? 'text-gold-700' : 'text-navy-600'
              }`}>
                {upcoming.awaiting_staff_confirmation ? 'Requested — not yet confirmed' : 'Next appointment'}
              </p>
              <p className="font-display text-lg font-semibold text-navy-700">{formatDate(upcoming.appointment_date)}</p>
              <p className="text-sm text-slate-600">{formatTime(upcoming.appointment_time)} with {upcoming.provider_name}</p>
              {upcoming.awaiting_staff_confirmation ? (
                <p className="mt-1 text-sm text-slate-600">
                  Our office has not confirmed this time yet. Please do not travel for this visit until it is confirmed.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-slate-600">No upcoming appointments are scheduled.</p>
        )}
      </div>

      {/* KPI tiles — same premium primitive as the clinician surfaces. A flagged
          lab is the single gold attention beat; the count carries danger. */}
      <div className="mc-reveal-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile icon={CalendarDays} label="Appointments" value={appointments.length} tone="navy" sublabel="Upcoming on file" />
        <StatTile
          icon={Pill}
          label="Medications"
          value={medications.length}
          tone="navy"
          sublabel={`${refillPending.length} refill${refillPending.length === 1 ? '' : 's'} under review`}
        />
        <StatTile
          icon={FlaskConical}
          label="Lab Results"
          value={labs.length}
          tone={abnormalLabs.length > 0 ? 'gold' : 'navy'}
          sublabel={labs.length === 0 ? 'No results on file' : abnormalLabs.length > 0 ? `${abnormalLabs.length} flagged for clinician review` : 'All within range'}
        />
      </div>
    </div>
  );
}

const APPOINTMENT_TYPE_OPTIONS = [
  { value: 'follow_up', label: 'Follow-up visit' },
  { value: 'new_patient', label: 'New patient visit' },
  { value: 'annual_wellness', label: 'Annual wellness' },
  { value: 'urgent', label: 'Urgent visit' },
];

function RequestAppointmentForm({ onSubmitted, setError }) {
  const [open, setOpen] = useState(false);
  const [appointmentType, setAppointmentType] = useState('follow_up');
  const [reason, setReason] = useState('');
  const [slots, setSlots] = useState([]);
  const [findingSlots, setFindingSlots] = useState(false);
  const [submittingSlotId, setSubmittingSlotId] = useState(null);
  const [confirmedSlot, setConfirmedSlot] = useState(null); // B2: confirmation state

  const reset = () => {
    setSlots([]);
    setReason('');
    setAppointmentType('follow_up');
    setSubmittingSlotId(null);
  };

  const handleFindSlots = async () => {
    setFindingSlots(true);
    setSlots([]);
    setError('');
    try {
      const result = await portalApi.findAppointmentSlots({ appointmentType });
      setSlots(result.slots || []);
      if (!result.slots || result.slots.length === 0) {
        setError('No available slots in the next 14 days. Please call the office.');
      }
    } catch (err) {
      setError(err.message || 'Failed to find appointment slots');
    } finally {
      setFindingSlots(false);
    }
  };

  const handleBookSlot = async (slot) => {
    setSubmittingSlotId(slot.slotId);
    setError('');
    try {
      const result = await portalApi.requestAppointment({
        slotId: slot.slotId,
        appointmentType,
        reason: reason || 'Patient-requested appointment',
      });
      // B2: show confirmation before closing and refreshing list
      setConfirmedSlot({ slot, result });
      await onSubmitted();
    } catch (err) {
      setError(err.message || 'Failed to request appointment');
      setSubmittingSlotId(null);
    }
  };

  // B2: confirmation banner — shown after successful booking
  if (confirmedSlot) {
    return (
      <div className="rounded-3xl border border-success-200 bg-success-50 p-5 space-y-2">
        <p className="text-sm font-semibold text-success-700">Appointment request submitted</p>
        <p className="text-sm text-success-700">
          {confirmedSlot.slot.dateTimeFormatted || confirmedSlot.result?.dateTimeFormatted || 'Your selected time'} —
          your request is pending confirmation from the front desk.
        </p>
        <p className="text-xs text-success-600">Our team will confirm shortly. You can view the pending appointment below.</p>
        <button
          type="button"
          onClick={() => { setConfirmedSlot(null); reset(); setOpen(false); }}
          className="mt-1 rounded-xl border border-success-300 px-4 py-1.5 text-xs font-semibold text-success-700 hover:bg-success-100"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-2xl border border-navy-100 bg-navy-50 px-4 py-2 text-sm font-semibold text-navy-700 transition hover:bg-navy-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2"
      >
        Request a new appointment
      </button>
    );
  }

  return (
    <div className="rounded-3xl border border-navy-100 bg-navy-50/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-lg font-semibold text-navy-700">Request a new appointment</h3>
        <button
          onClick={() => { reset(); setOpen(false); }}
          className="rounded-sm text-xs font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2"
        >
          Cancel
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="text-sm font-medium text-slate-700">Visit type</label>
        <select
          value={appointmentType}
          onChange={(e) => { setAppointmentType(e.target.value); setSlots([]); }}
          className="rounded-xl border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
        >
          {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <label className="text-sm font-medium text-slate-700">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What would you like to discuss?"
          rows={2}
          className="rounded-xl border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
        />
      </div>

      <div className="mt-4">
        <button
          onClick={handleFindSlots}
          disabled={findingSlots}
          className="mc-btn-fill mc-btn-navy flex items-center gap-1.5 rounded-xl bg-navy-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-navy-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
        >
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          {findingSlots ? 'Finding slots...' : 'Find available slots'}
        </button>
      </div>

      {slots.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Pick a time — your request will be sent to the front desk for confirmation
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => (
              <button
                key={slot.slotId}
                onClick={() => handleBookSlot(slot)}
                disabled={submittingSlotId !== null}
                className="rounded-xl border border-slate-200 bg-offWhite-100 px-3 py-2 text-left text-sm font-medium text-navy-700 transition hover:border-gold-400 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {submittingSlotId === slot.slotId ? 'Submitting...' : slot.dateTimeFormatted}
                <span className="block text-xs font-normal text-slate-600">{slot.duration} min</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AppointmentsView({ appointments, checkInAppointment, activeCheckInId, onRequestSubmitted, setError }) {
  return (
    <div className="space-y-6">
      <RequestAppointmentForm onSubmitted={onRequestSubmitted} setError={setError} />

      {appointments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-offWhite-100 p-8 text-sm text-slate-600">
          No upcoming appointments. Use the form above to request one.
        </div>
      ) : (
        <div className="mc-reveal-stagger space-y-4">
          {appointments.map((appointment) => (
            <div className="rounded-3xl border border-slate-100 bg-offWhite-100 p-5 shadow-mc transition-all duration-200 hover:-translate-y-0.5 hover:shadow-mc-lg" key={appointment.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-xl font-semibold text-navy-700">{formatDate(appointment.appointment_date)}</h3>
                  <p className="mt-1 text-sm text-slate-600">{formatTime(appointment.appointment_time)} with {appointment.provider_name}</p>
                  <p className="mt-2 text-sm capitalize text-slate-600">{String(appointment.appointment_type || 'visit').replace(/_/g, ' ')}</p>
                  {appointment.awaiting_staff_confirmation ? (
                    <p className="mt-2 rounded-xl border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-slate-700">
                      <span className="font-semibold text-gold-700">Awaiting confirmation.</span>{' '}
                      You have asked for this time. Our office has not confirmed it yet, and it is
                      not on the schedule until they do.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={appointment.status} />
                  {/* Check-in is only meaningful once staff have accepted the
                      time. A requested slot is not on the schedule to arrive for. */}
                  {['scheduled', 'confirmed'].includes(appointment.status) ? (
                    <button
                      onClick={() => checkInAppointment(appointment.id)}
                      disabled={activeCheckInId === appointment.id}
                      className="mc-btn-fill mc-btn-success flex items-center gap-1.5 rounded-xl bg-success-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-success-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-success-600 disabled:active:scale-100"
                    >
                      <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                      {activeCheckInId === appointment.id ? 'Checking in...' : 'Check in'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MedicationsView({ medications, requestRefill, activeMedicationId }) {
  if (!medications.length) {
    return <div className="rounded-3xl border border-dashed border-slate-300 bg-offWhite-100 p-8 text-sm text-slate-600">No active medications on file.</div>;
  }

  return (
    <div className="mc-reveal-stagger space-y-4">
      {medications.map((medication) => (
        <div className="rounded-3xl border border-slate-100 bg-offWhite-100 p-5 shadow-mc transition-all duration-200 hover:-translate-y-0.5 hover:shadow-mc-lg" key={medication.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-navy-700">{medication.medication_name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {[medication.dose, medication.route, medication.frequency].filter(Boolean).join(' • ')}
              </p>
              <p className="mt-2 text-sm text-slate-600">Prescriber: {medication.prescriber || 'Care team'}</p>
            </div>
            <div className="flex items-center gap-3">
              {medication.refill_status ? <StatusPill status={medication.refill_status} /> : null}
              <button
                onClick={() => requestRefill(medication)}
                disabled={activeMedicationId === medication.id}
                className="mc-btn-fill mc-btn-navy flex items-center gap-1.5 rounded-xl bg-navy-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-navy-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
              >
                <RefreshCw size={15} strokeWidth={2} aria-hidden="true" className={activeMedicationId === medication.id ? 'animate-spin' : ''} />
                {activeMedicationId === medication.id ? 'Submitting...' : 'Request refill'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LabsView({ labs }) {
  if (!labs.length) {
    return <div className="rounded-3xl border border-dashed border-slate-300 bg-offWhite-100 p-8 text-sm text-slate-600">No lab results are available yet.</div>;
  }

  return (
    <div className="mc-reveal-stagger space-y-4">
      {labs.map((lab) => (
        <div className="rounded-3xl border border-slate-100 bg-offWhite-100 p-5 shadow-mc transition-all duration-200 hover:-translate-y-0.5 hover:shadow-mc-lg" key={lab.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-navy-700">{lab.plain_name || lab.test_name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {lab.result_value} {lab.units || ''} {lab.reference_range ? ` • Ref ${lab.reference_range}` : ''}
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{lab.explanation}</p>
            </div>
            <StatusPill status={lab.flag_level || 'normal'} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesView({ messages, messageForm, setMessageForm, sendMessage, sendingMessage }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="mc-reveal-stagger space-y-4">
        {messages.length ? messages.map((message) => (
          <div className="rounded-3xl border border-slate-100 bg-offWhite-100 p-5 shadow-mc transition-all duration-200 hover:-translate-y-0.5 hover:shadow-mc-lg" key={message.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-navy-700">{message.subject || 'Message'}</h3>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                  {message.message_type === 'refill_notification' ? 'Refill Request' :
                   message.message_type === 'appointment_request' ? 'Appointment Request' :
                   'Message'}
                </p>
              </div>
              <StatusPill status={message.status} />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message.plain_language_content || message.content}</p>
          </div>
        )) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-offWhite-100 p-8 text-sm text-slate-600">No messages yet.</div>
        )}
      </div>

      <form className="relative overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-lg" onSubmit={sendMessage}>
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <p className="mc-section-label">Care team</p>
        <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-navy-700">
          <MessageSquare size={20} strokeWidth={2} aria-hidden="true" className="text-navy-600" />
          Send a secure message
        </h3>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
            <input
              value={messageForm.subject}
              onChange={(event) => setMessageForm((current) => ({ ...current, subject: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Message</span>
            <textarea
              value={messageForm.message}
              onChange={(event) => setMessageForm((current) => ({ ...current, message: event.target.value }))}
              rows={6}
              className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
              required
            />
          </label>
          <button
            type="submit"
            disabled={sendingMessage}
            className="mc-btn-fill mc-btn-navy flex w-full items-center justify-center gap-2 rounded-2xl bg-navy-600 px-4 py-3 text-base font-semibold text-white transition-all hover:bg-navy-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
          >
            <Send size={16} strokeWidth={2} aria-hidden="true" />
            {sendingMessage ? 'Sending...' : 'Send message'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SymptomTriageView({ form, setForm, onSubmit, submitting }) {
  return (
    <form className="relative overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-lg" onSubmit={onSubmit}>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
      <p className="mc-section-label">Symptom triage</p>
      <h3 className="flex items-center gap-2 font-display text-2xl font-semibold text-navy-700">
        <Stethoscope size={22} strokeWidth={2} aria-hidden="true" className="text-navy-600" />
        Report symptoms
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Symptom reports persist into the care-team workflow and are routed based on severity.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-700">Symptoms</span>
          <textarea
            value={form.symptoms}
            onChange={(event) => setForm((current) => ({ ...current, symptoms: event.target.value }))}
            rows={4}
            className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
            required
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Severity (1-10)</span>
          <input
            type="number"
            min="1"
            max="10"
            value={form.severity}
            onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))}
            className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
            required
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Onset</span>
          <input
            value={form.onset}
            onChange={(event) => setForm((current) => ({ ...current, onset: event.target.value }))}
            className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
            placeholder="Example: started this morning"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-700">Additional notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            rows={4}
            className="w-full rounded-2xl border border-slate-200 bg-ivory-100 px-4 py-3 text-base text-navy-700 outline-none transition focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mc-btn-fill mc-btn-navy mt-6 flex items-center gap-1.5 rounded-2xl bg-navy-600 px-5 py-3 text-base font-semibold text-white transition-all hover:bg-navy-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
      >
        <Stethoscope size={18} strokeWidth={2} aria-hidden="true" />
        {submitting ? 'Submitting...' : 'Send symptom report'}
      </button>
    </form>
  );
}

function VisitPrepView({ checklist }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-lg">
      {/* Signature moment — gold hairline crowns the visit-prep card */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
      <p className="mc-section-label">Before your visit</p>
      <h3 className="flex items-center gap-2 font-display text-2xl font-semibold text-navy-700">
        <ClipboardCheck size={22} strokeWidth={2} aria-hidden="true" className="text-navy-600" />
        Visit checklist
      </h3>
      <ul className="mc-reveal-stagger mt-5 space-y-3">
        {checklist.map((item) => (
          <li className="mc-row flex items-start gap-3 text-sm leading-6 text-slate-700" key={item}>
            <CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-success-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MediVaultView({ onExport, exporting, exportError }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc-lg">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
      <p className="mc-section-label">Health records</p>
      <h3 className="flex items-center gap-2 font-display text-2xl font-semibold text-navy-700">
        <FileText size={22} strokeWidth={2} aria-hidden="true" className="text-navy-600" />
        My Records Export
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Download a complete copy of your health records in JSON format — medications, lab results,
        appointments, allergies, and visit notes. Your file will download immediately.
      </p>

      {exportError ? (
        <div className="mt-4 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
          {exportError}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="mc-btn-fill mc-btn-navy mt-6 flex items-center gap-2 rounded-2xl bg-navy-600 px-5 py-3 text-base font-semibold text-white transition-all hover:bg-navy-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:hover:bg-navy-600 disabled:active:scale-100"
      >
        <Download size={18} strokeWidth={2} aria-hidden="true" className={exporting ? 'animate-bounce' : ''} />
        {exporting ? 'Preparing download...' : 'Download my records'}
      </button>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-ivory-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">What is included</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {['Active medications and prescription history', 'Lab results with reference ranges', 'Appointment history', 'Allergies and adverse reactions', 'Visit notes and encounter summaries'].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <CheckCircle2 size={12} strokeWidth={2.5} className="flex-shrink-0 text-success-500" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function PatientPortal() {
  const [portalSession, setPortalSession] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [labs, setLabs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [visitPrep, setVisitPrep] = useState([]);
  const [messageForm, setMessageForm] = useState({ subject: '', message: '' });
  const [triageForm, setTriageForm] = useState({ symptoms: '', severity: '5', onset: '', notes: '' });
  const [sendingMessage, setSendingMessage] = useState(false);
  const [submittingTriage, setSubmittingTriage] = useState(false);
  const [activeMedicationId, setActiveMedicationId] = useState(null);
  const [activeCheckInId, setActiveCheckInId] = useState(null);
  const [exportingRecords, setExportingRecords] = useState(false); // C1: MediVault
  const [exportError, setExportError] = useState('');

  const patientName = useMemo(() => {
    const patient = portalSession?.patient;
    return patient?.name || [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || 'Patient';
  }, [portalSession]);

  const bootstrapSession = useCallback(async () => {
    try {
      const session = await portalApi.getSession();
      setPortalSession(session);
      return session;
    } catch {
      setPortalSession(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  const loadPortalData = useCallback(async (tab) => {
    if (!portalSession?.authenticated) return;

    setLoading(true);
    setError('');

    try {
      switch (tab) {
        case 'dashboard': {
          const [appointmentData, medicationData, labData] = await Promise.all([
            portalApi.getAppointments(),
            portalApi.getMedications(),
            portalApi.getLabs(),
          ]);
          setAppointments(appointmentData.appointments || []);
          setMedications(medicationData.medications || []);
          setLabs(labData.labs || []);
          break;
        }
        case 'appointments': {
          const appointmentData = await portalApi.getAppointments();
          setAppointments(appointmentData.appointments || []);
          break;
        }
        case 'medications': {
          const medicationData = await portalApi.getMedications();
          setMedications(medicationData.medications || []);
          break;
        }
        case 'labs': {
          const labData = await portalApi.getLabs();
          setLabs(labData.labs || []);
          break;
        }
        case 'messages': {
          const messageData = await portalApi.getMessages();
          setMessages(messageData.messages || []);
          break;
        }
        case 'prep': {
          const prep = await portalApi.getVisitPrep();
          setVisitPrep(prep.checklist || []);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      setError(err.message || 'Failed to load portal data');
    } finally {
      setLoading(false);
    }
  }, [portalSession?.authenticated]);

  useEffect(() => {
    if (portalSession?.authenticated) {
      loadPortalData(activeTab);
    }
  }, [activeTab, loadPortalData, portalSession?.authenticated]);

  // C1: MediVault — trigger a browser file download of the full patient record bundle
  const handleMediVaultExport = async () => {
    const patientId = portalSession?.patient?.id;
    if (!patientId) return;
    setExportingRecords(true);
    setExportError('');
    try {
      const response = await portalApi.exportMediVault(patientId);
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `my-records-${patientId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || 'Export failed. Please try again.');
    } finally {
      setExportingRecords(false);
    }
  };

  const handleVerify = async (form) => {
    setVerifying(true);
    setError('');
    try {
      await portalApi.verify({
        first_name: form.first_name,
        last_name: form.last_name,
        dob: form.dob,
        mrn: form.mrn,
      });
      await bootstrapSession();
      setActiveTab('dashboard');
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogout = async () => {
    await portalApi.logout();
    setPortalSession(null);
    setAppointments([]);
    setMedications([]);
    setLabs([]);
    setMessages([]);
    setVisitPrep([]);
  };

  const handleCheckIn = async (appointmentId) => {
    setActiveCheckInId(appointmentId);
    setError('');
    try {
      await portalApi.checkInAppointment(appointmentId);
      await loadPortalData('appointments');
    } catch (err) {
      setError(err.message || 'Check-in failed');
    } finally {
      setActiveCheckInId(null);
    }
  };

  const [refillConfirmed, setRefillConfirmed] = useState(null); // C2: confirmation state
  const handleRefill = async (medication) => {
    setActiveMedicationId(medication.id);
    setError('');
    try {
      await portalApi.requestRefill({
        medication_id: medication.id,
        medication_name: medication.medication_name,
      });
      setRefillConfirmed(medication.medication_name); // C2: show confirmation
      await loadPortalData('medications');
    } catch (err) {
      setError(err.message || 'Refill request failed');
    } finally {
      setActiveMedicationId(null);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    setSendingMessage(true);
    setError('');
    try {
      await portalApi.sendMessage({
        subject: messageForm.subject || 'Message from Patient Portal',
        message: messageForm.message,
      });
      setMessageForm({ subject: '', message: '' });
      await loadPortalData('messages');
    } catch (err) {
      setError(err.message || 'Message send failed');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSubmitTriage = async (event) => {
    event.preventDefault();
    setSubmittingTriage(true);
    setError('');
    try {
      await portalApi.submitSymptomTriage(triageForm);
      setTriageForm({ symptoms: '', severity: '5', onset: '', notes: '' });
      setActiveTab('messages');
      await loadPortalData('messages');
    } catch (err) {
      setError(err.message || 'Symptom report failed');
    } finally {
      setSubmittingTriage(false);
    }
  };

  if (!portalSession?.authenticated) {
    return <VerifyIdentity loading={verifying} error={error} onVerify={handleVerify} />;
  }

  return (
    <div className="min-h-screen bg-ivory-200">
      <DemoBanner />
      <header className="relative border-b border-slate-100 bg-offWhite-100/90 backdrop-blur">
        {/* Signature moment — gold hairline crowns the portal header */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-gold-700">
              <ShieldCheck size={15} strokeWidth={2.25} aria-hidden="true" className="text-gold-600" />
              Patient Portal
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-navy-700">{patientName}</h1>
            <p className="mt-2 text-sm text-slate-600">Appointments, labs, refill requests, and secure care-team communication.</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-offWhite-100 px-4 py-2 text-sm font-semibold text-slate-700 shadow-mc transition hover:border-slate-300 hover:bg-ivory-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2"
          >
            <LogOut size={15} strokeWidth={2} aria-hidden="true" />
            End portal session
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2 ${
                activeTab === tab.key ? 'bg-navy-600 text-white shadow-mc' : 'bg-offWhite-100 text-slate-600 hover:bg-ivory-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-100 bg-offWhite-100 p-8 text-sm text-slate-600">Loading portal data...</div>
        ) : null}

        {!loading && activeTab === 'dashboard' ? (
          <DashboardView appointments={appointments} medications={medications} labs={labs} patientName={patientName} />
        ) : null}
        {!loading && activeTab === 'appointments' ? (
          <AppointmentsView
            appointments={appointments}
            checkInAppointment={handleCheckIn}
            activeCheckInId={activeCheckInId}
            onRequestSubmitted={() => loadPortalData('appointments')}
            setError={setError}
          />
        ) : null}
        {!loading && activeTab === 'medications' ? (
          <>
            {refillConfirmed && (
              <div className="rounded-2xl border border-success-200 bg-success-50 px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-success-700">Refill request submitted</p>
                  <p className="text-xs text-success-600 mt-0.5">
                    Your care team will review the request for <span className="font-medium">{refillConfirmed}</span> and respond within 1–2 business days.
                  </p>
                </div>
                <button type="button" onClick={() => setRefillConfirmed(null)}
                  className="text-success-500 hover:text-success-700 text-xs font-semibold flex-shrink-0">Dismiss</button>
              </div>
            )}
            <MedicationsView medications={medications} requestRefill={handleRefill} activeMedicationId={activeMedicationId} />
          </>
        ) : null}
        {!loading && activeTab === 'labs' ? (
          <LabsView labs={labs} />
        ) : null}
        {!loading && activeTab === 'messages' ? (
          <MessagesView
            messages={messages}
            messageForm={messageForm}
            setMessageForm={setMessageForm}
            sendMessage={handleSendMessage}
            sendingMessage={sendingMessage}
          />
        ) : null}
        {!loading && activeTab === 'triage' ? (
          <SymptomTriageView form={triageForm} setForm={setTriageForm} onSubmit={handleSubmitTriage} submitting={submittingTriage} />
        ) : null}
        {!loading && activeTab === 'prep' ? (
          <VisitPrepView checklist={visitPrep} />
        ) : null}
        {!loading && activeTab === 'medivault' ? (
          <MediVaultView
            patientId={portalSession?.patient?.id}
            onExport={handleMediVaultExport}
            exporting={exportingRecords}
            exportError={exportError}
          />
        ) : null}
        {!loading && activeTab === 'voice' ? (
          <PatientVoice />
        ) : null}
      </main>
    </div>
  );
}
