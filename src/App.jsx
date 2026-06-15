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
        <div className="flex h-screen items-center justify-center bg-ivory-200" role="alert">
          <div className="mx-4 max-w-md rounded-2xl border border-slate-100 bg-offWhite-100 p-8 text-center shadow-mc-xl">
            <h1 className="mb-3 font-display text-2xl font-semibold text-navy-700">Something went wrong</h1>
            <p className="mb-6 text-sm leading-6 text-slate-600">
              The application hit an unexpected error. Any work that was already auto-saved is preserved, but
              unsaved changes on this screen may be lost. Reloading restarts the app safely.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  window.location.reload();
                }}
                className="rounded-lg bg-navy-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-700"
              >
                Reload application
              </button>
              <button
                onClick={() => window.location.assign('/')}
                className="rounded-lg border border-slate-200 bg-offWhite-100 px-6 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-ivory-200"
              >
                Return to dashboard
              </button>
            </div>
            {this.state.message ? (
              <details className="mt-5 text-left">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500">Technical detail</summary>
                <p className="mt-2 break-words rounded-lg bg-ivory-200 p-3 font-mono text-[11px] text-slate-600">{this.state.message}</p>
              </details>
            ) : null}
            <p className="mt-5 text-[11px] text-slate-400">Synthetic EHR Demo · No PHI · Not for clinical use</p>
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
