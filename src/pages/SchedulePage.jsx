import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import {
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  CalendarDays,
  CalendarX,
  LogIn,
  CheckCircle2,
  CalendarRange,
} from 'lucide-react';

const STATUS_LABELS = {
  scheduled: { label: 'Scheduled', variant: 'routine' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  arrived: { label: 'Arrived', variant: 'purple' },
  completed: { label: 'Completed', variant: 'success' },
  'no-show': { label: 'No-Show', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'warning' },
};

const VISIT_TYPES = [
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'new_patient', label: 'New Patient' },
  { value: 'sick_visit', label: 'Sick Visit' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'telehealth', label: 'Telehealth' },
];

function formatAppointmentType(value) {
  return VISIT_TYPES.find((type) => type.value === value)?.label || String(value || '').replace(/_/g, ' ');
}

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = toDateStr(new Date());
  if (dateStr === today) return 'Today';
  if (dateStr === shiftDate(today, 1)) return 'Tomorrow';
  if (dateStr === shiftDate(today, -1)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '--';
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export default function SchedulePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { providerName } = useAuth();

  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  // New appointment form state
  const [form, setForm] = useState({
    patient_id: '',
    appointment_date: toDateStr(new Date()),
    appointment_time: '09:00',
    duration_minutes: 30,
    appointment_type: 'follow_up',
    chief_complaint: '',
    notes: '',
    provider_name: providerName || '',
  });

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSchedule({ date: selectedDate });
      setAppointments(data.appointments || []);
    } catch (err) {
      toast.error('Failed to load schedule: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, toast]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    api.getPatients().then((data) => setPatients(data.patients || data || [])).catch(() => {});
  }, []);

  async function handleStatusChange(apptId, newStatus) {
    setUpdatingId(apptId);
    try {
      await api.updateAppointment(apptId, { status: newStatus });
      await loadSchedule();
      toast.success(`Status updated to ${newStatus}`);
    } catch (err) {
      toast.error('Update failed: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(apptId) {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      await api.deleteAppointment(apptId);
      await loadSchedule();
      toast.success('Appointment cancelled');
    } catch (err) {
      toast.error('Delete failed: ' + err.message);
    }
  }

  async function handleNewAppointment(e) {
    e.preventDefault();
    try {
      await api.createAppointment({
        ...form,
        patient_id: parseInt(form.patient_id),
        duration_minutes: parseInt(form.duration_minutes),
        provider_name: form.provider_name || providerName || 'Dr. MJR',
      });
      toast.success('Appointment scheduled');
      setShowNewForm(false);
      setForm(f => ({ ...f, patient_id: '', chief_complaint: '', notes: '' }));
      // Reload if new appt is on selected date
      if (form.appointment_date === selectedDate) await loadSchedule();
    } catch (err) {
      toast.error('Failed to schedule: ' + err.message);
    }
  }

  async function handleCheckin(appt) {
    try {
      const enc = await api.createEncounter({
        patient_id: appt.patient_id,
        chief_complaint: appt.chief_complaint || formatAppointmentType(appt.appointment_type) || 'Office Visit',
        encounter_date: selectedDate,
        encounter_type: appt.appointment_type === 'new_patient' ? 'new_patient' : 'office_visit',
      });
      const encId = enc.encounter_id || enc.id;
      await api.updateAppointment(appt.id, { status: 'checked-in', encounter_id: encId });
      navigate('/checkin/' + encId);
    } catch (err) {
      toast.error('Check-in failed: ' + err.message);
    }
  }

  const totalByStatus = appointments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mc-page max-w-4xl mc-reveal-stagger space-y-5">
      {/* Page header — gold hairline crowns the surface + a navy icon chip in the
          title, matching the AuditPage reference bar (signature). */}
      <div className="relative">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <p className="mc-section-label">Reception</p>
        <h1 className="mc-page-title flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-navy-100">
            <CalendarRange size={20} strokeWidth={2} aria-hidden="true" />
          </span>
          Schedule
        </h1>
      </div>

      {/* Date navigation — signature moment: a gold hairline crowns the control bar */}
      <div className="relative mc-card rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />
        <div className="flex items-center gap-2">
          <TouchButton
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Previous day"
            icon={<ChevronLeft className="w-4 h-4" strokeWidth={2.25} />}
            onClick={() => setSelectedDate(d => shiftDate(d, -1))}
          />
          <div className="flex items-center gap-2.5 min-w-[180px] justify-center px-1">
            <CalendarDays className="w-4 h-4 text-gold-500 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
            <div className="text-center">
              <p className="font-display text-lg font-semibold text-navy-700 tracking-tight leading-tight">{formatDisplayDate(selectedDate)}</p>
              <p className="text-xs text-slate-500 tabular-nums">{selectedDate}</p>
            </div>
          </div>
          <TouchButton
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Next day"
            icon={<ChevronRight className="w-4 h-4" strokeWidth={2.25} />}
            onClick={() => setSelectedDate(d => shiftDate(d, 1))}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          />
          <TouchButton type="button" variant="secondary" size="sm" onClick={() => setSelectedDate(toDateStr(new Date()))}>
            Today
          </TouchButton>
          <TouchButton
            type="button"
            variant="primary"
            size="sm"
            icon={<CalendarPlus className="w-4 h-4" strokeWidth={2.25} />}
            onClick={() => setShowNewForm(true)}
          >
            New Appointment
          </TouchButton>
        </div>
      </div>

      {/* Summary badges */}
      {appointments.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="mc-section-label mb-0">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''}</span>
          {Object.entries(totalByStatus).map(([status, count]) => (
            <Badge key={status} variant={STATUS_LABELS[status]?.variant || 'routine'}>
              {count} {STATUS_LABELS[status]?.label || status}
            </Badge>
          ))}
        </div>
      )}

      {/* New appointment form */}
      {showNewForm && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <span>New Appointment</span>
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                aria-label="Close new appointment form"
                className="text-slate-400 hover:text-navy-700 text-lg leading-none rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-1"
              >
                &times;
              </button>
            </div>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleNewAppointment} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Patient *</label>
                  <select
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    value={form.patient_id}
                    onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}
                  >
                    <option value="">Select patient...</option>
                    {patients.map(p => {
                      const dob = p.dob ? ` · DOB ${p.dob}` : '';
                      const mrn = p.mrn ? ` · MRN ${p.mrn}` : '';
                      return (
                        <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}{mrn}{dob}</option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Visit Type</label>
                  <select
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    value={form.appointment_type}
                    onChange={e => setForm(f => ({ ...f, appointment_type: e.target.value }))}
                  >
                    {VISIT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Date</label>
                  <input
                    type="date"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    value={form.appointment_date}
                    onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Time</label>
                  <input
                    type="time"
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    value={form.appointment_time}
                    onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Duration (min)</label>
                  <select
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  >
                    {[15, 20, 30, 45, 60, 90].map(d => (
                      <option key={d} value={d}>{d} min</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Chief Complaint</label>
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-offWhite-100 text-navy-700 transition-all duration-150 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                    placeholder="Reason for visit..."
                    value={form.chief_complaint}
                    onChange={e => setForm(f => ({ ...f, chief_complaint: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <TouchButton variant="secondary" size="sm" type="button" onClick={() => setShowNewForm(false)}>
                  Cancel
                </TouchButton>
                <TouchButton variant="primary" size="sm" type="submit">
                  Schedule Appointment
                </TouchButton>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Appointment list */}
      {loading ? (
        <LoadingSpinner message="Loading schedule..." />
      ) : appointments.length === 0 ? (
        <Card>
          <CardBody className="text-center py-14">
            <span className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ivory-200 border border-slate-100 shadow-mc">
              <CalendarDays className="w-8 h-8 text-slate-400" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="font-display text-lg font-semibold text-navy-700">No appointments scheduled</h3>
            <p className="text-sm text-slate-600 mt-1">for {formatDisplayDate(selectedDate)}</p>
            <div className="mt-5">
              <TouchButton
                type="button"
                variant="primary"
                size="sm"
                icon={<CalendarPlus className="w-4 h-4" strokeWidth={2.25} />}
                onClick={() => setShowNewForm(true)}
              >
                Schedule an Appointment
              </TouchButton>
            </div>
          </CardBody>
        </Card>
      ) : (
        /* Appointment list — audit-grade refined table treatment: slate
           column-header eyebrows, refined row rhythm, hover, semantic status
           dots, and a danger lead-edge on no-show / cancelled rows. */
        <Card>
          <CardHeader action={<span className="font-mono text-xs text-slate-500">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''}</span>}>
            {formatDisplayDate(selectedDate)}
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-ivory-200/70">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Visit</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...appointments]
                  .sort((a, b) => (a.appointment_time || '').localeCompare(b.appointment_time || ''))
                  .map(appt => {
                    const statusInfo = STATUS_LABELS[appt.status] || { label: appt.status, variant: 'routine' };
                    const isUpdating = updatingId === appt.id;
                    // A flagged row (no-show / cancelled) carries a quiet danger
                    // lead-edge; an active arrival carries a gold attention edge.
                    const isFlagged = appt.status === 'no-show' || appt.status === 'cancelled';
                    const isArrived = appt.status === 'arrived';
                    const dotColor = appt.status === 'completed' || appt.status === 'confirmed'
                      ? 'bg-success-500'
                      : isFlagged
                      ? 'bg-danger-500'
                      : isArrived
                      ? 'bg-gold-500'
                      : 'bg-navy-400';
                    return (
                      <tr key={appt.id} className={`group transition-colors ${
                        isFlagged ? 'bg-danger-50/40 hover:bg-danger-50/70' : 'hover:bg-ivory-200'
                      }`}>
                        {/* Time */}
                        <td className={`relative whitespace-nowrap px-4 py-3 ${
                          isFlagged ? 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-danger-400 before:opacity-70' :
                          isArrived ? 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-gold-400 before:opacity-70' : ''
                        }`}>
                          <p className="text-sm font-bold text-navy-700 tabular-nums">{formatTime(appt.appointment_time)}</p>
                          <p className="text-xs text-slate-500">{appt.duration_minutes || 30}m</p>
                        </td>
                        {/* Patient */}
                        <td className="px-4 py-3">
                          <p className="font-semibold text-navy-700 text-sm">
                            {appt.patient_last_name ? `${appt.patient_last_name}, ${appt.patient_first_name}` : `Patient #${appt.patient_id}`}
                          </p>
                          {appt.chief_complaint && (
                            <p className="text-xs text-slate-600 mt-0.5 max-w-[220px] truncate">{appt.chief_complaint}</p>
                          )}
                        </td>
                        {/* Status */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden="true" />
                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                          </span>
                        </td>
                        {/* Visit type */}
                        <td className="whitespace-nowrap px-4 py-3">
                          {appt.appointment_type ? (
                            <span className="text-xs text-slate-600 capitalize">{formatAppointmentType(appt.appointment_type)}</span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {appt.status === 'scheduled' || appt.status === 'confirmed' ? (
                              <>
                                {appt.status === 'scheduled' && (
                                  <button
                                    onClick={() => handleStatusChange(appt.id, 'confirmed')}
                                    disabled={isUpdating}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-navy-50 text-navy-700 border border-navy-100 rounded-lg hover:bg-navy-100 active:bg-navy-100 transition-colors disabled:opacity-50 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-1"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
                                    Confirm
                                  </button>
                                )}
                                <button
                                  onClick={() => handleCheckin(appt)}
                                  disabled={isUpdating}
                                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-success-50 text-success-700 border border-success-100 rounded-lg hover:bg-success-100 active:bg-success-100 transition-colors disabled:opacity-50 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500 focus-visible:ring-offset-1"
                                >
                                  <LogIn className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
                                  Check In
                                </button>
                                <button
                                  onClick={() => handleStatusChange(appt.id, 'no-show')}
                                  disabled={isUpdating}
                                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-danger-500 text-white rounded-lg hover:bg-danger-600 active:bg-danger-600 transition-colors disabled:opacity-50 font-semibold shadow-mc focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-1"
                                >
                                  <CalendarX className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
                                  No-Show
                                </button>
                              </>
                            ) : appt.status === 'arrived' && appt.encounter_id ? (
                              <button
                                onClick={() => navigate('/checkin/' + appt.encounter_id)}
                                className="text-xs px-2.5 py-1.5 bg-slate-50 text-slate-700 border border-slate-100 rounded-lg hover:bg-ivory-200 active:bg-ivory-200 transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-1"
                              >
                                Open Encounter
                              </button>
                            ) : null}
                            {appt.status !== 'completed' && appt.status !== 'no-show' && appt.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleDelete(appt.id)}
                                disabled={isUpdating}
                                aria-label={`Cancel appointment for ${appt.patient_last_name ? `${appt.patient_first_name} ${appt.patient_last_name}` : `patient ${appt.patient_id}`} at ${formatTime(appt.appointment_time)}`}
                                className="text-xs px-2 py-1.5 text-slate-400 hover:text-danger-600 transition-colors disabled:opacity-50 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-1"
                                title="Cancel appointment"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
