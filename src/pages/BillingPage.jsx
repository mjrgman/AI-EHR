/**
 * BillingPage — Billing Worklist
 *
 * Route: /billing
 *
 * Surfaces the billing charges worklist from GET /api/billing/charges.
 * Includes per-row eligibility check button via POST /api/insurance/verify-eligibility.
 * Spec: section 4 S9.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, RefreshCw, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import api from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import Badge from '../components/common/Badge';
import TouchButton from '../components/common/TouchButton';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useToast } from '../components/common/Toast';

// Billing Worklist — one screen for all charge statuses
const STATUS_OPTIONS = [
  { value: 'finalized', label: 'Finalized' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'billed', label: 'Billed' },
  { value: 'paid', label: 'Paid' },
  { value: 'denied', label: 'Denied' },
];

const STATUS_BADGE = {
  finalized: 'navy',
  draft: 'slate',
  submitted: 'gold',
  billed: 'gold',
  paid: 'success',
  denied: 'danger',
};

function formatDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

export default function BillingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('finalized');
  const [eligibilityResults, setEligibilityResults] = useState({});
  const [checkingEligibility, setCheckingEligibility] = useState({});

  const loadCharges = useCallback(async () => {
    setLoadError(null);
    try {
      setLoading(true);
      const data = await api.getBillingCharges({ status: statusFilter });
      setCharges(Array.isArray(data) ? data : []);
    } catch (err) {
      // Capture error in state instead of calling toast (which can cause re-render loops)
      const msg = err?.message || 'Failed to load billing charges';
      setLoadError(msg);
      setCharges([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);  // removed toast from deps — toast identity is unstable

  // Guard: only re-run when statusFilter actually changes, not on every render
  const [fetchedFilter, setFetchedFilter] = useState(null);
  useEffect(() => {
    if (fetchedFilter === statusFilter) return;
    setFetchedFilter(statusFilter);
    loadCharges();
  }, [statusFilter, fetchedFilter, loadCharges]);

  async function handleEligibilityCheck(charge) {
    if (!charge.patient_id) return;
    const key = charge.encounter_id || charge.id;
    setCheckingEligibility((prev) => ({ ...prev, [key]: true }));
    try {
      const patient = await api.getPatient(charge.patient_id).catch(() => null);
      const insurance_carrier = patient?.insurance_carrier || 'Unknown';
      const insurance_id = patient?.insurance_id || patient?.mrn || 'ID-001';
      const result = await api.verifyInsuranceEligibility({
        patient_id: charge.patient_id,
        insurance_carrier,
        insurance_id,
      });
      setEligibilityResults((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      toast.error('Eligibility check failed');
    } finally {
      setCheckingEligibility((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="mc-page mc-reveal-stagger space-y-6 pb-8">
      {/* Header */}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <div>
          <p className="mc-section-label">Revenue Cycle</p>
          <h1 className="mc-page-title flex items-center gap-2">
            <CreditCard size={22} className="text-navy-600" strokeWidth={2} />
            Billing Worklist
          </h1>
        </div>
        <TouchButton variant="secondary" size="sm" icon={<RefreshCw size={16} />} onClick={loadCharges}>
          Refresh
        </TouchButton>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === opt.value
                ? 'bg-navy-600 text-white shadow-mc'
                : 'bg-offWhite-100 text-slate-600 border border-slate-200 hover:bg-ivory-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Worklist */}
      <Card>
        <CardHeader>
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <CreditCard size={14} strokeWidth={2} />
            </span>
            Charges — {statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
          </span>
        </CardHeader>
        <CardBody>
          {loading ? (
            <LoadingSpinner message="Loading charges…" />
          ) : loadError ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-semibold text-danger-700">Unable to load charges</p>
              <p className="text-xs text-slate-500">{loadError}</p>
              <button
                type="button"
                onClick={() => { setFetchedFilter(null); }}
                className="mt-2 rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-ivory-200"
              >
                Retry
              </button>
            </div>
          ) : charges.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No {statusFilter} charges found.</p>
          ) : (
            <div className="space-y-2">
              {charges.map((charge) => {
                const key = charge.encounter_id || charge.id;
                const elig = eligibilityResults[key];
                const checking = checkingEligibility[key];
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-100 bg-offWhite-100 p-4 shadow-mc hover:border-navy-200 hover:shadow-mc-lg transition-all"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-navy-700">
                            {charge.patient_name || `Patient ${charge.patient_id}`}
                          </span>
                          <Badge variant={STATUS_BADGE[charge.status] || 'slate'} className="text-xs capitalize">
                            {charge.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                          {charge.em_code && (
                            <span>E/M: <span className="font-semibold text-navy-700">{charge.em_code}</span></span>
                          )}
                          {charge.encounter_date && (
                            <span>Date: {formatDate(charge.encounter_date)}</span>
                          )}
                          {charge.encounter_id && (
                            <span>Enc #{charge.encounter_id}</span>
                          )}
                        </div>
                        {charge.provider_notes && (
                          <p className="text-xs text-slate-500 italic">{charge.provider_notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Eligibility check */}
                        <TouchButton
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEligibilityCheck(charge)}
                          disabled={checking}
                        >
                          {checking ? 'Checking…' : 'Check Eligibility'}
                        </TouchButton>
                        {/* Navigate to encounter */}
                        {charge.encounter_id && (
                          <TouchButton
                            variant="ghost"
                            size="sm"
                            icon={<ChevronRight size={16} />}
                            onClick={() => navigate(`/checkout/${charge.encounter_id}`)}
                          >
                            View
                          </TouchButton>
                        )}
                      </div>
                    </div>
                    {/* Eligibility result */}
                    {elig && (
                      <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${elig.eligible ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
                        <span className="flex items-center gap-1.5 font-semibold">
                          {elig.eligible
                            ? <><CheckCircle2 size={14} /> Eligible</>
                            : <><XCircle size={14} /> Not Eligible</>
                          }
                        </span>
                        {elig.eligible && (
                          <div className="mt-1 flex gap-4">
                            {elig.plan_type && <span>Plan: {elig.plan_type}</span>}
                            {elig.copay != null && <span>Copay: ${elig.copay}</span>}
                            {elig.deductible != null && <span>Deductible: ${elig.deductible}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
