/**
 * AgentPanel — 9-agent clinical pipeline status & results.
 * Tabbed view: Pre-Visit (4 agents) | Encounter (5 agents)
 *
 * Usage: <AgentPanel encounterId={id} patientId={pid} />
 */

import React, { useState, useCallback } from 'react';
import {
  Bot, FileText, Shield, ClipboardList, DollarSign, Activity,
  CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight,
  Play, Loader2, AlertTriangle, Zap, Phone, UserCheck,
  Stethoscope, Heart
} from 'lucide-react';
import api from '../../api/client';

// All 9 agents with metadata. Measured Canon: icon tints sit on the navy/slate/
// gold/success/danger brand axis; surfaces are warm offWhite tiles.
const AGENT_META = {
  // Pre-visit
  phone_triage: { icon: Phone, label: 'Phone Triage', color: 'text-gold-600', bg: 'bg-gold-50/60', description: 'Call handling & symptom triage', group: 'pre_visit' },
  front_desk: { icon: UserCheck, label: 'Front Desk', color: 'text-slate-600', bg: 'bg-slate-50/60', description: 'Scheduling & pre-visit briefing', group: 'pre_visit' },
  ma: { icon: Stethoscope, label: 'MA', color: 'text-navy-500', bg: 'bg-navy-50/60', description: 'Refills, labs, encounter prep', group: 'pre_visit' },
  physician: { icon: Heart, label: 'Physician', color: 'text-navy-600', bg: 'bg-navy-50/60', description: 'Escalations, protocols, learning', group: 'pre_visit' },
  // Encounter
  scribe: { icon: FileText, label: 'Scribe', color: 'text-navy-500', bg: 'bg-navy-50/60', description: 'Ambient documentation', group: 'encounter' },
  cds: { icon: Shield, label: 'CDS', color: 'text-gold-600', bg: 'bg-gold-50/60', description: 'Clinical decision support', group: 'encounter' },
  orders: { icon: ClipboardList, label: 'Orders', color: 'text-success-600', bg: 'bg-success-50/60', description: 'Order management', group: 'encounter' },
  coding: { icon: DollarSign, label: 'Coding', color: 'text-slate-600', bg: 'bg-slate-50/60', description: 'E&M / ICD-10 / Billing', group: 'encounter' },
  quality: { icon: Activity, label: 'Quality', color: 'text-danger-500', bg: 'bg-danger-50/50', description: 'MIPS / HEDIS / Compliance', group: 'encounter' }
};

const PRE_VISIT_AGENTS = ['phone_triage', 'front_desk', 'ma', 'physician'];
const ENCOUNTER_AGENTS = ['scribe', 'cds', 'orders', 'coding', 'quality'];

// ==========================================
// STATUS BADGE
// ==========================================

function StatusBadge({ status }) {
  const styles = {
    idle: 'bg-ivory-200 text-slate-600 border border-slate-100',
    processing: 'bg-navy-50 text-navy-700 border border-navy-100',
    complete: 'bg-success-50 text-success-700 border border-success-100',
    error: 'bg-danger-50 text-danger-700 border border-danger-100',
    disabled: 'bg-ivory-200 text-slate-400 border border-slate-100',
    approved: 'bg-success-50 text-success-700 border border-success-100',
    escalation_required: 'bg-gold-50 text-gold-700 border border-gold-200',
    answered: 'bg-success-50 text-success-700 border border-success-100',
    scheduling_request_generated: 'bg-slate-50 text-slate-700 border border-slate-100'
  };
  const icons = {
    idle: Clock, processing: Loader2, complete: CheckCircle,
    error: AlertCircle, approved: CheckCircle,
    escalation_required: AlertTriangle, answered: CheckCircle
  };
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.idle}`}>
      {Icon && <Icon size={12} className={status === 'processing' ? 'animate-spin' : ''} />}
      {(status || 'idle').replace(/_/g, ' ')}
    </span>
  );
}

// ==========================================
// STAT HELPER
// ==========================================

function Stat({ label, value, color }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-offWhite-100 px-2 py-1.5 text-center shadow-mc">
      <div className={`font-display text-lg font-semibold leading-none tabular-nums ${color || 'text-navy-700'}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</div>
    </div>
  );
}

// ==========================================
// AGENT CARD
// ==========================================

