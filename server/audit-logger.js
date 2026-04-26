// ==========================================
// HIPAA AUDIT LOGGER MODULE
// ==========================================
// Provides automatic audit trail for all API activity.
// Classifies routes by PHI access, tracks sessions,
// and supports filtered querying for compliance review.

const crypto = require('crypto');
const db = require('./database');

const SESSION_HEADER = 'x-audit-session-id';
const USER_HEADER = 'x-audit-user';
const ROLE_HEADER = 'x-audit-role';

// ==========================================
// PHI ROUTE CLASSIFICATION MAP
// ==========================================
// Every API route is classified: does it touch PHI?
// What resource type is it? What fields are accessed?

const PHI_ROUTES = {
  // --- Patient endpoints (all PHI) ---
  'GET /api/patients':                    { resource_type: 'patient', action: 'READ', phi: true, phiFields: ['dob','phone','email','address','insurance_id','insurance_carrier'] },
  'GET /api/patients/:id':                { resource_type: 'patient', action: 'READ', phi: true, phiFields: ['dob','phone','email','address','insurance_id','insurance_carrier','problems','medications','allergies','labs','vitals'], extractPatientId: (req) => req.params.id },
  'POST /api/patients':                   { resource_type: 'patient', action: 'CREATE', phi: true, phiFields: ['dob','phone','email','address','insurance_id'] },
  'POST /api/patients/extract-from-speech': { resource_type: 'patient', action: 'CREATE', phi: true, phiFields: ['transcript'] },
  'POST /api/patients/:id/problems':      { resource_type: 'problem', action: 'CREATE', phi: true, phiFields: ['problem_name','icd10_code'], extractPatientId: (req) => req.params.id },
  'GET /api/patients/:id/medications':    { resource_type: 'medication', action: 'READ', phi: true, phiFields: ['medication_name','dose'], extractPatientId: (req) => req.params.id },
  'POST /api/patients/:id/medications':   { resource_type: 'medication', action: 'CREATE', phi: true, phiFields: ['medication_name','dose'], extractPatientId: (req) => req.params.id },
  'GET /api/patients/:id/allergies':      { resource_type: 'allergy', action: 'READ', phi: true, phiFields: ['allergen','reaction'], extractPatientId: (req) => req.params.id },
  'POST /api/patients/:id/allergies':     { resource_type: 'allergy', action: 'CREATE', phi: true, phiFields: ['allergen','reaction'], extractPatientId: (req) => req.params.id },
  'GET /api/patients/:id/labs':           { resource_type: 'lab_result', action: 'READ', phi: true, phiFields: ['test_name','result_value'], extractPatientId: (req) => req.params.id },
  'POST /api/patients/:id/labs':          { resource_type: 'lab_result', action: 'CREATE', phi: true, phiFields: ['test_name','result_value'], extractPatientId: (req) => req.params.id },
  'GET /api/patients/:id/vitals':         { resource_type: 'vitals', action: 'READ', phi: true, phiFields: ['systolic_bp','diastolic_bp','heart_rate','weight','height'], extractPatientId: (req) => req.params.id },

  // --- Encounter endpoints (PHI) ---
  'GET /api/encounters':                  { resource_type: 'encounter', action: 'READ', phi: true, phiFields: ['chief_complaint','transcript','soap_note'] },
  'GET /api/encounters/:id':              { resource_type: 'encounter', action: 'READ', phi: true, phiFields: ['chief_complaint','transcript','soap_note'] },
  'POST /api/encounters':                 { resource_type: 'encounter', action: 'CREATE', phi: true, phiFields: ['chief_complaint'], extractPatientId: (req) => req.body.patient_id },
  'PATCH /api/encounters/:id':            { resource_type: 'encounter', action: 'UPDATE', phi: true, phiFields: ['transcript','soap_note','chief_complaint'] },
  'GET /api/encounters/:id/orders':       { resource_type: 'encounter_orders', action: 'READ', phi: true, phiFields: ['orders_summary'] },

  // --- Vitals (PHI) ---
  'POST /api/vitals':                     { resource_type: 'vitals', action: 'CREATE', phi: true, phiFields: ['systolic_bp','diastolic_bp','heart_rate','weight'], extractPatientId: (req) => req.body.patient_id },
  'POST /api/vitals/from-speech':         { resource_type: 'vitals', action: 'CREATE', phi: true, phiFields: ['transcript'], extractPatientId: (req) => req.body.patient_id },

  // --- Prescriptions (PHI) ---
  'POST /api/prescriptions':              { resource_type: 'prescription', action: 'CREATE', phi: true, phiFields: ['medication_name','dose','instructions'], extractPatientId: (req) => req.body.patient_id },
  'POST /api/prescriptions/from-speech':  { resource_type: 'prescription', action: 'CREATE', phi: true, phiFields: ['transcript'], extractPatientId: (req) => req.body.patient_id },

  // --- Lab orders (PHI) ---
  'GET /api/lab-orders':                  { resource_type: 'lab_order', action: 'READ', phi: true, phiFields: ['test_name','indication'], extractPatientId: (req) => req.query.patient_id },
  'POST /api/lab-orders':                 { resource_type: 'lab_order', action: 'CREATE', phi: true, phiFields: ['test_name','indication'], extractPatientId: (req) => req.body.patient_id },
  'POST /api/lab-orders/from-speech':     { resource_type: 'lab_order', action: 'CREATE', phi: true, phiFields: ['transcript'], extractPatientId: (req) => req.body.patient_id },

  // --- Imaging orders (PHI) ---
  'GET /api/imaging-orders':              { resource_type: 'imaging_order', action: 'READ', phi: true, phiFields: ['study_type','indication'], extractPatientId: (req) => req.query.patient_id },
  'POST /api/imaging-orders':             { resource_type: 'imaging_order', action: 'CREATE', phi: true, phiFields: ['study_type','body_part','indication'], extractPatientId: (req) => req.body.patient_id },

  // --- Referrals (PHI) ---
  'GET /api/referrals':                   { resource_type: 'referral', action: 'READ', phi: true, phiFields: ['specialty','reason'], extractPatientId: (req) => req.query.patient_id },
  'POST /api/referrals':                  { resource_type: 'referral', action: 'CREATE', phi: true, phiFields: ['specialty','reason'], extractPatientId: (req) => req.body.patient_id },

  // --- AI endpoints (PHI - processes clinical data) ---
  'POST /api/ai/extract-data':            { resource_type: 'ai_extraction', action: 'CREATE', phi: true, phiFields: ['transcript'] },
  'POST /api/ai/generate-note':           { resource_type: 'ai_note', action: 'CREATE', phi: true, phiFields: ['transcript'] },
  'GET /api/ai/status':                   { resource_type: 'system', action: 'READ', phi: false },

  // --- CDS endpoints (suggestions are clinical but not direct PHI) ---
  'POST /api/cds/evaluate':               { resource_type: 'cds_evaluation', action: 'CREATE', phi: true, phiFields: ['clinical_context'] },
  'GET /api/cds/suggestions/:id':         { resource_type: 'cds_suggestion', action: 'READ', phi: false },
  'POST /api/cds/suggestions/:id/accept': { resource_type: 'cds_suggestion', action: 'UPDATE', phi: false },
  'POST /api/cds/suggestions/:id/reject': { resource_type: 'cds_suggestion', action: 'UPDATE', phi: false },
  'POST /api/cds/suggestions/:id/defer':  { resource_type: 'cds_suggestion', action: 'UPDATE', phi: false },

  // --- Workflow endpoints (operational, not PHI) ---
  'POST /api/workflow':                           { resource_type: 'workflow', action: 'CREATE', phi: false },
  'GET /api/workflow/:id':                        { resource_type: 'workflow', action: 'READ', phi: false },
  'POST /api/workflow/:id/transition':            { resource_type: 'workflow', action: 'TRANSITION', phi: false },
  'GET /api/workflow/:id/timeline':               { resource_type: 'workflow', action: 'READ', phi: false },
  'GET /api/workflow/queue/:id':                  { resource_type: 'workflow', action: 'READ', phi: false },
  'GET /api/workflows':                           { resource_type: 'workflow', action: 'READ', phi: false },

  // --- Provider learning (not PHI) ---
  'GET /api/provider/preferences':                { resource_type: 'provider_preferences', action: 'READ', phi: false },
  'POST /api/provider/preferences/decay':         { resource_type: 'provider_preferences', action: 'UPDATE', phi: false },

  // --- Dashboard (aggregated, contains patient list) ---
  'GET /api/dashboard':                           { resource_type: 'dashboard', action: 'READ', phi: true, phiFields: ['patient_list'] },

  // --- Patient portal: appointment booking (added with the scheduling-DB refactor) ---
  // These are the only patient-portal routes currently registered. The wider
  // gap — every other /api/patient-portal/* endpoint is currently un-audited —
  // is tracked in CLAUDE.md plan §"Pre-existing gaps" and gets its own PR.
  // extractPatientId reads req.portalPatient.id, set by requirePortalSession.
  // The middleware runs the callback inside res.on('finish'), by which point
  // req.portalPatient has been populated by the route handler chain.
  'POST /api/patient-portal/appointments/find-slots': {
    resource_type: 'appointment',
    action: 'access',
    phi: true,
    phiFields: ['appointment_date', 'provider_name'],
    extractPatientId: (req) => req.portalPatient?.id
  },
  'POST /api/patient-portal/appointments/request': {
    resource_type: 'appointment',
    action: 'CREATE',
    phi: true,
    phiFields: ['appointment_date', 'provider_name', 'chief_complaint', 'reason'],
    extractPatientId: (req) => req.portalPatient?.id
  },

  // --- MediVault patient export (Phase 3c) ---
  // This endpoint ships the patient's full clinical record as a FHIR Bundle.
  // It MUST be classified as PHI so the audit-logger middleware captures the
  // export in the central audit_log — separately from the vault_access_log
  // row the route itself writes. Two logs, two purposes: audit_log answers
  // "who hit this endpoint when", vault_access_log answers "how many times
  // has this specific patient's data been exported".
  'GET /api/medivault/export/:patientId':         { resource_type: 'vault_export', action: 'READ', phi: true, phiFields: ['fhir_bundle'], extractPatientId: (req) => req.params.patientId },

  // --- System ---
  'GET /api/health':                              { resource_type: 'system', action: 'READ', phi: false },
};

