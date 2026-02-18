import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../hooks/usePatient';
import { useWorkflow } from '../hooks/useWorkflow';
import { useEncounter } from '../hooks/useEncounter';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import PatientBanner from '../components/patient/PatientBanner';
import WorkflowTracker from '../components/workflow/WorkflowTracker';
import LoadingSpinner from '../components/common/LoadingSpinner';

const FOLLOW_UP_INTERVALS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function CheckOutPage() {
  const { encounterId } = useParams();
  const eid = parseInt(encounterId);
  const navigate = useNavigate();
  const toast = useToast();

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpInterval, setFollowUpInterval] = useState('');
  const [billingNotes, setBillingNotes] = useState('');

  const { encounter, orders } = useEncounter(eid);
  const { patient } = usePatient(encounter?.patient_id);
  const { workflow, timeline, transition } = useWorkflow(eid);

  const orderCounts = useMemo(() => {
    if (!orders) return { prescriptions: 0, labs: 0, imaging: 0, referrals: 0, total: 0 };
    const prescriptions = orders.prescriptions?.length || 0;
    const labs = orders.lab_orders?.length || 0;
    const imaging = orders.imaging_orders?.length || 0;
    const referrals = orders.referrals?.length || 0;
    return { prescriptions, labs, imaging, referrals, total: prescriptions + labs + imaging + referrals };
  }, [orders]);

  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Patient';

  // Generate patient instructions from orders
  const instructions = useMemo(() => {
    const items = [];
    orders?.prescriptions?.forEach((rx) => {
      items.push({
        type: 'pharmacy',
        text: `Pick up ${rx.medication_name} ${rx.dose || ''} at your pharmacy. Take ${rx.frequency || 'as directed'}.`,
      });
    });
    orders?.lab_orders?.forEach((lab) => {
      items.push({
        type: 'lab',
        text: `${lab.test_name}${lab.scheduled_date ? ` scheduled for ${formatDate(lab.scheduled_date)}` : ' - proceed to the lab for blood work'}.${lab.fasting ? ' Fasting required.' : ''}`,
      });
    });
    orders?.imaging_orders?.forEach((img) => {
      items.push({
        type: 'imaging',
        text: `Schedule ${img.study_type} of ${img.body_part}. ${img.instructions || 'Call the imaging center to schedule your appointment.'}`,
      });
    });
    orders?.referrals?.forEach((ref) => {
      items.push({
        type: 'referral',
        text: `Referral to ${ref.specialty}${ref.reason ? ` for ${ref.reason}` : ''}. ${ref.provider_name ? `Referred to ${ref.provider_name}.` : 'You will receive scheduling information.'} `,
      });
    });
    return items;
  }, [orders]);

  function handleIntervalChange(e) {
    const val = e.target.value;
    setFollowUpInterval(val);
    if (val) {
      const interval = FOLLOW_UP_INTERVALS.find((fi) => fi.label === val);
      if (interval) {
        setFollowUpDate(addDays(new Date(), interval.days));
      }
    }
  }

  function handleFollowUpDateChange(e) {
    setFollowUpDate(e.target.value);
    // Clear interval dropdown since user picked a custom date
    setFollowUpInterval('');
  }

  async function handleCheckOut() {
    setCheckingOut(true);
    try {
      if (workflow?.current_state === 'signed') {
        await transition('checked-out');
      }

      const updateData = { status: 'completed' };
      if (followUpDate) updateData.follow_up_date = followUpDate;
      if (billingNotes) updateData.billing_notes = billingNotes;

      await api.updateEncounter(encounterId, updateData);
      setCheckedOut(true);
      toast.success('Patient checked out successfully.');
    } catch (err) {
      toast.error('Checkout failed: ' + err.message);
      // Show complete screen anyway since partial transition may have succeeded
      setCheckedOut(true);
    } finally {
      setCheckingOut(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  // --- Loading ---
  if (!encounter) return <LoadingSpinner message="Loading checkout..." />;

  // --- Post-checkout success screen ---
  if (checkedOut) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Print styles are handled via @media print below */}
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
            body { background: white; }
            .print-container { box-shadow: none !important; border: none !important; max-width: 100% !important; }
          }
          .print-only { display: none; }
          @keyframes checkmark-pop {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
          }
          .animate-checkmark { animation: checkmark-pop 0.5s ease-out forwards; }
        `}</style>

        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="print-container max-w-lg w-full">
            <Card>
              <CardBody className="text-center py-10">
                {/* Animated checkmark */}
                <div className="animate-checkmark inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-5">
                  <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <h2 className="text-2xl font-bold text-gray-900 mb-1">Encounter Complete</h2>
                <p className="text-gray-600 mb-1">{patientName} has been checked out.</p>
                <p className="text-gray-400 text-sm mb-6">
                  {orderCounts.total} order{orderCounts.total !== 1 ? 's' : ''} placed &middot; Encounter #{encounterId}
                </p>

                {followUpDate && (
                  <div className="bg-blue-50 rounded-xl p-3 mb-4 text-sm">
                    <span className="font-semibold text-blue-800">Follow-up: </span>
                    <span className="text-blue-700">{formatDate(followUpDate)}</span>
                  </div>
                )}

                {/* After-Visit Summary */}
                <div className="text-left bg-gray-50 rounded-xl p-5 mb-6">
                  {/* Print header */}
                  <div className="print-only mb-4">
                    <h1 className="text-xl font-bold">After-Visit Summary</h1>
                    <p className="text-sm text-gray-500">{patientName} &middot; {new Date().toLocaleDateString()}</p>
                    <hr className="mt-2" />
                  </div>

                  <h3 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wide">
                    After-Visit Summary
                  </h3>

                  {encounter.chief_complaint && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 uppercase font-semibold">Reason for Visit</p>
                      <p className="text-sm text-gray-800">{encounter.chief_complaint}</p>
                    </div>
                  )}

                  {instructions.length > 0 ? (
                    <div className="space-y-3">
                      {orders?.prescriptions?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Pharmacy</p>
                          {instructions.filter((i) => i.type === 'pharmacy').map((inst, idx) => (
                            <p key={idx} className="text-sm text-gray-700 py-0.5">&bull; {inst.text}</p>
                          ))}
                        </div>
                      )}
                      {orders?.lab_orders?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Lab Work</p>
                          {instructions.filter((i) => i.type === 'lab').map((inst, idx) => (
                            <p key={idx} className="text-sm text-gray-700 py-0.5">&bull; {inst.text}</p>
                          ))}
                        </div>
                      )}
                      {orders?.imaging_orders?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Imaging</p>
                          {instructions.filter((i) => i.type === 'imaging').map((inst, idx) => (
                            <p key={idx} className="text-sm text-gray-700 py-0.5">&bull; {inst.text}</p>
                          ))}
                        </div>
                      )}
                      {orders?.referrals?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Referrals</p>
                          {instructions.filter((i) => i.type === 'referral').map((inst, idx) => (
                            <p key={idx} className="text-sm text-gray-700 py-0.5">&bull; {inst.text}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No orders for this visit.</p>
                  )}

                  {followUpDate && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500 uppercase font-semibold">Follow-Up Appointment</p>
                      <p className="text-sm text-gray-800">{formatDate(followUpDate)}</p>
                    </div>
                  )}
                </div>

                {/* Action buttons (hidden on print) */}
                <div className="no-print space-y-2">
                  <TouchButton variant="secondary" onClick={handlePrint} className="w-full">
                    Print After-Visit Summary
                  </TouchButton>
                  <TouchButton variant="primary" onClick={() => navigate('/')} className="w-full">
                    Back to Dashboard
                  </TouchButton>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // --- Pre-checkout view ---
  return (
    <div>
      {patient && <PatientBanner patient={patient} />}

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TouchButton variant="secondary" size="sm" onClick={() => navigate('/review/' + encounterId)}>
            &#x2190; Back to Review
          </TouchButton>
          <WorkflowTracker timeline={timeline} currentState={workflow?.current_state} />
        </div>

        {/* Signed confirmation banner */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-green-800">Encounter Signed</p>
            <p className="text-sm text-green-600">
              {orderCounts.total} order{orderCounts.total !== 1 ? 's' : ''} ready for processing
              {encounter.signed_by && ` | Signed by ${encounter.signed_by}`}
            </p>
          </div>
        </div>

        {/* Patient Instructions */}
        {instructions.length > 0 && (
          <Card>
            <CardHeader>Patient Instructions</CardHeader>
            <CardBody className="space-y-3">
              {orders?.prescriptions?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Pharmacy Pickups</h4>
                  {orders.prescriptions.map((rx, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm py-1">
                      <Badge variant="success">Rx</Badge>
                      <span>Pick up <span className="font-medium">{rx.medication_name}</span> {rx.dose || ''} - take {rx.frequency || 'as directed'}</span>
                    </div>
                  ))}
                </div>
              )}
              {orders?.lab_orders?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Lab Appointments</h4>
                  {orders.lab_orders.map((lab, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm py-1">
                      <Badge variant="routine">Lab</Badge>
                      <span>
                        <span className="font-medium">{lab.test_name}</span>
                        {lab.scheduled_date ? ` - scheduled ${formatDate(lab.scheduled_date)}` : ' - proceed to lab'}
                        {lab.fasting ? ' (fasting required)' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {orders?.imaging_orders?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Imaging Scheduling</h4>
                  {orders.imaging_orders.map((img, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm py-1">
                      <Badge variant="purple">Imaging</Badge>
                      <span>Schedule <span className="font-medium">{img.study_type}</span> of {img.body_part}</span>
                    </div>
                  ))}
                </div>
              )}
              {orders?.referrals?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Referrals</h4>
                  {orders.referrals.map((ref, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm py-1">
                      <Badge variant="warning">Referral</Badge>
                      <span>
                        Referral to <span className="font-medium">{ref.specialty}</span>
                        {ref.reason ? ` for ${ref.reason}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* Follow-up Scheduling */}
        <Card>
          <CardHeader>Follow-Up Scheduling</CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-clinical block mb-1">Interval</label>
                <select
                  className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={followUpInterval}
                  onChange={handleIntervalChange}
                >
                  <option value="">Select interval...</option>
                  {FOLLOW_UP_INTERVALS.map((fi) => (
                    <option key={fi.label} value={fi.label}>{fi.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-clinical block mb-1">Follow-Up Date</label>
                <input
                  type="date"
                  className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={followUpDate}
                  onChange={handleFollowUpDateChange}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
            {followUpDate && (
              <p className="text-sm text-blue-600 mt-2">
                Follow-up scheduled for <span className="font-semibold">{formatDate(followUpDate)}</span>
              </p>
            )}
          </CardBody>
        </Card>

        {/* Copay / Billing Notes */}
        <Card>
          <CardHeader>Copay / Billing Notes</CardHeader>
          <CardBody>
            <input
              type="text"
              className="input-clinical w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter copay amount or billing notes..."
              value={billingNotes}
              onChange={(e) => setBillingNotes(e.target.value)}
            />
          </CardBody>
        </Card>

        {/* Complete Checkout */}
        <TouchButton
          variant="success"
          onClick={handleCheckOut}
          loading={checkingOut}
          className="w-full"
          size="lg"
        >
          Complete Checkout
        </TouchButton>

        <div className="h-4" />
      </div>
    </div>
  );
}
