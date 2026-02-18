import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import Modal from '../components/common/Modal';
import PatientBanner from '../components/patient/PatientBanner';
import ProblemList from '../components/patient/ProblemList';
import MedList from '../components/patient/MedList';
import VitalsDisplay from '../components/patient/VitalsDisplay';
import LabResults from '../components/patient/LabResults';
import AllergyBadges from '../components/patient/AllergyBadges';
import LoadingSpinner from '../components/common/LoadingSpinner';

// Workflow state to route mapping for encounter history navigation
const STATE_ROUTES = {
  'checked-in': '/checkin/',
  'vitals-recorded': '/encounter/',
  'provider-examining': '/encounter/',
  'orders-pending': '/encounter/',
  'documentation': '/review/',
  'signed': '/checkout/',
  'checked-out': '/checkout/',
};

function calculateAge(dob) {
  if (!dob) return '';
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function PatientPage() {
  const { patientId } = useParams();
  const pid = parseInt(patientId);
  const navigate = useNavigate();
  const toast = useToast();
  const { patient, loading, error, refresh } = usePatient(pid);

  // Encounter history
  const [encounters, setEncounters] = useState([]);
  const [encountersLoading, setEncountersLoading] = useState(true);

  // Modal states
  const [problemModalOpen, setProblemModalOpen] = useState(false);
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [allergyModalOpen, setAllergyModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Problem form
  const [problemForm, setProblemForm] = useState({ problem_name: '', icd10_code: '', status: 'active' });
  // Medication form
  const [medForm, setMedForm] = useState({ medication_name: '', dose: '', route: 'oral', frequency: '', status: 'active' });
  // Allergy form
  const [allergyForm, setAllergyForm] = useState({ allergen: '', reaction: '', severity: 'moderate' });

  // Load encounter history
  const loadEncounters = useCallback(async () => {
    setEncountersLoading(true);
    try {
      const data = await api.getEncounters({ patient_id: pid });
      const list = Array.isArray(data) ? data : data?.encounters || [];
      // Sort by date descending
      list.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));
      setEncounters(list);
    } catch (e) {
      // Encounters may not exist yet
      setEncounters([]);
    } finally {
      setEncountersLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadEncounters(); }, [loadEncounters]);

  // --- New encounter ---
  async function startEncounter() {
    try {
      const enc = await api.createEncounter({
        patient_id: pid,
        encounter_type: 'Office Visit - Follow-up',
        chief_complaint: '',
        provider: 'Dr. MJR',
      });
      navigate('/checkin/' + enc.id);
    } catch (e) {
      toast.error('Failed to create encounter: ' + e.message);
    }
  }

  // --- Add Problem ---
  async function handleAddProblem(e) {
    e.preventDefault();
    if (!problemForm.problem_name.trim()) {
      toast.warning('Problem name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`/api/patients/${pid}/problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(problemForm),
      }).then((r) => { if (!r.ok) throw new Error('Failed to add problem'); return r.json(); });
      toast.success('Problem added.');
      setProblemModalOpen(false);
      setProblemForm({ problem_name: '', icd10_code: '', status: 'active' });
      await refresh();
    } catch (err) {
      toast.error('Failed to add problem: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // --- Add Medication ---
  async function handleAddMed(e) {
    e.preventDefault();
    if (!medForm.medication_name.trim()) {
      toast.warning('Medication name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`/api/patients/${pid}/medications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(medForm),
      }).then((r) => { if (!r.ok) throw new Error('Failed to add medication'); return r.json(); });
      toast.success('Medication added.');
      setMedModalOpen(false);
      setMedForm({ medication_name: '', dose: '', route: 'oral', frequency: '', status: 'active' });
      await refresh();
    } catch (err) {
      toast.error('Failed to add medication: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // --- Add Allergy ---
  async function handleAddAllergy(e) {
    e.preventDefault();
    if (!allergyForm.allergen.trim()) {
      toast.warning('Allergen is required.');
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`/api/patients/${pid}/allergies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allergyForm),
      }).then((r) => { if (!r.ok) throw new Error('Failed to add allergy'); return r.json(); });
      toast.success('Allergy added.');
      setAllergyModalOpen(false);
      setAllergyForm({ allergen: '', reaction: '', severity: 'moderate' });
      await refresh();
    } catch (err) {
      toast.error('Failed to add allergy: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // --- Navigate to encounter at its workflow stage ---
  function goToEncounter(enc) {
    const route = STATE_ROUTES[enc.workflow_state] || STATE_ROUTES[enc.status] || '/encounter/';
    navigate(route + enc.id);
  }

  // --- Loading / Error ---
  if (loading) return <LoadingSpinner message="Loading patient..." />;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!patient) return <div className="p-4 text-gray-500">Patient not found</div>;

  const age = calculateAge(patient.dob);
  const latestVitals = patient.vitals && patient.vitals.length > 0 ? patient.vitals[0] : null;

  return (
    <div>
      <PatientBanner patient={patient} />

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>
            &#x2190; Back
          </TouchButton>
          <TouchButton variant="primary" onClick={startEncounter}>
            New Encounter
          </TouchButton>
        </div>

        {/* Demographics Card */}
        <Card>
          <CardHeader>Demographics</CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <span className="label-clinical">Full Name</span>
                <p className="font-semibold text-gray-900">{patient.last_name}, {patient.first_name}</p>
              </div>
              <div>
                <span className="label-clinical">Date of Birth</span>
                <p className="font-semibold text-gray-900">{formatDate(patient.dob)} (Age {age})</p>
              </div>
              <div>
                <span className="label-clinical">Sex</span>
                <p className="font-semibold text-gray-900">{patient.sex || '--'}</p>
              </div>
              <div>
                <span className="label-clinical">MRN</span>
                <p className="font-semibold text-gray-900">{patient.mrn || '--'}</p>
              </div>
              <div>
                <span className="label-clinical">Phone</span>
                <p className="font-semibold text-gray-900">{patient.phone || '--'}</p>
              </div>
              <div>
                <span className="label-clinical">Insurance</span>
                <p className="font-semibold text-gray-900">{patient.insurance || patient.insurance_provider || '--'}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 6-Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* 1. Problems */}
          <Card>
            <CardHeader
              action={
                <TouchButton variant="ghost" size="sm" onClick={() => setProblemModalOpen(true)}>
                  + Add
                </TouchButton>
              }
            >
              Problems
            </CardHeader>
            <CardBody>
              <ProblemList problems={patient.problems} />
            </CardBody>
          </Card>

          {/* 2. Medications */}
          <Card>
            <CardHeader
              action={
                <TouchButton variant="ghost" size="sm" onClick={() => setMedModalOpen(true)}>
                  + Add
                </TouchButton>
              }
            >
              Medications
            </CardHeader>
            <CardBody>
              <MedList medications={patient.medications} />
            </CardBody>
          </Card>

          {/* 3. Allergies */}
          <Card>
            <CardHeader
              action={
                <TouchButton variant="ghost" size="sm" onClick={() => setAllergyModalOpen(true)}>
                  + Add
                </TouchButton>
              }
            >
              Allergies
            </CardHeader>
            <CardBody>
              <AllergyBadges allergies={patient.allergies} />
            </CardBody>
          </Card>

          {/* 4. Latest Vitals */}
          <Card>
            <CardHeader>Latest Vitals</CardHeader>
            <CardBody>
              {latestVitals ? (
                <VitalsDisplay vitals={latestVitals} />
              ) : (
                <p className="text-sm text-gray-400 italic">No vitals recorded</p>
              )}
            </CardBody>
          </Card>

          {/* 5. Recent Labs (col-span-2 on md+) */}
          <Card className="md:col-span-2">
            <CardHeader>Recent Lab Results</CardHeader>
            <CardBody>
              <LabResults labs={patient.labs} />
            </CardBody>
          </Card>

          {/* 6. Encounter History (full width on lg) */}
          <Card className="lg:col-span-3 md:col-span-2">
            <CardHeader>
              Encounter History
            </CardHeader>
            <CardBody className="p-0">
              {encountersLoading ? (
                <div className="p-5">
                  <LoadingSpinner message="Loading encounters..." />
                </div>
              ) : encounters.length === 0 ? (
                <p className="p-5 text-sm text-gray-400 italic">No encounters on record.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {encounters.map((enc) => (
                    <div
                      key={enc.id}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => goToEncounter(enc)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-sm">
                          <p className="font-medium text-gray-900">
                            {enc.encounter_type || 'Office Visit'}
                          </p>
                          {enc.chief_complaint && (
                            <p className="text-gray-500 text-xs truncate max-w-xs">
                              CC: {enc.chief_complaint}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-gray-400">
                          {formatDate(enc.created_at || enc.date)}
                        </span>
                        <Badge
                          variant={
                            enc.status === 'completed' || enc.status === 'signed'
                              ? 'success'
                              : enc.status === 'in-progress' || enc.status === 'active'
                              ? 'warning'
                              : 'info'
                          }
                        >
                          {enc.workflow_state || enc.status || 'unknown'}
                        </Badge>
                        <span className="text-gray-300 text-sm">&#x203A;</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ===== Add Problem Modal ===== */}
      <Modal isOpen={problemModalOpen} onClose={() => setProblemModalOpen(false)} title="Add Problem">
        <form onSubmit={handleAddProblem} className="space-y-4">
          <div>
            <label className="label-clinical block mb-1">Problem Name *</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Hypertension"
              value={problemForm.problem_name}
              onChange={(e) => setProblemForm({ ...problemForm, problem_name: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label className="label-clinical block mb-1">ICD-10 Code</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. I10"
              value={problemForm.icd10_code}
              onChange={(e) => setProblemForm({ ...problemForm, icd10_code: e.target.value })}
            />
          </div>
          <div>
            <label className="label-clinical block mb-1">Status</label>
            <select
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={problemForm.status}
              onChange={(e) => setProblemForm({ ...problemForm, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="chronic">Chronic</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <TouchButton type="button" variant="secondary" onClick={() => setProblemModalOpen(false)} className="flex-1">
              Cancel
            </TouchButton>
            <TouchButton type="submit" variant="primary" loading={submitting} className="flex-1">
              Add Problem
            </TouchButton>
          </div>
        </form>
      </Modal>

      {/* ===== Add Medication Modal ===== */}
      <Modal isOpen={medModalOpen} onClose={() => setMedModalOpen(false)} title="Add Medication">
        <form onSubmit={handleAddMed} className="space-y-4">
          <div>
            <label className="label-clinical block mb-1">Medication Name *</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Lisinopril"
              value={medForm.medication_name}
              onChange={(e) => setMedForm({ ...medForm, medication_name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-clinical block mb-1">Dose</label>
              <input
                type="text"
                className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 10mg"
                value={medForm.dose}
                onChange={(e) => setMedForm({ ...medForm, dose: e.target.value })}
              />
            </div>
            <div>
              <label className="label-clinical block mb-1">Route</label>
              <select
                className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={medForm.route}
                onChange={(e) => setMedForm({ ...medForm, route: e.target.value })}
              >
                <option value="oral">Oral</option>
                <option value="topical">Topical</option>
                <option value="intravenous">Intravenous</option>
                <option value="intramuscular">Intramuscular</option>
                <option value="subcutaneous">Subcutaneous</option>
                <option value="inhaled">Inhaled</option>
                <option value="rectal">Rectal</option>
                <option value="ophthalmic">Ophthalmic</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label-clinical block mb-1">Frequency</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Once daily"
              value={medForm.frequency}
              onChange={(e) => setMedForm({ ...medForm, frequency: e.target.value })}
            />
          </div>
          <div>
            <label className="label-clinical block mb-1">Status</label>
            <select
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={medForm.status}
              onChange={(e) => setMedForm({ ...medForm, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="discontinued">Discontinued</option>
              <option value="on-hold">On Hold</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <TouchButton type="button" variant="secondary" onClick={() => setMedModalOpen(false)} className="flex-1">
              Cancel
            </TouchButton>
            <TouchButton type="submit" variant="primary" loading={submitting} className="flex-1">
              Add Medication
            </TouchButton>
          </div>
        </form>
      </Modal>

      {/* ===== Add Allergy Modal ===== */}
      <Modal isOpen={allergyModalOpen} onClose={() => setAllergyModalOpen(false)} title="Add Allergy">
        <form onSubmit={handleAddAllergy} className="space-y-4">
          <div>
            <label className="label-clinical block mb-1">Allergen *</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Penicillin"
              value={allergyForm.allergen}
              onChange={(e) => setAllergyForm({ ...allergyForm, allergen: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label className="label-clinical block mb-1">Reaction</label>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Rash, Anaphylaxis"
              value={allergyForm.reaction}
              onChange={(e) => setAllergyForm({ ...allergyForm, reaction: e.target.value })}
            />
          </div>
          <div>
            <label className="label-clinical block mb-1">Severity</label>
            <select
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={allergyForm.severity}
              onChange={(e) => setAllergyForm({ ...allergyForm, severity: e.target.value })}
            >
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <TouchButton type="button" variant="secondary" onClick={() => setAllergyModalOpen(false)} className="flex-1">
              Cancel
            </TouchButton>
            <TouchButton type="submit" variant="danger" loading={submitting} className="flex-1">
              Add Allergy
            </TouchButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
