import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, X, Send, Activity, Stethoscope } from 'lucide-react';
import api, { safeLog } from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import AllergyBadges from '../components/patient/AllergyBadges';
import LoadingSpinner from '../components/common/LoadingSpinner';
import PreVisitPanel from '../components/agents/PreVisitPanel';

// --- Vital range definitions for abnormal highlighting ---
const VITAL_RANGES = {
  systolic_bp:      { low: 90, high: 140 },
  diastolic_bp:     { low: 60, high: 90 },
  heart_rate:       { low: 50, high: 100 },
  temperature:      { high: 100.4 },
  spo2:             { low: 92 },
  respiratory_rate: { low: 10, high: 20 },
};

function isAbnormal(key, value) {
  if (!value || value === '') return false;
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  const range = VITAL_RANGES[key];
  if (!range) return false;
  if (range.low !== undefined && num < range.low) return true;
  if (range.high !== undefined && num > range.high) return true;
  return false;
}

// --- BMI helpers ---
function calcBMI(weightLbs, heightIn) {
  const w = parseFloat(weightLbs);
  const h = parseFloat(heightIn);
  if (!w || !h || h === 0) return null;
  return ((w / (h * h)) * 703).toFixed(1);
}

function bmiColor(bmi) {
  const n = parseFloat(bmi);
  if (n < 25) return 'text-success-600';
  if (n <= 30) return 'text-gold-700';
  return 'text-danger-600';
}

function bmiBg(bmi) {
  const n = parseFloat(bmi);
  if (n < 25) return 'bg-success-50 border-success-200';
  if (n <= 30) return 'bg-gold-50 border-gold-200';
  return 'bg-danger-50 border-danger-200';
}

// --- Vital field definitions ---
const VITAL_FIELDS = [
  { key: 'systolic_bp',      label: 'Systolic BP',  ph: '120',  unit: 'mmHg', step: '1' },
  { key: 'diastolic_bp',     label: 'Diastolic BP', ph: '80',   unit: 'mmHg', step: '1' },
  { key: 'heart_rate',       label: 'Heart Rate',   ph: '72',   unit: 'bpm',  step: '1' },
  { key: 'temperature',      label: 'Temperature',  ph: '98.6', unit: '\u00B0F', step: '0.1' },
  { key: 'weight',           label: 'Weight',       ph: '170',  unit: 'lbs',  step: '0.1' },
  { key: 'height',           label: 'Height',       ph: '68',   unit: 'in',   step: '0.1' },
  { key: 'respiratory_rate', label: 'Resp Rate',    ph: '16',   unit: '/min', step: '1' },
  { key: 'spo2',             label: 'SpO2',         ph: '98',   unit: '%',    step: '1' },
];

