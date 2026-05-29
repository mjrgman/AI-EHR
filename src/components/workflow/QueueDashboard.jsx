import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import api, { safeLog } from '../../api/client';
import WorkflowTracker from './WorkflowTracker';

const ROUTES = { 'scheduled': '/checkin', 'checked-in': '/checkin', 'roomed': '/ma', 'vitals-recorded': '/ma', 'provider-examining': '/encounter', 'orders-pending': '/encounter', 'documentation': '/encounter', 'signed': '/review', 'checked-out': '/checkout' };

export default function QueueDashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    try { setWorkflows(await api.getAllWorkflows()); } catch (e) { safeLog.error('Queue load failed:', e); } finally { setLoading(false); }
  }

  if (loading) return <div className="animate-pulse p-4 text-slate-500">Loading queue...</div>;
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
        <div key={wf.encounter_id} onClick={() => navigate((ROUTES[wf.current_state] || '/encounter') + '/' + wf.encounter_id)}
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
