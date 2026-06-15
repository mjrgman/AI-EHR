import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import DemoBanner from '../common/DemoBanner';

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
    path: '/patients',
    label: 'Patients',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'front_desk', 'billing', 'system'],
  },
  {
    path: '/schedule',
    label: 'Schedule',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'front_desk', 'billing', 'system'],
  },
  {
    // Provider Decision Queue (AI triage + one-click dispositions). Shown for
    // providers; MA also sees it for the close-out worklist surfaced on the page.
    path: '/decisions',
    label: 'Decisions',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'system'],
  },
  {
    path: '/billing',
    label: 'Billing',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'billing', 'system'],
  },
  {
    // B1: Staff portal inbox — portal-originated work (messages, refills, appt requests)
    path: '/inbox',
    label: 'Inbox',
    roles: ['physician', 'nurse_practitioner', 'physician_assistant', 'ma', 'front_desk'],
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
  // Global patient search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef(null);
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

  // Global patient search — typeahead over GET /api/patients
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const patients = await api.getPatients();
        const q = searchQuery.toLowerCase();
        const filtered = (patients || []).filter((p) => {
          const full = `${p.first_name} ${p.last_name}`.toLowerCase();
          const mrn = (p.mrn || '').toLowerCase();
          return full.includes(q) || mrn.includes(q);
        }).slice(0, 8);
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    function onDown(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function handleSearchSelect(patient) {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    navigate(`/patient/${patient.id}`);
  }

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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-navy-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-mc-lg"
      >
        Skip to main content
      </a>
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
                    aria-current={active ? 'page' : undefined}
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

          {/* Global patient search — typeahead over /api/patients */}
          <div className="hidden md:flex items-center flex-1 max-w-xs mx-4 relative" ref={searchRef}>
            <div className="relative w-full">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search patients…"
                value={searchQuery}
                aria-label="Global patient search"
                className="w-full rounded-lg bg-white/10 border border-white/20 pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/50 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-gold-400"
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
            </div>
            {searchOpen && (searchQuery.trim().length > 0) && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-slate-100 bg-offWhite-100 py-1 shadow-mc-xl text-navy-700">
                {searchLoading && <div className="px-4 py-2 text-xs text-slate-500">Searching…</div>}
                {!searchLoading && searchResults.length === 0 && (
                  <div className="px-4 py-2 text-xs text-slate-500">No patients found</div>
                )}
                {!searchLoading && searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSearchSelect(p)}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-ivory-200 transition-colors"
                  >
                    <span className="font-medium text-navy-700">{p.last_name}, {p.first_name}</span>
                    {p.mrn && <span className="ml-2 text-xs text-slate-500">MRN {p.mrn}</span>}
                  </button>
                ))}
              </div>
            )}
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

      <DemoBanner className="sticky top-14 z-40" />

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
                  aria-current={isActiveNav(item.path) ? 'page' : undefined}
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

      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto outline-none">{children}</main>

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
