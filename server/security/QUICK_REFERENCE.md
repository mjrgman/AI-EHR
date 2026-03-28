# EHR Security Modules - Quick Reference

## File Locations
```
/server/security/hipaa-middleware.js   (659 lines) - Session, audit, rate limit, sanitization
/server/security/rbac.js               (743 lines) - Role-based access control
/server/security/INTEGRATION_GUIDE.md  (502 lines) - Full integration documentation
```

## Init in server.js

```javascript
const hipaa = require('./security/hipaa-middleware');
const rbac = require('./security/rbac');

// Initialize with db
await hipaa.init(db);

// Add to middleware stack
app.use(hipaa.securityHeaders);
app.use(hipaa.sessionTracker);
app.use(hipaa.requestSanitizer);
app.use(hipaa.rateLimiter);
app.use(hipaa.autoLogout);
```

## Route Protection Patterns

**Physician only:**
```javascript
app.post('/api/prescriptions',
  rbac.requireRole('physician', 'nurse_practitioner'),
  rbac.requirePermission('sign', 'prescriptions'),
  handler
);
```

**With PHI logging and filtering:**
```javascript
app.get('/api/patients/:id',
  hipaa.phiAccessLogger,
  rbac.requireRole('physician', 'ma', 'nurse_practitioner'),
  rbac.filterResponse,
  handler
);
```

**Billing staff (limited fields):**
```javascript
app.get('/api/encounters/:id/codes',
  rbac.requireRole('billing'),
  rbac.filterResponse,  // Auto-strips clinical notes
  handler
);
```

**Admin audit access:**
```javascript
app.get('/api/audit-logs',
  rbac.requireRole('admin'),
  handler
);
```

## Roles & Permissions Matrix

| Role | Tier | Read Patients | Write Rx | Sign Rx | View Notes | View Billing |
|------|------|---------------|----------|---------|-----------|--------------|
| physician | 3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| nurse_practitioner | 3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| ma | 1 | ✓ | - | - | ✗ | ✗ |
| front_desk | 0 | ✓* | - | - | ✗ | ✗ |
| billing | 1 | ✓* | - | - | ✗ | ✓ |
| admin | 3 | ✗ | ✗ | ✗ | ✗ | ✗ |

*Demographics only

## Authorization Functions

```javascript
// Check permission
rbac.authorize(roleName, resourceType, action);
// Examples: 'read', 'write', 'create', 'delete', 'sign'

// Get role object
rbac.getRole('physician');

// Check specific permission
rbac.canSign('physician', 'prescriptions');     // true
rbac.canSign('ma', 'prescriptions');            // false

// Can role override agent?
rbac.canOverride('physician', 'agent_order_review');  // true

// Get PHI scope fields for role
rbac.getPhiScopeFields('ma');
// Returns: ['id', 'mrn', 'name', 'dob', 'vitals', 'allergies', ...]

// Filter PHI from response
const filtered = rbac.filterPHI('billing', patientData);
// Removes: clinical notes, medications, detailed medical history
```

## PHI Logging Examples

Log automatically triggered by:
- Any READ of patient/encounter data
- Any UPDATE to patient/prescription data
- Any DELETE operation

Logged fields:
```
session_id            User session token
user_identity         User email
user_role             Role name
action                READ, CREATE, UPDATE, DELETE
resource_type         patients, prescriptions, encounters, etc.
patient_id            Patient affected (if applicable)
phi_accessed          Boolean - were PHI fields returned?
phi_fields_accessed   "First Name, DOB, SSN, Medications" (if PHI=1)
ip_address            Client IP
user_agent            Browser/client info
response_status       HTTP status code
duration_ms           Request processing time
```

Query audit logs:
```sql
-- All PHI access today
SELECT * FROM audit_log 
WHERE phi_accessed = 1 AND timestamp > datetime('now', 'start of day');

-- Patient audit trail
SELECT * FROM audit_log WHERE patient_id = 42 ORDER BY timestamp DESC;

-- Unauthorized attempts
SELECT * FROM audit_log WHERE response_status >= 400 ORDER BY timestamp DESC;
```

## Session Management

**Session timeout:** 15 minutes inactivity (HIPAA)

**Properties:**
```javascript
req.session = {
  id: "abcd1234...",        // 256-bit token
  userId: "user@example.com",
  userRole: "physician",
  ipAddress: "192.168.1.100",
  userAgent: "Mozilla/5.0...",
  startTime: 1234567890,
  lastActivity: 1234567890
}
```

**Manual control:**
```javascript
// Create
const sid = await hipaa.createSession(userId, role, ip, agent);

// Validate
const session = await hipaa.validateSession(sessionId);

// Logout
await hipaa.invalidateSession(sessionId);
```

## Rate Limits

- **Normal users:** 100 req/min
- **System agents:** 500 req/min

Response when limit exceeded:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 23
}
```

Check remaining:
```javascript
res.header('X-RateLimit-Remaining');  // e.g., "45"
```

## Security Features

| Feature | Handled By | Details |
|---------|-----------|---------|
| Session timeout | sessionTracker | 15 min inactivity, auto-logout |
| PHI logging | phiAccessLogger | Audit trail of all sensitive access |
| SQL injection | requestSanitizer | Detects and blocks SQL keywords |
| Rate limiting | rateLimiter | Per-user request quota |
| Security headers | securityHeaders | HSTS, CSP, X-Frame-Options, etc. |
| PHI field detection | detectPHIFields | Auto-identifies sensitive fields in responses |
| Role enforcement | requireRole middleware | Blocks unauthorized role access |
| Resource filtering | requireResourceAccess | Enforces resource-level permissions |
| Data filtering | filterResponse | Strips PHI based on role |

## Testing Quick Commands

```bash
# Create session and access protected endpoint
curl -X GET http://localhost:3000/api/patients/1 \
  -H "X-User-Id: doc@clinic.local" \
  -H "X-User-Role: physician" -v

