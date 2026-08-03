import React, { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { EncounterProvider } from './context/EncounterContext';
import { ToastProvider } from './components/common/Toast';
import LoadingSpinner from './components/common/LoadingSpinner';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AppShell from './components/layout/AppShell';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CheckInPage = lazy(() => import('./pages/CheckInPage'));
const MAPage = lazy(() => import('./pages/MAPage'));
const DecisionQueuePage = lazy(() => import('./pages/DecisionQueuePage'));
const EncounterPage = lazy(() => import('./pages/EncounterPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const CheckOutPage = lazy(() => import('./pages/CheckOutPage'));
const PatientPage = lazy(() => import('./pages/PatientPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const PatientPortal = lazy(() => import('./pages/PatientPortal'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const VisitSummaryPage = lazy(() => import('./pages/VisitSummaryPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const PatientsPage = lazy(() => import('./pages/PatientsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || '' };
  }

  componentDidCatch(error) {
    console.error('[ErrorBoundary] Component error caught:', error?.message || error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black" role="alert">
          <div className="mx-4 max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="mb-3 font-display text-2xl font-semibold text-white tracking-tight">System Exception</h1>
            <p className="mb-6 text-sm leading-relaxed text-slate-400">
              The clinical agent hit an unexpected exception. Any work that was already auto-saved is preserved, but unsaved changes on this screen may be lost. Reloading restarts the module safely.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  window.location.reload();
                }}
                className="rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:scale-105 hover:shadow-cyan-500/40 active:scale-95"
              >
                Reload module
              </button>
              <button
                onClick={() => window.location.assign('/')}
                className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white active:scale-95"
              >
                Return to dashboard
              </button>
            </div>
            {this.state.message ? (
              <details className="mt-6 text-left group">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-400 transition-colors focus:outline-none">Technical detail</summary>
                <p className="mt-3 break-words rounded-xl border border-white/5 bg-black/40 p-4 font-mono text-[11px] text-slate-400 leading-relaxed overflow-x-auto shadow-inner">{this.state.message}</p>
              </details>
            ) : null}
            <div className="mt-6 pt-5 border-t border-white/10">
              <p className="text-[11px] font-medium tracking-widest text-cyan-500/40 uppercase">Synthetic EHR Demo · No PHI</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function RoutedShell() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RouteFallback() {
  return <LoadingSpinner message="Loading page..." />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EncounterProvider>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/portal" element={<PatientPortal />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<RoutedShell />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/patient/:patientId" element={<PatientPage />} />
                    <Route path="/checkin/:encounterId" element={<CheckInPage />} />
                    <Route path="/ma/:encounterId" element={<MAPage />} />
                    <Route path="/decisions" element={<DecisionQueuePage />} />
                    <Route path="/encounter/:encounterId" element={<EncounterPage />} />
                    <Route path="/review/:encounterId" element={<ReviewPage />} />
                    <Route path="/checkout/:encounterId" element={<CheckOutPage />} />
                    <Route path="/audit" element={<AuditPage />} />
                    <Route path="/schedule" element={<SchedulePage />} />
                    <Route path="/visit/:encounterId" element={<VisitSummaryPage />} />
                    <Route path="/billing" element={<BillingPage />} />
                    <Route path="/patients" element={<PatientsPage />} />
                    <Route path="/inbox" element={<InboxPage />} />
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </EncounterProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
