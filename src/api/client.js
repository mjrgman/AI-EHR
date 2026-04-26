const BASE = '/api';
const PORTAL_BASE = '/api/patient-portal';
const AUTH_STORAGE_KEY = 'ehr_auth_session_v1';

export const safeLog = {
  error: (msg, ...args) => {
    const safeArgs = args.map((arg) => {
      if (arg instanceof Error) return arg.message;
      if (typeof arg === 'object') return '[object]';
      return arg;
    });
    console.error(msg, ...safeArgs);
  }
};

function isSessionStorageAvailable() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function loadStoredJson(key) {
  if (!isSessionStorageAvailable()) return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function saveStoredJson(key, value) {
  if (!isSessionStorageAvailable()) return;
  if (!value) {
    window.sessionStorage.removeItem(key);
    return;
  }
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

let auditSessionId = isSessionStorageAvailable() ? window.sessionStorage.getItem('audit_session_id') : null;
let auditUser = null;
let auditRole = null;
let authSession = loadStoredJson(AUTH_STORAGE_KEY);
let authFailureHandler = null;

export function setAuditContext(providerName, role) {
  auditUser = providerName || null;
  auditRole = role || null;
}

export function setAuthFailureHandler(handler) {
  authFailureHandler = handler;
}

export function getStoredAuthSession() {
  return authSession ? { ...authSession } : null;
}

export function setStoredAuthSession(session) {
  authSession = session ? { ...session } : null;
  saveStoredJson(AUTH_STORAGE_KEY, authSession);
}

export function clearStoredAuthSession() {
  authSession = null;
  saveStoredJson(AUTH_STORAGE_KEY, null);
}

function handleUnauthorized() {
  clearStoredAuthSession();
  if (typeof authFailureHandler === 'function') {
    authFailureHandler();
    return;
  }

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function parseResponse(res) {
  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function refreshAccessToken() {
  if (!authSession?.refreshToken) return false;

  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authSession.refreshToken })
    });

    if (!res.ok) {
      clearStoredAuthSession();
      return false;
    }

    const payload = await res.json();
    setStoredAuthSession({
      token: payload.token,
      refreshToken: payload.refreshToken || authSession.refreshToken,
      expiresAt: payload.expiresAt || null,
    });
    return true;
  } catch {
    clearStoredAuthSession();
    return false;
  }
}

async function request(url, options = {}, meta = {}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Network connection lost. Please check your connection and try again.');
  }

  const { retryCount = 0, suppressUnauthorizedRedirect = false } = meta;
  const auditHeaders = {};
  if (auditSessionId) auditHeaders['X-Audit-Session-Id'] = auditSessionId;
  if (auditUser) auditHeaders['X-Audit-User'] = auditUser;
  if (auditRole) auditHeaders['X-Audit-Role'] = auditRole;

  const headers = {
    'Content-Type': 'application/json',
    ...auditHeaders,
    ...options.headers,
  };

  if (authSession?.token && !headers.Authorization) {
    headers.Authorization = `Bearer ${authSession.token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch (networkErr) {
    if (retryCount < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return request(url, options, { ...meta, retryCount: retryCount + 1 });
    }
    throw networkErr;
  }

  const responseSessionId = res.headers.get('X-Audit-Session-Id');
  if (responseSessionId) {
    auditSessionId = responseSessionId;
    if (isSessionStorageAvailable()) {
      window.sessionStorage.setItem('audit_session_id', responseSessionId);
    }
  }

  if (res.status === 401 && retryCount < 1 && authSession?.refreshToken && url !== '/auth/refresh' && url !== '/auth/login') {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(url, options, { ...meta, retryCount: retryCount + 1 });
    }
  }

  if (res.status === 401 || res.status === 403) {
    if (!suppressUnauthorizedRedirect) {
      handleUnauthorized();
    }
    const err = await parseResponse(res).catch(() => null);
    throw new Error(err?.error || 'Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = await parseResponse(res).catch(() => null);
    throw new Error(err?.error || err?.message || res.statusText || 'Request failed');
  }

  return parseResponse(res);
}

async function portalRequest(path, options = {}) {
  const res = await fetch(`${PORTAL_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const err = await parseResponse(res).catch(() => null);
    throw new Error(err?.error || err?.message || res.statusText || 'Portal request failed');
  }

  return parseResponse(res);
}

