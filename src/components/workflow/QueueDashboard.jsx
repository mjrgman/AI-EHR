import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, RefreshCw } from 'lucide-react';
import api, { safeLog } from '../../api/client';
import WorkflowTracker from './WorkflowTracker';
import { stateRoute } from '../../utils/stateRoute';

export default function QueueDashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    try {
      setWorkflows(await api.getAllWorkflows());
      setLoadError(null);
    } catch (e) {
      safeLog.error('Queue load failed:', e);
      setLoadError(e?.message || 'The encounter queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="animate-pulse p-4 text-slate-500">Loading queue...</div>;
  if (loadError) return (
    <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-danger-800">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Encounter queue unavailable</p>
          <p className="mt-1 text-sm">{loadError} This is a load failure, not an empty queue.</p>
          <button type="button" onClick={load} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-danger-600 px-3 py-2 text-sm font-semibold text-white hover:bg-danger-700">
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </div>
      </div>
    </div>
  );
  const active = workflows.filter(wf => wf.current_state !== 'checked-out');
  if (active.length === 0) return (
    <div className="flex flex-col items-center py-10 text-slate-400">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ivory-200 text-slate-400 ring-1 ring-slate-100">
        <ClipboardCheck size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="text-sm text-slate-500">No active encounters.</p>
    </div>
  );

  return (
    <div className="space-y-2 mc-reveal-stagger">
      {active.map(wf => (
        <div key={wf.encounter_id} onClick={() => navigate(stateRoute(wf.encounter_id, wf.current_state))}
          className="bg-offWhite-100 rounded-xl border border-slate-100 shadow-mc p-4 hover:border-navy-200 hover:shadow-mc-lg hover:-translate-y-px cursor-pointer transition-all active:scale-[0.99] active:translate-y-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-semibold text-navy-700">{wf.patient_first_name || 'Patient'} {wf.patient_last_name || ''}</span>
              <span className="text-slate-400 text-sm ml-2">Enc #{wf.encounter_id}</span>
            </div>
            <WorkflowTracker currentState={wf.current_state} compact />
          </div>
          {wf.assigned_provider && <p className="text-xs text-slate-500">Provider: {wf.assigned_provider}</p>}
        </div>
      ))}
    </div>
  );
}
