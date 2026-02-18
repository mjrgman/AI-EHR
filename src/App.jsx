import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { EncounterProvider } from './context/EncounterContext';
import { ToastProvider } from './components/common/Toast';
import AppShell from './components/layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import CheckInPage from './pages/CheckInPage';
import MAPage from './pages/MAPage';
import EncounterPage from './pages/EncounterPage';
import ReviewPage from './pages/ReviewPage';
import CheckOutPage from './pages/CheckOutPage';
import PatientPage from './pages/PatientPage';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EncounterProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/patient/:patientId" element={<PatientPage />} />
              <Route path="/checkin/:encounterId" element={<CheckInPage />} />
              <Route path="/ma/:encounterId" element={<MAPage />} />
              <Route path="/encounter/:encounterId" element={<EncounterPage />} />
              <Route path="/review/:encounterId" element={<ReviewPage />} />
              <Route path="/checkout/:encounterId" element={<CheckOutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </EncounterProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
