import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api, {
  clearStoredAuthSession,
  getStoredAuthSession,
  setAuditContext,
  setAuthFailureHandler,
} from '../api/client';

const AuthContext = createContext(null);

const UI_ROLE_CONFIG = {
  physician: { key: 'provider', label: 'Physician', color: 'green' },
  nurse_practitioner: { key: 'provider', label: 'Nurse Practitioner', color: 'green' },
  physician_assistant: { key: 'provider', label: 'Physician Assistant', color: 'green' },
  ma: { key: 'ma', label: 'Medical Assistant', color: 'purple' },
  front_desk: { key: 'reception', label: 'Front Desk', color: 'blue' },
  billing: { key: 'reception', label: 'Billing', color: 'blue' },
  admin: { key: 'provider', label: 'Administrator', color: 'green' },
  system: { key: 'provider', label: 'System', color: 'green' },
};

function getRoleConfig(userRole) {
  return UI_ROLE_CONFIG[userRole] || { key: 'provider', label: 'Clinician', color: 'green' };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    setAuthFailureHandler(() => {
      if (!isMounted) return;
      clearStoredAuthSession();
      setUser(null);
      setLoading(false);
    });

    const hydrate = async () => {
      const session = getStoredAuthSession();
      if (!session?.token) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const me = await api.me();
        if (isMounted) {
          setUser(me);
        }
      } catch {
        clearStoredAuthSession();
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
      setAuthFailureHandler(null);
    };
  }, []);

  const roleConfig = useMemo(() => getRoleConfig(user?.role), [user?.role]);
  const currentRole = roleConfig.key;
  const providerName = user?.fullName || user?.username || '';

  useEffect(() => {
    if (!providerName) return;
    setAuditContext(providerName, user?.role || currentRole);
  }, [currentRole, providerName, user?.role]);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: Boolean(user),
    currentRole,
    providerName,
    roleConfig,
    roles: { [currentRole]: roleConfig },
    switchRole: () => {},
    login: async (credentials) => {
      const result = await api.login(credentials);
      const me = result.user || await api.me();
      setUser(me);
      return me;
    },
    logout: async () => {
      await api.logout();
      setUser(null);
    },
    logoutAll: async () => {
      await api.logoutAll();
      setUser(null);
    },
  }), [currentRole, loading, providerName, roleConfig, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
