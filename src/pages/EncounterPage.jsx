import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useEncounter } from '../hooks/useEncounter';
import { useCDS } from '../hooks/useCDS';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useToast } from '../components/common/Toast';
import PatientBanner from '../components/patient/PatientBanner';
import ProblemList from '../components/patient/ProblemList';
import MedList from '../components/patient/MedList';
import VitalsDisplay from '../components/patient/VitalsDisplay';
import LabResults from '../components/patient/LabResults';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import CDSSuggestionList from '../components/encounter/CDSSuggestionList';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import Modal from '../components/common/Modal';
import LoadingSpinner from '../components/common/LoadingSpinner';

// ============================================================
// Encounter Timer Component
// ============================================================
function EncounterTimer({ startTime }) {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();

    function tick() {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const mm = String(Math.floor(diff / 60)).padStart(2, '0');
      const ss = String(diff % 60).padStart(2, '0');
      setElapsed(`${mm}:${ss}`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return (
    <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-mono font-semibold">
      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
      {elapsed}
    </div>
  );
}

// ============================================================
// Order Modal Forms
// ============================================================

function RxModalForm({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    medication_name: '', dose: '', route: 'PO',
    frequency: 'daily', quantity: '', refills: '0', instructions: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <label className="label-clinical">Medication Name *</label>
        <input className="input-clinical w-full" value={form.medication_name}
          onChange={e => set('medication_name', e.target.value)} placeholder="e.g. Lisinopril" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-clinical">Dose *</label>
          <input className="input-clinical w-full" value={form.dose}
            onChange={e => set('dose', e.target.value)} placeholder="e.g. 10mg" />
        </div>
        <div>
          <label className="label-clinical">Route</label>
          <select className="input-clinical w-full" value={form.route}
            onChange={e => set('route', e.target.value)}>
            {['PO', 'SC', 'IM', 'IV', 'INH'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label-clinical">Frequency</label>
          <select className="input-clinical w-full" value={form.frequency}
            onChange={e => set('frequency', e.target.value)}>
            {['daily', 'BID', 'TID', 'QID', 'PRN'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="label-clinical">Quantity</label>
          <input className="input-clinical w-full" type="number" value={form.quantity}
            onChange={e => set('quantity', e.target.value)} placeholder="30" />
        </div>
        <div>
          <label className="label-clinical">Refills</label>
          <input className="input-clinical w-full" type="number" value={form.refills}
            onChange={e => set('refills', e.target.value)} placeholder="0" />
        </div>
      </div>
      <div>
        <label className="label-clinical">Instructions</label>
        <textarea className="textarea-clinical w-full" rows={2} value={form.instructions}
          onChange={e => set('instructions', e.target.value)} placeholder="Take with food..." />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <TouchButton variant="secondary" size="sm" onClick={onClose}>Cancel</TouchButton>
        <TouchButton variant="success" size="sm"
          disabled={!form.medication_name || !form.dose}
          onClick={() => onSubmit(form)}>
          Add Prescription
        </TouchButton>
      </div>
    </div>
  );
}

function LabModalForm({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    test_name: '', cpt_code: '', priority: 'routine',
    fasting_required: false, special_instructions: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <label className="label-clinical">Test Name *</label>
        <input className="input-clinical w-full" value={form.test_name}
          onChange={e => set('test_name', e.target.value)} placeholder="e.g. CBC with Differential" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-clinical">CPT Code</label>
          <input className="input-clinical w-full" value={form.cpt_code}
            onChange={e => set('cpt_code', e.target.value)} placeholder="e.g. 85025" />
        </div>
        <div>
          <label className="label-clinical">Priority</label>
          <select className="input-clinical w-full" value={form.priority}
            onChange={e => set('priority', e.target.value)}>
            {['routine', 'urgent', 'stat'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.fasting_required}
          onChange={e => set('fasting_required', e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span className="text-sm text-gray-700">Fasting required</span>
      </label>
      <div>
        <label className="label-clinical">Special Instructions</label>
        <textarea className="textarea-clinical w-full" rows={2} value={form.special_instructions}
          onChange={e => set('special_instructions', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <TouchButton variant="secondary" size="sm" onClick={onClose}>Cancel</TouchButton>
        <TouchButton variant="primary" size="sm" disabled={!form.test_name}
          onClick={() => onSubmit(form)}>
          Add Lab Order
        </TouchButton>
      </div>
    </div>
  );
}

function ImagingModalForm({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    study_type: 'X-ray', body_part: '', indication: '',
    contrast_required: false, priority: 'routine',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-clinical">Study Type *</label>
          <select className="input-clinical w-full" value={form.study_type}
            onChange={e => set('study_type', e.target.value)}>
            {['X-ray', 'CT', 'MRI', 'Ultrasound', 'EKG'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label-clinical">Body Part *</label>
          <input className="input-clinical w-full" value={form.body_part}
            onChange={e => set('body_part', e.target.value)} placeholder="e.g. Chest" />
        </div>
      </div>
      <div>
        <label className="label-clinical">Indication *</label>
        <input className="input-clinical w-full" value={form.indication}
          onChange={e => set('indication', e.target.value)} placeholder="e.g. Rule out pneumonia" />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.contrast_required}
            onChange={e => set('contrast_required', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-sm text-gray-700">Contrast required</span>
        </label>
        <div>
          <label className="label-clinical">Priority</label>
          <select className="input-clinical w-full" value={form.priority}
            onChange={e => set('priority', e.target.value)}>
            {['routine', 'urgent', 'stat'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <TouchButton variant="secondary" size="sm" onClick={onClose}>Cancel</TouchButton>
        <TouchButton variant="primary" size="sm"
          disabled={!form.body_part || !form.indication}
          onClick={() => onSubmit(form)}>
          Add Imaging Order
        </TouchButton>
      </div>
    </div>
  );
}

function ReferralModalForm({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    specialty: '', reason: '', urgency: 'routine', notes: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <label className="label-clinical">Specialty *</label>
        <input className="input-clinical w-full" value={form.specialty}
          onChange={e => set('specialty', e.target.value)} placeholder="e.g. Cardiology" />
      </div>
      <div>
        <label className="label-clinical">Reason *</label>
        <input className="input-clinical w-full" value={form.reason}
          onChange={e => set('reason', e.target.value)} placeholder="e.g. Evaluation of new murmur" />
      </div>
      <div>
        <label className="label-clinical">Urgency</label>
        <select className="input-clinical w-full" value={form.urgency}
          onChange={e => set('urgency', e.target.value)}>
          {['routine', 'urgent', 'emergent'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div>
        <label className="label-clinical">Notes</label>
        <textarea className="textarea-clinical w-full" rows={2} value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <TouchButton variant="secondary" size="sm" onClick={onClose}>Cancel</TouchButton>
        <TouchButton variant="warning" size="sm"
          disabled={!form.specialty || !form.reason}
          onClick={() => onSubmit(form)}>
          Add Referral
        </TouchButton>
      </div>
    </div>
  );
}

// ============================================================
// Main EncounterPage Component
// ============================================================
export default function EncounterPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId);
  const navigate = useNavigate();
  const toast = useToast();

  // --- Hooks ---
  const { encounter, orders, update: updateEncounter, refresh: refreshEncounter } = useEncounter(eid);
  const { patient, refresh: refreshPatient } = usePatient(encounter?.patient_id);
  const { workflow, timeline, transition } = useWorkflow(eid);
  const {
    suggestions, pending, accepted, evaluate, accept, reject, refresh: refreshCDS,
  } = useCDS(eid, encounter?.patient_id, { pollInterval: 5000, autoEvaluate: true });
  const speech = useSpeechRecognition();

  // --- Local state ---
  const [transcript, setTranscript] = useState('');
  const [soapNote, setSoapNote] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Auto-save indicator
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // '', 'saving', 'saved'
  const autoSaveTimerRef = useRef(null);

  // Encounter timer start time
  const [examStartTime, setExamStartTime] = useState(null);

  // Modal state
  const [activeModal, setActiveModal] = useState(null); // 'rx' | 'lab' | 'imaging' | 'referral' | null

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState('encounter'); // 'patient' | 'encounter' | 'cds'

  // --- Initialize from encounter data ---
  useEffect(() => {
    if (encounter) {
      setTranscript(encounter.transcript || '');
      setSoapNote(encounter.soap_note || '');
      setLoading(false);
    }
  }, [encounter]);

  // Set exam start time from workflow timeline
  useEffect(() => {
    if (timeline && Array.isArray(timeline)) {
      const examEvent = timeline.find(
        t => t.to_state === 'provider-examining' || t.target_state === 'provider-examining'
      );
      if (examEvent) {
        setExamStartTime(examEvent.timestamp || examEvent.created_at);
      }
    }
  }, [timeline]);

  // --- Append live speech to transcript ---
  useEffect(() => {
    if (speech.transcript && !speech.isListening) {
      setTranscript(prev => {
        const sep = prev ? '\n' : '';
        return prev + sep + speech.transcript;
      });
      speech.resetTranscript();
    }
  }, [speech.transcript, speech.isListening]);

  // --- Auto-save transcript with 2s debounce ---
  useEffect(() => {
    if (!encounter || !transcript) return;
    // Don't auto-save if unchanged from server
    if (transcript === (encounter.transcript || '')) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        setAutoSaveStatus('saving');
        await api.updateEncounter(eid, {
          transcript,
          patient_id: encounter.patient_id,
        });
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus(''), 2000);
      } catch (e) {
        console.error('Auto-save failed:', e);
        setAutoSaveStatus('');
      }
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [transcript, encounter, eid]);

  // --- Handlers ---

  async function handleStartExam() {
    try {
      await transition('provider-examining');
      setExamStartTime(new Date().toISOString());
      toast.info('Exam started');
    } catch (_) {
      // may already be in this state
    }
  }

  async function handleExtract() {
    if (!transcript.trim()) return;
    setExtracting(true);
    try {
      const result = await api.extractData({
        transcript,
        patient_id: encounter.patient_id,
        encounter_id: eid,
      });
      setExtractedData(result);
      await updateEncounter({ transcript, patient_id: encounter.patient_id });
      await refreshCDS();
      toast.success('Clinical data extracted');
    } catch (e) {
      console.error('Extract failed:', e);
      toast.error('Data extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  async function handleGenerateNote() {
    setGenerating(true);
    try {
      const result = await api.generateNote({
        transcript,
        patient_id: encounter.patient_id,
        encounter_id: eid,
      });
      if (result.soap_note) {
        setSoapNote(result.soap_note);
        await updateEncounter({ soap_note: result.soap_note, patient_id: encounter.patient_id });
        toast.success('SOAP note generated');
      }
    } catch (e) {
      console.error('Note generation failed:', e);
      toast.error('Note generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveTranscript() {
    try {
      await updateEncounter({ transcript, soap_note: soapNote, patient_id: encounter.patient_id });
      toast.success('Encounter saved');
    } catch (e) {
      toast.error('Save failed: ' + e.message);
    }
  }

  // --- Order creation handlers ---
  async function handleCreateRx(data) {
    try {
      await api.createPrescription({ ...data, encounter_id: eid, patient_id: encounter.patient_id });
      await refreshEncounter();
      setActiveModal(null);
      toast.success(`Prescription added: ${data.medication_name}`);
    } catch (e) {
      toast.error('Failed to create prescription: ' + e.message);
    }
  }

  async function handleCreateLab(data) {
    try {
      await api.createLabOrder({ ...data, encounter_id: eid, patient_id: encounter.patient_id });
      await refreshEncounter();
      setActiveModal(null);
      toast.success(`Lab order added: ${data.test_name}`);
    } catch (e) {
      toast.error('Failed to create lab order: ' + e.message);
    }
  }

  async function handleCreateImaging(data) {
    try {
      await api.createImagingOrder({ ...data, encounter_id: eid, patient_id: encounter.patient_id });
      await refreshEncounter();
      setActiveModal(null);
      toast.success(`Imaging order added: ${data.study_type} ${data.body_part}`);
    } catch (e) {
      toast.error('Failed to create imaging order: ' + e.message);
    }
  }

  async function handleCreateReferral(data) {
    try {
      await api.createReferral({ ...data, encounter_id: eid, patient_id: encounter.patient_id });
      await refreshEncounter();
      setActiveModal(null);
      toast.success(`Referral added: ${data.specialty}`);
    } catch (e) {
      toast.error('Failed to create referral: ' + e.message);
    }
  }

  // --- CDS handlers ---
  async function handleAcceptSuggestion(id) {
    try {
      await accept(id);
      await refreshEncounter();
      toast.success('Suggestion accepted');
    } catch (e) {
      toast.error('Failed to accept suggestion');
    }
  }

  async function handleRejectSuggestion(id) {
    await reject(id);
  }

  // --- Computed values ---
  const differentials = suggestions.filter(s => s.suggestion_type === 'differential_diagnosis');
  const clinicalSuggestions = suggestions.filter(s => s.suggestion_type !== 'differential_diagnosis');

  const prescriptions  = orders?.prescriptions  || [];
  const labOrders      = orders?.lab_orders      || [];
  const imagingOrders  = orders?.imaging_orders  || [];
  const referrals      = orders?.referrals       || [];
  const totalOrders    = prescriptions.length + labOrders.length + imagingOrders.length + referrals.length;

  const canReviewSign = !!(soapNote || totalOrders > 0);

  if (loading || !encounter) return <LoadingSpinner message="Loading encounter..." />;

  // ============================================================
  // Left Panel: Patient Summary
  // ============================================================
  const leftPanel = (
    <div className="p-3 space-y-3">
      {/* Problems */}
      <div>
        <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
          Problems
        </h3>
        {patient?.problems && patient.problems.length > 0 ? (
          <div className="space-y-1">
            {patient.problems.map((p, i) => (
              <div key={i} className="bg-white rounded-lg p-2 text-sm border border-gray-100">
                <div className="font-medium text-gray-900">{p.name || p.problem_name}</div>
                {p.icd10_code && (
                  <div className="text-xs text-gray-500 font-mono">{p.icd10_code}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 px-1">No active problems</p>
        )}
      </div>

      {/* Medications */}
      <div>
        <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
          Medications
        </h3>
        {patient?.medications && patient.medications.length > 0 ? (
          <div className="space-y-1">
            {patient.medications.map((m, i) => (
              <div key={i} className="bg-white rounded-lg p-2 text-sm border border-gray-100">
                <div className="font-medium text-gray-900">{m.name || m.medication_name}</div>
                <div className="text-xs text-gray-500">
                  {m.dosage}
                  {m.frequency ? ` \u2022 ${m.frequency}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 px-1">No medications</p>
        )}
      </div>

      {/* Latest Vitals */}
      <div>
        <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
          Latest Vitals
        </h3>
        {patient?.vitals && patient.vitals.length > 0 ? (
          <VitalsDisplay vitals={patient.vitals[0]} compact />
        ) : (
          <p className="text-xs text-gray-400 px-1">No vitals recorded</p>
        )}
      </div>

      {/* Recent Labs */}
      <div>
        <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
          Recent Labs
        </h3>
        {patient?.labs && patient.labs.length > 0 ? (
          <LabResults labs={patient.labs} compact />
        ) : (
          <p className="text-xs text-gray-400 px-1">No lab results</p>
        )}
      </div>
    </div>
  );

  // ============================================================
  // Center Panel: Transcript, Data, Note, Orders
  // ============================================================
  const centerPanel = (
    <div className="max-w-2xl mx-auto p-4 space-y-4">

      {/* Encounter Timer + Start Exam */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {workflow?.current_state === 'vitals-recorded' && (
            <TouchButton variant="primary" size="sm" onClick={handleStartExam}>
              Start Exam
            </TouchButton>
          )}
          {examStartTime && <EncounterTimer startTime={examStartTime} />}
        </div>
        {autoSaveStatus === 'saving' && (
          <span className="text-xs text-gray-400">Saving...</span>
        )}
        {autoSaveStatus === 'saved' && (
          <span className="text-xs text-green-500">Saved</span>
        )}
      </div>

      {/* Transcript + Voice Recording */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <span>Encounter Transcript</span>
            {speech.isListening && (
              <span className="flex items-center gap-1 text-red-500 text-xs animate-pulse">
                <span className="w-2 h-2 bg-red-500 rounded-full" />
                Recording...
              </span>
            )}
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            placeholder="Start recording or type the encounter narrative..."
            className="textarea-clinical w-full min-h-[120px] resize-y"
            rows={5}
          />
          {/* Live interim text in blue */}
          {speech.isListening && speech.interimTranscript && (
            <div className="bg-blue-50 rounded-lg p-2 text-sm text-blue-600 italic">
              {speech.interimTranscript}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {speech.isSupported && (
              <TouchButton
                variant={speech.isListening ? 'danger' : 'primary'}
                size="sm"
                onClick={speech.isListening ? speech.stopListening : speech.startListening}
              >
                {speech.isListening ? 'Stop Recording' : 'Record'}
              </TouchButton>
            )}
            <TouchButton
              variant="secondary" size="sm"
              onClick={handleExtract} loading={extracting}
              disabled={!transcript.trim()}
            >
              Extract Data
            </TouchButton>
            <TouchButton
              variant="secondary" size="sm"
              onClick={handleGenerateNote} loading={generating}
              disabled={!transcript.trim()}
            >
              Generate Note
            </TouchButton>
            <TouchButton
              variant="secondary" size="sm"
              onClick={handleSaveTranscript}
              disabled={!transcript.trim()}
            >
              Save
            </TouchButton>
          </div>
        </CardBody>
      </Card>

      {/* Extracted Data - Color-coded cards */}
      {extractedData && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span>Extracted Clinical Data</span>
              <Badge variant="success">AI Parsed</Badge>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Blue = Vitals */}
              {extractedData.vitals && Object.keys(extractedData.vitals).length > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <h4 className="text-xs font-semibold text-blue-700 uppercase mb-2">Vitals</h4>
                  {Object.entries(extractedData.vitals).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="text-gray-600">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Green = Medications */}
              {extractedData.medications && extractedData.medications.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                  <h4 className="text-xs font-semibold text-green-700 uppercase mb-2">Medications</h4>
                  {extractedData.medications.map((m, i) => (
                    <div key={i} className="text-sm mb-1">
                      <span className="font-medium">{m.name || m.medication}</span>
                      {m.dosage && <span className="text-gray-500 ml-1">{m.dosage}</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* Amber = Diagnoses */}
              {extractedData.problems && extractedData.problems.length > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <h4 className="text-xs font-semibold text-amber-700 uppercase mb-2">Diagnoses</h4>
                  {extractedData.problems.map((p, i) => (
                    <div key={i} className="text-sm mb-1">
                      <span className="font-medium">{p.name || p.problem}</span>
                      {p.icd10 && <span className="text-gray-500 ml-1">({p.icd10})</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* Purple = Labs */}
              {extractedData.labs && extractedData.labs.length > 0 && (
                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                  <h4 className="text-xs font-semibold text-purple-700 uppercase mb-2">Lab Orders</h4>
                  {extractedData.labs.map((l, i) => (
                    <div key={i} className="text-sm mb-1">
                      <span className="font-medium">{l.test_name || l.name}</span>
                      {l.cpt_code && <span className="text-gray-500 ml-1">({l.cpt_code})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Editable SOAP Note */}
      {(soapNote || generating) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 w-full justify-between">
              <div className="flex items-center gap-2">
                <span>SOAP Note</span>
                <Badge variant="info">Editable</Badge>
              </div>
              {autoSaveStatus === 'saving' && (
                <span className="text-xs text-gray-400">Auto-saving...</span>
              )}
            </div>
          </CardHeader>
          <CardBody>
            <textarea
              value={soapNote}
              onChange={e => setSoapNote(e.target.value)}
              className="textarea-clinical w-full min-h-[200px] font-mono text-sm leading-relaxed resize-y"
              rows={10}
              placeholder="SOAP note will appear here after generation..."
            />
          </CardBody>
        </Card>
      )}

      {/* Manual Order Entry Buttons */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span>Orders</span>
            {totalOrders > 0 && <Badge variant="success">{totalOrders}</Badge>}
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* 4 order type buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <TouchButton variant="success" size="sm" onClick={() => setActiveModal('rx')}>
              + Add Rx
            </TouchButton>
            <TouchButton variant="primary" size="sm" onClick={() => setActiveModal('lab')}>
              + Add Lab
            </TouchButton>
            <TouchButton variant="secondary" size="sm" onClick={() => setActiveModal('imaging')}>
              + Add Imaging
            </TouchButton>
            <TouchButton variant="warning" size="sm" onClick={() => setActiveModal('referral')}>
              + Add Referral
            </TouchButton>
          </div>

          {/* Display created orders */}
          {totalOrders > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              {prescriptions.map((rx, i) => (
                <div key={'rx' + i} className="flex items-center gap-2 bg-green-50 rounded-lg p-2 text-sm">
                  <span className="text-green-600 font-bold text-xs">Rx</span>
                  <span className="font-medium">{rx.medication_name}</span>
                  <span className="text-gray-500">{rx.dosage || rx.dose} {rx.frequency}</span>
                  {rx.route && <span className="text-gray-400">({rx.route})</span>}
                  <Badge variant="success">Rx</Badge>
                </div>
              ))}
              {labOrders.map((lab, i) => (
                <div key={'lab' + i} className="flex items-center gap-2 bg-purple-50 rounded-lg p-2 text-sm">
                  <span className="text-purple-600 font-bold text-xs">LAB</span>
                  <span className="font-medium">{lab.test_name}</span>
                  {lab.cpt_code && <span className="text-gray-500">({lab.cpt_code})</span>}
                  {lab.priority && lab.priority !== 'routine' && (
                    <Badge variant={lab.priority === 'stat' ? 'urgent' : 'warning'}>
                      {lab.priority}
                    </Badge>
                  )}
                  <Badge variant="purple">Lab</Badge>
                </div>
              ))}
              {imagingOrders.map((img, i) => (
                <div key={'img' + i} className="flex items-center gap-2 bg-blue-50 rounded-lg p-2 text-sm">
                  <span className="text-blue-600 font-bold text-xs">IMG</span>
                  <span className="font-medium">
                    {img.study_type || img.modality} - {img.body_part}
                  </span>
                  {img.priority && img.priority !== 'routine' && (
                    <Badge variant={img.priority === 'stat' ? 'urgent' : 'warning'}>
                      {img.priority}
                    </Badge>
                  )}
                  <Badge variant="info">Imaging</Badge>
                </div>
              ))}
              {referrals.map((ref, i) => (
                <div key={'ref' + i} className="flex items-center gap-2 bg-amber-50 rounded-lg p-2 text-sm">
                  <span className="text-amber-600 font-bold text-xs">REF</span>
                  <span className="font-medium">{ref.specialty}</span>
                  <span className="text-gray-500">{ref.reason}</span>
                  {ref.urgency && ref.urgency !== 'routine' && (
                    <Badge variant={ref.urgency === 'emergent' ? 'urgent' : 'warning'}>
                      {ref.urgency}
                    </Badge>
                  )}
                  <Badge variant="warning">Referral</Badge>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Review & Sign Button */}
      <div className="flex gap-3 pb-4">
        <TouchButton
          variant="success"
          className="flex-1"
          onClick={() => navigate('/review/' + encounterId)}
          disabled={!canReviewSign}
        >
          Review &amp; Sign
        </TouchButton>
      </div>
    </div>
  );

  // ============================================================
  // Right Panel: CDS
  // ============================================================
  const rightPanel = (
    <div className="p-3 space-y-3">
      {/* CDS Suggestions */}
      <div>
        <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1 flex items-center justify-between">
          <span>CDS Suggestions</span>
          {pending.length > 0 && (
            <Badge variant="urgent">{pending.length} pending</Badge>
          )}
        </h3>
        <CDSSuggestionList
          suggestions={clinicalSuggestions}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
        />
      </div>

      {/* Differential Diagnoses */}
      {differentials.length > 0 && (
        <div>
          <h3 className="section-header text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
            Differential Diagnoses
          </h3>
          <div className="space-y-1">
            {differentials.map((d, i) => (
              <div key={d.id || i} className="bg-white rounded-lg p-2 border border-gray-100">
                <div className="font-medium text-sm text-gray-900">{d.title}</div>
                {d.description && (
                  <p className="text-xs text-gray-500 mt-1">{d.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Re-evaluate button */}
      <div className="pt-2">
        <TouchButton variant="secondary" size="sm" className="w-full" onClick={evaluate}>
          Re-evaluate CDS
        </TouchButton>
      </div>
    </div>
  );

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="flex flex-col h-screen">
      {/* Patient Banner */}
      {patient && <PatientBanner patient={patient} />}

      {/* Workflow Bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
        <TouchButton variant="secondary" size="sm" onClick={() => navigate('/')}>
          &#x2190; Dashboard
        </TouchButton>
        <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} compact />
      </div>

      {/* Mobile Tab Switcher (visible < lg) */}
      <div className="lg:hidden bg-white border-b border-gray-200 flex">
        {[
          { key: 'patient', label: 'Patient' },
          { key: 'encounter', label: 'Encounter' },
          { key: 'cds', label: 'CDS', badge: pending.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-center border-b-2 transition-colors ${
              mobileTab === tab.key
                ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.badge > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Desktop: Three-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL - desktop always visible, mobile conditional */}
        <div className={`w-72 border-r border-gray-200 bg-gray-50/50 overflow-y-auto clinical-scroll flex-shrink-0 ${
          mobileTab === 'patient' ? 'block' : 'hidden'
        } lg:block`}>
          {leftPanel}
        </div>

        {/* CENTER PANEL */}
        <div className={`flex-1 overflow-y-auto clinical-scroll ${
          mobileTab === 'encounter' ? 'block' : 'hidden'
        } lg:block`}>
          {centerPanel}
        </div>

        {/* RIGHT PANEL */}
        <div className={`w-80 border-l border-gray-200 bg-gray-50/50 overflow-y-auto clinical-scroll flex-shrink-0 ${
          mobileTab === 'cds' ? 'block' : 'hidden'
        } lg:block`}>
          {rightPanel}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Order Modals */}
      {/* ============================================================ */}

      <Modal isOpen={activeModal === 'rx'} onClose={() => setActiveModal(null)} title="New Prescription" size="md">
        <RxModalForm onSubmit={handleCreateRx} onClose={() => setActiveModal(null)} />
      </Modal>

      <Modal isOpen={activeModal === 'lab'} onClose={() => setActiveModal(null)} title="New Lab Order" size="md">
        <LabModalForm onSubmit={handleCreateLab} onClose={() => setActiveModal(null)} />
      </Modal>

      <Modal isOpen={activeModal === 'imaging'} onClose={() => setActiveModal(null)} title="New Imaging Order" size="md">
        <ImagingModalForm onSubmit={handleCreateImaging} onClose={() => setActiveModal(null)} />
      </Modal>

      <Modal isOpen={activeModal === 'referral'} onClose={() => setActiveModal(null)} title="New Referral" size="md">
        <ReferralModalForm onSubmit={handleCreateReferral} onClose={() => setActiveModal(null)} />
      </Modal>
    </div>
  );
}
