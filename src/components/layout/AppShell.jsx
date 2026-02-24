import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';

const ROLE_COLORS = {
  reception: { bg: 'bg-blue-700', hover: 'hover:bg-blue-600', badge: 'bg-blue-500' },
  ma: { bg: 'bg-purple-700', hover: 'hover:bg-purple-600', badge: 'bg-purple-500' },
  provider: { bg: 'bg-emerald-700', hover: 'hover:bg-emerald-600', badge: 'bg-emerald-500' },
};

export default function AppShell({ children }) {
  const { currentRole, providerName, roleConfig, switchRole, roles } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [queueCounts, setQueueCounts] = useState({});
  const [clock, setClock] = useState(new Date());
  const navigate = useNavigate();
  const location = useLocation();
  const colors = ROLE_COLORS[currentRole];

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const data = await api.getDashboard();
        setQueueCounts(data.queue_counts || {});
      } catch (e) { /* ignore */ }
    }
    fetchCounts();
    const iv = setInterval(fetchCounts, 15000);
    return () => clearInterval(iv);
  }, []);

  const totalActive = Object.entries(queueCounts)
    .filter(([k]) => k !== 'checked-out')
    .reduce((s, [, v]) => s + v, 0);

  const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Navigation Bar */}
      <header className={`${colors.bg} text-white sticky top-0 z-50 shadow-lg transition-colors duration-300`}>
        <div className="flex items-center justify-between px-4 h-14">
          {/* Left: Menu + Logo */}
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors lg:hidden">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
              <span className="text-xl">🩺</span>
              <div>
                <h1 className="text-base font-bold leading-tight tracking-tight">MJR-EHR</h1>
                <p className="text-[10px] opacity-75 leading-tight hidden sm:block">Intelligent Clinical Agent</p>
              </div>
            </div>
          </div>

          {/* Center: Queue Status */}
          <div className="hidden md:flex items-center gap-3 text-sm">
            {totalActive > 0 && (
              <div className="flex items-center gap-3 bg-white/10 rounded-lg px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-medium">{totalActive} active</span>
                </span>
                {queueCounts['checked-in'] > 0 && (
                  <span className="text-xs opacity-80 border-l border-white/20 pl-3">
                    {queueCounts['checked-in']} in lobby
                  </span>
                )}
                {(queueCounts['roomed'] || 0) + (queueCounts['vitals-recorded'] || 0) > 0 && (
                  <span className="text-xs opacity-80 border-l border-white/20 pl-3">
                    {(queueCounts['roomed'] || 0) + (queueCounts['vitals-recorded'] || 0)} roomed
                  </span>
                )}
              </div>
            )}
            {totalActive === 0 && (
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 text-xs opacity-80">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                No active encounters
              </div>
            )}
          </div>

          {/* Right: Clock + Role + Provider */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right text-xs opacity-80 leading-tight">
              <div className="font-medium">{formatTime(clock)}</div>
              <div>{formatDate(clock)}</div>
            </div>

            {/* Role Switcher */}
            <div className="relative">
              <button onClick={() => setRoleMenuOpen(!roleMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm">
                <span className={`w-2 h-2 rounded-full ${colors.badge}`} />
                <span className="font-medium hidden sm:inline">{roleConfig.label}</span>
                <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {roleMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setRoleMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 min-w-[200px] animate-scale-in">
                    <div className="px-4 py-2 border-b border-gray-50">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Switch Role</p>
                    </div>
                    {Object.entries(roles).map(([key, role]) => (
                      <button key={key} onClick={() => { switchRole(key); setRoleMenuOpen(false); }}
                        className={`w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3 transition-colors ${currentRole === key ? 'font-semibold text-gray-900 bg-gray-50/50' : 'text-gray-600'}`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${ROLE_COLORS[key].badge}`} />
                        <span className="flex-1">{role.label}</span>
                        {currentRole === key && <span className="text-emerald-500 text-xs">✓</span>}
                      </button>
                    ))}
                    <div className="border-t border-gray-100 mt-1 px-4 py-2.5">
                      <p className="text-xs text-gray-500 font-medium">{providerName}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed left-0 top-14 bottom-0 w-72 bg-white z-50 shadow-xl border-r border-gray-100 lg:hidden overflow-y-auto animate-slide-in-right">
            <nav className="p-3">
              <button onClick={() => { navigate('/'); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  location.pathname === '/' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                <span>🏠</span>
                <span>Dashboard</span>
              </button>
              <button onClick={() => { navigate('/audit'); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  location.pathname === '/audit' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                <span>📋</span>
                <span>Audit Log</span>
              </button>
            </nav>
            {/* Queue summary */}
            {Object.entries(queueCounts).some(([k, v]) => v > 0 && k !== 'checked-out') && (
              <div className="p-3 border-t border-gray-100">
                <p className="section-header">Active Queue</p>
                <div className="space-y-1">
                  {Object.entries(queueCounts).filter(([k, v]) => v > 0 && k !== 'checked-out').map(([state, count]) => (
                    <div key={state} className="flex items-center justify-between text-sm text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                      <span className="capitalize">{state.replace(/-/g, ' ')}</span>
                      <span className="bg-gray-100 rounded-full px-2 py-0.5 text-xs font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
