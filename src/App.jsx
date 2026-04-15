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
const EncounterPage = lazy(() => import('./pages/EncounterPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const CheckOutPage = lazy(() => import('./pages/CheckOutPage'));
const PatientPage = lazy(() => import('./pages/PatientPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const PatientPortal = lazy(() => import('./pages/PatientPortal'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    console.error('[ErrorBoundary] Component error caught');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <div className="p-8 text-center">
            <h1 className="mb-4 text-2xl font-bold text-gray-800">Something went wrong</h1>
            <p className="mb-6 text-gray-600">The application encountered an error. Your work has been auto-saved.</p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
            >
              Reload Application
            </button>
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
                    <Route path="/encounter/:encounterId" element={<EncounterPage />} />
                    <Route path="/review/:encounterId" element={<ReviewPage />} />
                    <Route path="/checkout/:encounterId" element={<CheckOutPage />} />
                    <Route path="/audit" element={<AuditPage />} />
                    <Route path="/schedule" element={<SchedulePage />} />
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