export const api = {
  login: async (credentials) => {
    const payload = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }, { suppressUnauthorizedRedirect: true });

    setStoredAuthSession({
      token: payload.token,
      refreshToken: payload.refreshToken,
      expiresAt: payload.refreshExpiresAt || null,
    });

    return payload;
  },
  me: () => request('/auth/me', { method: 'GET' }, { suppressUnauthorizedRedirect: true }),
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' }, { suppressUnauthorizedRedirect: true });
    } finally {
      clearStoredAuthSession();
    }
  },
  logoutAll: async () => {
    try {
      await request('/auth/logout-all', { method: 'POST' }, { suppressUnauthorizedRedirect: true });
    } finally {
      clearStoredAuthSession();
    }
  },

  getPatients: () => request('/patients'),
  getPatient: (id) => request(`/patients/${id}`),
  createPatient: (data) => request('/patients', { method: 'POST', body: JSON.stringify(data) }),
  getEncounters: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/encounters${q ? `?${q}` : ''}`);
  },
  getEncounter: (id) => request(`/encounters/${id}`),
  createEncounter: (data) => request('/encounters', { method: 'POST', body: JSON.stringify(data) }),
  updateEncounter: (id, data) => request(`/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getEncounterOrders: (id) => request(`/encounters/${id}/orders`),
  addVitals: (data) => request('/vitals', { method: 'POST', body: JSON.stringify(data) }),
  addVitalsFromSpeech: (data) => request('/vitals/from-speech', { method: 'POST', body: JSON.stringify(data) }),
  getLabOrders: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/lab-orders${q ? `?${q}` : ''}`);
  },
  createLabOrder: (data) => request('/lab-orders', { method: 'POST', body: JSON.stringify(data) }),
  getImagingOrders: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/imaging-orders${q ? `?${q}` : ''}`);
  },
  createImagingOrder: (data) => request('/imaging-orders', { method: 'POST', body: JSON.stringify(data) }),
  getReferrals: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/referrals${q ? `?${q}` : ''}`);
  },
  createReferral: (data) => request('/referrals', { method: 'POST', body: JSON.stringify(data) }),
  createPrescription: (data) => request('/prescriptions', { method: 'POST', body: JSON.stringify(data) }),
  extractData: (data) => request('/ai/extract-data', { method: 'POST', body: JSON.stringify(data) }),
  generateNote: (data) => request('/ai/generate-note', { method: 'POST', body: JSON.stringify(data) }),
  getWorkflow: (encounterId) => request(`/workflow/${encounterId}`),
  createWorkflow: (data) => request('/workflow', { method: 'POST', body: JSON.stringify(data) }),
  transitionWorkflow: (encounterId, data) => request(`/workflow/${encounterId}/transition`, { method: 'POST', body: JSON.stringify(data) }),
  getTimeline: (encounterId) => request(`/workflow/${encounterId}/timeline`),
  getQueue: (state) => request(`/workflow/queue/${state}`),
  getAllWorkflows: () => request('/workflows'),
  evaluateCDS: (data) => request('/cds/evaluate', { method: 'POST', body: JSON.stringify(data) }),
  getSuggestions: (encounterId, status) => {
    const q = status ? `?status=${status}` : '';
    return request(`/cds/suggestions/${encounterId}${q}`);
  },
  acceptSuggestion: (id, data) => request(`/cds/suggestions/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  rejectSuggestion: (id, data) => request(`/cds/suggestions/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  deferSuggestion: (id) => request(`/cds/suggestions/${id}/defer`, { method: 'POST', body: JSON.stringify({}) }),
  getProviderPreferences: (provider) => request(`/provider/preferences?provider=${encodeURIComponent(provider)}`),
  getDashboard: () => request('/dashboard'),
  getHealth: () => request('/health'),
  getAuditLogs: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/audit/logs${q ? `?${q}` : ''}`);
  },
  getAuditStats: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/audit/stats${q ? `?${q}` : ''}`);
  },
  getAuditSessions: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/audit/sessions${q ? `?${q}` : ''}`);
  },
  getPatientAuditTrail: (patientId) => request(`/audit/patient/${patientId}`),
  getSchedule: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/schedule${q ? `?${q}` : ''}`);
  },
  getPatientAppointments: (patientId) => request(`/patients/${patientId}/appointments`),
  getAppointment: (id) => request(`/appointments/${id}`),
  createAppointment: (data) => request('/appointments', { method: 'POST', body: JSON.stringify(data) }),
  updateAppointment: (id, data) => request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAppointment: (id) => request(`/appointments/${id}`, { method: 'DELETE' }),
  getCharge: (encounterId) => request(`/encounters/${encounterId}/charge`),
  updateCharge: (encounterId, data) => request(`/encounters/${encounterId}/charge`, { method: 'POST', body: JSON.stringify(data) }),
  finalizeCheckout: (encounterId, data) => request(`/encounters/${encounterId}/checkout`, { method: 'POST', body: JSON.stringify(data) }),
  getBillingCharges: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/billing/charges${q ? `?${q}` : ''}`);
  },
  addProblem: (patientId, data) => request(`/patients/${patientId}/problems`, { method: 'POST', body: JSON.stringify(data) }),
  addMedication: (patientId, data) => request(`/patients/${patientId}/medications`, { method: 'POST', body: JSON.stringify(data) }),
  addAllergy: (patientId, data) => request(`/patients/${patientId}/allergies`, { method: 'POST', body: JSON.stringify(data) }),
  runAgentPipeline: (data) => request('/agents/run', { method: 'POST', body: JSON.stringify(data) }),
  getAgentBriefing: (patientId, encounterId) => request(`/agents/briefing/${patientId}${encounterId ? `?encounter_id=${encounterId}` : ''}`),
  runMAAgent: (data) => request('/agents/ma', { method: 'POST', body: JSON.stringify(data) }),
};

