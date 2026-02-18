import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useEncounter } from '../hooks/useEncounter';
import { useCDS } from '../hooks/useCDS';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function ReviewPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId);
  const navigate = useNavigate();
  const toast = useToast();
  const { providerName } = useAuth();

  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attested, setAttested] = useState(false);
  const [soapNote, setSoapNote] = useState('');
  const [soapDirty, setSoapDirty] = useState(false);

  const { encounter, orders, refresh: refreshEncounter } = useEncounter(eid);
  const { patient } = usePatient(encounter?.patient_id);
  const { workflow, timeline, transition } = useWorkflow(eid);
  const { accepted, rejected } = useCDS(eid, encounter?.patient_id, { pollInterval: 0 });

  // Seed SOAP note from encounter data
  useEffect(() => {
    if (encounter?.soap_note && !soapDirty) {
      setSoapNote(encounter.soap_note);
    }
  }, [encounter?.soap_note, soapDirty]);

  // --- Computed values ---
  const orderCounts = useMemo(() => {
    if (!orders) return { prescriptions: 0, labs: 0, imaging: 0, referrals: 0, total: 0 };
    const prescriptions = orders.prescriptions?.length || 0;
    const labs = orders.lab_orders?.length || 0;
    const imaging = orders.imaging_orders?.length || 0;
    const referrals = orders.referrals?.length || 0;
    return { prescriptions, labs, imaging, referrals, total: prescriptions + labs + imaging + referrals };
  }, [orders]);

  // --- Timestamps ---
  const timestamps = useMemo(() => {
    if (!timeline) return {};
    const events = Array.isArray(timeline) ? timeline : timeline?.events || [];
    let checkIn = null;
    let examStart = null;
    for (const ev of events) {
      const ts = ev.transitioned_at || ev.timestamp || ev.created_at;
      if (ev.to_state === 'checked-in' || ev.to_state === 'arrived') {
        checkIn = ts;
      }
      if (ev.to_state === 'provider-examining') {
        examStart = ts;
      }
    }
    let duration = null;
    if (checkIn) {
      const start = new Date(checkIn);
      const now = new Date();
      const diffMs = now - start;
      const mins = Math.floor(diffMs / 60000);
      if (mins >= 60) {
        duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
      } else {
        duration = `${mins}m`;
      }
    }
    return { checkIn, examStart, duration };
  }, [timeline]);

  function formatTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // --- Save SOAP edits ---
  async function handleSaveSoap() {
    setSaving(true);
    try {
      await api.updateEncounter(encounterId, { soap_note: soapNote });
      setSoapDirty(false);
      toast.success('SOAP note saved.');
      await refreshEncounter();
    } catch (err) {
      toast.error('Failed to save SOAP note: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // --- Sign encounter ---
  async function handleSign() {
    if (!attested) {
      toast.warning('Please attest to the documentation before signing.');
      return;
    }
    if (!soapNote.trim()) {
      toast.warning('SOAP note is required before signing.');
      return;
    }

    setSigning(true);
    try {
      // Save any unsaved SOAP edits first
      if (soapDirty) {
        await api.updateEncounter(encounterId, { soap_note: soapNote });
      }

      // Transition workflow to documentation then signed
      const state = workflow?.current_state;
      if (state !== 'documentation' && state !== 'signed') {
        try { await transition('documentation'); } catch (e) { /* may already be past this */ }
      }
      try { await transition('signed'); } catch (e) { /* may already be signed */ }

      await api.updateEncounter(encounterId, {
        status: 'signed',
        signed_by: providerName,
        signed_at: new Date().toISOString(),
      });

      toast.success('Encounter signed successfully.');
      navigate('/checkout/' + encounterId);
    } catch (err) {
      toast.error('Signing failed: ' + err.message);
      // Attempt navigation anyway since partial transition may have occurred
      navigate('/checkout/' + encounterId);
    } finally {
      setSigning(false);
    }
  }

  // --- Loading ---
  if (!encounter) return <LoadingSpinner message="Loading review..." />;

  const canSign = attested && soapNote.trim().length > 0;

  return (
    <div>
      {patient && <PatientBanner patient={patient} />}

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/encounter/' + encounterId)}>
            &#x2190; Continue Editing
          </TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>

        {/* Encounter Timestamps */}
        <Card>
          <CardHeader>Encounter Timeline</CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="label-clinical">Check-in</span>
                <p className="font-semibold text-gray-900">{formatTime(timestamps.checkIn)}</p>
              </div>
              <div>
                <span className="label-clinical">Exam Start</span>
                <p className="font-semibold text-gray-900">{formatTime(timestamps.examStart)}</p>
              </div>
              <div>
                <span className="label-clinical">Duration</span>
                <p className="font-semibold text-gray-900">{timestamps.duration || '--'}</p>
              </div>
              <div>
                <span className="label-clinical">Encounter Type</span>
                <p className="font-semibold text-gray-900">{encounter.encounter_type || 'Office Visit'}</p>
              </div>
              {encounter.chief_complaint && (
                <div>
                  <span className="label-clinical">Chief Complaint</span>
                  <p className="font-semibold text-gray-900">{encounter.chief_complaint}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Editable SOAP Note */}
        <Card>
          <CardHeader
            action={
              <TouchButton
                variant="primary"
                size="sm"
                onClick={handleSaveSoap}
                loading={saving}
                disabled={!soapDirty}
              >
                Save Changes
              </TouchButton>
            }
          >
            SOAP Note
          </CardHeader>
          <CardBody>
            {soapNote || encounter.soap_note ? (
              <textarea
                className="textarea-clinical w-full min-h-[280px] font-mono text-sm leading-relaxed resize-y border border-gray-300 rounded-xl p-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={soapNote}
                onChange={(e) => {
                  setSoapNote(e.target.value);
                  setSoapDirty(true);
                }}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400 italic">No SOAP note generated for this encounter.</p>
                <TouchButton
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate('/encounter/' + encounterId)}
                >
                  Go back to generate a note
                </TouchButton>
              </div>
            )}
          </CardBody>
        </Card>

        {/* CDS Suggestions Summary */}
        {(accepted.length > 0 || rejected.length > 0) && (
          <Card>
            <CardHeader>
              CDS Suggestions
            </CardHeader>
            <CardBody className="space-y-3">
              {accepted.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Accepted ({accepted.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {accepted.map((s) => (
                      <Badge key={s.id} variant="success">
                        {s.title || s.suggestion_type}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {rejected.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Rejected ({rejected.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {rejected.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-400 line-through"
                      >
                        {s.title || s.suggestion_type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Orders Summary */}
        <Card>
          <CardHeader>Orders Summary ({orderCounts.total} total)</CardHeader>
          <CardBody className="space-y-4">
            {orderCounts.total === 0 && (
              <p className="text-sm text-gray-400 italic">No orders created for this encounter.</p>
            )}

            {orders?.prescriptions?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Prescriptions ({orders.prescriptions.length})
                </h4>
                <div className="space-y-1">
                  {orders.prescriptions.map((rx, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <Badge variant="success">Rx</Badge>
                      <span className="font-medium">{rx.medication_name}</span>
                      <span className="text-gray-500">{rx.dose} {rx.route} {rx.frequency}</span>
                      <span className="text-gray-400 text-xs ml-auto">{rx.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orders?.lab_orders?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Lab Orders ({orders.lab_orders.length})
                </h4>
                <div className="space-y-1">
                  {orders.lab_orders.map((lab, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <Badge variant="routine">Lab</Badge>
                      <span className="font-medium">{lab.test_name}</span>
                      {lab.cpt_code && <span className="text-gray-400 text-xs">CPT: {lab.cpt_code}</span>}
                      <span className="text-gray-400 text-xs ml-auto">{lab.priority}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orders?.imaging_orders?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Imaging ({orders.imaging_orders.length})
                </h4>
                <div className="space-y-1">
                  {orders.imaging_orders.map((img, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <Badge variant="purple">Imaging</Badge>
                      <span className="font-medium">{img.study_type}</span>
                      <span className="text-gray-500">{img.body_part}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orders?.referrals?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Referrals ({orders.referrals.length})
                </h4>
                <div className="space-y-1">
                  {orders.referrals.map((ref, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <Badge variant="warning">Referral</Badge>
                      <span className="font-medium">{ref.specialty}</span>
                      <span className="text-gray-500">{ref.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Attestation */}
        <Card>
          <CardBody>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="font-semibold text-gray-900">
                  I have reviewed and approve this documentation
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  By checking this box, I attest that the SOAP note, orders, and clinical decision support
                  actions accurately reflect the care provided during this encounter.
                </p>
                {providerName && (
                  <p className="text-xs text-gray-400 mt-1">Signing as: {providerName}</p>
                )}
              </div>
            </label>
          </CardBody>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-3 pb-6">
          <TouchButton
            variant="secondary"
            onClick={() => navigate('/encounter/' + encounterId)}
            className="flex-1"
          >
            &#x2190; Continue Editing
          </TouchButton>
          <TouchButton
            variant="success"
            onClick={handleSign}
            loading={signing}
            disabled={!canSign}
            className="flex-1"
          >
            Sign Encounter
          </TouchButton>
        </div>
      </div>
    </div>
  );
}
