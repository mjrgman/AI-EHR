# EHR Security Modules - Integration Guide

This guide explains how to integrate the HIPAA middleware and RBAC system into your Express server.

## Overview

Two production-ready security modules have been added:

1. **`hipaa-middleware.js`** (659 lines)
   - PHI access logging with audit trail
   - Session management with automatic timeout
   - Request sanitization (SQL injection prevention)
   - Rate limiting per user
   - Security headers (HSTS, CSP, X-Frame-Options, etc.)
   - PHI field detection in responses

2. **`rbac.js`** (743 lines)
   - Role-Based Access Control system
   - 7 predefined roles: physician, nurse_practitioner, ma, front_desk, billing, admin, system
   - Resource-level authorization (patients, encounters, prescriptions, etc.)
   - PHI field filtering by role
   - Express middleware for route protection

## Quick Start

### 1. Initialize in your server.js

```javascript
const express = require('express');
const db = require('./database');
const hipaa = require('./security/hipaa-middleware');
const rbac = require('./security/rbac');

const app = express();

// Initialize HIPAA middleware with database
hipaa.init(db).then(() => {
  console.log('✓ HIPAA middleware initialized');
}).catch(err => {
  console.error('✗ HIPAA initialization failed:', err);
  process.exit(1);
});

// Apply security middleware in this order:
// 1. Security headers
app.use(hipaa.securityHeaders);

// 2. Body parsing (already done with express.json)
app.use(express.json());

// 3. Session tracking
app.use(hipaa.sessionTracker);

// 4. Request sanitization
app.use(hipaa.requestSanitizer);

// 5. Rate limiting
app.use(hipaa.rateLimiter);

// 6. Auto-logout check
app.use(hipaa.autoLogout);
```

### 2. Protect routes with role-based access

```javascript
// Physician/NP only access
app.get('/api/patients/:id', 
  rbac.requireRole('physician', 'nurse_practitioner'),
  rbac.filterResponse,
  async (req, res) => {
    // Handler code
  }
);

// Prescribing endpoint (requires sign permission)
app.post('/api/prescriptions',
  rbac.requireRole('physician', 'nurse_practitioner'),
  rbac.requirePermission('sign', 'prescriptions'),
  async (req, res) => {
    // Only physicians/NPs can sign prescriptions
  }
);

// Medical assistant vitals entry
app.post('/api/encounters/:id/vitals',
  rbac.requireRole('ma', 'physician', 'nurse_practitioner'),
  rbac.requirePermission('write', 'vitals'),
  async (req, res) => {
    // Only MAs and providers can record vitals
  }
);

// Billing staff access (filtered to billing-relevant fields)
app.get('/api/encounters/:id/coding',
  rbac.requireRole('billing'),
  rbac.requireResourceAccess('billing'),
  rbac.filterResponse,
  async (req, res) => {
    // Response automatically filtered to ICD-10, CPT, demographics only
  }
);

// Audit log access (admin only)
app.get('/api/audit-logs',
  rbac.requireRole('admin'),
  async (req, res) => {
    // Only admins can view audit logs
  }
);
```

### 3. Protect PHI-accessing endpoints with logging

```javascript
// Patient data endpoints automatically log PHI access
app.get('/api/patients/:id/medications',
  hipaa.phiAccessLogger,  // Logs which PHI fields were returned
  rbac.requireRole('physician', 'nurse_practitioner', 'ma'),
  rbac.filterResponse,
  async (req, res) => {
    const patient = await db.getPatientById(req.params.id);
    res.json(patient);
    // phiAccessLogger automatically logs: meds, patient_id, user, timestamp, duration
  }
);

// Billing access (logs without clinical PHI access)
app.get('/api/encounters/:id/codes',
  hipaa.phiAccessLogger,
  rbac.requireRole('billing'),
  rbac.filterResponse,
  async (req, res) => {
    const encounter = await db.getEncounter(req.params.id);
    res.json(encounter);
    // phiAccessLogger logs: ICD-10 code access, user, timestamp
    // Clinical notes NOT returned due to filterResponse
  }
);
```

## Expected User Request Headers

The middleware expects user context in headers (normally set by auth middleware):

```
X-User-Id: provider@clinic.local
X-User-Role: physician
X-Session-Id: <hex-token>  (optional - created on first request)
```

Example with curl:
```bash
curl -X GET http://localhost:3000/api/patients/42 \
  -H "X-User-Id: provider@clinic.local" \
  -H "X-User-Role: physician" \
  -H "Content-Type: application/json"
```

## Session Management

