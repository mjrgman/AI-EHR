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
  Stethoscope, Heart, User
} from 'lucide-react';

const API_BASE = '/api';

// All 9 agents with metadata
const AGENT_META = {
  // Pre-visit
  phone_triage: { icon: Phone, label: 'Phone Triage', color: 'text-orange-400', bg: 'bg-orange-900/30', description: 'Call handling & symptom triage', group: 'pre_visit' },
  front_desk: { icon: UserCheck, label: 'Front Desk', color: 'text-teal-400', bg: 'bg-teal-900/30', description: 'Scheduling & pre-visit briefing', group: 'pre_visit' },
  ma: { icon: Stethoscope, label: 'MA', color: 'text-pink-400', bg: 'bg-pink-900/30', description: 'Refills, labs, encounter prep', group: 'pre_visit' },
  physician: { icon: Heart, label: 'Physician', color: 'text-indigo-400', bg: 'bg-indigo-900/30', description: 'Escalations, protocols, learning', group: 'pre_visit' },
  // Encounter
  scribe: { icon: FileText, label: 'Scribe', color: 'text-blue-400', bg: 'bg-blue-900/30', description: 'Ambient documentation', group: 'encounter' },
  cds: { icon: Shield, label: 'CDS', color: 'text-amber-400', bg: 'bg-amber-900/30', description: 'Clinical decision support', group: 'encounter' },
  orders: { icon: ClipboardList, label: 'Orders', color: 'text-green-400', bg: 'bg-green-900/30', description: 'Order management', group: 'encounter' },
  coding: { icon: DollarSign, label: 'Coding', color: 'text-purple-400', bg: 'bg-purple-900/30', description: 'E&M / ICD-10 / Billing', group: 'encounter' },
  quality: { icon: Activity, label: 'Quality', color: 'text-rose-400', bg: 'bg-rose-900/30', description: 'MIPS / HEDIS / Compliance', group: 'encounter' }
};

const PRE_VISIT_AGENTS = ['phone_triage', 'front_desk', 'ma', 'physician'];
const ENCOUNTER_AGENTS = ['scribe', 'cds', 'orders', 'coding', 'quality'];

// ==========================================
// STATUS BADGE
// ==========================================

function StatusBadge({ status }) {
  const styles = {
    idle: 'bg-gray-700 text-gray-300',
    processing: 'bg-blue-700 text-blue-200',
    complete: 'bg-green-800 text-green-200',
    error: 'bg-red-800 text-red-200',
    disabled: 'bg-gray-800 text-gray-500',
    approved: 'bg-green-800 text-green-200',
    escalation_required: 'bg-amber-800 text-amber-200',
    answered: 'bg-green-800 text-green-200',
    scheduling_request_generated: 'bg-teal-800 text-teal-200'
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
    <div className="bg-gray-800 rounded px-2 py-1 text-center">
      <div className={`font-bold ${color || 'text-gray-200'}`}>{value}</div>
      <div className="text-gray-500 text-[10px]">{label}</div>
    </div>
  );
}

// ==========================================
// AGENT CARD
// ==========================================

