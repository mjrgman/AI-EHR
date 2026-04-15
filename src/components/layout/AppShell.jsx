import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';

const ROLE_COLORS = {
  reception: { bg: 'bg-blue-700', badge: 'bg-blue-400' },
  ma: { bg: 'bg-purple-700', badge: 'bg-purple-400' },
  provider: { bg: 'bg-emerald-700', badge: 'bg-emerald-400' },
};

export default function AppShell({ children }) {
  const { currentRole, providerName, roleConfig, logout, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [queueCounts, setQueueCounts] = useState({});
  const [queueError, setQueueError] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const colors = ROLE_COLORS[currentRole] || ROLE_COLORS.provider;

  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const data = await api.getDashboard();
        setQueueCounts(data.queue_counts || {});
        setQueueError(false);
      } catch {
        setQueueError(true);
      }
    }

    fetchCounts();
    const interval = setInterval(fetchCounts, 15000);
    return () => clearInterval(interval);
  }, []);

  const totalActive = Object.entries(queueCounts)
    .filter(([key]) => key !== 'checked-out')
    .reduce((sum, [, value]) => sum + value, 0);

  const formatTime = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatDate = (date) => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
      setMenuOpen(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className={`${colors.bg} sticky top-0 z-50 text-white shadow-lg`}>
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-lg p-2 transition-colors hover:bg-white/10 lg:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button className="flex items-center gap-2" onClick={() => navigate('/')}>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold tracking-[0.2em]">AI</span>
              <div className="text-left">
                <h1 className="text-base font-bold leading-tight tracking-tight">MJR-EHR</h1>
                <p className="hidden text-[10px] leading-tight opacity-75 sm:block">Intelligent Clinical Agent</p>
              </div>
            </button>
          </div>

          <div className="hidden items-center gap-3 text-sm md:flex">
            {queueError ? (
              <div className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-100">
                Queue unavailable
              </div>
            ) : (
              <div className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium">
                {totalActive > 0 ? `${totalActive} active encounters` : 'No active encounters'}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight opacity-80 sm:block">
              <div className="font-medium">{formatTime(clock)}</div>
              <div>{formatDate(clock)}</div>
            </div>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
              >
                <span className={`h-2 w-2 rounded-full ${colors.badge}`} />
                <span className="hidden font-medium sm:inline">{roleConfig.label}</span>
                <svg className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-gray-100 bg-white py-2 text-slate-900 shadow-xl">
                    <div className="border-b border-gray-100 px-4 pb-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Session</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{providerName}</p>
                      <p className="text-xs text-slate-500">{user?.username}</p>
                    </div>
                    <div className="border-t border-gray-100 px-4 pt-3">
                      <button
                        onClick={handleLogout}
                        disabled={loggingOut}
                        className="w-full rounded-lg border border-red-100 px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {loggingOut ? 'Signing out...' : 'Sign out'}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {sidebarOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed bottom-0 left-0 top-14 z-50 w-72 overflow-y-auto border-r border-gray-100 bg-white shadow-xl lg:hidden">
            <nav className="p-3">
              {[
                { path: '/', label: 'Dashboard' },
                { path: '/schedule', label: 'Schedule' },
                { path: '/audit', label: 'Audit Log' },
              ].map((item) => (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    setSidebarOpen(false);
                  }}
                  className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${
                    location.pathname === item.path ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
        </>
      ) : null}

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