export default function MAPage() {
  const { encounterId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  // --- Core data hooks ---
  const [encounter, setEncounter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extractingVoice, setExtractingVoice] = useState(false);

  const { workflow, timeline, transition } = useWorkflow(encounterId);
  const { patient, refresh: refreshPatient } = usePatient(encounter?.patient_id);
  const speech = useSpeechRecognition();

  // --- Local form state ---
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [vitals, setVitals] = useState({
    systolic_bp: '', diastolic_bp: '', heart_rate: '', temperature: '',
    weight: '', height: '', respiratory_rate: '', spo2: '',
  });

  // Medication reconciliation: map of med index -> confirmed boolean
  const [medConfirmed, setMedConfirmed] = useState({});
  // Allergy review confirmed
  const [allergyReviewed, setAllergyReviewed] = useState(false);

  // --- Unsaved work protection ---
  const hasUnsavedChanges = chiefComplaint.trim() !== '' ||
    Object.values(vitals).some(v => v !== '');

  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // --- Load encounter on mount ---
  useEffect(() => {
    api.getEncounter(encounterId)
      .then(enc => {
        setEncounter(enc);
        setChiefComplaint(enc.chief_complaint || '');
      })
      .catch(err => {
        safeLog.error('Failed to load encounter:', err);
        toast.error('Failed to load encounter');
      })
      .finally(() => setLoading(false));
  }, [encounterId]);

  // --- Previous vitals for trend comparison ---
  // patient.vitals from the bundle is either a single object (latest) or an array
  const previousVitals = useMemo(() => {
    if (!patient?.vitals) return null;
    if (Array.isArray(patient.vitals)) return patient.vitals[0] || null;
    return patient.vitals; // single object
  }, [patient]);

  function formatPrevVital(key) {
    if (!previousVitals) return null;
    if (key === 'systolic_bp' && previousVitals.systolic_bp && previousVitals.diastolic_bp) {
      return `Last: ${previousVitals.systolic_bp}/${previousVitals.diastolic_bp}`;
    }
    if (key === 'diastolic_bp') return null; // shown with systolic
    const val = previousVitals[key];
    if (val !== undefined && val !== null) return `Last: ${val}`;
    return null;
  }

  // --- BMI calculation ---
  const bmi = useMemo(() => calcBMI(vitals.weight, vitals.height), [vitals.weight, vitals.height]);

  // --- Handlers ---
  function updateVital(field, value) {
    setVitals(prev => ({ ...prev, [field]: value }));
  }

  async function extractVitalsFromSpeech() {
    if (!speech.transcript) return;
    setExtractingVoice(true);
    try {
      const r = await api.addVitalsFromSpeech({
        transcript: speech.transcript,
        patient_id: encounter.patient_id,
        encounter_id: parseInt(encounterId, 10),
      });
      if (r) {
        setVitals(prev => ({
          ...prev,
          systolic_bp:      r.systolic_bp      || prev.systolic_bp,
          diastolic_bp:     r.diastolic_bp     || prev.diastolic_bp,
          heart_rate:       r.heart_rate       || prev.heart_rate,
          temperature:      r.temperature      || prev.temperature,
          weight:           r.weight           || prev.weight,
          height:           r.height           || prev.height,
          respiratory_rate: r.respiratory_rate || prev.respiratory_rate,
          spo2:             r.spo2             || prev.spo2,
        }));
        toast.success('Vitals extracted from voice');
      }
    } catch (e) {
      safeLog.error('MA error:', e);
      toast.error('Failed to extract vitals from speech');
    } finally {
      setExtractingVoice(false);
    }
  }

  async function handleSave() {
    const hasVitals = VITAL_FIELDS.some(({ key }) => String(vitals[key] ?? '').trim() !== '');
    const medicationsReviewed = medications.length === 0
      || Object.values(medConfirmed).filter(Boolean).length === medications.length;

    if (!hasVitals) {
      toast.warning('Enter at least one vital before sending the patient to the provider.');
      return;
    }
    if (!medicationsReviewed) {
      toast.warning('Confirm each active medication before sending the patient to the provider.');
      return;
    }
    if (!allergyReviewed) {
      toast.warning('Review allergies before sending the patient to the provider.');
      return;
    }

    setSaving(true);
    try {
      const data = {
        patient_id: encounter.patient_id,
        encounter_id: parseInt(encounterId, 10),
        recorded_by: 'MA',
      };
      if (vitals.systolic_bp)      data.systolic_bp      = parseInt(vitals.systolic_bp, 10);
      if (vitals.diastolic_bp)     data.diastolic_bp     = parseInt(vitals.diastolic_bp, 10);
      if (vitals.heart_rate)       data.heart_rate       = parseInt(vitals.heart_rate, 10);
      if (vitals.temperature)      data.temperature      = parseFloat(vitals.temperature);
      if (vitals.weight)           data.weight           = parseFloat(vitals.weight);
      if (vitals.height)           data.height           = parseFloat(vitals.height);
      if (vitals.respiratory_rate) data.respiratory_rate = parseInt(vitals.respiratory_rate, 10);
      if (vitals.spo2)             data.spo2             = parseInt(vitals.spo2, 10);

      await api.addVitals(data);

      if (chiefComplaint) {
        await api.updateEncounter(encounterId, {
          chief_complaint: chiefComplaint,
          patient_id: encounter.patient_id,
        });
      }

      // Workflow transitions: roomed -> vitals-recorded
      try { await transition('roomed'); } catch (_) { /* may already be past this */ }
      try { await transition('vitals-recorded'); } catch (_) { /* may already be past this */ }

      await refreshPatient();
      toast.success('Vitals saved and sent to provider');
      navigate('/encounter/' + encounterId);
    } catch (e) {
      safeLog.error('MA error:', e);
      toast.error('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  // --- Render ---
  if (loading) return <LoadingSpinner message="Loading MA screen..." />;

  // Reconcile only ACTIVE medications. Discontinued meds must not appear in the
  // rooming med-rec list (a clinician confirming a stopped drug as current is a
  // safety risk) and must not inflate the "X/N confirmed" completion gate.
  // Matches the m.status === 'active' filter in MedList.jsx and cds-engine.js.
  const medications = (patient?.medications || []).filter(m => m.status === 'active');
  const allergies = patient?.allergies || [];

  return (
    <div className="flex flex-col min-h-screen bg-ivory-200">
      {/* Signature moment: slim gold hairline crowning the patient banner. */}
      <div className="h-0.5 bg-gradient-to-r from-gold-500/0 via-gold-500/70 to-gold-500/0" aria-hidden="true" />
      {/* Patient Banner */}
      {patient && <PatientBanner patient={patient} />}

      {/* Workflow Bar */}
      <div className="bg-offWhite-100 border-b border-slate-100 px-4 py-2 flex items-center justify-between">
        <TouchButton variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/')}>
          Dashboard
        </TouchButton>
        <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto w-full p-4 space-y-4 flex-1 mc-reveal-stagger">

        {/* Page header — gold eyebrow + icon chip, matching the Audit/Dashboard bar */}
        <div className="relative">
          <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
          <p className="mc-section-label">Rooming &amp; Intake</p>
          <h1 className="mc-page-title flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <Stethoscope size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            Medical Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-600">Vitals, medication reconciliation &amp; allergy review</p>
        </div>

        {/* Chief Complaint */}
        <Card>
          <CardHeader>Chief Complaint</CardHeader>
          <CardBody>
            <textarea
              value={chiefComplaint}
              onChange={e => setChiefComplaint(e.target.value)}
              placeholder="Reason for visit..."
              className="textarea-clinical w-full min-h-[60px]"
              rows={2}
            />
          </CardBody>
        </Card>

        {/* Voice Vitals Entry */}
        {speech.isSupported && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span className="font-display text-sm font-semibold tracking-tight text-navy-700 normal-case">Voice Vitals Entry</span>
                {speech.isListening && (
                  <span className="flex items-center gap-1 text-danger-600 text-xs font-semibold animate-pulse">
                    <span className="w-2 h-2 bg-danger-500 rounded-full" />
                    Listening...
                  </span>
                )}
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-600">
                Say: &quot;Blood pressure 142 over 88, heart rate 76, temperature 98.6, weight 187, height 68 inches&quot;
              </p>
              <div className="flex gap-2 flex-wrap">
                <TouchButton
                  variant={speech.isListening ? 'danger' : 'primary'}
                  size="sm"
                  icon={speech.isListening ? '⏹' : '🎤'}
                  onClick={speech.isListening ? speech.stopListening : speech.startListening}
                >
                  {speech.isListening ? 'Stop Listening' : 'Start Listening'}
                </TouchButton>
                {speech.transcript && (
                  <TouchButton
                    variant="primary"
                    size="sm"
                    icon={<Sparkles size={16} />}
                    onClick={extractVitalsFromSpeech}
                    loading={extractingVoice}
                  >
                    Extract Vitals
                  </TouchButton>
                )}
                {speech.transcript && (
                  <TouchButton variant="ghost" size="sm" icon={<X size={15} />} onClick={speech.resetTranscript}>
                    Clear
                  </TouchButton>
                )}
              </div>
              {/* Live transcript display */}
              {(speech.transcript || speech.interimTranscript) && (
                <div className="bg-ivory-200/70 rounded-lg p-3 text-sm border border-slate-200 text-navy-700">
                  <span>{speech.transcript}</span>
                  {speech.interimTranscript && (
                    <span className="text-navy-500 italic">{speech.interimTranscript}</span>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Manual Vitals Grid */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span className="font-display text-sm font-semibold tracking-tight text-navy-700 normal-case">Vitals</span>
              {bmi && (
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-semibold ${bmiBg(bmi)}`}>
                  <span className="text-slate-600 font-normal">BMI:</span>
                  <span className={bmiColor(bmi)}>{bmi}</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {VITAL_FIELDS.map(f => {
                const abnormal = isAbnormal(f.key, vitals[f.key]);
                const prevText = formatPrevVital(f.key);
                return (
                  <div key={f.key}>
                    <label className="label-clinical block text-xs font-medium text-slate-600 mb-1">
                      {f.label} ({f.unit})
                    </label>
                    <input
                      type="number"
                      step={f.step}
                      value={vitals[f.key]}
                      onChange={e => updateVital(f.key, e.target.value)}
                      placeholder={f.ph}
                      className={`input-clinical w-full rounded-lg px-3 py-2 text-lg text-center border focus:ring-2 focus:ring-navy-500 focus:border-navy-500 ${
                        abnormal
                          ? 'border-danger-500 bg-danger-50 ring-1 ring-danger-300 text-danger-700 font-semibold'
                          : 'border-slate-300'
                      }`}
                    />
                    {/* Previous vital trend */}
                    {prevText && (
                      <p className="text-xs text-slate-400 mt-0.5 text-center">{prevText}</p>
                    )}
                    {/* Abnormal indicator */}
                    {abnormal && (
                      <p className="text-xs text-danger-600 font-semibold mt-0.5 text-center">Abnormal</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* BMI summary — premium stat-card treatment: large Source-Serif
                number, semantic tint, an icon chip, and the layered .mc-stat-card
                depth so it reads at the Audit/Dashboard bar. */}
            {bmi && (
              <div className={`mc-stat-card relative mt-4 overflow-hidden !flex-row items-center justify-between !p-5 border ${bmiBg(bmi)}`}>
                <div className="min-w-0">
                  <div className={`font-display text-4xl font-semibold leading-none tabular-nums sm:text-5xl ${bmiColor(bmi)}`}>
                    {bmi}
                  </div>
                  <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Calculated BMI
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {parseFloat(bmi) < 18.5 && 'Underweight'}
                    {parseFloat(bmi) >= 18.5 && parseFloat(bmi) < 25 && 'Normal weight'}
                    {parseFloat(bmi) >= 25 && parseFloat(bmi) < 30 && 'Overweight'}
                    {parseFloat(bmi) >= 30 && 'Obese'}
                  </div>
                </div>
                <span
                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-offWhite-100/70 ring-1 ring-slate-100 shadow-mc ${bmiColor(bmi)}`}
                  aria-hidden="true"
                >
                  <Activity size={24} strokeWidth={2} />
                </span>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Medication Reconciliation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span className="font-display text-sm font-semibold tracking-tight text-navy-700 normal-case">Medication Reconciliation</span>
              {medications.length > 0 && (
                <Badge variant={Object.keys(medConfirmed).length === medications.length ? 'success' : 'warning'}>
                  {Object.values(medConfirmed).filter(Boolean).length}/{medications.length} confirmed
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {medications.length > 0 ? (
              <div className="space-y-2">
                {medications.map((m, i) => (
                  <label
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-150 ${
                      medConfirmed[i]
                        ? 'bg-success-50 border-success-200 shadow-mc'
                        : 'bg-offWhite-100 border-slate-200 hover:bg-ivory-200 hover:border-slate-300 hover:shadow-mc'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!medConfirmed[i]}
                      onChange={e => setMedConfirmed(prev => ({ ...prev, [i]: e.target.checked }))}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-success-600 focus:ring-success-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-navy-700 text-sm">
                        {m.name || m.medication_name}
                      </p>
                      <p className="text-xs text-slate-600">
                        {m.dosage}{m.frequency ? ` - ${m.frequency}` : ''}
                        {m.route ? ` (${m.route})` : ''}
                      </p>
                    </div>
                    {medConfirmed[i] && (
                      <span className="text-success-600 text-xs font-semibold whitespace-nowrap">
                        Patient confirms
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No active medications on file</p>
            )}
          </CardBody>
        </Card>

        {/* Allergy Review */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span className="font-display text-sm font-semibold tracking-tight text-navy-700 normal-case">Allergy Review</span>
              {allergyReviewed && <Badge variant="success">Reviewed</Badge>}
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <AllergyBadges allergies={allergies} />
            <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-slate-100">
              <input
                type="checkbox"
                checked={allergyReviewed}
                onChange={e => setAllergyReviewed(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-success-600 focus:ring-success-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Allergies reviewed with patient
              </span>
            </label>
          </CardBody>
        </Card>

        {/* Pre-Visit Intelligence — agent briefing panel for MA prep */}
        {encounter?.patient_id && (
          <PreVisitPanel patientId={encounter.patient_id} encounterId={parseInt(encounterId, 10)} />
        )}

        {/* Save Button — terminal complete action (vitals done, handing off to
            the provider): confident brand success green with a send icon. */}
        <TouchButton
          variant="success"
          size="lg"
          icon={<Send size={18} />}
          onClick={handleSave}
          loading={saving}
          disabled={saving}
          className="w-full"
        >
          Save Vitals and Send to Provider
        </TouchButton>
      </div>
    </div>
  );
}