function AgentCard({ name, agentResult, expanded, onToggle }) {
  const meta = AGENT_META[name] || { icon: Bot, label: name, color: 'text-slate-500', bg: 'bg-offWhite-100', description: '' };
  const Icon = meta.icon;
  const result = agentResult?.result || agentResult;
  const status = agentResult?.status || result?.status || 'idle';
  const timeMs = agentResult?.executionTimeMs;

  return (
    <div className={`rounded-xl border border-slate-100 shadow-mc hover:shadow-mc-lg hover:-translate-y-px transition-all duration-200 ${meta.bg} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-navy-50/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-offWhite-100 shadow-mc">
            <Icon size={16} className={meta.color} />
          </span>
          <div className="text-left">
            <div className="font-medium text-sm text-navy-700">{meta.label} Agent</div>
            <div className="text-xs text-slate-500">{meta.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {timeMs != null && <span className="text-xs text-slate-400">{timeMs}ms</span>}
          <StatusBadge status={status} />
          {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </button>
      {expanded && result && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <AgentResultDetails name={name} result={result} />
        </div>
      )}
    </div>
  );
}

// ==========================================
// RESULT DETAIL RENDERERS
// ==========================================

function AgentResultDetails({ name, result }) {
  switch (name) {
    case 'scribe': return <ScribeDetails result={result} />;
    case 'cds': return <CDSDetails result={result} />;
    case 'orders': return <OrdersDetails result={result} />;
    case 'coding': return <CodingDetails result={result} />;
    case 'quality': return <QualityDetails result={result} />;
    case 'phone_triage': return <TriageDetails result={result} />;
    case 'front_desk': return <FrontDeskDetails result={result} />;
    case 'ma': return <MADetails result={result} />;
    case 'physician': return <PhysicianDetails result={result} />;
    default: return <pre className="text-xs text-slate-500 mt-2 overflow-auto max-h-48">{JSON.stringify(result, null, 2)}</pre>;
  }
}

function ScribeDetails({ result }) {
  const stats = result.extractionStats || {};
  const comp = result.completeness || {};
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Vitals" value={stats.vitalsExtracted || 0} />
        <Stat label="Problems" value={stats.problemsExtracted || 0} />
        <Stat label="Medications" value={stats.medicationsExtracted || 0} />
        <Stat label="Lab Orders" value={stats.labOrdersExtracted || 0} />
        <Stat label="ROS Systems" value={stats.rosCategories || 0} />
        <Stat label="PE Findings" value={stats.peFindings || 0} />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 bg-ivory-300/60 rounded-full h-2">
          <div className={`h-2 rounded-full ${comp.percentage >= 80 ? 'bg-success-500' : comp.percentage >= 50 ? 'bg-gold-500' : 'bg-danger-500'}`}
            style={{ width: `${comp.percentage || 0}%` }} />
        </div>
        <span className="text-xs text-slate-500">{comp.percentage || 0}% complete</span>
      </div>
      {result.chiefComplaint && (
        <div className="text-xs text-slate-600"><span className="text-slate-400">CC:</span> {result.chiefComplaint}</div>
      )}
    </div>
  );
}

function CDSDetails({ result }) {
  const counts = result.counts || {};
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="Urgent" value={counts.urgent || 0} color={counts.urgent > 0 ? 'text-danger-500' : undefined} />
        <Stat label="Routine" value={counts.routine || 0} />
        <Stat label="Preventive" value={counts.preventive || 0} />
        <Stat label="Info" value={counts.informational || 0} />
      </div>
      {(result.suggestions || []).slice(0, 5).map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {s.category === 'urgent' ? <AlertTriangle size={12} className="text-danger-500 mt-0.5 flex-shrink-0" /> : <Zap size={12} className="text-gold-600 mt-0.5 flex-shrink-0" />}
          <div><div className="text-navy-700">{s.title}</div><div className="text-slate-400 truncate max-w-md">{s.description}</div></div>
        </div>
      ))}
    </div>
  );
}

function OrdersDetails({ result }) {
  const counts = result.counts || {};
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="Labs" value={counts.labs || 0} />
        <Stat label="Imaging" value={counts.imaging || 0} />
        <Stat label="Referrals" value={counts.referrals || 0} />
        <Stat label="Rx" value={counts.prescriptions || 0} />
      </div>
      {(result.warnings || []).length > 0 && (
        <div className="space-y-1">
          {result.warnings.slice(0, 3).map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gold-700">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodingDetails({ result }) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className="font-display text-2xl font-semibold leading-none tabular-nums text-navy-700">{result.emLevel || '—'}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">E&amp;M Level</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className="font-display text-lg font-semibold leading-none tabular-nums text-navy-700">{result.cptCode || '—'}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">CPT Code</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className="font-display text-lg font-semibold leading-none tabular-nums text-navy-700">{(result.icd10Codes || []).length}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">ICD-10</div>
        </div>
      </div>
      {(result.hccFlags || []).length > 0 && (
        <div className="text-gold-700"><span className="font-medium">HCC Codes:</span> {result.hccFlags.map(h => `${h.code} (HCC ${h.hccCategory})`).join(', ')}</div>
      )}
    </div>
  );
}

function QualityDetails({ result }) {
  const dashboard = result.dashboard || {};
  const qualityScore = result.qualityScore || {};
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${qualityScore.score >= 75 ? 'text-success-600' : qualityScore.score >= 50 ? 'text-gold-600' : 'text-danger-500'}`}>
            {qualityScore.score || 0}%
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Quality Score</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className="font-display text-lg font-semibold leading-none tabular-nums text-danger-500">{dashboard.openCareGaps || 0}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Care Gaps</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
          <div className="font-display text-lg font-semibold leading-none tabular-nums text-danger-500">{dashboard.measuresAtGoal || '—'}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Measures Met</div>
        </div>
      </div>
      {(result.gaps || []).slice(0, 4).map((g, i) => (
        <div key={i} className="flex items-start gap-2">
          <AlertCircle size={12} className="text-danger-500 mt-0.5 flex-shrink-0" />
          <div><div className="text-navy-700">{g.measureName}</div><div className="text-slate-400">{g.suggestedAction}</div></div>
        </div>
      ))}
    </div>
  );
}

