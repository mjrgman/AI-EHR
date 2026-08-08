import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Mic, MicOff, X, Send, Stethoscope, ClipboardCheck, CheckCircle2, AlertTriangle, PhoneCall, RefreshCw } from 'lucide-react';
import api, { safeLog } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useToast } from '../components/common/Toast';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import TouchButton from '../components/common/TouchButton';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';

// EMERGENCY BYPASS: ESI 1-2 are emergent (AHRQ Emergency Severity Index v4 —
// level 1 = immediate life-saving intervention; level 2 = high-risk, cannot
// wait). These bypass the routine 4-option deliberative tree: a single
// one-click "Call 911 / Send to ED now" headline action. Keys MUST match
// server/triage-service.js EMERGENCY_911_KEY / EMERGENCY_ED_TRANSFER_KEY.
const EMERGENCY_911_KEY = 'emergency_911';
const EMERGENCY_ED_TRANSFER_KEY = 'emergency_ed_transfer';

// ESI 1-5 acuity badge styling (AHRQ Emergency Severity Index). Lower = sicker.
function esiBadgeVariant(esi) {
  if (esi == null) return 'neutral';
  if (esi <= 2) return 'danger';
  if (esi === 3) return 'warning';
  return 'success';
}

function PatientLine({ patient }) {
  const name = [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || 'Patient';
  return (
    <div className="min-w-0">
      <p className="font-display text-base font-semibold tracking-tight text-navy-700 truncate">{name}</p>
      <p className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
        {patient?.mrn && <span>MRN: {patient.mrn}</span>}
        {patient?.age != null && <span>{patient.age}y</span>}
        {patient?.sex && <span>{patient.sex}</span>}
      </p>
    </div>
  );
}

// One pending/decided decision card: triage chip, mid-tier summary paragraph,
// four one-click option TouchButtons, and a fifth dictate-a-custom-decision
// affordance backed by the shared speech-recognition hook.
function DecisionCard({ item, onDecide, deciding }) {
  const speech = useSpeechRecognition();
  const [dictating, setDictating] = useState(false);
  const [dictateText, setDictateText] = useState('');

  // Pull finalized speech into the editable dictation textarea.
  useEffect(() => {
    if (speech.transcript) setDictateText(speech.transcript);
  }, [speech.transcript]);

  const decided = item.status === 'decided';
  // EMERGENCY BYPASS: ESI 1-2 cards render with unmistakable critical (red)
  // treatment and SUPPRESS the routine 4-option deliberative tree.
  const isEmergency = !!item.is_emergency;
  const esi = item.triage?.esi_level;
  const levelOfCare = item.triage?.level_of_care || 'Pending';

  return (
    <Card className={`relative${isEmergency ? ' border-danger-300 ring-2 ring-danger-200 bg-red-50/40' : ''}`}>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] bg-gradient-to-r ${
          isEmergency
            ? 'from-danger-500/0 via-danger-500 to-danger-500/0'
            : 'from-gold-500/0 via-gold-500/70 to-gold-500/0'
        }`}
      />
      <CardHeader>
        <div className="flex items-start justify-between w-full gap-3">
          <PatientLine patient={item.patient} />
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isEmergency ? (
              <Badge variant="danger" className="font-bold uppercase tracking-wide">
                <AlertTriangle size={12} aria-hidden="true" /> EMERGENT · ESI {esi ?? '?'} · {levelOfCare}
              </Badge>
            ) : (
              <Badge variant={esiBadgeVariant(esi)}>
                ESI {esi ?? '?'} · {levelOfCare}
              </Badge>
            )}
            {decided && (
              <Badge variant={isEmergency ? 'danger' : 'success'} dot>
                {isEmergency ? '911 / ED' : 'Decided'}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <p className="mc-section-label">Chief Complaint</p>
          <p className="text-sm text-navy-700">{item.chief_complaint || '—'}</p>
        </div>

        {/* Mid-tier (haiku) one-paragraph summary, with visible model provenance. */}
        <div className="rounded-lg border border-slate-200 bg-ivory-200/60 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="mc-section-label flex items-center gap-1.5">
              <Sparkles size={13} className="text-navy-500" aria-hidden="true" /> AI Summary
            </p>
            {item.summary_model && (
              <span className="text-[10px] font-mono text-slate-400" title="Mid-tier model">{item.summary_model}</span>
            )}
          </div>
          <p className="text-sm leading-6 text-navy-700">{item.summary || 'Summary pending…'}</p>
        </div>

        {/* Triage rationale (top-tier). */}
        {item.triage?.rationale && (
          <div className="rounded-lg border border-slate-200 bg-offWhite-100 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="mc-section-label">Triage Rationale</p>
              {item.triage?.model && (
                <span className="text-[10px] font-mono text-slate-400" title="Top-tier model">{item.triage.model}</span>
              )}
            </div>
            <p className="text-xs leading-5 text-slate-600">{item.triage.rationale}</p>
          </div>
        )}

        {decided ? (
          <div className={`rounded-lg border p-3 ${isEmergency ? 'border-danger-200 bg-red-50' : 'border-success-200 bg-success-50'}`}>
            <p className={`mc-section-label ${isEmergency ? 'text-danger-700' : 'text-success-700'}`}>
              {isEmergency ? 'Emergency Escalation Recorded' : 'Decision Recorded'}
            </p>
            <p className={`text-sm font-medium ${isEmergency ? 'text-danger-800' : 'text-success-800'}`}>
              {item.decision?.text || item.decision?.label}
            </p>
            <p className={`text-xs mt-1 ${isEmergency ? 'text-danger-700' : 'text-success-700'}`}>
              {isEmergency
                ? `Routed for immediate handling — MA to confirm 911/ED handoff · ${item.decision?.decided_by}`
                : `Routed to medical assistant for close-out · ${item.decision?.decided_by}`}
            </p>
          </div>
        ) : isEmergency ? (
          /* EMERGENCY BYPASS: the routine 4-option grid is SUPPRESSED. A single
             one-click "Call 911 / Send to ED now" headline action, plus an
             optional ED-transfer fallback and a dictate-handoff-note field. */
          <div className="space-y-3">
            <div className="rounded-lg border border-danger-200 bg-red-50 p-3">
              <p className="mc-section-label text-danger-700 flex items-center gap-1.5">
                <AlertTriangle size={13} aria-hidden="true" /> Immediate action required
              </p>
              <p className="text-xs leading-5 text-danger-700/90 mt-0.5">
                This is an emergent (ESI {esi ?? '1-2'}) presentation. Routine deliberation is bypassed — escalate now.
              </p>
            </div>

            <TouchButton
              variant="danger"
              size="lg"
              icon={<PhoneCall size={20} />}
              disabled={deciding}
              onClick={() => onDecide(item.id, { decision_key: EMERGENCY_911_KEY })}
              className="w-full !font-bold"
            >
              Call 911 / Send to ED now
            </TouchButton>

            <TouchButton
              variant="secondary"
              size="sm"
              disabled={deciding}
              onClick={() => onDecide(item.id, { decision_key: EMERGENCY_ED_TRANSFER_KEY })}
              className="w-full"
            >
              Direct ED transfer / rapid response
            </TouchButton>

            {/* Optional: dictate a handoff note alongside the escalation. */}
            <div className="rounded-xl border border-slate-200 bg-offWhite-100 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="mc-section-label text-slate-600">Optional handoff note</p>
                {!dictating ? (
                  <TouchButton
                    variant="ghost"
                    size="sm"
                    icon={<Mic size={15} />}
                    onClick={() => { setDictating(true); if (speech.isSupported) speech.startListening(); }}
                  >
                    Dictate
                  </TouchButton>
                ) : (
                  <div className="flex gap-2">
                    {speech.isSupported && (
                      <TouchButton
                        variant={speech.isListening ? 'danger' : 'secondary'}
                        size="sm"
                        icon={speech.isListening ? <MicOff size={15} /> : <Mic size={15} />}
                        onClick={speech.isListening ? speech.stopListening : speech.startListening}
                      >
                        {speech.isListening ? 'Stop' : 'Listen'}
                      </TouchButton>
                    )}
                    <TouchButton
                      variant="ghost"
                      size="sm"
                      icon={<X size={15} />}
                      onClick={() => {
                        setDictating(false);
                        setDictateText('');
                        speech.resetTranscript();
                        if (speech.isListening) speech.stopListening();
                      }}
                    >
                      Cancel
                    </TouchButton>
                  </div>
                )}
              </div>
              {dictating && (
                <textarea
                  value={dictateText + (speech.interimTranscript ? ` ${speech.interimTranscript}` : '')}
                  onChange={(e) => setDictateText(e.target.value)}
                  placeholder="Handoff note to accompany the 911/ED escalation…"
                  className="textarea-clinical w-full min-h-[60px]"
                  rows={2}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="mc-section-label">Decision Tree — one click to resolve</p>
              {item.decision_model && (
                <span className="text-[10px] font-mono text-slate-400" title="Top-tier model">{item.decision_model}</span>
              )}
            </div>

            {/* Four (or more) one-click option buttons. */}
            <div className="grid grid-cols-1 gap-2">
              {(item.options || []).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={deciding}
                  onClick={() => onDecide(item.id, { decision_key: opt.key })}
                  className="text-left rounded-xl border border-slate-200 bg-offWhite-100 p-3 transition-all duration-150 hover:border-navy-300 hover:bg-navy-50 hover:shadow-mc active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                >
                  <p className="text-sm font-semibold text-navy-700">{opt.label}</p>
                  {opt.detail && <p className="text-xs text-slate-600 mt-0.5 leading-5">{opt.detail}</p>}
                  <span className="mt-1 inline-block text-[10px] uppercase tracking-[0.12em] text-slate-400">{opt.action}</span>
                </button>
              ))}
            </div>

            {/* Fifth option: dictate a custom decision (speech + free text). */}
            <div className="rounded-xl border border-gold-200 bg-gold-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="mc-section-label text-gold-800">Or dictate a custom decision</p>
                {!dictating ? (
                  <TouchButton
                    variant="ghost"
                    size="sm"
                    icon={<Mic size={15} />}
                    onClick={() => { setDictating(true); if (speech.isSupported) speech.startListening(); }}
                  >
                    Dictate
                  </TouchButton>
                ) : (
                  <div className="flex gap-2">
                    {speech.isSupported && (
                      <TouchButton
                        variant={speech.isListening ? 'danger' : 'secondary'}
                        size="sm"
                        icon={speech.isListening ? <MicOff size={15} /> : <Mic size={15} />}
                        onClick={speech.isListening ? speech.stopListening : speech.startListening}
                      >
                        {speech.isListening ? 'Stop' : 'Listen'}
                      </TouchButton>
                    )}
                    <TouchButton
                      variant="ghost"
                      size="sm"
                      icon={<X size={15} />}
                      onClick={() => {
                        setDictating(false);
                        setDictateText('');
                        speech.resetTranscript();
                        if (speech.isListening) speech.stopListening();
                      }}
                    >
                      Cancel
                    </TouchButton>
                  </div>
                )}
              </div>

              {dictating && (
                <>
                  <textarea
                    value={dictateText + (speech.interimTranscript ? ` ${speech.interimTranscript}` : '')}
                    onChange={(e) => setDictateText(e.target.value)}
                    placeholder="Type or dictate the custom disposition…"
                    className="textarea-clinical w-full min-h-[60px]"
                    rows={2}
                  />
                  <TouchButton
                    variant="primary"
                    size="sm"
                    icon={<Send size={15} />}
                    disabled={deciding || !dictateText.trim()}
                    onClick={() => onDecide(item.id, { decision_text: dictateText.trim() })}
                  >
                    Submit Dictated Decision
                  </TouchButton>
                </>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function DecisionQueuePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { currentRole } = useAuth();

  const isProvider = currentRole === 'provider';
  const isMA = currentRole === 'ma';

  const [items, setItems] = useState([]);
  const [closeouts, setCloseouts] = useState([]);
  const [emergencyCount, setEmergencyCount] = useState(0);
  const [mode, setMode] = useState('mock');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [closing, setClosing] = useState(null);

  const load = useCallback(async () => {
    try {
      // Providers see the full queue; everyone with access sees MA close-outs.
      const tasks = [];
      if (isProvider) tasks.push(api.getDecisions());
      else tasks.push(Promise.resolve(null));
      tasks.push(api.getMaCloseouts());

      const [queue, closeoutData] = await Promise.all(tasks);
      if (queue) {
        setItems(queue.items || []);
        setMode(queue.mode || 'mock');
        // EMERGENCY BYPASS: prefer the server-computed count; fall back to a
        // client-side count of is_emergency items so the banner is robust.
        setEmergencyCount(
          typeof queue.emergency_count === 'number'
            ? queue.emergency_count
            : (queue.items || []).filter(i => i.is_emergency).length
        );
      }
      if (closeoutData) setCloseouts(closeoutData.items || []);
      setLoadError(null);
    } catch (err) {
      safeLog.error('Decision queue error:', err);
      setLoadError(err?.message || 'The decision queue could not be loaded.');
      toast.error('Failed to load the decision queue');
    } finally {
      setLoading(false);
    }
  }, [isProvider, toast]);

  useEffect(() => {
    load();
    const intervalId = setInterval(load, 10000);
    return () => clearInterval(intervalId);
  }, [load]);

  async function handleDecide(id, payload) {
    setDeciding(true);
    try {
      await api.decideDecision(id, payload);
      toast.success('Decision recorded and routed to the medical assistant');
      await load();
    } catch (err) {
      safeLog.error('Decision queue error:', err);
      toast.error('Failed to record decision: ' + err.message);
    } finally {
      setDeciding(false);
    }
  }

  async function handleClose(id) {
    setClosing(id);
    try {
      await api.closeDecision(id);
      toast.success('Decision closed out');
      await load();
    } catch (err) {
      safeLog.error('Decision queue error:', err);
      toast.error('Failed to close decision: ' + err.message);
    } finally {
      setClosing(null);
    }
  }

  if (loading) return <LoadingSpinner message="Loading decision queue..." />;

  if (loadError) return (
    <div className="mc-page max-w-4xl">
      <Card className="border-danger-200 bg-danger-50" role="alert">
        <CardBody className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-danger-600" size={22} aria-hidden="true" />
          <div>
            <h1 className="font-display text-lg font-semibold text-danger-800">Decision queue unavailable</h1>
            <p className="mt-1 text-sm text-danger-700">{loadError} This is a load failure, not an empty queue.</p>
            <TouchButton className="mt-4" variant="danger" size="sm" icon={<RefreshCw size={15} />} onClick={load}>
              Retry
            </TouchButton>
          </div>
        </CardBody>
      </Card>
    </div>
  );

  const pendingCount = items.filter(i => i.status === 'pending').length;

  return (
    <div className="pb-24">
      <div className="bg-offWhite-100 border-b border-slate-100 px-4 py-2">
        <TouchButton variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/')}>
          Dashboard
        </TouchButton>
      </div>

      {/* EMERGENCY BYPASS banner — visible before scrolling whenever any emergent
          (ESI 1-2) patient is in the queue. Routine deliberation is bypassed for
          these; they are pinned to the top with a one-click 911/ED action. */}
      {isProvider && emergencyCount > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2.5 bg-danger-600 text-white px-4 py-3 shadow-md"
        >
          <AlertTriangle size={20} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
          <p className="text-sm font-bold tracking-tight">
            ⚠ {emergencyCount} emergent patient{emergencyCount === 1 ? '' : 's'} — immediate action required
          </p>
        </div>
      )}

      <div className="mc-page mc-reveal-stagger space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <header className="relative">
          <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
          <p className="mc-section-label">AI Triage · {mode === 'api' ? 'Claude API' : 'Deterministic (offline)'}</p>
          <h1 className="mc-page-title flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <Stethoscope size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            Decision Queue
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Patients triaged by acuity (AHRQ Emergency Severity Index). Resolve each with one click or a dictated decision.
          </p>
        </header>

        {/* Provider decision queue */}
        {isProvider && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm font-semibold tracking-tight text-navy-700">Awaiting Decision</h2>
              <Badge variant={pendingCount > 0 ? 'warning' : 'neutral'}>{pendingCount} pending</Badge>
            </div>
            {items.length === 0 ? (
              <Card><CardBody><p className="text-sm text-slate-400 italic">No patients in the decision queue.</p></CardBody></Card>
            ) : (
              items.map((item) => (
                <DecisionCard key={item.id} item={item} onDecide={handleDecide} deciding={deciding} />
              ))
            )}
          </section>
        )}

        {/* Medical-assistant close-out list (visible to MA + provider). */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-navy-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold tracking-tight text-navy-700">
              Medical Assistant Close-Out
            </h2>
            <Badge variant={closeouts.length > 0 ? 'primary' : 'neutral'}>{closeouts.length} awaiting</Badge>
          </div>
          {closeouts.length === 0 ? (
            <Card><CardBody><p className="text-sm text-slate-400 italic">No decided items awaiting close-out.</p></CardBody></Card>
          ) : (
            // EMERGENCY BYPASS: pin emergency escalations first, styled critically.
            [...closeouts]
              .sort((a, b) => (b.is_emergency ? 1 : 0) - (a.is_emergency ? 1 : 0))
              .map((item) => {
                const itemEmergency = !!item.is_emergency;
                return (
                  <Card
                    key={item.id}
                    className={itemEmergency ? 'border-danger-300 ring-2 ring-danger-200 bg-red-50/40' : ''}
                  >
                    <CardBody className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {itemEmergency && (
                          <Badge variant="danger" className="font-bold uppercase tracking-wide mb-1">
                            <AlertTriangle size={12} aria-hidden="true" /> EMERGENCY — confirm 911/ED handoff
                          </Badge>
                        )}
                        <PatientLine patient={item.patient} />
                        <p className="text-sm text-navy-700 mt-2">
                          <span className="font-semibold">{itemEmergency ? 'Escalation:' : 'Decision:'}</span> {item.decision?.text || item.decision?.label}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          ESI {item.triage?.esi_level ?? '?'} · {item.triage?.level_of_care} · by {item.decision?.decided_by}
                        </p>
                      </div>
                      <TouchButton
                        variant={itemEmergency ? 'danger' : 'success'}
                        size="sm"
                        icon={<CheckCircle2 size={16} />}
                        loading={closing === item.id}
                        disabled={closing !== null}
                        onClick={() => handleClose(item.id)}
                      >
                        {itemEmergency ? 'Confirm Handoff' : 'Close Out'}
                      </TouchButton>
                    </CardBody>
                  </Card>
                );
              })
          )}
        </section>

        {!isProvider && !isMA && (
          <Card><CardBody><p className="text-sm text-slate-500">Your role does not have decision-queue actions.</p></CardBody></Card>
        )}
      </div>
    </div>
  );
}
