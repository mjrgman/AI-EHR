import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { safeLog } from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import PatientBanner from '../components/patient/PatientBanner';
import AllergyBadges from '../components/patient/AllergyBadges';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useToast } from '../components/common/Toast';
import {
  ArrowLeft,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Send,
} from 'lucide-react';

const APPOINTMENT_TYPES = [
  'Follow-Up',
  'New Patient',
  'Urgent',
  'Procedure',
  'Annual Wellness',
];

function formatTimestamp(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export default function CheckInPage() {
  const { encounterId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [encounter, setEncounter] = useState(null);
  const [encounterLoading, setEncounterLoading] = useState(true);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [appointmentType, setAppointmentType] = useState('Follow-Up');
  const [submitting, setSubmitting] = useState(false);
  const [arrivalTime] = useState(() => new Date());

  const { workflow, timeline, transition } = useWorkflow(encounterId);
  const { patient, loading: patientLoading } = usePatient(encounter?.patient_id);

  // Load encounter data
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const enc = await api.getEncounter(encounterId);
        if (cancelled) return;
        setEncounter(enc);
        setChiefComplaint(enc.chief_complaint || '');
        if (enc.encounter_type) {
          const match = APPOINTMENT_TYPES.find(
            (t) => t.toLowerCase() === (enc.encounter_type || '').toLowerCase()
          );
          if (match) setAppointmentType(match);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error('Failed to load encounter');
          safeLog.error('CheckIn error:', err);
        }
      } finally {
        if (!cancelled) setEncounterLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [encounterId, toast]);

  // Determine if patient has previous encounters
  const previousEncounter = useMemo(() => {
    if (!patient?.encounters || patient.encounters.length === 0) return null;
    // Find the most recent encounter that is NOT the current one
    const sorted = [...patient.encounters]
      .filter((e) => String(e.id) !== String(encounterId))
      .sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0));
    return sorted[0] || null;
  }, [patient, encounterId]);

  // Allergies
  const allergies = patient?.allergies || [];
  const hasAllergies = allergies.length > 0;

  const handleCheckIn = async () => {
    if (!chiefComplaint.trim()) {
      toast.warning('Please enter a chief complaint before checking in');
      return;
    }

    try {
      setSubmitting(true);

      await api.updateEncounter(encounterId, {
        chief_complaint: chiefComplaint.trim(),
        encounter_type: appointmentType,
      });

      if (workflow?.current_state === 'scheduled' || workflow?.current_state === 'created') {
        await transition('checked-in');
      }

      toast.success('Patient checked in successfully');
      navigate(`/ma/${encounterId}`);
    } catch (err) {
      toast.error('Check-in failed: ' + (err.message || 'Unknown error'));
      safeLog.error('Check-in failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Loading states
  if (encounterLoading) {
    return <LoadingSpinner message="Loading encounter..." />;
  }

  if (!encounter) {
    return (
      <div className="mc-page max-w-3xl text-center mc-reveal">
        <p className="text-slate-500 text-lg">Encounter not found.</p>
        <TouchButton
          variant="secondary"
          className="mt-4"
          icon={<ArrowLeft className="w-4 h-4" strokeWidth={2.25} />}
          onClick={() => navigate('/')}
        >
          Back to Dashboard
        </TouchButton>
      </div>
    );
  }

  const isLoading = patientLoading;

  return (
    <div className="min-h-screen pb-8">
      {/* Patient Banner */}
      {patient && <PatientBanner patient={patient} />}

      <div className="mc-page max-w-3xl mc-reveal-stagger space-y-5">
        {/* Navigation + Workflow */}
        <div className="flex items-center justify-between">
          <TouchButton
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" strokeWidth={2.25} />}
            onClick={() => navigate('/')}
          >
            Dashboard
          </TouchButton>
          <WorkflowTracker
            timeline={timeline}
            currentState={workflow?.current_state}
            compact
          />
        </div>

        {/* Arrival Timestamp */}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Badge variant="info">Arrived</Badge>
          <Clock className="w-3.5 h-3.5 text-slate-400" strokeWidth={2} aria-hidden="true" />
          <span className="font-medium tabular-nums">{formatTimestamp(arrivalTime)}</span>
        </div>

        {/* Allergy Alerts — prominent danger treatment */}
        {!isLoading && (
          hasAllergies ? (
            <div className="rounded-2xl border-2 border-danger-300 bg-danger-50 shadow-mc-lg overflow-hidden">
              <div className="flex items-center gap-2 bg-danger-500 px-5 py-2.5">
                <AlertTriangle className="w-4 h-4 text-white flex-shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <h3 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-white m-0">
                  Allergy Alerts
                </h3>
                <Badge variant="urgent" className="ml-auto bg-white text-danger-700 border-white">
                  {allergies.length} {allergies.length === 1 ? 'Allergy' : 'Allergies'}
                </Badge>
              </div>
              <div className="p-4">
                <AllergyBadges allergies={allergies} />
              </div>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <span className="mc-section-label mb-0">Allergy Alerts</span>
              </CardHeader>
              <CardBody>
                <p className="inline-flex items-center gap-2 text-success-700 bg-success-50 border border-success-100 rounded-lg px-3 py-2 text-sm font-medium">
                  <ShieldCheck className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  No known allergies (NKA)
                </p>
              </CardBody>
            </Card>
          )
        )}

        {/* Demographics Confirmation */}
        {patient && (
          <Card>
            <CardHeader>
              <span className="mc-section-label mb-0">Demographics Confirmation</span>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <span className="label-clinical">Name</span>
                  <p className="text-navy-700 font-medium">
                    {patient.first_name} {patient.last_name}
                  </p>
                </div>
                <div>
                  <span className="label-clinical">Date of Birth</span>
                  <p className="text-navy-700 font-medium">
                    {patient.dob || '--'}
                  </p>
                </div>
                <div>
                  <span className="label-clinical">Sex</span>
                  <p className="text-navy-700 font-medium">
                    {patient.sex || '--'}
                  </p>
                </div>
                <div>
                  <span className="label-clinical">Phone</span>
                  <p className="text-navy-700 font-medium">
                    {patient.phone || '--'}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <span className="label-clinical">Insurance</span>
                  <p className="text-navy-700 font-medium">
                    {patient.insurance_carrier || '--'}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Previous Visit Summary */}
        {previousEncounter && (
          <Card>
            <CardHeader>
              <span className="mc-section-label mb-0">Previous Visit</span>
            </CardHeader>
            <CardBody>
              <div className="bg-ivory-100 border border-slate-100 rounded-xl p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="label-clinical">Date:</span>
                  <span className="text-navy-700 font-medium">
                    {formatDateShort(previousEncounter.date || previousEncounter.created_at)}
                  </span>
                </div>
                {previousEncounter.chief_complaint && (
                  <div className="flex items-start gap-2">
                    <span className="label-clinical shrink-0">Chief Complaint:</span>
                    <span className="text-navy-700">
                      {previousEncounter.chief_complaint}
                    </span>
                  </div>
                )}
                {previousEncounter.encounter_type && (
                  <div className="flex items-center gap-2">
                    <span className="label-clinical">Type:</span>
                    <Badge variant="info">{previousEncounter.encounter_type}</Badge>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Check-In Form — signature moment: a gold hairline crowns the decisive section */}
        <div>
          <Card className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />
            <CardHeader>
              <span className="mc-section-label mb-0">Check-In</span>
            </CardHeader>
            <CardBody>
              <div className="space-y-5">
                {/* Appointment Type */}
                <div>
                  <label className="label-clinical" htmlFor="appointmentType">
                    Appointment Type
                  </label>
                  <select
                    id="appointmentType"
                    className="input-clinical w-full"
                    value={appointmentType}
                    onChange={(e) => setAppointmentType(e.target.value)}
                  >
                    {APPOINTMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chief Complaint */}
                <div>
                  <label className="label-clinical" htmlFor="chiefComplaint">
                    Chief Complaint / Reason for Visit
                  </label>
                  <textarea
                    id="chiefComplaint"
                    className="textarea-clinical w-full min-h-[120px]"
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                    placeholder={
                      'Describe the primary reason for today\'s visit...\n\n' +
                      'Examples:\n' +
                      '  - Diabetes and hypertension follow-up\n' +
                      '  - New onset chest pain, 3 days\n' +
                      '  - Annual wellness exam\n' +
                      '  - Post-surgical wound check'
                    }
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <TouchButton
                    variant="success"
                    size="lg"
                    className="flex-1"
                    icon={<Send className="w-5 h-5" strokeWidth={2.25} />}
                    onClick={handleCheckIn}
                    loading={submitting}
                    disabled={submitting || !chiefComplaint.trim()}
                  >
                    Check In &amp; Send to MA
                  </TouchButton>
                  <TouchButton
                    variant="ghost"
                    size="lg"
                    onClick={() => navigate('/')}
                    disabled={submitting}
                  >
                    Cancel
                  </TouchButton>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
