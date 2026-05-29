import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { safeLog } from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import QueueDashboard from '../components/workflow/QueueDashboard';
import { useAuth } from '../context/AuthContext';

// Queue summary cards. The `key` for each card MUST be a canonical workflow
// engine state (hyphenated vocab from server/workflow-engine.js STATES, mirrored
// by WorkflowTracker's STATE_CONFIG). The /dashboard endpoint builds
// `queue_counts` keyed by `wf.current_state`, so any divergent key (the old
// `waiting`/`with_provider`) silently reads 0. The unit test in
// test/unit/dashboard-queue-config.test.js asserts every key below is a member
// of the canonical STATE_CONFIG key set (single source of truth).
//
// `accent`/`dot` are presentation-only Measured Canon brand classes layered on
// the .mc-stat-card surface. `key` + `label` are unchanged (the test parses
// `key:` and asserts the four canonical states + four-card count).
const QUEUE_CONFIG = [
  { key: 'checked-in', label: 'Waiting', accent: 'text-gold-600', dot: 'bg-gold-500', icon: '⏳' },
  { key: 'roomed', label: 'Roomed', accent: 'text-slate-600', dot: 'bg-slate-400', icon: '🚪' },
  { key: 'provider-examining', label: 'With Provider', accent: 'text-navy-600', dot: 'bg-navy-500', icon: '👨‍⚕️' },
  { key: 'signed', label: 'Signed', accent: 'text-success-600', dot: 'bg-success-500', icon: '✅' },
];

const NEW_PATIENT_FIELDS = [
  { name: 'first_name', label: 'First Name', type: 'text', required: true, placeholder: 'First name' },
  { name: 'last_name', label: 'Last Name', type: 'text', required: true, placeholder: 'Last name' },
  { name: 'dob', label: 'Date of Birth', type: 'date', required: true },
  { name: 'sex', label: 'Sex', type: 'select', required: true, options: ['Male', 'Female', 'Other'] },
  { name: 'mrn', label: 'MRN', type: 'text', required: false, placeholder: 'Auto-generated if blank' },
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

function getInitials(first, last) {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
];

function avatarColor(name) {
  let hash = 0;
  for (const ch of (name || '')) {
    hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { currentRole, providerName } = useAuth();

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
        {/* Branded greeting header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mc-section-label">{formatDate(today)}</p>
            <h1 className="mc-page-title">
              {getGreeting()}, {providerName || 'Doctor'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-navy-50 px-3.5 py-1.5 font-medium text-navy-700">
              <span className="text-base" aria-hidden="true">{'👥'}</span>
              {dashboard?.patient_count ?? patients.length} Patients
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-success-100 bg-success-50 px-3.5 py-1.5 font-medium text-success-700">
              <span className="text-base" aria-hidden="true">{'📋'}</span>
              {dashboard?.active_encounters ?? 0} Active Encounters
            </span>
          </div>
        </header>

        {/* Queue count summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUEUE_CONFIG.map((q) => (
            <div key={q.key} className="mc-stat-card mc-card-hover">
              <div className="flex items-center justify-between">
                <span className="text-xl leading-none" aria-hidden="true">{q.icon}</span>
                <span className={`h-2 w-2 rounded-full ${q.dot}`} aria-hidden="true" />
              </div>
              <div className={`mt-1 font-display text-3xl font-semibold tabular-nums ${q.accent}`}>
                {queueCounts[q.key] ?? 0}
              </div>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                {q.label}
              </div>
            </div>
          ))}
        </div>

        {/* Main grid: 1 col mobile, 2 cols desktop */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left column -- Patient list */}
          <div>
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h2 className="font-display text-base font-semibold tracking-tight text-navy-700 m-0">Patients</h2>
                  <TouchButton
                    type="button"
                    variant="primary"
                    size="sm"
                    icon="+"
                    onClick={() => setShowNewPatient(true)}
                  >
                    Add New Patient
                  </TouchButton>
                </div>
                <div className="mt-3">
                  <input
                    type="text"
                    className="input-clinical w-full"
                    placeholder="Search by name or MRN..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardBody>
                {filteredPatients.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">
                    {searchQuery
                      ? 'No patients match your search.'
                      : 'No patients found.'}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredPatients.map((patient) => {
                      const fullName = `${patient.first_name} ${patient.last_name}`;
                      const initials = getInitials(patient.first_name, patient.last_name);
                      const bgColor = avatarColor(fullName);

                      return (
                        <div
                          key={patient.id}
                          className="flex items-center gap-3 py-3 px-1 hover:bg-ivory-200 rounded-lg transition-colors group"
                        >
                          {/* Avatar */}
                          <button
                            type="button"
                            onClick={() => navigate(`/patient/${patient.id}`)}
                            className={`${bgColor} w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-navy-400 transition-shadow border-0`}
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
                            <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {patient.mrn && <span>MRN: {patient.mrn}</span>}
                              {patient.dob && <span>DOB: {patient.dob}</span>}
                              {patient.sex && <span>{patient.sex}</span>}
                            </div>
                          </button>

                          {/* New Visit Button */}
                          <TouchButton
                            variant="success"
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
                <h2 className="font-display text-base font-semibold tracking-tight text-navy-700 m-0">Active Encounters</h2>
              </CardHeader>
              <CardBody>
                <QueueDashboard />
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* System status bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-navy-800 bg-navy-700 px-4 py-2 text-xs text-white/80">
        <div className="flex items-center gap-3">
          <Badge variant="success" dot>System Online</Badge>
          <span className="text-white/30">|</span>
          <span>Role: {currentRole || 'Provider'}</span>
          <span className="text-white/30">|</span>
          <span>CDS Engine: Active</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">{formatDate(today)}</span>
          <span className="hidden text-white/30 sm:inline">|</span>
          <span className="font-medium tracking-wide text-gold-300">MJR-EHR v1.0</span>
        </div>
      </div>

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
                      <option key={opt} value={opt}>
                        {opt}
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
