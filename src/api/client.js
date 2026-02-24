const BASE = '/api';

// Audit session tracking
let auditSessionId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('audit_session_id') : null;
let auditUser = null;
let auditRole = null;

export function setAuditContext(providerName, role) {
  auditUser = providerName;
  auditRole = role;
}

async function request(url, options = {}) {
  const auditHeaders = {};
  if (auditSessionId) auditHeaders['X-Audit-Session-Id'] = auditSessionId;
  if (auditUser) auditHeaders['X-Audit-User'] = auditUser;
  if (auditRole) auditHeaders['X-Audit-Role'] = auditRole;

  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...auditHeaders, ...options.headers },
    ...options
  });

  // Capture session ID from server response
  const responseSessionId = res.headers.get('X-Audit-Session-Id');
  if (responseSessionId) {
    auditSessionId = responseSessionId;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('audit_session_id', responseSessionId);
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  getPatients: () => request('/patients'),
  getPatient: (id) => request(`/patients/${id}`),
  createPatient: (data) => request('/patients', { method: 'POST', body: JSON.stringify(data) }),
  getEncounters: (params) => { const q = new URLSearchParams(params).toString(); return request(`/encounters${q ? '?' + q : ''}`); },
  getEncounter: (id) => request(`/encounters/${id}`),
  createEncounter: (data) => request('/encounters', { method: 'POST', body: JSON.stringify(data) }),
  updateEncounter: (id, data) => request(`/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getEncounterOrders: (id) => request(`/encounters/${id}/orders`),
  addVitals: (data) => request('/vitals', { method: 'POST', body: JSON.stringify(data) }),
  addVitalsFromSpeech: (data) => request('/vitals/from-speech', { method: 'POST', body: JSON.stringify(data) }),
  getLabOrders: (params) => { const q = new URLSearchParams(params).toString(); return request(`/lab-orders${q ? '?' + q : ''}`); },
  createLabOrder: (data) => request('/lab-orders', { method: 'POST', body: JSON.stringify(data) }),
  getImagingOrders: (params) => { const q = new URLSearchParams(params).toString(); return request(`/imaging-orders${q ? '?' + q : ''}`); },
  createImagingOrder: (data) => request('/imaging-orders', { method: 'POST', body: JSON.stringify(data) }),
  getReferrals: (params) => { const q = new URLSearchParams(params).toString(); return request(`/referrals${q ? '?' + q : ''}`); },
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
  getSuggestions: (encounterId, status) => { const q = status ? `?status=${status}` : ''; return request(`/cds/suggestions/${encounterId}${q}`); },
  acceptSuggestion: (id, data) => request(`/cds/suggestions/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  rejectSuggestion: (id, data) => request(`/cds/suggestions/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  deferSuggestion: (id) => request(`/cds/suggestions/${id}/defer`, { method: 'POST', body: JSON.stringify({}) }),
  getProviderPreferences: (provider) => request(`/provider/preferences?provider=${encodeURIComponent(provider)}`),
  getDashboard: () => request('/dashboard'),
  getHealth: () => request('/health'),

  // Audit endpoints
  getAuditLogs: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/logs${q ? '?' + q : ''}`); },
  getAuditStats: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/stats${q ? '?' + q : ''}`); },
  getAuditSessions: (params) => { const q = new URLSearchParams(params).toString(); return request(`/audit/sessions${q ? '?' + q : ''}`); },
  getPatientAuditTrail: (patientId) => request(`/audit/patient/${patientId}`),
};

export default api;