// ==========================================
// PRE-VISIT AGENT DETAIL RENDERERS
// ==========================================

function TriageDetails({ result }) {
  const assessment = result.assessment || result;
  return (
    <div className="mt-3 space-y-2 text-xs">
      {assessment.urgency && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
            <div className={`font-display text-lg font-semibold leading-none ${
              assessment.urgency === 'emergency' ? 'text-danger-500' :
              assessment.urgency === 'urgent' ? 'text-gold-600' :
              'text-success-600'
            }`}>{(assessment.urgency || '').toUpperCase()}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Urgency</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-offWhite-100 p-2.5 text-center shadow-mc">
            <div className="font-display text-lg font-semibold leading-none text-gold-700">{assessment.disposition || assessment.routing || '—'}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Routing</div>
          </div>
        </div>
      )}
      {assessment.symptoms && (
        <div className="text-slate-600"><span className="text-slate-400">Symptoms:</span> {
          Array.isArray(assessment.symptoms) ? assessment.symptoms.join(', ') : assessment.symptoms
        }</div>
      )}
      {result.message && <div className="text-slate-500 italic">{result.message}</div>}
    </div>
  );
}

function FrontDeskDetails({ result }) {
  const briefing = result.briefing;
  if (briefing) {
    const sections = briefing.sections || briefing;
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Problems" value={sections.activeProblemsSynopsis?.length || sections.problems?.length || 0} />
          <Stat label="Medications" value={sections.currentMedications?.length || 0} />
          <Stat label="Allergies" value={sections.allergies?.length || 0} />
        </div>
        {sections.visitReason && (
          <div className="text-slate-600"><span className="text-slate-400">Visit:</span> {sections.visitReason}</div>
        )}
        {briefing.briefingDocument && (
          <div className="mt-2 bg-ivory-200/70 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap text-slate-600 font-mono text-[11px] leading-relaxed">
            {briefing.briefingDocument.substring(0, 2000)}{briefing.briefingDocument.length > 2000 ? '\n...' : ''}
          </div>
        )}
        {result.message && <div className="text-slate-500 italic">{result.message}</div>}
      </div>
    );
  }
  // Scheduling or other front desk result
  return (
    <div className="mt-3 space-y-2 text-xs">
      {result.slots && (
        <div className="space-y-1">
          {result.slots.slice(0, 5).map((s, i) => (
            <div key={i} className="bg-ivory-200/70 rounded px-3 py-2 flex justify-between">
              <span className="text-navy-700">{s.date} {s.time}</span>
              <span className="text-slate-600">{s.provider || ''}</span>
            </div>
          ))}
        </div>
      )}
      {result.message && <div className="text-slate-500 italic">{result.message}</div>}
    </div>
  );
}

