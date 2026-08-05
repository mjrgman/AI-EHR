import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { safeLog } from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import QueueDashboard from '../components/workflow/QueueDashboard';
import StatTile from '../components/workflow/StatTile';
import { useAuth } from '../context/AuthContext';
import { avatarTone, getInitials } from '../components/common/avatarColor';
import { Hourglass, DoorOpen, Stethoscope, CheckCircle2, Users, ClipboardList, UserPlus, Search } from 'lucide-react';

// Queue summary cards. The `key` for each card MUST be a canonical workflow
// engine state (hyphenated vocab from server/workflow-engine.js STATES, mirrored
// by WorkflowTracker's STATE_CONFIG). The /dashboard endpoint builds
// `queue_counts` keyed by `wf.current_state`, so any divergent key (the old
// `waiting`/`with_provider`) silently reads 0. The unit test in
// test/unit/dashboard-queue-config.test.js asserts every key below is a member
// of the canonical STATE_CONFIG key set (single source of truth).
//
// `icon`/`tone` are presentation-only Measured Canon props consumed by the
// StatTile primitive (lucide-react icon + on-brand state color). `key` + `label`
// are unchanged (the test parses `key:` and asserts the four canonical states +
// four-card count). `tone` is disciplined: gold marks the single live attention
// beat (Waiting), navy carries in-flight authority, success marks complete.
const QUEUE_CONFIG = [
  { key: 'checked-in', label: 'Waiting', tone: 'gold', icon: Hourglass },
  { key: 'roomed', label: 'Roomed', tone: 'slate', icon: DoorOpen },
  { key: 'provider-examining', label: 'With Provider', tone: 'navy', icon: Stethoscope },
  { key: 'signed', label: 'Signed', tone: 'success', icon: CheckCircle2 },
];

