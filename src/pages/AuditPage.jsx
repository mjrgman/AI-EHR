import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, FileText, Lock, Users, AlertTriangle, Search,
  RefreshCw, Download, X,
} from 'lucide-react';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import Badge from '../components/common/Badge';
import StatTile from '../components/workflow/StatTile';
import LoadingSpinner from '../components/common/LoadingSpinner';
import api, { safeLog } from '../api/client';

// ==========================================
// CONSTANTS
// ==========================================

const ACTION_COLORS = {
  READ: 'info',
  CREATE: 'success',
  UPDATE: 'warning',
  DELETE: 'urgent',
  TRANSITION: 'purple',
};

const ACTION_OPTIONS = ['', 'READ', 'CREATE', 'UPDATE', 'DELETE', 'TRANSITION'];

const RESOURCE_OPTIONS = [
  '', 'patient', 'encounter', 'vitals', 'prescription', 'lab_order',
  'imaging_order', 'referral', 'medication', 'allergy', 'lab_result',
  'problem', 'workflow', 'cds_evaluation', 'cds_suggestion',
  'ai_extraction', 'ai_note', 'dashboard', 'system',
];

// ==========================================
// HELPER COMPONENTS
// ==========================================

function formatTimestamp(ts) {
  if (!ts) return '-';
  const d = new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatFullTimestamp(ts) {
  if (!ts) return '-';
  const d = new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

function StatusDot({ code }) {
  if (!code) return null;
  const color = code < 300 ? 'bg-success-500' : code < 400 ? 'bg-navy-400' : code < 500 ? 'bg-gold-500' : 'bg-danger-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={`HTTP ${code}`} />;
}

// ==========================================
// DETAIL PANEL
// ==========================================

function AuditDetailPanel({ log, onClose }) {
  if (!log) return null;

  const fields = [
    ['Timestamp', formatFullTimestamp(log.timestamp)],
    ['User', log.user_identity],
    ['Role', log.user_role],
    ['Action', log.action],
    ['Resource', `${log.resource_type}${log.resource_id ? ` #${log.resource_id}` : ''}`],
    ['Patient ID', log.patient_id || 'N/A'],
    ['Method', log.request_method],
    ['Path', log.request_path],
    ['HTTP Status', log.response_status],
    ['Duration', log.duration_ms ? `${log.duration_ms}ms` : 'N/A'],
    ['IP Address', log.ip_address || 'N/A'],
    ['Session', log.session_id ? log.session_id.slice(0, 8) + '...' : 'N/A'],
    ['PHI Accessed', log.phi_accessed ? 'Yes' : 'No'],
  ];

  let phiFields = [];
  if (log.phi_fields_accessed) {
    try { phiFields = JSON.parse(log.phi_fields_accessed); } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="fixed inset-0 bg-navy-900/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-100 bg-offWhite-100 shadow-mc-xl animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-offWhite-100 px-5 py-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Audit Detail</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audit detail"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-ivory-200 hover:text-slate-600"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Action + Status header */}
          <div className="flex items-center gap-2">
            <Badge variant={ACTION_COLORS[log.action] || 'info'}>{log.action}</Badge>
            <StatusDot code={log.response_status} />
            <span className="text-xs text-slate-500">HTTP {log.response_status}</span>
            {log.phi_accessed ? (
              <span className="ml-auto flex items-center gap-1 rounded-md border border-danger-200 bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700">
                <Lock size={13} strokeWidth={2.5} aria-hidden="true" />
                PHI
              </span>
            ) : null}
          </div>

          {/* Key-value pairs */}
          <div className="divide-y divide-slate-100">
            {fields.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between py-2.5">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
                <span className="max-w-[60%] break-all text-right font-mono text-sm text-navy-700">{value}</span>
              </div>
            ))}
          </div>

          {/* PHI fields */}
          {phiFields.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">PHI Fields Accessed</p>
              <div className="flex flex-wrap gap-1.5">
                {phiFields.map(f => (
                  <span key={f} className="rounded-md border border-danger-200 bg-danger-50 px-2 py-0.5 font-mono text-xs text-danger-700">{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Request body summary */}
          {log.request_body_summary && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Request Body</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-100 bg-ivory-200 p-3 font-mono text-xs text-slate-600">
                {log.request_body_summary}
              </pre>
            </div>
          )}

          {/* Error */}
          {log.error_message && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-danger-500">Error</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-danger-100 bg-danger-50 p-3 font-mono text-xs text-danger-700">
                {log.error_message}
              </pre>
            </div>
          )}

          {/* User Agent */}
          {log.user_agent && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">User Agent</p>
              <p className="break-all font-mono text-xs text-slate-500">{log.user_agent}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// MAIN PAGE
// ==========================================

export default function AuditPage() {
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedLog, setSelectedLog] = useState(null);

  const [filters, setFilters] = useState({
    search: '',
    action: '',
    resource_type: '',
    phi_only: false,
    date_from: '',
    date_to: '',
    user: '',
  });

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef(null);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters(f => ({ ...f, search: val }));
      setPage(1);
    }, 400);
  };

  const updateFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  };

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filters.search) params.search = filters.search;
      if (filters.action) params.action = filters.action;
      if (filters.resource_type) params.resource_type = filters.resource_type;
      if (filters.phi_only) params.phi_only = 'true';
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.user) params.user = filters.user;

      const [logsResult, statsResult] = await Promise.all([
        api.getAuditLogs(params),
        api.getAuditStats({
          ...(filters.date_from ? { date_from: filters.date_from } : {}),
          ...(filters.date_to ? { date_to: filters.date_to } : {}),
        }),
      ]);
      setLogs(Array.isArray(logsResult?.logs) ? logsResult.logs : []);
      setTotalPages(Number(logsResult?.totalPages) || 1);
      setTotal(Number(logsResult?.total) || 0);
      setStats(statsResult || null);
    } catch (err) {
      safeLog.error('Failed to load audit data:', err);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (filters.phi_only) params.set('phi_only', 'true');
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    window.open(`/api/audit/export${params.toString() ? '?' + params.toString() : ''}`, '_blank');
  };

  const clearFilters = () => {
    setFilters({ search: '', action: '', resource_type: '', phi_only: false, date_from: '', date_to: '', user: '' });
    setSearchInput('');
    setPage(1);
  };

  const hasActiveFilters = filters.search || filters.action || filters.resource_type || filters.phi_only || filters.date_from || filters.date_to || filters.user;

  return (
    <div className="mc-page mc-reveal-stagger max-w-7xl space-y-5">
      {/* Page header — gold hairline crowns the compliance surface (signature) */}
      <div className="relative flex items-center justify-between">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <div>
          <p className="mc-section-label">Security &amp; Compliance</p>
          <h1 className="mc-page-title flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-slate-500">HIPAA compliance trail &middot; All system activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchData}
            aria-label="Refresh audit log"
            className="rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-ivory-200 hover:text-navy-700"
            title="Refresh">
            <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg bg-navy-600 px-3 py-2 text-sm font-medium text-white shadow-mc transition-all hover:bg-navy-700 hover:shadow-mc-lg">
            <Download size={16} strokeWidth={2} aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats bar — StatTile hierarchy; PHI is the single gold moment (the
          audit's whole reason to exist), error count carries danger. */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={FileText} label="Total Events" value={stats.total_events?.toLocaleString() ?? '-'} tone="navy" />
          <StatTile icon={Lock} label="PHI Accesses" value={stats.phi_access_count?.toLocaleString() ?? '-'} tone="gold" />
          <StatTile icon={Users} label="Unique Users" value={stats.by_user?.length || 0} tone="slate" />
          <StatTile icon={AlertTriangle} label="Errors" value={stats.recent_errors?.length || 0} tone="danger" />
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardBody className="!p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} strokeWidth={2} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                placeholder="Search logs..."
                className="w-full rounded-lg border border-slate-200 bg-offWhite-100 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gold-500"
              />
            </div>

            {/* Action filter */}
            <select value={filters.action} onChange={e => updateFilter('action', e.target.value)}
              className="rounded-lg border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500">
              <option value="">All Actions</option>
              {ACTION_OPTIONS.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            {/* Resource filter */}
            <select value={filters.resource_type} onChange={e => updateFilter('resource_type', e.target.value)}
              className="rounded-lg border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500">
              <option value="">All Resources</option>
              {RESOURCE_OPTIONS.filter(Boolean).map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>

            {/* PHI toggle */}
            <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors hover:bg-ivory-200">
              <input type="checkbox" checked={filters.phi_only} onChange={e => updateFilter('phi_only', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-danger-600 focus:ring-danger-500" />
              <Lock size={14} strokeWidth={2.25} aria-hidden="true" className="text-danger-600" />
              <span className="text-slate-600">PHI Only</span>
            </label>

            {/* Date range */}
            <input type="date" value={filters.date_from} onChange={e => updateFilter('date_from', e.target.value)}
              aria-label="From date"
              className="rounded-lg border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
              title="From date" />
            <input type="date" value={filters.date_to} onChange={e => updateFilter('date_to', e.target.value)}
              aria-label="To date"
              className="rounded-lg border border-slate-200 bg-offWhite-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
              title="To date" />

            {/* Clear */}
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="rounded-lg px-3 py-2 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50">
                Clear
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Log table */}
      <Card>
        <CardHeader action={<span className="font-mono text-xs text-slate-400">{(Number(total) || 0).toLocaleString()} entries</span>}>
          Activity Log
        </CardHeader>

        {loading ? (
          <LoadingSpinner message="Loading audit trail..." />
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={48} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-500">No audit entries found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-sm font-medium text-navy-600 hover:text-navy-700">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-ivory-200/70">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Resource</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Patient</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">PHI</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map(log => {
                  const isError = Number(log.response_status) >= 400;
                  // Security rows carry a quiet danger lead-edge: PHI access or
                  // an error status is the audit trail's whole reason to exist.
                  const securityRow = log.phi_accessed || isError;
                  return (
                  <tr key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className={`group cursor-pointer transition-colors ${
                      isError
                        ? 'bg-danger-50/40 hover:bg-danger-50/70'
                        : log.phi_accessed
                        ? 'hover:bg-danger-50/40'
                        : 'hover:bg-ivory-200'
                    }`}>
                    <td className={`relative whitespace-nowrap px-4 py-3 ${securityRow ? 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-danger-400 before:opacity-70' : ''}`}>
                      <span className="font-mono text-xs text-navy-700" title={formatFullTimestamp(log.timestamp)}>
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[120px] truncate text-xs font-medium text-navy-700">{log.user_identity}</span>
                        {log.user_role && log.user_role !== 'unknown' && (
                          <span className="rounded bg-ivory-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">{log.user_role}</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={ACTION_COLORS[log.action] || 'info'}>{log.action}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-xs text-slate-600">
                        {log.resource_type?.replace(/_/g, ' ')}
                        {log.resource_id ? <span className="ml-1 font-mono text-slate-400">#{log.resource_id}</span> : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {log.patient_id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/patient/${log.patient_id}`); }}
                          className="font-mono text-xs text-navy-600 hover:text-navy-700 hover:underline">
                          #{log.patient_id}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.phi_accessed ? (
                        <Lock size={16} strokeWidth={2.25} aria-label="PHI accessed" className="mx-auto text-danger-600" />
                      ) : (
                        <span className="text-slate-200">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <StatusDot code={log.response_status} />
                        <span className="font-mono text-xs text-slate-500">{log.response_status}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="font-mono text-xs text-slate-400">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : '-'}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-400">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-ivory-200 disabled:cursor-not-allowed disabled:opacity-30">
                Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${
                      p === page ? 'bg-navy-600 text-white' : 'text-slate-600 hover:bg-ivory-200'
                    }`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-ivory-200 disabled:cursor-not-allowed disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail slide-out panel */}
      {selectedLog && <AuditDetailPanel log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
