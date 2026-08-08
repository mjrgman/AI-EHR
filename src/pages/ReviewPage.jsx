import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, PenLine, ClipboardCheck, Pill, FlaskConical, Camera, Send } from 'lucide-react';
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
import StatTile from '../components/workflow/StatTile';
import LoadingSpinner from '../components/common/LoadingSpinner';

export default function ReviewPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId, 10);
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

  // --- Unsaved work protection ---
  useEffect(() => {
    const handler = (e) => {
      if (soapDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [soapDirty]);

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

      // Advance workflow through all states up to and including 'signed'.
      // The state machine only accepts one-step transitions, so we walk the
      // full ordered chain from the current state to 'signed', skipping states
      // already passed.
      const STATE_CHAIN = [
        'scheduled',
        'checked-in',
        'roomed',
        'vitals-recorded',
        'provider-examining',
        'documentation',
        'signed',
      ];
      const currentState = workflow?.current_state;
      const currentIdx = STATE_CHAIN.indexOf(currentState);
      const signedIdx = STATE_CHAIN.indexOf('signed');
      if (currentIdx < signedIdx) {
        for (let i = currentIdx + 1; i <= signedIdx; i++) {
          try {
            await transition(STATE_CHAIN[i]);
          } catch (e) {
            // If transition fails for a state we've already passed, continue.
            // Re-throw only if we couldn't reach 'signed'.
            if (i === signedIdx) throw e;
          }
        }
      }

      await api.updateEncounter(encounterId, {
        status: 'signed',
        signed_by: providerName,
        signed_at: new Date().toISOString(),
      });

      toast.success('Encounter signed successfully.');
      navigate('/visit/' + encounterId);
    } catch (err) {
      toast.error('Signing failed: ' + err.message);
    } finally {
      setSigning(false);
    }
  }

  // --- Loading ---
  if (!encounter) return <LoadingSpinner message="Loading review..." />;

  const canSign = attested && soapNote.trim().length > 0;

  return (
    <div>
      {/* Signature moment: slim gold hairline crowning the patient banner. */}
      <div className="h-0.5 bg-gradient-to-r from-gold-500/0 via-gold-500/70 to-gold-500/0" aria-hidden="true" />
      {patient && <PatientBanner patient={patient} />}

      <div className="max-w-4xl mx-auto p-4 space-y-4 mc-reveal-stagger">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TouchButton variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/encounter/' + encounterId)}>
            Continue Editing
          </TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>

        {/* Page header — gold eyebrow + icon chip (Audit/Dashboard bar) */}
        <div className="relative">
          <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
          <p className="mc-section-label">Documentation &amp; Sign-off</p>
          <h1 className="mc-page-title flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <ClipboardCheck size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            Review &amp; Sign
          </h1>
          <p className="mt-1 text-sm text-slate-600">Verify the note, confirm orders, attest, and sign the encounter</p>
        </div>

        {/* Orders at-a-glance — premium StatTiles matching the Audit stat bar.
            Prescriptions carry the single gold attention beat (the most
            controlled order class); the rest sit on navy/slate authority. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={Pill} label="Prescriptions" value={orderCounts.prescriptions} tone="gold" />
          <StatTile icon={FlaskConical} label="Lab Orders" value={orderCounts.labs} tone="navy" />
          <StatTile icon={Camera} label="Imaging" value={orderCounts.imaging} tone="slate" />
          <StatTile icon={Send} label="Referrals" value={orderCounts.referrals} tone="slate" />
        </div>

        {/* Encounter Timestamps */}
        <Card>
          <CardHeader>Encounter Timeline</CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="label-clinical">Check-in</span>
                <p className="font-semibold text-navy-700">{formatTime(timestamps.checkIn)}</p>
              </div>
              <div>
                <span className="label-clinical">Exam Start</span>
                <p className="font-semibold text-navy-700">{formatTime(timestamps.examStart)}</p>
              </div>
              <div>
                <span className="label-clinical">Duration</span>
                <p className="font-semibold text-navy-700">{timestamps.duration || '--'}</p>
              </div>
              <div>
                <span className="label-clinical">Encounter Type</span>
                <p className="font-semibold text-navy-700">{encounter.encounter_type || 'Office Visit'}</p>
              </div>
              {encounter.chief_complaint && (
                <div>
                  <span className="label-clinical">Chief Complaint</span>
                  <p className="font-semibold text-navy-700">{encounter.chief_complaint}</p>
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
                icon={<Save size={15} />}
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
                className="textarea-clinical w-full min-h-[280px] font-mono text-sm leading-relaxed resize-y border border-slate-300 rounded-xl p-4 focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                value={soapNote}
                onChange={(e) => {
                  setSoapNote(e.target.value);
                  setSoapDirty(true);
                }}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-400 italic">No SOAP note generated for this encounter.</p>
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
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Accepted ({accepted.length})</h4>
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
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Rejected ({rejected.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {rejected.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-ivory-200 text-slate-400 border border-slate-100 line-through"
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

        {/* Orders Summary — AuditPage-grade tabular treatment: each order class
            is a refined table with slate eyebrow column headers, a steady row
            rhythm, and a hover wash. One disciplined surface, no rainbow. */}
        <Card>
          <CardHeader action={<span className="font-mono text-xs text-slate-400">{orderCounts.total} total</span>}>
            Orders Summary
          </CardHeader>
          <CardBody className="space-y-5">
            {orderCounts.total === 0 && (
              <p className="text-sm text-slate-400 italic">No orders created for this encounter.</p>
            )}

            {orders?.prescriptions?.length > 0 && (
              <div>
                <p className="mc-section-label">Prescriptions ({orders.prescriptions.length})</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-ivory-200/70">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Medication</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Sig</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.prescriptions.map((rx, i) => (
                        <tr key={i} className="transition-colors hover:bg-ivory-200/60">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="success">Rx</Badge>
                              <span className="font-medium text-navy-700">{rx.medication_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{rx.dose} {rx.route} {rx.frequency}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">{rx.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {orders?.lab_orders?.length > 0 && (
              <div>
                <p className="mc-section-label">Lab Orders ({orders.lab_orders.length})</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-ivory-200/70">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Test</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">CPT</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-600">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.lab_orders.map((lab, i) => (
                        <tr key={i} className="transition-colors hover:bg-ivory-200/60">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="routine">Lab</Badge>
                              <span className="font-medium text-navy-700">{lab.test_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{lab.cpt_code || '—'}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-400">{lab.priority}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {orders?.imaging_orders?.length > 0 && (
              <div>
                <p className="mc-section-label">Imaging ({orders.imaging_orders.length})</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-ivory-200/70">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Study</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Body Part</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.imaging_orders.map((img, i) => (
                        <tr key={i} className="transition-colors hover:bg-ivory-200/60">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="info">Imaging</Badge>
                              <span className="font-medium text-navy-700">{img.study_type}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{img.body_part}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {orders?.referrals?.length > 0 && (
              <div>
                <p className="mc-section-label">Referrals ({orders.referrals.length})</p>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-ivory-200/70">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Specialty</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.referrals.map((ref, i) => (
                        <tr key={i} className="transition-colors hover:bg-ivory-200/60">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="warning">Referral</Badge>
                              <span className="font-medium text-navy-700">{ref.specialty}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{ref.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                className="mt-1 w-5 h-5 rounded border-slate-300 text-navy-600 focus:ring-navy-500"
              />
              <div>
                <p className="font-semibold text-navy-700">
                  I have reviewed and approve this documentation
                </p>
                <p className="text-sm text-slate-600 mt-0.5">
                  By checking this box, I attest that the SOAP note, orders, and clinical decision support
                  actions accurately reflect the care provided during this encounter.
                </p>
                {providerName && (
                  <p className="text-xs text-slate-400 mt-1">Signing as: {providerName}</p>
                )}
              </div>
            </label>
          </CardBody>
        </Card>

        {/* Readiness hint — surfaces exactly why Sign is inert, so the disabled
            state reads as a clear gate, not a washed-out button. Presentation
            only; mirrors the existing canSign predicate. */}
        {!canSign && (
          <div className="flex items-start gap-2 rounded-xl border border-gold-200 bg-gold-50/70 px-4 py-3 text-sm text-gold-800">
            <PenLine size={16} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-gold-600" aria-hidden="true" />
            <span>
              {!soapNote.trim()
                ? 'A SOAP note is required before this encounter can be signed.'
                : 'Check the attestation box above to enable signing.'}
            </span>
          </div>
        )}

        {/* Action Buttons. Sign Encounter is the terminal positive/complete
            action — confident brand success green with a signing icon. Continue
            Editing is a quiet secondary so the sign path reads as the hero. */}
        <div className="flex gap-3 pb-6">
          <TouchButton
            variant="secondary"
            size="lg"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate('/encounter/' + encounterId)}
            className="flex-1"
          >
            Continue Editing
          </TouchButton>
          <TouchButton
            variant="success"
            size="lg"
            icon={<PenLine size={18} />}
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