export const portalApi = {
  verify: (payload) => portalRequest('/verify', { method: 'POST', body: JSON.stringify(payload) }),
  getSession: () => portalRequest('/session'),
  logout: () => portalRequest('/logout', { method: 'POST' }),
  getAppointments: () => portalRequest('/appointments'),
  checkInAppointment: (appointmentId) => portalRequest('/appointments/checkin', {
    method: 'POST',
    body: JSON.stringify({ appointment_id: appointmentId }),
  }),
  findAppointmentSlots: (payload) => portalRequest('/appointments/find-slots', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  requestAppointment: (payload) => portalRequest('/appointments/request', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  getMedications: () => portalRequest('/medications'),
  getLabs: () => portalRequest('/labs'),
  getMessages: () => portalRequest('/messages'),
  sendMessage: (payload) => portalRequest('/message', { method: 'POST', body: JSON.stringify(payload) }),
  requestRefill: (payload) => portalRequest('/refill-request', { method: 'POST', body: JSON.stringify(payload) }),
  submitSymptomTriage: (payload) => portalRequest('/symptom-triage', { method: 'POST', body: JSON.stringify(payload) }),
  getVisitPrep: () => portalRequest('/visit-prep'),
  processVoiceIntent: (transcript) => portalRequest('/voice-intent', {
    method: 'POST',
    body: JSON.stringify({ transcript }),
  }),
};

export default api;
