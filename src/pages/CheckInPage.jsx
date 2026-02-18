import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
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
          console.error(err);
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
      console.error(err);
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
      <div className="max-w-3xl mx-auto p-6 text-center animate-fade-in">
        <p className="text-gray-500 text-lg">Encounter not found.</p>
        <TouchButton
          variant="secondary"
          className="mt-4"
          onClick={() => navigate('/')}
        >
          Back to Dashboard
        </TouchButton>
      </div>
    );
  }

  const isLoading = patientLoading;

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Patient Banner */}
      {patient && <PatientBanner patient={patient} />}

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* Navigation + Workflow */}
        <div className="flex items-center justify-between animate-fade-in">
          <TouchButton
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
          >
            &larr; Dashboard
          </TouchButton>
          <WorkflowTracker
            timeline={timeline}
            currentState={workflow?.current_state}
            compact
          />
        </div>

        {/* Arrival Timestamp */}
        <div className="flex items-center gap-2 text-sm text-gray-600 animate-fade-in">
          <Badge variant="info">Arrived</Badge>
          <span className="font-medium">{formatTimestamp(arrivalTime)}</span>
        </div>

        {/* Allergy Alerts */}
        {!isLoading && (
          <div className="animate-slide-up">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <h3 className="section-header m-0">Allergy Alerts</h3>
                  {hasAllergies && (
                    <Badge variant="urgent">
                      {allergies.length} {allergies.length === 1 ? 'Allergy' : 'Allergies'}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardBody>
                {hasAllergies ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <AllergyBadges allergies={allergies} />
                  </div>
                ) : (
                  <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm font-medium">
                    No known allergies (NKA)
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        )}

        {/* Demographics Confirmation */}
        {patient && (
          <div className="animate-slide-up">
            <Card>
              <CardHeader>
                <h3 className="section-header m-0">Demographics Confirmation</h3>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <span className="label-clinical">Name</span>
                    <p className="text-gray-900 font-medium">
                      {patient.first_name} {patient.last_name}
                    </p>
                  </div>
                  <div>
                    <span className="label-clinical">Date of Birth</span>
                    <p className="text-gray-900 font-medium">
                      {patient.dob || '--'}
                    </p>
                  </div>
                  <div>
                    <span className="label-clinical">Sex</span>
                    <p className="text-gray-900 font-medium">
                      {patient.sex || '--'}
                    </p>
                  </div>
                  <div>
                    <span className="label-clinical">Phone</span>
                    <p className="text-gray-900 font-medium">
                      {patient.phone || '--'}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="label-clinical">Insurance</span>
                    <p className="text-gray-900 font-medium">
                      {patient.insurance_carrier || '--'}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {/* Previous Visit Summary */}
        {previousEncounter && (
          <div className="animate-slide-up">
            <Card>
              <CardHeader>
                <h3 className="section-header m-0">Previous Visit</h3>
              </CardHeader>
              <CardBody>
                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="label-clinical">Date:</span>
                    <span className="text-gray-900 font-medium">
                      {formatDateShort(previousEncounter.date || previousEncounter.created_at)}
                    </span>
                  </div>
                  {previousEncounter.chief_complaint && (
                    <div className="flex items-start gap-2">
                      <span className="label-clinical shrink-0">Chief Complaint:</span>
                      <span className="text-gray-900">
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
          </div>
        )}

        {/* Check-In Form */}
        <div className="animate-slide-up">
          <Card>
            <CardHeader>
              <h3 className="section-header m-0">Check-In</h3>
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
