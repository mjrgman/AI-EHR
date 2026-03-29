/**
 * PreVisitPanel — Pre-visit intelligence briefing for the physician.
 * Displays the Front Desk Agent's synopsis-style briefing document
 * with actionable sections: problems, meds, allergies, preventive care,
 * treatment carryforward, and MA encounter prep.
 *
 * This is the "1-pager" that replaces the old template chart review.
 *
 * Usage: <PreVisitPanel patientId={pid} encounterId={eid} />
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  FileText, AlertTriangle, CheckCircle, Clock, Loader2,
  ClipboardList, Pill, AlertCircle, Shield, Activity,
  Stethoscope, RefreshCw, ChevronDown, ChevronRight,
  Heart, Syringe, Eye, UserCheck
} from 'lucide-react';

const API_BASE = '/api';

// ==========================================
// SECTION COMPONENTS
// ==========================================

function BriefingSection({ title, icon: Icon, iconColor, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-800/50 hover:bg-gray-800 transition-colors"
      >
        <Icon size={16} className={iconColor || 'text-gray-400'} />
        <span className="text-sm font-medium text-gray-200 flex-1 text-left">{title}</span>
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
      </button>
      {open && <div className="px-4 py-3 bg-gray-900/50">{children}</div>}
    </div>
  );
}

function ProblemRow({ problem }) {
  const statusColors = {
    active: 'bg-green-900/50 text-green-300',
    chronic: 'bg-blue-900/50 text-blue-300',
    resolved: 'bg-gray-800 text-gray-500'
  };
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
      <div className="flex-1">
        <div className="text-sm text-gray-200 font-medium">{problem.problem_name || problem.name}</div>
        {problem.icd10_code && (
          <span className="text-xs text-gray-500">{problem.icd10_code}</span>
        )}
        {problem.synopsis && (
          <div className="text-xs text-gray-400 mt-1">{problem.synopsis}</div>
        )}
        {problem.managed_by && (
          <div className="text-xs text-teal-400 mt-0.5">Managed by: {problem.managed_by}</div>
        )}
      </div>
      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${statusColors[problem.status] || statusColors.active}`}>
        {problem.status || 'active'}
      </span>
    </div>
  );
}

function MedicationRow({ med }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div>
        <div className="text-sm text-gray-200">{med.medication_name || med.name}</div>
        <div className="text-xs text-gray-500">
          {[med.dosage, med.frequency, med.route].filter(Boolean).join(' · ')}
        </div>
      </div>
      {med.prescriber && <span className="text-xs text-gray-500">{med.prescriber}</span>}
    </div>
  );
}

function AllergyBadge({ allergy }) {
  const severityColors = {
    high: 'bg-red-900/60 text-red-300 border-red-700',
    medium: 'bg-amber-900/60 text-amber-300 border-amber-700',
    low: 'bg-gray-800 text-gray-300 border-gray-700'
  };
  const cls = severityColors[allergy.severity] || severityColors.medium;
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${cls}`}>
      <AlertTriangle size={12} />
      <span className="font-medium">{allergy.allergen}</span>
      {allergy.reaction && <span className="text-gray-400">— {allergy.reaction}</span>}
    </div>
  );
}

function LabProposal({ lab }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div>
        <div className="text-sm text-gray-200">{lab.test_name}</div>
        <div className="text-xs text-gray-500">{lab.indication}</div>
      </div>
      <div className="flex items-center gap-2">
        {lab.last_done_days_ago != null && (
          <span className="text-xs text-gray-500">{lab.last_done_days_ago}d ago</span>
        )}
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
          lab.priority === 'stat' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'
        }`}>{lab.priority}</span>
      </div>
    </div>
  );
}

function VitalsChecklistItem({ item }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className={`w-4 h-4 rounded border ${item.required ? 'border-cyan-500' : 'border-gray-600'} flex items-center justify-center`}>
        {item.completed && <CheckCircle size={12} className="text-green-400" />}
      </div>
      <span className="text-xs text-gray-300">{item.vital}</span>
      {item.required && <span className="text-[10px] text-cyan-500 font-medium">REQ</span>}
    </div>
  );
}

// ==========================================
// MAIN PANEL
// ==========================================

export default function PreVisitPanel({ patientId, encounterId }) {
  const [briefing, setBriefing] = useState(null);
  const [maPrep, setMaPrep] = useState(null);
  const [preVisitLabs, setPreVisitLabs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadBriefing = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch briefing, MA prep, and pre-visit labs in parallel
      const [briefRes, prepRes, labsRes] = await Promise.all([
        fetch(`${API_BASE}/agents/briefing/${patientId}${encounterId ? '?encounter_id=' + encounterId : ''}`),
        fetch(`${API_BASE}/agents/ma`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, encounter_id: encounterId, request_type: 'encounter_prep' })
        }),
        fetch(`${API_BASE}/agents/ma`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, encounter_id: encounterId, request_type: 'pre_visit_labs' })
        })
      ]);

      if (briefRes.ok) {
        const data = await briefRes.json();
        setBriefing(data);
      }
      if (prepRes.ok) {
        const data = await prepRes.json();
        setMaPrep(data);
      }
      if (labsRes.ok) {
        const data = await labsRes.json();
        setPreVisitLabs(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [patientId, encounterId]);

  // Extract sections from briefing
  const sections = briefing?.briefing?.sections || briefing?.sections || {};
  const problems = sections.activeProblemsSynopsis || sections.problems || [];
  const medications = sections.currentMedications || sections.medications || [];
  const allergies = sections.allergies || [];
  const preventiveCare = sections.preventiveCareGaps || sections.preventive || [];
  const visitReason = sections.visitReason || sections.reason || '';
  const surgicalHistory = sections.surgicalHistory || [];
  const treatmentCarryforward = sections.treatmentCarryforward || sections.carryforward || [];
  const proposedLabs = preVisitLabs?.proposed_labs || [];
  const vitalsChecklist = maPrep?.vitals_checklist || [];
  const questionnaires = maPrep?.questionnaires || [];
  const alerts = maPrep?.alerts || [];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gradient-to-r from-gray-800/80 to-teal-900/30">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-teal-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Pre-Visit Intelligence Briefing</h3>
            <p className="text-xs text-gray-400">Synopsis-based patient preparation</p>
          </div>
        </div>
        <button
          onClick={loadBriefing}
          disabled={loading || !patientId}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            loading ? 'bg-teal-900/50 text-teal-300 cursor-wait' : 'bg-teal-700 hover:bg-teal-600 text-white'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> Loading...</> : <><RefreshCw size={14} /> Generate Briefing</>}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Alerts Banner */}
      {alerts.length > 0 && (
        <div className="mx-4 mt-3 space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className="p-2.5 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle size={14} className="flex-shrink-0" /> {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {briefing ? (
        <div className="p-4 space-y-3">
          {/* Visit Reason */}
          {visitReason && (
            <div className="bg-teal-900/20 border border-teal-800/50 rounded-lg px-4 py-3">
              <div className="text-xs text-teal-400 font-medium mb-1">REASON FOR VISIT</div>
              <div className="text-sm text-gray-200">{visitReason}</div>
            </div>
          )}

          {/* Allergies — always visible */}
          {allergies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allergies.map((a, i) => <AllergyBadge key={i} allergy={a} />)}
            </div>
          )}

          {/* Problem Synopsis */}
          <BriefingSection title={`Active Problems (${problems.length})`} icon={ClipboardList} iconColor="text-blue-400">
            {problems.length > 0 ? problems.map((p, i) => <ProblemRow key={i} problem={p} />) : (
              <div className="text-xs text-gray-500 italic">No active problems on file</div>
            )}
          </BriefingSection>

          {/* Medications */}
          <BriefingSection title={`Medications (${medications.length})`} icon={Pill} iconColor="text-green-400">
            {medications.length > 0 ? medications.map((m, i) => <MedicationRow key={i} med={m} />) : (
              <div className="text-xs text-gray-500 italic">No active medications</div>
            )}
          </BriefingSection>

          {/* Pre-Visit Labs */}
          {proposedLabs.length > 0 && (
            <BriefingSection title={`Pre-Visit Labs (${proposedLabs.length})`} icon={Syringe} iconColor="text-pink-400">
              {proposedLabs.map((l, i) => <LabProposal key={i} lab={l} />)}
            </BriefingSection>
          )}

          {/* Preventive Care Gaps */}
          {preventiveCare.length > 0 && (
            <BriefingSection title={`Preventive Care Gaps (${preventiveCare.length})`} icon={Shield} iconColor="text-amber-400">
              {preventiveCare.map((g, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-800 last:border-0 text-xs">
                  <AlertCircle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-gray-200">{g.measure || g.name || g}</div>
                    {g.action && <div className="text-gray-500">{g.action}</div>}
                  </div>
                </div>
              ))}
            </BriefingSection>
          )}

          {/* Treatment Carryforward */}
          {treatmentCarryforward.length > 0 && (
            <BriefingSection title="Treatment Carryforward" icon={Heart} iconColor="text-rose-400" defaultOpen={false}>
              {treatmentCarryforward.map((t, i) => (
                <div key={i} className="py-2 border-b border-gray-800 last:border-0">
                  <div className="text-sm text-gray-200">{t.plan || t.description || t}</div>
                  {t.source && <div className="text-xs text-gray-500 mt-0.5">From: {t.source}</div>}
                </div>
              ))}
            </BriefingSection>
          )}

          {/* Encounter Prep (MA) */}
          {vitalsChecklist.length > 0 && (
            <BriefingSection title="MA Encounter Prep" icon={Stethoscope} iconColor="text-pink-400" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {vitalsChecklist.map((v, i) => <VitalsChecklistItem key={i} item={v} />)}
              </div>
              {questionnaires.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 font-medium mb-1">QUESTIONNAIRES</div>
                  {questionnaires.map((q, i) => (
                    <div key={i} className="text-xs text-gray-300 py-1">
                      {q.name} — <span className="text-gray-500">{q.topics?.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </BriefingSection>
          )}

          {/* Raw briefing document (expandable) */}
          {briefing?.briefing?.document && (
            <BriefingSection title="Full Briefing Document" icon={FileText} iconColor="text-gray-500" defaultOpen={false}>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-auto">
                {briefing.briefing.briefingDocument}
              </pre>
            </BriefingSection>
          )}
        </div>
      ) : !loading && (
        <div className="p-8 text-center">
          <UserCheck size={32} className="mx-auto text-gray-600 mb-3" />
          <div className="text-gray-500 text-sm">Click "Generate Briefing" to prepare pre-visit intelligence</div>
          <div className="text-gray-600 text-xs mt-1">Synopsis-style summary replaces template chart review</div>
        </div>
      )}
    </div>
  );
}