const NEW_PATIENT_FIELDS = [
  { name: 'first_name', label: 'First Name', type: 'text', required: true, placeholder: 'First name' },
  { name: 'last_name', label: 'Last Name', type: 'text', required: true, placeholder: 'Last name' },
  { name: 'dob', label: 'Date of Birth', type: 'date', required: true },
  { name: 'sex', label: 'Sex', type: 'select', required: true, options: [
    { value: 'M', label: 'Male' },
    { value: 'F', label: 'Female' },
    { value: 'Other', label: 'Other' },
  ] },
  { name: 'phone', label: 'Phone', type: 'tel', required: false, placeholder: '(555) 123-4567' },
  { name: 'insurance_carrier', label: 'Insurance Carrier', type: 'text', required: false, placeholder: 'Insurance carrier name' },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { providerName } = useAuth();

  const [patients, setPatients] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState({});
  const [savingPatient, setSavingPatient] = useState(false);
  const [startingVisit, setStartingVisit] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [patientList, dashData] = await Promise.all([
        api.getPatients(),
        api.getDashboard(),
      ]);
      setPatients(patientList);
      setDashboard(dashData);
    } catch (err) {
      toast.error('Failed to load dashboard data');
      safeLog.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered patient list based on search
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return patients;
    const q = searchQuery.toLowerCase();
    return patients.filter((p) => {
      const full = `${p.first_name} ${p.last_name}`.toLowerCase();
      const mrn = (p.mrn || '').toLowerCase();
      return full.includes(q) || mrn.includes(q);
    });
  }, [patients, searchQuery]);

  // Queue counts from dashboard data
  const queueCounts = useMemo(() => {
    if (!dashboard?.queue_counts) return {};
    return dashboard.queue_counts;
  }, [dashboard]);

  const handleNewPatientChange = (field, value) => {
    setNewPatientForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreatePatient = async (e) => {
    e.preventDefault();
    if (!newPatientForm.first_name?.trim() || !newPatientForm.last_name?.trim() || !newPatientForm.dob) {
      toast.warning('First name, last name, and date of birth are required');
      return;
    }
    try {
      setSavingPatient(true);
      await api.createPatient(newPatientForm);
      toast.success(`Patient ${newPatientForm.first_name} ${newPatientForm.last_name} created`);
      setShowNewPatient(false);
      setNewPatientForm({});
      await loadData();
    } catch (err) {
      toast.error('Failed to create patient');
      safeLog.error('Dashboard error:', err);
    } finally {
      setSavingPatient(false);
    }
  };

  const handleNewVisit = async (patient) => {
    try {
      setStartingVisit(patient.id);
      const encounter = await api.createEncounter({
        patient_id: patient.id,
        encounter_type: 'office_visit',
        chief_complaint: '',
        provider: providerName || 'Dr. MJR',
      });
      toast.success(`New visit started for ${patient.first_name} ${patient.last_name}`);
      navigate(`/checkin/${encounter.id}`);
    } catch (err) {
      toast.error('Failed to start new visit');
      safeLog.error('Dashboard error:', err);
    } finally {
      setStartingVisit(null);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  const today = new Date();

  return (
    <div className="pb-24">
      <div className="mc-page mc-reveal-stagger space-y-6">
        {/* Branded greeting header — a gold hairline crowns the surface, matching
            the AuditPage reference treatment (signature, presentation-only). */}
        <header className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
          <div>
            <p className="mc-section-label">{formatDate(today)}</p>
            <h1 className="mc-page-title">
              {getGreeting()}, {providerName || 'Doctor'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-navy-50 px-3.5 py-1.5 font-medium text-navy-700 shadow-mc">
              <Users size={15} strokeWidth={2.25} className="text-navy-600" aria-hidden="true" />
              {dashboard?.patient_count ?? patients.length} Patients
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-success-100 bg-success-50 px-3.5 py-1.5 font-medium text-success-700 shadow-mc">
              <ClipboardList size={15} strokeWidth={2.25} className="text-success-600" aria-hidden="true" />
              {dashboard?.active_encounters ?? 0} Active Encounters
            </span>
          </div>
        </header>

        {/* Queue count summary cards — redesigned KPI tiles (lucide icon in a
            tinted chip, large serif number, no arbitrary dots). Gold tone on
            "Waiting" is the dashboard's single live attention beat. */}
        <div className="mc-reveal-stagger grid grid-cols-2 gap-4 sm:grid-cols-4">
          {QUEUE_CONFIG.map((q) => (
            <StatTile
              key={q.key}
              icon={q.icon}
              label={q.label}
              tone={q.tone}
              value={queueCounts[q.key] ?? 0}
            />
          ))}
        </div>

        {/* Main grid: 1 col mobile, 2 cols desktop */}
        <div className="mc-reveal-stagger grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left column -- Patient list */}
          <div>
            <Card className="relative">
              {/* Signature moment: a refined gold key-line crowning the roster. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] bg-gradient-to-r from-gold-500/0 via-gold-500/80 to-gold-500/0"
              />
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mc-section-label">Roster · {filteredPatients.length}</p>
                    <h2 className="font-display text-base font-semibold tracking-tight text-navy-700 m-0">Patients</h2>
                  </div>
                  <TouchButton
                    type="button"
                    variant="primary"
                    size="sm"
                    icon={<UserPlus size={16} strokeWidth={2.25} />}
                    onClick={() => setShowNewPatient(true)}
                  >
                    Add New Patient
                  </TouchButton>
                </div>
                <div className="relative mt-3">
                  <Search
                    size={16}
                    strokeWidth={2}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    className="input-clinical w-full pl-9"
                    placeholder="Search by name or MRN..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardBody>
                {filteredPatients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-300 ring-1 ring-navy-100">
                      <Users size={22} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-slate-600">
                      {searchQuery
                        ? 'No patients match your search.'
                        : 'No patients yet.'}
                    </p>
                    <p className="max-w-[15rem] text-xs leading-5 text-slate-500">
                      {searchQuery
                        ? 'Try a different name or MRN, or clear the search.'
                        : 'Add a patient to begin building the roster.'}
                    </p>
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-navy-600 transition-colors hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                      >
                        Clear search
                      </button>
                    ) : (
                      <TouchButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={<UserPlus size={15} strokeWidth={2.25} />}
                        onClick={() => setShowNewPatient(true)}
                      >
                        Add New Patient
                      </TouchButton>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredPatients.map((patient) => {
                      const fullName = `${patient.first_name} ${patient.last_name}`;
                      const initials = getInitials(patient.first_name, patient.last_name);
                      const tone = avatarTone(fullName);

                      return (
                        <div
                          key={patient.id}
                          className="mc-row group flex items-center gap-3 py-3 hover:shadow-mc"
                        >
                          {/* Avatar */}
                          <button
                            type="button"
                            onClick={() => navigate(`/patient/${patient.id}`)}
                            className={`${tone.bg} ${tone.text} w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0 cursor-pointer shadow-mc ring-1 ring-white/10 hover:ring-2 hover:ring-offset-1 hover:ring-navy-400 transition-all duration-150 group-hover:scale-105 active:scale-95 border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-1`}
                            title={`View ${fullName}`}
                          >
                            {initials}
                          </button>

                          {/* Patient Info */}
                          <button
                            type="button"
                            onClick={() => navigate(`/patient/${patient.id}`)}
                            className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0"
                          >
                            <div className="font-medium text-navy-700 truncate group-hover:text-navy-600 transition-colors">
                              {fullName}
                            </div>
                            <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {patient.mrn && <span>MRN: {patient.mrn}</span>}
                              {patient.dob && <span>DOB: {patient.dob}</span>}
                              {patient.sex && <span>{patient.sex}</span>}
                            </div>
                          </button>

                          {/* New Visit — a PRIMARY action, navy filled (not
                              success-green; green is reserved for complete states). */}
                          <TouchButton
                            variant="primary"
                            size="sm"
                            loading={startingVisit === patient.id}
                            disabled={startingVisit !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNewVisit(patient);
                            }}
                          >
                            New Visit
                          </TouchButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Right column -- Active encounters */}
          <div>
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <p className="mc-section-label">In Flight · {dashboard?.active_encounters ?? 0}</p>
                  <h2 className="font-display text-base font-semibold tracking-tight text-navy-700 m-0">Active Encounters</h2>
                </div>
              </CardHeader>
              <CardBody>
                <QueueDashboard />
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* Status bar removed — AppShell footer serves this role globally. */}

      {/* New patient modal */}
      <Modal
        isOpen={showNewPatient}
        onClose={() => {
          setShowNewPatient(false);
          setNewPatientForm({});
        }}
        title="Add New Patient"
        size="lg"
      >
        <form onSubmit={handleCreatePatient} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {NEW_PATIENT_FIELDS.map((field) => (
              <div key={field.name}>
                <label className="label-clinical">
                  {field.label}
                  {field.required && (
                    <span className="text-danger-500 ml-0.5">*</span>
                  )}
                </label>

                {field.type === 'select' ? (
                  <select
                    className="input-clinical w-full"
                    value={newPatientForm[field.name] || ''}
                    onChange={(e) =>
                      handleNewPatientChange(field.name, e.target.value)
                    }
                    required={field.required}
                  >
                    <option value="">Select...</option>
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    className="input-clinical w-full"
                    placeholder={field.placeholder || ''}
                    value={newPatientForm[field.name] || ''}
                    onChange={(e) =>
                      handleNewPatientChange(field.name, e.target.value)
                    }
                    required={field.required}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <TouchButton
              variant="ghost"
              type="button"
              onClick={() => {
                setShowNewPatient(false);
                setNewPatientForm({});
              }}
            >
              Cancel
            </TouchButton>
            <TouchButton
              variant="primary"
              type="submit"
              loading={savingPatient}
            >
              Create Patient
            </TouchButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
