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

import React, { useState, useCallback } from 'react';
import {
  FileText, AlertTriangle, CheckCircle, Loader2,
  ClipboardList, Pill, AlertCircle, Shield,
  Stethoscope, RefreshCw, ChevronDown, ChevronRight,
  Heart, Syringe, UserCheck
} from 'lucide-react';
import api from '../../api/client';

// ==========================================
// SECTION COMPONENTS
// ==========================================

function BriefingSection({ title, icon: Icon, iconColor, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-offWhite-100 hover:bg-ivory-200/70 transition-colors"
      >
        <Icon size={16} className={iconColor || 'text-slate-500'} />
        <span className="text-sm font-medium text-navy-700 flex-1 text-left">{title}</span>
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
      </button>
      {open && <div className="px-4 py-3 bg-ivory-200/50">{children}</div>}
    </div>
  );
}

function ProblemRow({ problem }) {
  const statusColors = {
    active: 'bg-success-50 text-success-700 border border-success-100',
    chronic: 'bg-navy-50 text-navy-700 border border-navy-100',
    resolved: 'bg-ivory-200/70 text-slate-400 border border-slate-100'
  };
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="flex-1">
        <div className="text-sm text-navy-700 font-medium">{problem.problem_name || problem.name}</div>
        {problem.icd10_code && (
          <span className="text-xs text-slate-400">{problem.icd10_code}</span>
        )}
        {problem.synopsis && (
          <div className="text-xs text-slate-500 mt-1">{problem.synopsis}</div>
        )}
        {problem.managed_by && (
          <div className="text-xs text-slate-600 mt-0.5">Managed by: {problem.managed_by}</div>
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
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <div className="text-sm text-navy-700">{med.medication_name || med.name}</div>
        <div className="text-xs text-slate-400">
          {[med.dosage, med.frequency, med.route].filter(Boolean).join(' · ')}
        </div>
      </div>
      {med.prescriber && <span className="text-xs text-slate-400">{med.prescriber}</span>}
    </div>
  );
}

function AllergyBadge({ allergy }) {
  const severityColors = {
    high: 'bg-danger-100 text-danger-600 border-danger-200',
    medium: 'bg-gold-100 text-gold-700 border-gold-300',
    low: 'bg-ivory-200/70 text-slate-600 border-slate-100'
  };
  const cls = severityColors[allergy.severity] || severityColors.medium;
  const high = allergy.severity === 'high';
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs shadow-mc ${cls} ${high ? 'border-l-4 border-l-danger-500 font-semibold' : ''}`}>
      <AlertTriangle size={12} />
      <span className="font-semibold">{allergy.allergen}</span>
      {allergy.reaction && <span className="text-slate-500 font-normal">— {allergy.reaction}</span>}
    </div>
  );
}

function LabProposal({ lab }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <div className="text-sm text-navy-700">{lab.test_name}</div>
        <div className="text-xs text-slate-400">{lab.indication}</div>
      </div>
      <div className="flex items-center gap-2">
        {lab.last_done_days_ago != null && (
          <span className="text-xs text-slate-400">{lab.last_done_days_ago}d ago</span>
        )}
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
          lab.priority === 'stat' ? 'bg-danger-100 text-danger-600' : 'bg-ivory-300/60 text-slate-600'
        }`}>{lab.priority}</span>
      </div>
    </div>
  );
}

