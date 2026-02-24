import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import Badge from '../components/common/Badge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import api from '../api/client';

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

function StatCard({ label, value, icon, accent = 'blue' }) {
  const accents = {
    blue: 'border-blue-500 bg-blue-50 text-blue-700',
    amber: 'border-amber-500 bg-amber-50 text-amber-700',
    green: 'border-green-500 bg-green-50 text-green-700',
    red: 'border-red-500 bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-xl border-l-4 p-4 ${accents[accent]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
          <p className="text-2xl font-bold mt-1">{value ?? '-'}</p>
        </div>
        <span className="text-2xl opacity-40">{icon}</span>
      </div>
    </div>
  );
}

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
  const color = code < 300 ? 'bg-green-400' : code < 400 ? 'bg-blue-400' : code < 500 ? 'bg-amber-400' : 'bg-red-400';
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
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl border-l border-gray-200 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-500">Audit Detail</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Action + Status header */}
          <div className="flex items-center gap-2">
            <Badge variant={ACTION_COLORS[log.action] || 'info'}>{log.action}</Badge>
            <StatusDot code={log.response_status} />
            <span className="text-xs text-gray-500">HTTP {log.response_status}</span>
            {log.phi_accessed ? (
              <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                PHI
              </span>
            ) : null}
          </div>

          {/* Key-value pairs */}
          <div className="divide-y divide-gray-50">
            {fields.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between py-2.5">
                <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</span>
                <span className="text-sm text-gray-800 font-mono text-right max-w-[60%] break-all">{value}</span>
              </div>
            ))}
          </div>

          {/* PHI fields */}
          {phiFields.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">PHI Fields Accessed</p>
              <div className="flex flex-wrap gap-1.5">
                {phiFields.map(f => (
                  <span key={f} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-md font-mono border border-amber-200">{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Request body summary */}
          {log.request_body_summary && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Request Body</p>
              <pre className="text-xs font-mono bg-gray-50 rounded-lg p-3 text-gray-600 overflow-x-auto whitespace-pre-wrap break-all border border-gray-100">
                {log.request_body_summary}
              </pre>
            </div>
          )}

          {/* Error */}
          {log.error_message && (
            <div>
              <p className="text-xs text-red-400 uppercase tracking-wider font-medium mb-2">Error</p>
              <pre className="text-xs font-mono bg-red-50 rounded-lg p-3 text-red-700 overflow-x-auto whitespace-pre-wrap border border-red-100">
                {log.error_message}
              </pre>
            </div>
          )}

          {/* User Agent */}
          {log.user_agent && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">User Agent</p>
              <p className="text-xs font-mono text-gray-500 break-all">{log.user_agent}</p>
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
  const { currentRole } = useAuth();
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
      setLogs(logsResult.logs);
      setTotalPages(logsResult.totalPages);
      setTotal(logsResult.total);
      setStats(statsResult);
    } catch (err) {
      console.error('Failed to load audit data:', err);
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
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">HIPAA compliance trail &middot; All system activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Events" value={stats.total_events?.toLocaleString()} icon="#" accent="blue" />
          <StatCard label="PHI Accesses" value={stats.phi_access_count?.toLocaleString()} icon="!" accent="amber" />
          <StatCard
            label="Unique Users"
            value={stats.by_user?.length || 0}
            icon="@"
            accent="green"
          />
          <StatCard
            label="Errors"
            value={stats.recent_errors?.length || 0}
            icon="X"
            accent="red"
          />
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardBody className="!p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                placeholder="Search logs..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Action filter */}
            <select value={filters.action} onChange={e => updateFilter('action', e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">All Actions</option>
              {ACTION_OPTIONS.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            {/* Resource filter */}
            <select value={filters.resource_type} onChange={e => updateFilter('resource_type', e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">All Resources</option>
              {RESOURCE_OPTIONS.filter(Boolean).map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>

            {/* PHI toggle */}
            <label className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors select-none">
              <input type="checkbox" checked={filters.phi_only} onChange={e => updateFilter('phi_only', e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500 focus:ring-amber-500" />
              <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-600">PHI Only</span>
            </label>

            {/* Date range */}
            <input type="date" value={filters.date_from} onChange={e => updateFilter('date_from', e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="From date" />
            <input type="date" value={filters.date_to} onChange={e => updateFilter('date_to', e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="To date" />

            {/* Clear */}
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium">
                Clear
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Log table */}
      <Card>
        <CardHeader action={<span className="text-xs text-gray-400 font-mono">{total.toLocaleString()} entries</span>}>
          Activity Log
        </CardHeader>

        {loading ? (
          <LoadingSpinner message="Loading audit trail..." />
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-500">No audit entries found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Resource</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Patient</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">PHI</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(log => (
                  <tr key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors group">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-gray-800 font-mono text-xs" title={formatFullTimestamp(log.timestamp)}>
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-800 text-xs font-medium truncate max-w-[120px]">{log.user_identity}</span>
                        {log.user_role && log.user_role !== 'unknown' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wider">{log.user_role}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={ACTION_COLORS[log.action] || 'info'}>{log.action}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-gray-700 text-xs">
                        {log.resource_type?.replace(/_/g, ' ')}
                        {log.resource_id ? <span className="text-gray-400 font-mono ml-1">#{log.resource_id}</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.patient_id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/patient/${log.patient_id}`); }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-mono hover:underline">
                          #{log.patient_id}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.phi_accessed ? (
                        <svg className="w-4 h-4 mx-auto text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className="text-gray-200">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <StatusDot code={log.response_status} />
                        <span className="text-xs font-mono text-gray-500">{log.response_status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-xs font-mono text-gray-400">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
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
                    className={`w-8 h-8 text-xs rounded-lg font-medium transition-colors ${
                      p === page ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
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
