import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { portalApi } from '../api/client';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'medications', label: 'Medications' },
  { key: 'labs', label: 'Labs' },
  { key: 'messages', label: 'Messages' },
  { key: 'triage', label: 'Symptom Triage' },
  { key: 'prep', label: 'Visit Prep' },
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
    scheduled: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-sky-100 text-sky-800',
    checked_in: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-slate-100 text-slate-700',
    submitted: 'bg-amber-100 text-amber-800',
    physician_review: 'bg-orange-100 text-orange-800',
    sent: 'bg-emerald-100 text-emerald-800',
    read: 'bg-slate-100 text-slate-700',
  };

  const label = String(status || 'unknown').replace(/[_-]/g, ' ');
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${palette[status] || 'bg-slate-100 text-slate-700'}`}>
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dbeafe,_#f8fafc_45%,_#f8fafc_80%)] px-4 py-12">
      <div className="mx-auto max-w-5xl rounded-[2rem] border border-sky-100 bg-white/85 p-6 shadow-[0_30px_80px_rgba(14,116,144,0.12)] backdrop-blur md:grid md:grid-cols-[1.1fr_0.9fr] md:gap-10 md:p-10">
        <section className="mb-8 md:mb-0">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Patient Portal</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">Verify your identity to access appointments, labs, and messages.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
            Portal access now runs on a dedicated patient session. Once verified, every refill request, secure message, and triage submission is tied to your server-side portal identity.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Appointments</p>
              <p className="mt-2 text-sm text-slate-700">Check upcoming visits and self check-in when available.</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Messaging</p>
              <p className="mt-2 text-sm text-slate-700">Secure refill and care-team requests persist into the shared workflow.</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Triage</p>
              <p className="mt-2 text-sm text-slate-700">Report symptoms with a severity score so the team can route urgent follow-up.</p>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <h2 className="text-2xl font-semibold text-slate-900">Verify identity</h2>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {[
              ['first_name', 'First name', 'text'],
              ['last_name', 'Last name', 'text'],
              ['dob', 'Date of birth', 'date'],
              ['mrn', 'MRN (optional)', 'text'],
            ].map(([key, label, type]) => (
              <label className="block" key={key}>
                <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(event) => update(key, event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                  required={key !== 'mrn'}
                />
              </label>
            ))}

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400"
            >
              {loading ? 'Verifying...' : 'Continue to Portal'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function DashboardView({ appointments, medications, labs, patientName }) {
  const upcoming = appointments[0];
  const abnormalLabs = labs.filter((lab) => lab.flag_level === 'abnormal');
  const refillPending = medications.filter((medication) => medication.refill_status === 'physician_review');

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-3xl border border-sky-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Welcome</p>
        <h3 className="mt-2 text-2xl font-semibold text-slate-900">{patientName}</h3>
        {upcoming ? (
          <div className="mt-5 rounded-2xl bg-sky-50 p-4">
            <p className="text-sm font-semibold text-sky-800">Next appointment</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{formatDate(upcoming.appointment_date)}</p>
            <p className="text-sm text-slate-600">{formatTime(upcoming.appointment_time)} with {upcoming.provider_name}</p>
          </div>
        ) : (
          <p className="mt-5 text-sm text-slate-600">No upcoming appointments are scheduled.</p>
        )}
      </div>
      <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Medications</p>
        <p className="mt-3 text-4xl font-semibold text-slate-900">{medications.length}</p>
        <p className="mt-1 text-sm text-slate-600">Active medications on file</p>
        <p className="mt-5 text-sm text-slate-700">{refillPending.length} refill requests currently under review.</p>
      </div>
      <div className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Lab results</p>
        <p className="mt-3 text-4xl font-semibold text-slate-900">{labs.length}</p>
        <p className="mt-1 text-sm text-slate-600">Recent results available</p>
        <p className="mt-5 text-sm text-slate-700">{abnormalLabs.length} flagged results need clinician review.</p>
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
      await portalApi.requestAppointment({
        slotId: slot.slotId,
        appointmentType,
        reason: reason || 'Patient-requested appointment',
      });
      reset();
      setOpen(false);
      await onSubmitted();
    } catch (err) {
      setError(err.message || 'Failed to request appointment');
      setSubmittingSlotId(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
      >
        Request a new appointment
      </button>
    );
  }

  return (
    <div className="rounded-3xl border border-sky-200 bg-sky-50/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-900">Request a new appointment</h3>
        <button
          onClick={() => { reset(); setOpen(false); }}
          className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="text-sm font-medium text-slate-700">Visit type</label>
        <select
          value={appointmentType}
          onChange={(e) => { setAppointmentType(e.target.value); setSlots([]); }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
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
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-4">
        <button
          onClick={handleFindSlots}
          disabled={findingSlots}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400"
        >
          {findingSlots ? 'Finding slots...' : 'Find available slots'}
        </button>
      </div>

      {slots.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pick a time — your request will be sent to the front desk for confirmation
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => (
              <button
                key={slot.slotId}
                onClick={() => handleBookSlot(slot)}
                disabled={submittingSlotId !== null}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:border-sky-400 hover:bg-sky-50 disabled:opacity-50"
              >
                {submittingSlotId === slot.slotId ? 'Submitting...' : slot.dateTimeFormatted}
                <span className="block text-xs font-normal text-slate-500">{slot.duration} min</span>
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
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          No upcoming appointments. Use the form above to request one.
        </div>
      ) : (
        <div className="space-y-4">
          {appointments.map((appointment) => (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" key={appointment.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">{formatDate(appointment.appointment_date)}</h3>
                  <p className="mt-1 text-sm text-slate-600">{formatTime(appointment.appointment_time)} with {appointment.provider_name}</p>
                  <p className="mt-2 text-sm text-slate-500 capitalize">{String(appointment.appointment_type || 'visit').replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={appointment.status} />
                  {['scheduled', 'confirmed'].includes(appointment.status) ? (
                    <button
                      onClick={() => checkInAppointment(appointment.id)}
                      disabled={activeCheckInId === appointment.id}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300"
                    >
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
    return <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">No active medications on file.</div>;
  }

  return (
    <div className="space-y-4">
      {medications.map((medication) => (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" key={medication.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{medication.medication_name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {[medication.dose, medication.route, medication.frequency].filter(Boolean).join(' • ')}
              </p>
              <p className="mt-2 text-sm text-slate-500">Prescriber: {medication.prescriber || 'Care team'}</p>
            </div>
            <div className="flex items-center gap-3">
              {medication.refill_status ? <StatusPill status={medication.refill_status} /> : null}
              <button
                onClick={() => requestRefill(medication)}
                disabled={activeMedicationId === medication.id}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400"
              >
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
    return <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">No lab results are available yet.</div>;
  }

  return (
    <div className="space-y-4">
      {labs.map((lab) => (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" key={lab.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{lab.plain_name || lab.test_name}</h3>
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
      <div className="space-y-4">
        {messages.length ? messages.map((message) => (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" key={message.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{message.subject || 'Message'}</h3>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{message.message_type || 'general'}</p>
              </div>
              <StatusPill status={message.status} />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message.plain_language_content || message.content}</p>
          </div>
        )) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">No messages yet.</div>
        )}
      </div>

      <form className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={sendMessage}>
        <h3 className="text-xl font-semibold text-slate-900">Send a secure message</h3>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
            <input
              value={messageForm.subject}
              onChange={(event) => setMessageForm((current) => ({ ...current, subject: event.target.value }))}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Message</span>
            <textarea
              value={messageForm.message}
              onChange={(event) => setMessageForm((current) => ({ ...current, message: event.target.value }))}
              rows={6}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
              required
            />
          </label>
          <button
            type="submit"
            disabled={sendingMessage}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-400"
          >
            {sendingMessage ? 'Sending...' : 'Send message'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SymptomTriageView({ form, setForm, onSubmit, submitting }) {
  return (
    <form className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={onSubmit}>
      <h3 className="text-2xl font-semibold text-slate-900">Report symptoms</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        This feature is the first Track C slice. Symptom reports persist into the care-team workflow and are routed based on severity.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-700">Symptoms</span>
          <textarea
            value={form.symptoms}
            onChange={(event) => setForm((current) => ({ ...current, symptoms: event.target.value }))}
            rows={4}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
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
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            required
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Onset</span>
          <input
            value={form.onset}
            onChange={(event) => setForm((current) => ({ ...current, onset: event.target.value }))}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            placeholder="Example: started this morning"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-700">Additional notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            rows={4}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-6 rounded-2xl bg-rose-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-rose-700 disabled:bg-rose-300"
      >
        {submitting ? 'Submitting...' : 'Send symptom report'}
      </button>
    </form>
  );
}

function VisitPrepView({ checklist }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-2xl font-semibold text-slate-900">Visit checklist</h3>
      <ul className="mt-5 space-y-3">
        {checklist.map((item) => (
          <li className="flex items-start gap-3 text-sm leading-6 text-slate-700" key={item}>
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
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

  const handleVerify = async (form) => {
    setVerifying(true);
    setError('');
    try {
      await portalApi.verify({
        first_name: form.first_name,
        last_name: form.last_name,
        dob: form.dob,
        ...(form.mrn ? { mrn: form.mrn } : {}),
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

  const handleRefill = async (medication) => {
    setActiveMedicationId(medication.id);
    setError('');
    try {
      await portalApi.requestRefill({
        medication_id: medication.id,
        medication_name: medication.medication_name,
      });
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
    <div className="min-h-screen bg-[linear-gradient(180deg,_#eff6ff_0%,_#f8fafc_18%,_#f8fafc_100%)]">
      <header className="border-b border-sky-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Patient Portal</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{patientName}</h1>
            <p className="mt-2 text-sm text-slate-600">Appointments, labs, refill requests, and secure care-team communication.</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
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
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading portal data...</div>
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
          <MedicationsView medications={medications} requestRefill={handleRefill} activeMedicationId={activeMedicationId} />
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
      </main>
    </div>
  );
}