// ==========================================
// ROUTE MATCHING
// ==========================================

function matchRoute(method, path) {
  const cleanPath = path.split('?')[0].replace(/\/$/, '');
  const exactKey = `${method} ${cleanPath}`;
  if (PHI_ROUTES[exactKey]) return { key: exactKey, config: PHI_ROUTES[exactKey] };

  for (const [pattern, config] of Object.entries(PHI_ROUTES)) {
    const [patMethod, patPath] = pattern.split(' ');
    if (patMethod !== method) continue;

    const patParts = patPath.split('/');
    const reqParts = cleanPath.split('/');
    if (patParts.length !== reqParts.length) continue;

    let match = true;
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(':')) continue;
      if (patParts[i] !== reqParts[i]) { match = false; break; }
    }
    if (match) return { key: pattern, config };
  }

  return null;
}

// ==========================================
// HELPERS
// ==========================================

function methodToAction(method) {
  const map = { GET: 'READ', POST: 'CREATE', PATCH: 'UPDATE', PUT: 'UPDATE', DELETE: 'DELETE' };
  return map[method] || method;
}

function resolveUserIdentity(req) {
  // Only trust authenticated identity — never request body fields
  return req.user?.username
    || req.user?.sub
    || req.headers[USER_HEADER]
    || 'anonymous';
}

