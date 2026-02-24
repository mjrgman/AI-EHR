import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setAuditContext } from '../api/client';

const AuthContext = createContext(null);

const ROLES = {
  reception: { label: 'Reception', color: 'blue' },
  ma: { label: 'Medical Assistant', color: 'purple' },
  provider: { label: 'Provider', color: 'green' }
};

export function AuthProvider({ children }) {
  const [currentRole, setCurrentRole] = useState('provider');
  const [providerName, setProviderName] = useState('Dr. MJR');

  // Sync audit identity to API client whenever role or name changes
  useEffect(() => {
    setAuditContext(providerName, currentRole);
  }, [providerName, currentRole]);

  const switchRole = useCallback((role) => {
    if (ROLES[role]) setCurrentRole(role);
  }, []);

  return (
    <AuthContext.Provider value={{ currentRole, providerName, roleConfig: ROLES[currentRole], switchRole, setProviderName, roles: ROLES }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