function VitalsChecklistItem({ item }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className={`w-4 h-4 rounded border ${item.required ? 'border-gold-400' : 'border-slate-200'} flex items-center justify-center`}>
        {item.completed && <CheckCircle size={12} className="text-success-600" />}
      </div>
      <span className="text-xs text-slate-600">{item.vital}</span>
      {item.required && <span className="text-[10px] text-gold-600 font-medium">REQ</span>}
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
      const results = await Promise.allSettled([
        api.getAgentBriefing(patientId, encounterId),
        api.runMAAgent({ patient_id: patientId, encounter_id: encounterId, request_type: 'encounter_prep' }),
        api.runMAAgent({ patient_id: patientId, encounter_id: encounterId, request_type: 'pre_visit_labs' })
      ]);

      if (results[0].status === 'fulfilled') setBriefing(results[0].value);
      if (results[1].status === 'fulfilled') setMaPrep(results[1].value);
      if (results[2].status === 'fulfilled') setPreVisitLabs(results[2].value);
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
  const treatmentCarryforward = sections.treatmentCarryforward || sections.carryforward || [];
  const proposedLabs = preVisitLabs?.proposed_labs || [];
  const vitalsChecklist = maPrep?.vitals_checklist || [];
  const questionnaires = maPrep?.questionnaires || [];
  const alerts = maPrep?.alerts || [];

  return (
    <div className="bg-offWhite-100 rounded-xl border border-slate-100 shadow-mc overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-offWhite-100 to-navy-50">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-navy-50 text-navy-600 shadow-mc">
            <FileText size={18} />
          </span>
          <div>
            <h3 className="font-display text-sm font-semibold tracking-tight text-navy-700">Pre-Visit Intelligence Briefing</h3>
            <p className="text-xs text-slate-500">Synopsis-based patient preparation</p>
          </div>
        </div>
        <button
          onClick={loadBriefing}
          disabled={loading || !patientId}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            loading ? 'bg-slate-100 text-slate-600 cursor-wait' : 'bg-navy-600 hover:bg-navy-700 text-white'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> Loading...</> : <><RefreshCw size={14} /> Generate Briefing</>}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-danger-50 border border-danger-200 rounded-lg text-sm text-danger-600 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Alerts Banner */}
      {alerts.length > 0 && (
        <div className="mx-4 mt-3 space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className="p-2.5 bg-danger-50 border border-danger-200 border-l-4 border-l-danger-500 rounded-lg text-sm font-medium text-danger-700 flex items-center gap-2">
              <AlertTriangle size={14} className="flex-shrink-0" /> {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {briefing ? (
        <div className="p-4 space-y-3 mc-reveal-stagger">
          {/* Visit Reason */}
          {visitReason && (
            <div className="bg-navy-50 border border-navy-100 rounded-lg px-4 py-3">
              <div className="text-xs text-slate-600 font-semibold tracking-wide mb-1">REASON FOR VISIT</div>
              <div className="text-sm text-navy-700">{visitReason}</div>
            </div>
          )}

          {/* Allergies — always visible */}
          {allergies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allergies.map((a, i) => <AllergyBadge key={i} allergy={a} />)}
            </div>
          )}

          {/* Problem Synopsis */}
          <BriefingSection title={`Active Problems (${problems.length})`} icon={ClipboardList} iconColor="text-navy-500">
            {problems.length > 0 ? problems.map((p, i) => <ProblemRow key={i} problem={p} />) : (
              <div className="text-xs text-slate-400 italic">No active problems on file</div>
            )}
          </BriefingSection>

          {/* Medications */}
          <BriefingSection title={`Medications (${medications.length})`} icon={Pill} iconColor="text-success-600">
            {medications.length > 0 ? medications.map((m, i) => <MedicationRow key={i} med={m} />) : (
              <div className="text-xs text-slate-400 italic">No active medications</div>
            )}
          </BriefingSection>

          {/* Pre-Visit Labs */}
          {proposedLabs.length > 0 && (
            <BriefingSection title={`Pre-Visit Labs (${proposedLabs.length})`} icon={Syringe} iconColor="text-navy-500">
              {proposedLabs.map((l, i) => <LabProposal key={i} lab={l} />)}
            </BriefingSection>
          )}

          {/* Preventive Care Gaps */}
          {preventiveCare.length > 0 && (
            <BriefingSection title={`Preventive Care Gaps (${preventiveCare.length})`} icon={Shield} iconColor="text-gold-600">
              {preventiveCare.map((g, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0 text-xs">
                  <AlertCircle size={12} className="text-gold-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-navy-700">{g.measure || g.name || g}</div>
                    {g.action && <div className="text-slate-400">{g.action}</div>}
                  </div>
                </div>
              ))}
            </BriefingSection>
          )}

          {/* Treatment Carryforward */}
          {treatmentCarryforward.length > 0 && (
            <BriefingSection title="Treatment Carryforward" icon={Heart} iconColor="text-danger-500" defaultOpen={false}>
              {treatmentCarryforward.map((t, i) => (
                <div key={i} className="py-2 border-b border-slate-100 last:border-0">
                  <div className="text-sm text-navy-700">{t.plan || t.description || t}</div>
                  {t.source && <div className="text-xs text-slate-400 mt-0.5">From: {t.source}</div>}
                </div>
              ))}
            </BriefingSection>
          )}

          {/* Encounter Prep (MA) */}
          {vitalsChecklist.length > 0 && (
            <BriefingSection title="MA Encounter Prep" icon={Stethoscope} iconColor="text-navy-500" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {vitalsChecklist.map((v, i) => <VitalsChecklistItem key={i} item={v} />)}
              </div>
              {questionnaires.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-slate-400 font-medium mb-1">QUESTIONNAIRES</div>
                  {questionnaires.map((q, i) => (
                    <div key={i} className="text-xs text-slate-600 py-1">
                      {q.name} — <span className="text-slate-400">{q.topics?.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </BriefingSection>
          )}

          {/* Raw briefing document (expandable) */}
          {briefing?.briefing?.document && (
            <BriefingSection title="Full Briefing Document" icon={FileText} iconColor="text-slate-400" defaultOpen={false}>
              <pre className="text-[11px] text-slate-500 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-auto">
                {briefing.briefing.briefingDocument}
              </pre>
            </BriefingSection>
          )}
        </div>
      ) : !loading && (
        <div className="p-8 text-center">
          <UserCheck size={32} className="mx-auto text-slate-400 mb-3" />
          <div className="text-slate-400 text-sm">Click &quot;Generate Briefing&quot; to prepare pre-visit intelligence</div>
          <div className="text-slate-400 text-xs mt-1">Synopsis-style summary replaces template chart review</div>
        </div>
      )}
    </div>
  );
}