function MADetails({ result }) {
  // Refill result
  if (result.decision) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className={`bg-ivory-200/70 rounded p-3 ${
          result.decision.includes('approved') ? 'border-l-4 border-success-500' :
          result.decision.includes('escalation') || result.escalation_required ? 'border-l-4 border-gold-400' :
          'border-l-4 border-slate-200'
        }`}>
          <div className="font-medium text-navy-700">{result.medication || result.question || 'Result'}</div>
          <div className="text-slate-500 mt-1">{result.instructions || result.response || result.message || result.ma_assessment}</div>
          {result.escalation_required && (
            <div className="mt-2 flex items-center gap-1 text-gold-700">
              <AlertTriangle size={12} /> Escalation to Physician Agent
            </div>
          )}
        </div>
      </div>
    );
  }
  // Pre-visit labs or encounter prep
  if (result.proposed_labs) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="text-navy-700 font-medium">{result.count} Pre-Visit Labs Proposed</div>
        {result.proposed_labs.map((lab, i) => (
          <div key={i} className="bg-ivory-200/70 rounded px-3 py-2 flex justify-between items-center">
            <div>
              <div className="text-navy-700">{lab.test_name}</div>
              <div className="text-slate-400">{lab.indication}</div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] ${lab.priority === 'stat' ? 'bg-danger-100 text-danger-600' : 'bg-ivory-300/60 text-slate-600'}`}>
              {lab.priority}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (result.vitals_checklist) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="text-navy-700 font-medium">Encounter Prep</div>
        <div className="grid grid-cols-2 gap-1">
          {result.vitals_checklist.map((v, i) => (
            <div key={i} className="bg-ivory-200/70 rounded px-2 py-1 text-slate-600">{v.vital}</div>
          ))}
        </div>
        {(result.questionnaires || []).map((q, i) => (
          <div key={i} className="bg-ivory-200/70 rounded px-3 py-2">
            <div className="text-navy-700">{q.name}</div>
            <div className="text-slate-400">{q.topics?.join(', ')}</div>
          </div>
        ))}
        {(result.alerts || []).map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-gold-700">
            <AlertTriangle size={12} /> {a.message}
          </div>
        ))}
      </div>
    );
  }
  return <div className="mt-3 text-xs text-slate-500 italic">{result.message || 'MA Agent ready'}</div>;
}

function PhysicianDetails({ result }) {
  if (result.decision) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="bg-ivory-200/70 rounded p-3 border-l-4 border-navy-500">
          <div className="font-medium text-navy-700">Decision: {result.decision.replace(/_/g, ' ')}</div>
          {result.instructions && <div className="text-slate-500 mt-1">{result.instructions}</div>}
          {result.to_agent && <div className="text-navy-600 mt-1">Directive sent to: {result.to_agent}</div>}
        </div>
      </div>
    );
  }
  if (result.edited_note) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Original" value={`${result.original_length} chars`} />
          <Stat label="Edited" value={`${result.edited_length} chars`} />
        </div>
        {result.validations && (
          <div className={`flex items-center gap-2 ${result.validations.complete ? 'text-success-600' : 'text-gold-700'}`}>
            {result.validations.complete ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
            {result.validations.complete ? 'Note complete — ready to sign' : `Missing: ${result.validations.missing_sections?.join(', ')}`}
          </div>
        )}
      </div>
    );
  }
  if (result.queues) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="text-navy-700 font-medium">Post-Visit Queues</div>
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Rx" value={result.queues.prescriptions || 0} />
          <Stat label="Labs" value={result.queues.lab_orders || 0} />
          <Stat label="Imaging" value={result.queues.imaging_orders || 0} />
          <Stat label="Referrals" value={result.queues.referral_letters || 0} />
        </div>
      </div>
    );
  }
  return <div className="mt-3 text-xs text-slate-500 italic">{result.message || 'Physician Agent ready'}</div>;
}

// ==========================================
// MAIN PANEL
// ==========================================

export default function AgentPanel({ encounterId, patientId }) {
  const [activeTab, setActiveTab] = useState('encounter');
  const [pipelineResult, setPipelineResult] = useState(null);
  const [preVisitResults, setPreVisitResults] = useState({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [expandedAgents, setExpandedAgents] = useState(new Set());
  const [totalTime, setTotalTime] = useState(null);

  const toggleAgent = useCallback((name) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // Run encounter pipeline (5 agents)
  const runEncounterPipeline = useCallback(async () => {
    if (!encounterId || !patientId) return;
    setRunning(true);
    setError(null);
    try {
      const data = await api.runAgentPipeline({ encounter_id: encounterId, patient_id: patientId });
      setPipelineResult(data.results || {});
      setTotalTime(data.totalTimeMs);
      setExpandedAgents(new Set(Object.keys(data.results || {})));
    } catch (err) { setError(err.message); }
    finally { setRunning(false); }
  }, [encounterId, patientId]);

  // Run pre-visit briefing
  const runPreVisitBriefing = useCallback(async () => {
    if (!patientId) return;
    setRunning(true);
    setError(null);
    try {
      const data = await api.getAgentBriefing(patientId, encounterId);
      setPreVisitResults(prev => ({ ...prev, front_desk: data }));
      setExpandedAgents(prev => new Set([...prev, 'front_desk']));
    } catch (err) { setError(err.message); }
    finally { setRunning(false); }
  }, [patientId, encounterId]);

  // Run MA pre-visit labs
  const runPreVisitLabs = useCallback(async () => {
    if (!patientId) return;
    setRunning(true);
    setError(null);
    try {
      const data = await api.runMAAgent({ patient_id: patientId, encounter_id: encounterId, request_type: 'pre_visit_labs' });
      setPreVisitResults(prev => ({ ...prev, ma: data }));
      setExpandedAgents(prev => new Set([...prev, 'ma']));
    } catch (err) { setError(err.message); }
    finally { setRunning(false); }
  }, [patientId, encounterId]);

  const agents = activeTab === 'encounter' ? ENCOUNTER_AGENTS : PRE_VISIT_AGENTS;
  const results = activeTab === 'encounter' ? pipelineResult : preVisitResults;

  return (
    <div className="mc-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-offWhite-100 to-navy-50/50">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-navy-50 text-navy-600 shadow-mc">
            <Bot size={18} />
          </span>
          <div>
            <h3 className="font-display text-sm font-semibold tracking-tight text-navy-700">AI Clinical Agents</h3>
            <p className="text-xs text-slate-400">9-agent intelligent pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {totalTime != null && activeTab === 'encounter' && (
            <span className="text-xs text-slate-400">{totalTime}ms</span>
          )}
          {activeTab === 'encounter' ? (
            <button onClick={runEncounterPipeline} disabled={running || !encounterId || !patientId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-mc ${running ? 'bg-navy-100 text-navy-600 cursor-wait' : 'bg-navy-600 hover:bg-navy-700 text-white'} disabled:opacity-40 disabled:cursor-not-allowed`}>
              {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run Pipeline</>}
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={runPreVisitBriefing} disabled={running || !patientId}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-navy-600 hover:bg-navy-700 text-white shadow-mc disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <UserCheck size={12} /> Briefing
              </button>
              <button onClick={runPreVisitLabs} disabled={running || !patientId}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-600 hover:bg-slate-700 text-white shadow-mc disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <Stethoscope size={12} /> Pre-Visit Labs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        <button onClick={() => setActiveTab('pre_visit')}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${activeTab === 'pre_visit' ? 'text-navy-700 border-b-2 border-gold-400 bg-navy-50/40' : 'text-slate-400 hover:text-navy-700'}`}>
          Pre-Visit (4 agents)
        </button>
        <button onClick={() => setActiveTab('encounter')}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${activeTab === 'encounter' ? 'text-navy-700 border-b-2 border-gold-400 bg-navy-50/40' : 'text-slate-400 hover:text-navy-700'}`}>
          Encounter (5 agents)
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-danger-50 border border-danger-200 rounded-lg text-sm text-danger-600 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Agent Cards — orchestrated staggered reveal as the pipeline tab mounts */}
      <div className="p-4 space-y-2 mc-reveal-stagger">
        {agents.map(name => (
          <AgentCard key={name} name={name} agentResult={results?.[name]} expanded={expandedAgents.has(name)} onToggle={() => toggleAgent(name)} />
        ))}
      </div>

      {/* No results message */}
      {!results && !running && !error && (
        <div className="px-4 pb-4 text-center text-slate-400 text-sm">
          {activeTab === 'encounter' ? 'Click "Run Pipeline" to analyze this encounter' : 'Run pre-visit actions above'}
        </div>
      )}
    </div>
  );
}