function AgentCard({ name, agentResult, expanded, onToggle }) {
  const meta = AGENT_META[name] || { icon: Bot, label: name, color: 'text-gray-400', bg: 'bg-gray-900/30', description: '' };
  const Icon = meta.icon;
  const result = agentResult?.result || agentResult;
  const status = agentResult?.status || result?.status || 'idle';
  const timeMs = agentResult?.executionTimeMs;

  return (
    <div className={`rounded-lg border border-gray-700 ${meta.bg} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon size={18} className={meta.color} />
          <div className="text-left">
            <div className="font-medium text-sm text-gray-100">{meta.label} Agent</div>
            <div className="text-xs text-gray-400">{meta.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {timeMs != null && <span className="text-xs text-gray-500">{timeMs}ms</span>}
          <StatusBadge status={status} />
          {expanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        </div>
      </button>
      {expanded && result && (
        <div className="px-4 pb-4 border-t border-gray-700/50">
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
    default: return <pre className="text-xs text-gray-400 mt-2 overflow-auto max-h-48">{JSON.stringify(result, null, 2)}</pre>;
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
        <div className="flex-1 bg-gray-700 rounded-full h-2">
          <div className={`h-2 rounded-full ${comp.percentage >= 80 ? 'bg-green-500' : comp.percentage >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${comp.percentage || 0}%` }} />
        </div>
        <span className="text-xs text-gray-400">{comp.percentage || 0}% complete</span>
      </div>
      {result.chiefComplaint && (
        <div className="text-xs text-gray-300"><span className="text-gray-500">CC:</span> {result.chiefComplaint}</div>
      )}
    </div>
  );
}

function CDSDetails({ result }) {
  const counts = result.counts || {};
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="Urgent" value={counts.urgent || 0} color={counts.urgent > 0 ? 'text-red-400' : undefined} />
        <Stat label="Routine" value={counts.routine || 0} />
        <Stat label="Preventive" value={counts.preventive || 0} />
        <Stat label="Info" value={counts.informational || 0} />
      </div>
      {(result.suggestions || []).slice(0, 5).map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {s.category === 'urgent' ? <AlertTriangle size={12} className="text-red-400 mt-0.5 flex-shrink-0" /> : <Zap size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />}
          <div><div className="text-gray-200">{s.title}</div><div className="text-gray-500 truncate max-w-md">{s.description}</div></div>
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
            <div key={i} className="flex items-start gap-2 text-xs text-amber-300">
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
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className="text-2xl font-bold text-purple-300">{result.emLevel || '—'}</div>
          <div className="text-gray-400">E&M Level</div>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-purple-300">{result.cptCode || '—'}</div>
          <div className="text-gray-400">CPT Code</div>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-purple-300">{(result.icd10Codes || []).length}</div>
          <div className="text-gray-400">ICD-10</div>
        </div>
      </div>
      {(result.hccFlags || []).length > 0 && (
        <div className="text-amber-300"><span className="font-medium">HCC Codes:</span> {result.hccFlags.map(h => `${h.code} (HCC ${h.hccCategory})`).join(', ')}</div>
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
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className={`text-2xl font-bold ${qualityScore.score >= 75 ? 'text-green-400' : qualityScore.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {qualityScore.score || 0}%
          </div>
          <div className="text-gray-400">Quality Score</div>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-rose-300">{dashboard.openCareGaps || 0}</div>
          <div className="text-gray-400">Care Gaps</div>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-rose-300">{dashboard.measuresAtGoal || '—'}</div>
          <div className="text-gray-400">Measures Met</div>
        </div>
      </div>
      {(result.gaps || []).slice(0, 4).map((g, i) => (
        <div key={i} className="flex items-start gap-2">
          <AlertCircle size={12} className="text-rose-400 mt-0.5 flex-shrink-0" />
          <div><div className="text-gray-200">{g.measureName}</div><div className="text-gray-500">{g.suggestedAction}</div></div>
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
          <div className={`bg-gray-800 rounded p-2 text-center`}>
            <div className={`text-lg font-bold ${
              assessment.urgency === 'emergency' ? 'text-red-400' :
              assessment.urgency === 'urgent' ? 'text-amber-400' :
              'text-green-400'
            }`}>{(assessment.urgency || '').toUpperCase()}</div>
            <div className="text-gray-400">Urgency</div>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <div className="text-lg font-bold text-orange-300">{assessment.disposition || assessment.routing || '—'}</div>
            <div className="text-gray-400">Routing</div>
          </div>
        </div>
      )}
      {assessment.symptoms && (
        <div className="text-gray-300"><span className="text-gray-500">Symptoms:</span> {
          Array.isArray(assessment.symptoms) ? assessment.symptoms.join(', ') : assessment.symptoms
        }</div>
      )}
      {result.message && <div className="text-gray-400 italic">{result.message}</div>}
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
          <div className="text-gray-300"><span className="text-gray-500">Visit:</span> {sections.visitReason}</div>
        )}
        {briefing.briefingDocument && (
          <div className="mt-2 bg-gray-800 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap text-gray-300 font-mono text-[11px] leading-relaxed">
            {briefing.briefingDocument.substring(0, 2000)}{briefing.briefingDocument.length > 2000 ? '\n...' : ''}
          </div>
        )}
        {result.message && <div className="text-gray-400 italic">{result.message}</div>}
      </div>
    );
  }
  // Scheduling or other front desk result
  return (
    <div className="mt-3 space-y-2 text-xs">
      {result.slots && (
        <div className="space-y-1">
          {result.slots.slice(0, 5).map((s, i) => (
            <div key={i} className="bg-gray-800 rounded px-3 py-2 flex justify-between">
              <span className="text-gray-200">{s.date} {s.time}</span>
              <span className="text-teal-400">{s.provider || ''}</span>
            </div>
          ))}
        </div>
      )}
      {result.message && <div className="text-gray-400 italic">{result.message}</div>}
    </div>
  );
}

function MADetails({ result }) {
  // Refill result
  if (result.decision) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className={`bg-gray-800 rounded p-3 ${
          result.decision.includes('approved') ? 'border-l-4 border-green-500' :
          result.decision.includes('escalation') || result.escalation_required ? 'border-l-4 border-amber-500' :
          'border-l-4 border-gray-600'
        }`}>
          <div className="font-medium text-gray-200">{result.medication || result.question || 'Result'}</div>
          <div className="text-gray-400 mt-1">{result.instructions || result.response || result.message || result.ma_assessment}</div>
          {result.escalation_required && (
            <div className="mt-2 flex items-center gap-1 text-amber-300">
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
        <div className="text-gray-200 font-medium">{result.count} Pre-Visit Labs Proposed</div>
        {result.proposed_labs.map((lab, i) => (
          <div key={i} className="bg-gray-800 rounded px-3 py-2 flex justify-between items-center">
            <div>
              <div className="text-gray-200">{lab.test_name}</div>
              <div className="text-gray-500">{lab.indication}</div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] ${lab.priority === 'stat' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'}`}>
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
        <div className="text-gray-200 font-medium">Encounter Prep</div>
        <div className="grid grid-cols-2 gap-1">
          {result.vitals_checklist.map((v, i) => (
            <div key={i} className="bg-gray-800 rounded px-2 py-1 text-gray-300">{v.vital}</div>
          ))}
        </div>
        {(result.questionnaires || []).map((q, i) => (
          <div key={i} className="bg-gray-800 rounded px-3 py-2">
            <div className="text-gray-200">{q.name}</div>
            <div className="text-gray-500">{q.topics?.join(', ')}</div>
          </div>
        ))}
        {(result.alerts || []).map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-amber-300">
            <AlertTriangle size={12} /> {a.message}
          </div>
        ))}
      </div>
    );
  }
  return <div className="mt-3 text-xs text-gray-400 italic">{result.message || 'MA Agent ready'}</div>;
}

function PhysicianDetails({ result }) {
  if (result.decision) {
    return (
      <div className="mt-3 space-y-2 text-xs">
        <div className="bg-gray-800 rounded p-3 border-l-4 border-indigo-500">
          <div className="font-medium text-gray-200">Decision: {result.decision.replace(/_/g, ' ')}</div>
          {result.instructions && <div className="text-gray-400 mt-1">{result.instructions}</div>}
          {result.to_agent && <div className="text-indigo-300 mt-1">Directive sent to: {result.to_agent}</div>}
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
          <div className={`flex items-center gap-2 ${result.validations.complete ? 'text-green-400' : 'text-amber-300'}`}>
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
        <div className="text-gray-200 font-medium">Post-Visit Queues</div>
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Rx" value={result.queues.prescriptions || 0} />
          <Stat label="Labs" value={result.queues.lab_orders || 0} />
          <Stat label="Imaging" value={result.queues.imaging_orders || 0} />
          <Stat label="Referrals" value={result.queues.referral_letters || 0} />
        </div>
      </div>
    );
  }
  return <div className="mt-3 text-xs text-gray-400 italic">{result.message || 'Physician Agent ready'}</div>;
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
      const res = await fetch(`${API_BASE}/agents/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounter_id: encounterId, patient_id: patientId })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Pipeline failed');
      const data = await res.json();
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
      const res = await fetch(`${API_BASE}/agents/briefing/${patientId}${encounterId ? '?encounter_id=' + encounterId : ''}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Briefing failed');
      const data = await res.json();
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
      const res = await fetch(`${API_BASE}/agents/ma`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, encounter_id: encounterId, request_type: 'pre_visit_labs' })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'MA labs failed');
      const data = await res.json();
      setPreVisitResults(prev => ({ ...prev, ma: data }));
      setExpandedAgents(prev => new Set([...prev, 'ma']));
    } catch (err) { setError(err.message); }
    finally { setRunning(false); }
  }, [patientId, encounterId]);

  const agents = activeTab === 'encounter' ? ENCOUNTER_AGENTS : PRE_VISIT_AGENTS;
  const results = activeTab === 'encounter' ? pipelineResult : preVisitResults;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <Bot size={20} className="text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">AI Clinical Agents</h3>
            <p className="text-xs text-gray-500">9-agent intelligent pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {totalTime != null && activeTab === 'encounter' && (
            <span className="text-xs text-gray-500">{totalTime}ms</span>
          )}
          {activeTab === 'encounter' ? (
            <button onClick={runEncounterPipeline} disabled={running || !encounterId || !patientId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${running ? 'bg-blue-900/50 text-blue-300 cursor-wait' : 'bg-cyan-700 hover:bg-cyan-600 text-white'} disabled:opacity-40 disabled:cursor-not-allowed`}>
              {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run Pipeline</>}
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={runPreVisitBriefing} disabled={running || !patientId}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <UserCheck size={12} /> Briefing
              </button>
              <button onClick={runPreVisitLabs} disabled={running || !patientId}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-pink-700 hover:bg-pink-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <Stethoscope size={12} /> Pre-Visit Labs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button onClick={() => setActiveTab('pre_visit')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'pre_visit' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-gray-800/30' : 'text-gray-500 hover:text-gray-300'}`}>
          Pre-Visit (4 agents)
        </button>
        <button onClick={() => setActiveTab('encounter')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'encounter' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-gray-800/30' : 'text-gray-500 hover:text-gray-300'}`}>
          Encounter (5 agents)
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Agent Cards */}
      <div className="p-4 space-y-2">
        {agents.map(name => (
          <AgentCard key={name} name={name} agentResult={results?.[name]} expanded={expandedAgents.has(name)} onToggle={() => toggleAgent(name)} />
        ))}
      </div>

      {/* No results message */}
      {!results && !running && !error && (
        <div className="px-4 pb-4 text-center text-gray-500 text-sm">
          {activeTab === 'encounter' ? 'Click "Run Pipeline" to analyze this encounter' : 'Run pre-visit actions above'}
        </div>
      )}
    </div>
  );
}