# Try unauthorized access (MA accessing prescriptions)
curl -X GET http://localhost:3000/api/prescriptions \
  -H "X-User-Id: ma@clinic.local" \
  -H "X-User-Role: ma" \
  -H "Content-Type: application/json"
# Returns: 403 Insufficient permissions

# Try to exceed rate limit
for i in {1..150}; do
  curl -s http://localhost:3000/api/health \
    -H "X-User-Id: user@clinic.local" \
    -H "X-User-Role: physician" > /dev/null
done
# After 100 requests: 429 Rate limit exceeded
```

## Common Integration Points

**Authentication middleware (upstream - before HIPAA):**
```javascript
// You need to provide auth middleware that sets headers:
app.use(async (req, res, next) => {
  // Your JWT/OAuth validation here
  if (tokenValid) {
    req.headers['x-user-id'] = user.email;
    req.headers['x-user-role'] = user.role;  // 'physician', 'ma', etc.
  }
  next();
});

app.use(hipaa.sessionTracker);  // HIPAA middleware after auth
```

**Error handling (downstream - after routes):**
```javascript
// HIPAA middleware sanitizes errors, but add global handler:
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  // sanitizeErrorResponse already applied by requestSanitizer
  res.status(500).json({ error: 'Internal server error' });
});
```

## Monitoring Dashboard Queries

```sql
-- Active sessions
SELECT COUNT(*) as active_sessions
FROM audit_sessions
WHERE is_active = 1 AND last_activity > datetime('now', '-15 minutes');

-- PHI access today
SELECT DATE(timestamp) as date, 
       COUNT(*) as access_count,
       COUNT(DISTINCT patient_id) as patients_accessed
FROM audit_log
WHERE phi_accessed = 1
  AND timestamp > datetime('now', 'start of day')
GROUP BY DATE(timestamp);

-- Top users
SELECT user_identity, COUNT(*) as request_count
FROM audit_log
WHERE timestamp > datetime('now', '-7 days')
GROUP BY user_identity
ORDER BY request_count DESC;

-- Unusual activity
SELECT user_identity, response_status, COUNT(*) as failure_count, timestamp
FROM audit_log
WHERE response_status >= 400
  AND timestamp > datetime('now', '-1 day')
GROUP BY user_identity, response_status
HAVING COUNT(*) > 10
ORDER BY timestamp DESC;
```

## Compliance Notes

**HIPAA Compliance:**
- Session timeout: 15 minutes (configurable constant)
- PHI access logging: All fields identified and logged
- Audit trail: 100% request coverage
- Data minimization: Role-based PHI filtering
- Integrity: Immutable audit_log table (append-only)

**To strengthen:**
1. Enable HTTPS in production (add to server config)
2. Implement audit log retention policy (e.g., 7 years)
3. Set up automated alerts for:
   - Multiple failed authorization attempts
   - Unusual PHI access patterns
   - Sessions from new IP addresses
4. Regular audit log review (recommend weekly)
5. Document data retention schedule

## Troubleshooting

**Session keeps expiring:**
- Check `SESSION_TIMEOUT_MINUTES` constant (default 15)
- Verify `hipaa.sessionTracker` is in middleware stack
- Check if clock skew between server/client

**Rate limit too strict:**
- Change limit in `checkRateLimit()`: default 100/min
- System agents get 500/min (check user role)

**PHI not being detected:**
- Check field names against `PHI_FIELDS` object
- Detector scans up to 5 levels deep in objects
- May need to add new field to `PHI_FIELDS` definition

**RBAC rejecting valid requests:**
- Verify user role header: `X-User-Role`
- Check role exists in `ROLES` object
- Verify resource type matches (case-sensitive)
- Check resource is in role's `canAccess` or `canWrite`

## Export Summary

**hipaa-middleware.js exports:**
- `init(db)` - Initialize with database
- `sessionTracker` - Middleware
- `securityHeaders` - Middleware
- `rateLimiter` - Middleware
- `requestSanitizer` - Middleware
- `phiAccessLogger` - Middleware
- `autoLogout` - Middleware
- `createSession()`, `validateSession()`, `invalidateSession()` - Functions
- Constants: `SESSION_TIMEOUT_MS`, `SESSION_TIMEOUT_MINUTES`

**rbac.js exports:**
- `requireRole(...roles)` - Middleware
- `requirePermission(action, resource)` - Middleware
- `filterResponse` - Middleware
- `requireResourceAccess(resource)` - Middleware
- `filterPHI(role, data)` - Function
- `authorize(role, resource, action)` - Function
- `canAccess()`, `canWrite()`, `canSign()`, `canOverride()` - Functions
- `getPhiScopeFields()` - Function
- `getAllRoles()`, `getSuperiorRoles()`, `hasAuthority()` - Utilities
- Constants: `ROLES`, `PHI_FIELDS_BY_SCOPE`
