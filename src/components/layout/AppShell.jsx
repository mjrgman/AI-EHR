import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';

// Measured Canon: the top nav is navy authority for every role. The role
// identity now reads through the status-dot accent only (gold/slate/success),
// not a different nav background — keeping the rebrand cohesive.
const ROLE_COLORS = {
  reception: { bg: 'bg-navy-600', badge: 'bg-gold-400' },
  ma: { bg: 'bg-navy-600', badge: 'bg-slate-300' },
  provider: { bg: 'bg-navy-600', badge: 'bg-success-400' },
};

const NAV_ITEMS = [
  {
    path: '/',
    label: 'Dashboard',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'front_desk', 'billing', 'system'],
  },
  {
    path: '/schedule',
    label: 'Schedule',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'front_desk', 'billing', 'system'],
  },
  { path: '/audit', label: 'Audit Log', roles: ['admin'] },
];

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
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);

  const formatTime = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatDate = (date) => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const isActiveNav = (path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));
  const defaultNavPath = visibleNavItems[0]?.path || '/';

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
    <div className="min-h-screen bg-ivory-200 flex flex-col">
      <header className={`${colors.bg} sticky top-0 z-50 text-white shadow-mc-lg border-b border-navy-800`}>
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-lg p-2 transition-colors hover:bg-white/10 lg:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button type="button" className="flex items-center gap-2.5" onClick={() => navigate(defaultNavPath)}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold-400/60 bg-gold-500/15 text-[11px] font-bold tracking-[0.12em] text-gold-300">AI</span>
              <div className="text-left">
                <h1 className="font-display text-base font-semibold leading-tight tracking-tight">MJR-EHR</h1>
                <p className="hidden text-[10px] leading-tight text-white/70 sm:block">Intelligent Clinical Agent</p>
              </div>
            </button>
            <nav className="ml-3 hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
              {visibleNavItems.map((item) => {
                const active = isActiveNav(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className={`relative rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {item.label}
                    {active && (
                      <span className="pointer-events-none absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full bg-gold-400" />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="hidden items-center gap-3 text-sm md:flex">
            {queueError ? (
              <div className="rounded-lg border border-danger-300/40 bg-danger-500/25 px-3 py-1.5 text-xs font-medium text-danger-50">
                Queue unavailable
              </div>
            ) : (
              <div className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90">
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
                type="button"
                aria-label="Open session menu"
                aria-expanded={menuOpen}
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
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-slate-100 bg-offWhite-100 py-2 text-navy-700 shadow-mc-xl">
                    <div className="border-b border-slate-100 px-4 pb-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Session</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm font-semibold text-navy-700">{providerName}</p>
                      <p className="text-xs text-slate-500">{user?.username}</p>
                    </div>
                    <div className="border-t border-slate-100 px-4 pt-3">
                      <button
                        type="button"
                        onClick={handleLogout}
                        disabled={loggingOut}
                        className="w-full rounded-lg border border-danger-100 px-3 py-2 text-left text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 disabled:opacity-50"
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

      <div
        role="status"
        aria-live="off"
        className="sticky top-14 z-40 flex items-center justify-center gap-2 border-b border-gold-200 bg-gold-50 px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-gold-800 shadow-mc"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
        Synthetic EHR Demo · No PHI · Not for clinical use
      </div>

      {sidebarOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-navy-900/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed bottom-0 left-0 top-14 z-50 w-72 overflow-y-auto border-r border-slate-100 bg-offWhite-100 shadow-mc-xl lg:hidden">
            <nav className="p-3">
              {visibleNavItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    navigate(item.path);
                    setSidebarOpen(false);
                  }}
                  className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${
                    isActiveNav(item.path)
                      ? 'border-l-2 border-gold-400 bg-navy-50 text-navy-700'
                      : 'text-slate-600 hover:bg-ivory-200'
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

      <footer className="border-t border-slate-100 bg-offWhite-100/70 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden="true" />
            System Online
          </span>
          <span className="hidden sm:inline">{roleConfig.label}</span>
          <span className="font-medium tracking-wide">MJR-EHR · v1.0</span>
        </div>
      </footer>
    </div>
  );
}