Sessions automatically:
- **Timeout after 15 minutes of inactivity** (HIPAA compliance)
- **Track all requests** in `audit_sessions` table
- **Generate cryptographic tokens** (256-bit)
- **Clean up expired sessions** every 5 minutes

Programmatic session control:
```javascript
const hipaa = require('./security/hipaa-middleware');

// Create session manually
const sessionId = await hipaa.createSession(
  'provider@clinic.local',
  'physician',
  '192.168.1.100',
  'Mozilla/5.0...'
);
// Returns: hex string session ID

// Validate existing session
const sessionData = await hipaa.validateSession(sessionId);
// Returns: { userId, userRole, ipAddress, userAgent, lastActivity }
// or null if expired

// Logout user
await hipaa.invalidateSession(sessionId);
```

## Rate Limiting

Built-in per-user rate limits:
- **Normal users**: 100 requests/minute
- **System agents**: 500 requests/minute

Response headers show remaining quota:
```
X-RateLimit-Remaining: 47
```

When limit exceeded:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 23
}
```

## PHI Logging

Automatically logs access to:
- **Patient demographics**: first/last name, DOB, phone, email, address
- **Medical record numbers**: MRN, SSN
- **Clinical data**: diagnosis, medications, allergies, vital signs, lab results
- **Insurance**: carrier, policy numbers

Audit log schema (all requests logged):
```sql
INSERT INTO audit_log (
  session_id,           -- Active session
  user_identity,        -- User email
  user_role,            -- physician, ma, billing, etc.
  action,               -- READ, CREATE, UPDATE, DELETE
  resource_type,        -- patients, prescriptions, etc.
  resource_id,          -- ID of record accessed
  patient_id,           -- Patient affected
  phi_accessed,         -- 1 if any PHI in response
  phi_fields_accessed,  -- "Name, DOB, Phone"
  ip_address,
  user_agent,
  request_method,       -- GET, POST, etc.
  request_path,         -- /api/patients/42
  request_body_summary, -- Field names only, no values
  response_status,      -- 200, 403, etc.
  duration_ms
)
```

Query recent PHI access:
```sql
-- All PHI access in last 24 hours
SELECT user_identity, action, patient_id, phi_fields_accessed, timestamp
FROM audit_log
WHERE phi_accessed = 1
  AND timestamp > datetime('now', '-1 day')
ORDER BY timestamp DESC;

-- Unauthorized attempts
SELECT user_identity, response_status, timestamp
FROM audit_log
WHERE response_status >= 400
ORDER BY timestamp DESC;

-- Patient-specific audit trail
SELECT user_identity, action, resource_type, timestamp
FROM audit_log
WHERE patient_id = 42
ORDER BY timestamp DESC;
```

## Role Definitions

### Tier 3 (Highest Authority)
**Physician** & **Nurse Practitioner**
- Full clinical access
- Can sign notes, orders, prescriptions
- Can override AI agent suggestions
- Can view: all patient data, billing, agent results
- Cannot: access audit logs, delete records

**Admin**
- System management only
- Can view: audit logs, manage users
- Cannot: view patient PHI directly

**System Agent** (AI)
- Full data access for decision support
- All actions logged with reason/autonomy tier
- Cannot: sign documents (only suggest)
- Logged as separate user per agent instance

### Tier 1 (Limited Access)
**Medical Assistant**
- Can record: vital signs
- Can view: vitals, allergies, medications, problems (not clinical notes)
- Cannot: access prescriptions, billing, clinical notes
- Cannot: sign anything

**Billing**
- Can view: CPT/ICD-10 codes, encounter summaries, demographics
- Cannot: see clinical notes, medications, or detailed clinical data
- Cannot: modify clinical records

### Tier 0 (Minimal Access)
**Front Desk**
- Can: schedule encounters, view demographics
- Cannot: view clinical data of any kind

## Request Sanitization

The middleware automatically:

1. **Prevents SQL injection**
   - Detects SQL keywords (UNION, SELECT, DROP, etc.)
   - Strips suspicious parameters
   - Logs detection attempts

2. **Sanitizes error responses**
   - Never returns stack traces in production
   - Strips database structure details
   - Production: "An error occurred processing your request"

3. **Removes PHI from errors**
   - Never echoes back patient identifiers in error messages

## Security Headers Applied

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

## PHI Filtering Example

Without filtering (dangerous):
```javascript
const patient = await db.getPatientById(42);
res.json(patient);
// Exposes: name, DOB, phone, email, SSN, address, insurance ID
// WARNING: Even authorized users should only see fields they need
```

With role-based filtering:
```javascript
rbac.filterResponse,  // Middleware added above
// Medical Assistant sees:  name, DOB, phone, email, MRN (not insurance, SSN, address)
// Billing staff sees:       name, MRN, insurance_id (not phone, address, SSN)
// Front desk sees:          name, phone, email, MRN (demographics only)
```

Direct filtering in code:
```javascript
const rbac = require('./security/rbac');