function extractResourceId(req) {
  const id = req.params?.id || req.params?.encounterId;
  return id ? parseInt(id, 10) || null : null;
}

function scrubAndTruncateBody(body, maxLen) {
  if (!body || typeof body !== 'object') return null;
  const scrubbed = { ...body };
  // Remove PHI and sensitive fields from audit log body summaries
  const PHI_SCRUB_FIELDS = [
    'transcript', 'soap_note', 'first_name', 'last_name', 'dob',
    'phone', 'email', 'insurance_id', 'address_line1', 'ssn'
  ];
  for (const field of PHI_SCRUB_FIELDS) {
    if (field in scrubbed) scrubbed[field] = '[REDACTED]';
  }
  const str = JSON.stringify(scrubbed);
  return str.length > maxLen ? str.slice(0, maxLen) + '...[truncated]' : str;
}

function buildDescription(config, req) {
  const parts = [config.action, config.resource_type];
  if (req.params?.id) parts.push(`ID:${req.params.id}`);
  if (req.params?.encounterId) parts.push(`encounter:${req.params.encounterId}`);
  return parts.join(' ').trim();
}

function generateSessionId() {
  return crypto.randomUUID();
}

function truncate(str, maxLen) {
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function extractErrorMessage(body) {
  if (!body) return null;
  if (typeof body === 'object' && body.error) return String(body.error).slice(0, 500);
  return null;
}

// ==========================================
// DATABASE OPERATIONS
// ==========================================

async function insertAuditLog(data) {
  return db.dbRun(`
    INSERT INTO audit_log (
      session_id, user_identity, user_role, action, resource_type, resource_id,
      description, request_method, request_path, request_body_summary, response_status,
      phi_accessed, phi_fields_accessed, patient_id,
      ip_address, user_agent, duration_ms, error_message
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    data.session_id, data.user_identity, data.user_role, data.action,
    data.resource_type, data.resource_id, data.description,
    data.request_method, data.request_path, data.request_body_summary,
    data.response_status, data.phi_accessed ? 1 : 0, data.phi_fields_accessed,
    data.patient_id, data.ip_address, data.user_agent, data.duration_ms,
    data.error_message
  ]);
}

async function upsertSession(sessionId, userIdentity, userRole, ip, userAgent) {
  const existing = await db.dbGet('SELECT id FROM audit_sessions WHERE id = ?', [sessionId]);
  if (existing) {
    return db.dbRun(
      'UPDATE audit_sessions SET last_activity = CURRENT_TIMESTAMP, request_count = request_count + 1 WHERE id = ?',
      [sessionId]
    );
  }
  return db.dbRun(
    'INSERT INTO audit_sessions (id, user_identity, user_role, ip_address, user_agent) VALUES (?,?,?,?,?)',
    [sessionId, userIdentity, userRole, ip, truncate(userAgent, 200)]
  );
}

// ==========================================
// AUDIT MIDDLEWARE
// ==========================================

function auditMiddleware(options = {}) {
  const {
    excludePaths = ['/api/health', '/api/ai/status'],
    maxBodySummaryLength = 500,
  } = options;

  return (req, res, next) => {
    // Use originalUrl (never mutated by sub-routers) instead of req.path,
    // because Express's `app.use('/api/patient-portal', router)` rewrites
    // req.path to the path INSIDE the router. Without this, audit_log
    // captures stripped paths like `/appointments/request` and matchRoute
    // can't pair them with the full PHI_ROUTES keys.
    const requestPath = (req.originalUrl || req.url || '').split('?')[0];

    // Skip non-API routes (static files, SPA catch-all)
    if (!requestPath.startsWith('/api/')) return next();

    // Skip excluded paths
    if (excludePaths.includes(requestPath)) return next();

    // Skip audit endpoints to prevent recursive logging
    if (requestPath.startsWith('/api/audit/')) return next();

    const startTime = Date.now();

    // Resolve session — validate UUID format to reject spoofed values
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let sessionId = req.headers[SESSION_HEADER];
    if (!sessionId || !UUID_PATTERN.test(sessionId)) {
      sessionId = generateSessionId();
      res.setHeader('X-Audit-Session-Id', sessionId);
    }

    // Resolve user identity
    const userIdentity = resolveUserIdentity(req);
    const userRole = req.headers[ROLE_HEADER] || 'unknown';

    // Attach audit context to request for downstream use
    req.auditContext = { sessionId, userIdentity, userRole, startTime };

    // Capture response body for error extraction
    let capturedBody = null;
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      capturedBody = body;
      return originalJson(body);
    };

    // Log after response completes
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      // Fire-and-forget: audit logging must never block responses
      (async () => {
        try {
          // Upsert session
          await upsertSession(sessionId, userIdentity, userRole, req.ip, req.headers['user-agent']);

          const routeMatch = matchRoute(req.method, requestPath);

          if (!routeMatch) {
            // Unclassified route — still log for completeness
            await insertAuditLog({
              session_id: sessionId,
              user_identity: userIdentity,
              user_role: userRole,
              action: methodToAction(req.method),
              resource_type: 'unknown',
              resource_id: null,
              description: `${req.method} ${requestPath}`,
              request_method: req.method,
              request_path: requestPath,
              request_body_summary: null,
              response_status: res.statusCode,
              phi_accessed: false,
              phi_fields_accessed: null,
              patient_id: null,
              ip_address: req.ip,
              user_agent: truncate(req.headers['user-agent'], 200),
              duration_ms: duration,
              error_message: res.statusCode >= 400 ? extractErrorMessage(capturedBody) : null,
            });
            return;
          }

          const { config } = routeMatch;
          let patientId = null;
          if (config.extractPatientId) {
            patientId = parseInt(config.extractPatientId(req), 10) || null;
          }

          await insertAuditLog({
            session_id: sessionId,
            user_identity: userIdentity,
            user_role: userRole,
            action: config.action || methodToAction(req.method),
            resource_type: config.resource_type,
            resource_id: extractResourceId(req),
            description: buildDescription(config, req),
            request_method: req.method,
            request_path: requestPath,
            request_body_summary: scrubAndTruncateBody(req.body, maxBodySummaryLength),
            response_status: res.statusCode,
            phi_accessed: config.phi,
            phi_fields_accessed: config.phi && config.phiFields ? JSON.stringify(config.phiFields) : null,
            patient_id: patientId,
            ip_address: req.ip,
            user_agent: truncate(req.headers['user-agent'], 200),
            duration_ms: duration,
            error_message: res.statusCode >= 400 ? extractErrorMessage(capturedBody) : null,
          });
        } catch (err) {
          console.error('Audit logging error (non-fatal):', err.message);
        }
      })();
    });

    next();
  };
}

// ==========================================
// QUERY FUNCTIONS
// ==========================================

async function queryAuditLogs({ page = 1, limit = 50, user, action, resource_type, patient_id, phi_only, date_from, date_to, search, session_id } = {}) {
  const conditions = [];
  const params = [];

  if (user) { conditions.push('user_identity LIKE ?'); params.push(`%${user}%`); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (resource_type) { conditions.push('resource_type = ?'); params.push(resource_type); }
  if (patient_id) { conditions.push('patient_id = ?'); params.push(parseInt(patient_id, 10)); }
  if (phi_only === true || phi_only === 'true') { conditions.push('phi_accessed = 1'); }
  if (date_from) { conditions.push('timestamp >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('timestamp <= ?'); params.push(date_to); }
  if (session_id) { conditions.push('session_id = ?'); params.push(session_id); }
  if (search) {
    conditions.push('(description LIKE ? OR request_path LIKE ? OR user_identity LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [logs, countResult] = await Promise.all([
    db.dbAll(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    db.dbGet(`SELECT COUNT(*) as total FROM audit_log ${where}`, params),
  ]);

  return { logs, total: countResult.total, page, limit, totalPages: Math.ceil(countResult.total / limit) };
}

async function getAuditStats({ date_from, date_to } = {}) {
  const dateFilter = [];
  const params = [];
  if (date_from) { dateFilter.push('timestamp >= ?'); params.push(date_from); }
  if (date_to) { dateFilter.push('timestamp <= ?'); params.push(date_to); }
  const where = dateFilter.length > 0 ? `WHERE ${dateFilter.join(' AND ')}` : '';
  const whereAnd = where ? where + ' AND' : 'WHERE';

  const [totalEvents, phiAccesses, byAction, byResource, byUser, recentErrors] = await Promise.all([
    db.dbGet(`SELECT COUNT(*) as count FROM audit_log ${where}`, params),
    db.dbGet(`SELECT COUNT(*) as count FROM audit_log ${whereAnd} phi_accessed = 1`, params),
    db.dbAll(`SELECT action, COUNT(*) as count FROM audit_log ${where} GROUP BY action ORDER BY count DESC`, params),
    db.dbAll(`SELECT resource_type, COUNT(*) as count FROM audit_log ${where} GROUP BY resource_type ORDER BY count DESC`, params),
    db.dbAll(`SELECT user_identity, COUNT(*) as count FROM audit_log ${where} GROUP BY user_identity ORDER BY count DESC LIMIT 10`, params),
    db.dbAll(`SELECT * FROM audit_log ${whereAnd} response_status >= 400 ORDER BY timestamp DESC LIMIT 10`, params),
  ]);

  return {
    total_events: totalEvents.count,
    phi_access_count: phiAccesses.count,
    by_action: byAction,
    by_resource: byResource,
    by_user: byUser,
    recent_errors: recentErrors,
  };
}

async function getAuditSessions({ page = 1, limit = 20, active_only = false } = {}) {
  const where = active_only ? 'WHERE is_active = 1' : '';
  const offset = (page - 1) * limit;
  const [sessions, countResult] = await Promise.all([
    db.dbAll(`SELECT * FROM audit_sessions ${where} ORDER BY last_activity DESC LIMIT ? OFFSET ?`, [limit, offset]),
    db.dbGet(`SELECT COUNT(*) as total FROM audit_sessions ${where}`),
  ]);
  return { sessions, total: countResult.total, page, limit };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  auditMiddleware,
  queryAuditLogs,
  getAuditStats,
  getAuditSessions,
  PHI_ROUTES,
  matchRoute,
  SESSION_HEADER,
};
