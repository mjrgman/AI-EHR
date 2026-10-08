/**
 * VisitSummaryPage — read-only view of a completed/signed encounter.
 *
 * Route: /visit/:encounterId
 *
 * Terminal checked-out navigation from QueueDashboard and PatientPage routes
 * here via the shared stateRoute() util. Signed encounters go to Check-Out first. This screen
 * shows the signed SOAP note, vitals taken, orders placed, CDS decisions,
 * E/M code billed, and signature line — all read-only.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, FlaskConical, Activity, CreditCard, CheckCircle2 } from 'lucide-react';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import PatientBanner from '../components/patient/PatientBanner';
import TouchButton from '../components/common/TouchButton';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-navy-50 text-navy-600 ring-1 ring-navy-100">
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
      </span>
      {children}
    </span>
  );
}

export default function VisitSummaryPage() {
  const { encounterId } = useParams();
  const navigate = useNavigate();
  const eid = parseInt(encounterId, 10);

  const [encounter, setEncounter] = useState(null);
  const [orders, setOrders] = useState([]);
  const [charge, setCharge] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [cdsSuggestions, setCdsSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { patient } = usePatient(encounter?.patient_id);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const enc = await api.getEncounter(eid);
        setEncounter(enc);

        const [rawOrds, wf, suggestions, chargeData, allVitals] = await Promise.all([
          api.getEncounterOrders(eid).catch(() => null),
          api.getTimeline(eid).catch(() => null),
          api.getSuggestions(eid).catch(() => []),
          api.getCharge(eid).catch(() => null),
          enc?.patient_id ? api.getPatientVitals(enc.patient_id).catch(() => []) : Promise.resolve([]),
        ]);

        // getEncounterOrders returns { lab_orders, imaging_orders, referrals, prescriptions }.
        if (Array.isArray(rawOrds)) {
          setOrders(rawOrds);
        } else if (rawOrds && typeof rawOrds === 'object') {
          setOrders([
            ...(Array.isArray(rawOrds.lab_orders) ? rawOrds.lab_orders.map(o => ({ ...o, order_type: o.order_type || 'lab' })) : []),
            ...(Array.isArray(rawOrds.imaging_orders) ? rawOrds.imaging_orders.map(o => ({ ...o, order_type: o.order_type || 'imaging' })) : []),
            ...(Array.isArray(rawOrds.referrals) ? rawOrds.referrals.map(o => ({ ...o, order_type: o.order_type || 'referral' })) : []),
            ...(Array.isArray(rawOrds.prescriptions) ? rawOrds.prescriptions.map(o => ({ ...o, order_type: o.order_type || 'prescription' })) : []),
          ]);
        } else {
          setOrders([]);
        }

        setWorkflow(wf);
        setCdsSuggestions(Array.isArray(suggestions) ? suggestions : []);
        setCharge(chargeData);

        const encounterVitals = (Array.isArray(allVitals) ? allVitals : [])
          .find((row) => String(row.encounter_id) === String(eid));
        setVitals(encounterVitals || null);
      } catch (err) {
        setError(err.message || 'Failed to load visit summary');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [eid]);

  if (loading) return <LoadingSpinner message="Loading visit summary..." />;
  if (error) return <div className="p-4 text-danger-700">Error: {error}</div>;
  if (!encounter) return <div className="p-4 text-slate-600">Encounter not found</div>;

  const soapNote = encounter.soap_note || encounter.notes || '';
  const cdsAccepted = cdsSuggestions.filter((s) => s.status === 'accepted');
  const cdsRejected = cdsSuggestions.filter((s) => s.status === 'rejected');
  const terminalState = workflow?.current_state || encounter.workflow_state || encounter.status || '';
  const isCompleted = terminalState === 'checked-out' || terminalState === 'completed';

  return (
    <div>
      {patient && <PatientBanner patient={patient} />}
      <div className="mc-page mc-reveal-stagger space-y-4 pb-8">
      {/* Header */}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <TouchButton variant="secondary" size="sm" icon={<ArrowLeft size={16} strokeWidth={2} />} onClick={() => navigate(-1)}>
            Back
          </TouchButton>
          <div>
            <p className="mc-section-label">Read-Only</p>
            <h1 className="mc-page-title flex items-center gap-2">
              <CheckCircle2 size={20} className="text-success-500" strokeWidth={2} />
              Visit Summary
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">{isCompleted ? 'Completed' : 'Signed'}</Badge>
          <span className="text-xs text-slate-500">Enc #{eid}</span>
        </div>
      </div>

      {/* Encounter meta */}
      <Card>
        <CardHeader><SectionLabel icon={ClipboardCheck}>Encounter Details</SectionLabel></CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <span className="label-clinical">Type</span>
              <p className="font-medium text-navy-700">{encounter.encounter_type || '—'}</p>
            </div>
            <div>
              <span className="label-clinical">Chief Complaint</span>
              <p className="font-medium text-navy-700">{encounter.chief_complaint || '—'}</p>
            </div>
            <div>
              <span className="label-clinical">Provider</span>
              <p className="font-medium text-navy-700">{encounter.assigned_provider || encounter.provider || '—'}</p>
            </div>
            <div>
              <span className="label-clinical">Signed</span>
              <p className="font-medium text-navy-700">{formatDate(encounter.signed_at)}</p>
            </div>
            <div>
              <span className="label-clinical">Status</span>
              <p className="font-medium text-navy-700 capitalize">{terminalState || '—'}</p>
            </div>
            {encounter.follow_up_date && (
              <div>
                <span className="label-clinical">Follow-Up Due</span>
                <p className="font-medium text-navy-700">{formatDate(encounter.follow_up_date)}</p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* SOAP Note */}
      {soapNote ? (
        <Card>
          <CardHeader><SectionLabel icon={ClipboardCheck}>SOAP Note</SectionLabel></CardHeader>
          <CardBody>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{soapNote}</pre>
          </CardBody>
        </Card>
      ) : null}

      {/* Vitals */}
      {vitals && (
        <Card>
          <CardHeader><SectionLabel icon={Activity}>Vitals Recorded</SectionLabel></CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              {vitals.systolic_bp && (
                <div><span className="label-clinical">BP</span>
                  <p className="font-medium text-navy-700">{vitals.systolic_bp}/{vitals.diastolic_bp} mmHg</p></div>
              )}
              {vitals.heart_rate && (
                <div><span className="label-clinical">Pulse</span>
                  <p className="font-medium text-navy-700">{vitals.heart_rate} bpm</p></div>
              )}
              {vitals.temperature && (
                <div><span className="label-clinical">Temp</span>
                  <p className="font-medium text-navy-700">{vitals.temperature}°F</p></div>
              )}
              {vitals.weight && (
                <div><span className="label-clinical">Weight</span>
                  <p className="font-medium text-navy-700">{vitals.weight} lbs</p></div>
              )}
              {vitals.spo2 && (
                <div><span className="label-clinical">O₂ Sat</span>
                  <p className="font-medium text-navy-700">{vitals.spo2}%</p></div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Orders */}
      {orders.length > 0 && (
        <Card>
          <CardHeader><SectionLabel icon={FlaskConical}>Orders Placed</SectionLabel></CardHeader>
          <CardBody>
            <div className="space-y-1">
              {orders.map((o, i) => (
                <div key={`${o.order_type || o.type || 'order'}-${o.id ?? i}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-ivory-200/70">
                  <span className="font-medium text-slate-700">{o.medication_name || o.test_name || o.order_name || o.description || 'Order'}</span>
                  <Badge variant="slate" className="text-xs capitalize">{o.order_type || o.type || 'order'}</Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Billing */}
      {charge && (
        <Card>
          <CardHeader><SectionLabel icon={CreditCard}>Billing</SectionLabel></CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <span className="label-clinical">E/M Code</span>
                <p className="font-semibold text-navy-700">{charge.em_level || '—'}</p>
              </div>
              <div>
                <span className="label-clinical">MDM Level</span>
                <p className="font-medium text-navy-700">{charge.em_suggestion?.mdmLevel || '—'}</p>
              </div>
              {charge.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="label-clinical">Notes</span>
                  <p className="font-medium text-slate-600">{charge.notes}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* CDS Summary */}
      {(cdsAccepted.length > 0 || cdsRejected.length > 0) && (
        <Card>
          <CardHeader><SectionLabel icon={ClipboardCheck}>CDS Decisions</SectionLabel></CardHeader>
          <CardBody>
            {cdsAccepted.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-success-600">Accepted ({cdsAccepted.length})</p>
                <div className="space-y-1">
                  {cdsAccepted.map((s, i) => (
                    <div key={i} className="rounded-lg bg-success-50 px-3 py-1.5 text-sm text-success-800">{s.title || s.description || 'Suggestion'}</div>
                  ))}
                </div>
              </div>
            )}
            {cdsRejected.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Rejected ({cdsRejected.length})</p>
                <div className="space-y-1">
                  {cdsRejected.map((s, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-500 line-through">{s.suggestion_text || s.text}</div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      </div>
    </div>
  );
}