app.get('/api/patients/:id', async (req, res) => {
  const patientData = await db.getPatientById(req.params.id);
  
  // Filter based on user's role
  const userRole = req.session.userRole;
  const filtered = rbac.filterPHI(userRole, patientData);
  
  res.json(filtered);
});

// Or get scope fields for custom filtering
const allowedFields = rbac.getPhiScopeFields('ma');  // ['id', 'mrn', 'name', 'dob', ...]
```

## Testing with curl

```bash
# Create session and get access
curl -X GET http://localhost:3000/api/patients/1 \
  -H "X-User-Id: ma@clinic.local" \
  -H "X-User-Role: ma" \
  -H "Content-Type: application/json" \
  -v
# Response includes: X-Session-Id header

# Reuse session
curl -X GET http://localhost:3000/api/patients/1 \
  -H "X-User-Id: ma@clinic.local" \
  -H "X-User-Role: ma" \
  -H "X-Session-Id: <session-from-above>" \
  -H "Content-Type: application/json"

# Unauthorized access (front desk trying to access clinical note)
curl -X GET http://localhost:3000/api/encounters/1/notes \
  -H "X-User-Id: frontdesk@clinic.local" \
  -H "X-User-Role: front_desk" \
  -H "Content-Type: application/json"
# Response: 403 { "error": "Insufficient permissions" }
```

## Monitoring & Auditing

Check the audit trail:
```javascript
// Get audit logs from database
app.get('/api/admin/audit-logs', rbac.requireRole('admin'), async (req, res) => {
  const logs = await db.dbAll(
    `SELECT * FROM audit_log 
     WHERE timestamp > datetime('now', '-7 days')
     ORDER BY timestamp DESC
     LIMIT 1000`
  );
  res.json(logs);
});

// Session activity
app.get('/api/admin/sessions', rbac.requireRole('admin'), async (req, res) => {
  const sessions = await db.dbAll(
    `SELECT user_identity, user_role, ip_address, started_at, last_activity, request_count
     FROM audit_sessions
     WHERE is_active = 1
     ORDER BY last_activity DESC`
  );
  res.json(sessions);
});

// PHI access report
app.get('/api/admin/phi-access/:patientId', rbac.requireRole('admin'), async (req, res) => {
  const logs = await db.dbAll(
    `SELECT user_identity, action, phi_fields_accessed, timestamp
     FROM audit_log
     WHERE patient_id = ? AND phi_accessed = 1
     ORDER BY timestamp DESC`,
    [req.params.patientId]
  );
  res.json(logs);
});
```

## Error Handling

The middleware includes comprehensive error handling:

**Session Timeout**
```json
{
  "error": "Session expired. Please log in again."
}
```

**Rate Limit Exceeded**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45
}
```

**Insufficient Permissions**
```json
{
  "error": "Insufficient permissions",
  "requiredRoles": ["physician", "nurse_practitioner"],
  "userRole": "ma"
}
```

**Invalid Resource Access**
```json
{
  "error": "Cannot write medications",
  "userRole": "billing"
}
```

## Performance Considerations

- **In-memory session cache** for O(1) lookups on active sessions
- **Rate limit tracking** with automatic window reset
- **PHI detection** scans response up to 5 levels deep
- **Database indexes** on audit_log: timestamp, user_identity, patient_id
- **Periodic cleanup** of expired sessions every 5 minutes

Session state:
```
Active sessions: ~50-100 (small memory footprint)
Audit log: Growth ~500-1000 entries/day depending on usage
```

## Next Steps

1. **Integrate into server.js** - Add initialization and middleware
2. **Test with different roles** - Verify access control works
3. **Monitor audit logs** - Set up daily review process
4. **Configure session timeout** - Adjust if 15 minutes doesn't fit your workflow
5. **Document role assignments** - Map internal users to roles in your auth system
6. **Set up alerting** - Monitor audit_log for suspicious access patterns

## Security Checklist

- [x] HIPAA session timeout (15 min inactivity)
- [x] PHI access logging for all requests
- [x] Role-based access control per CATC governance
- [x] SQL injection prevention
- [x] Rate limiting per user
- [x] Security headers (HSTS, CSP, etc.)
- [x] Session invalidation on logout
- [x] Error message sanitization
- [x] PHI field filtering by role
- [ ] Enable HTTPS in production (add to server)
- [ ] Configure audit log retention policy
- [ ] Set up monitoring alerts for policy violations
