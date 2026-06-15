/**
 * PatientsPage — Patient Roster screen
 *
 * Route: /patients
 *
 * Full patient roster with search, new-patient modal, and chart links.
 * Moved from the Dashboard card into its own dedicated screen per spec S4.
 * The Dashboard card continues to show a compact roster view for convenience.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, Search, ChevronRight } from 'lucide-react';
import api from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import LoadingSpinner from '../components/common/LoadingSpinner';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { useAuth } from '../context/AuthContext';
import { avatarTone, getInitials } from '../components/common/avatarColor';

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

function formatDOB(dob) {
  if (!dob) return '—';
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? `${dob}T12:00:00` : dob;
    return new Date(normalized).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dob; }
}

// PatientRoster component — the core table used on this page
function PatientRoster({ patients, onNewVisit, startingVisit, onNavigate }) {
  const navigate = useNavigate();
  return (
    <div className="divide-y divide-slate-100">
      {patients.map((patient) => {
        const fullName = `${patient.first_name} ${patient.last_name}`;
        const initials = getInitials(patient.first_name, patient.last_name);
        const tone = avatarTone(fullName);
        return (
          <div key={patient.id} className="mc-row group flex items-center gap-3 py-3 hover:shadow-mc">
            <button
              type="button"
              onClick={() => onNavigate(patient.id)}
              className={`${tone.bg} ${tone.text} h-10 w-10 shrink-0 rounded-full border-0 flex items-center justify-center font-semibold text-sm cursor-pointer shadow-mc ring-1 ring-white/10 hover:ring-2 hover:ring-offset-1 hover:ring-navy-400 transition-all duration-150 group-hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500`}
              title={`View chart for ${fullName}`}
            >
              {initials}
            </button>
            <button
              type="button"
              onClick={() => onNavigate(patient.id)}
              className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
            >
              <div className="truncate font-medium text-navy-700 group-hover:text-navy-600 transition-colors">{fullName}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                {patient.mrn && <span>MRN: {patient.mrn}</span>}
                {patient.dob && <span>DOB: {formatDOB(patient.dob)}</span>}
                {patient.sex && <span>{patient.sex}</span>}
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate(patient.id)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-ivory-200 hover:text-navy-600"
                title="Open chart"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
              <TouchButton
                variant="primary"
                size="sm"
                loading={startingVisit === patient.id}
                disabled={startingVisit !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onNewVisit(patient);
                }}
              >
                New Visit
              </TouchButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PatientsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { providerName } = useAuth();

  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState({});
  const [savingPatient, setSavingPatient] = useState(false);
  const [startingVisit, setStartingVisit] = useState(null);

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);
      const list = await api.getPatients();
      setPatients(list || []);
    } catch (err) {
      toast.error('Failed to load patients');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return patients;
    const q = searchQuery.toLowerCase();
    return patients.filter((p) => {
      const full = `${p.first_name} ${p.last_name}`.toLowerCase();
      const mrn = (p.mrn || '').toLowerCase();
      return full.includes(q) || mrn.includes(q);
    });
  }, [patients, searchQuery]);

  async function handleCreatePatient(e) {
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
      await loadPatients();
    } catch (err) {
      toast.error('Failed to create patient');
    } finally {
      setSavingPatient(false);
    }
  }

  async function handleNewVisit(patient) {
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
    } finally {
      setStartingVisit(null);
    }
  }

  return (
    <div className="mc-page mc-reveal-stagger space-y-6 pb-8">
      {/* Header */}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <div>
          <p className="mc-section-label">Roster · {patients.length}</p>
          <h1 className="mc-page-title flex items-center gap-2">
            <Users size={22} className="text-navy-600" strokeWidth={2} />
            Patients
          </h1>
        </div>
        <TouchButton
          variant="primary"
          icon={<UserPlus size={18} strokeWidth={2} />}
          onClick={() => setShowNewPatient(true)}
        >
          New Patient
        </TouchButton>
      </div>

      {/* Search + Table */}
      <Card>
        <CardHeader>
          <div className="relative">
            <Search
              size={16}
              strokeWidth={2}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              className="input-clinical w-full pl-9"
              placeholder="Search by name or MRN…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <LoadingSpinner message="Loading patients…" />
          ) : filteredPatients.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-300 ring-1 ring-navy-100">
                <Users size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-slate-600">
                {searchQuery ? 'No patients match your search.' : 'No patients yet.'}
              </p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-navy-600 transition-colors hover:text-navy-700"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <PatientRoster
              patients={filteredPatients}
              onNewVisit={handleNewVisit}
              startingVisit={startingVisit}
              onNavigate={(id) => navigate(`/patient/${id}`)}
            />
          )}
        </CardBody>
      </Card>

      {/* New Patient Modal */}
      <Modal
        isOpen={showNewPatient}
        onClose={() => { setShowNewPatient(false); setNewPatientForm({}); }}
        title="New Patient"
      >
        <form onSubmit={handleCreatePatient} className="space-y-4 p-4">
          {NEW_PATIENT_FIELDS.map((field) => (
            <div key={field.name}>
              <label className="label-clinical">{field.label}{field.required && ' *'}</label>
              {field.type === 'select' ? (
                <select
                  className="input-clinical w-full"
                  value={newPatientForm[field.name] || ''}
                  onChange={(e) => setNewPatientForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  required={field.required}
                >
                  <option value="">Select…</option>
                  {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={field.type}
                  className="input-clinical w-full"
                  placeholder={field.placeholder}
                  value={newPatientForm[field.name] || ''}
                  onChange={(e) => setNewPatientForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  required={field.required}
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-2">
            <TouchButton type="button" variant="secondary" onClick={() => { setShowNewPatient(false); setNewPatientForm({}); }}>
              Cancel
            </TouchButton>
            <TouchButton type="submit" variant="primary" loading={savingPatient}>
              Create Patient
            </TouchButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
