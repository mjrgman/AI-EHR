# EHR Security Modules

> DEPRECATED: the historical `X-User-Id` / `X-User-Role` header-auth pattern was removed in commits `7b19bbb` and `9744c4f`. Clinician access now uses JWT bearer auth, and patient self-service uses the patient-portal session flow.

Production-ready HIPAA-compliant security middleware for Express/SQLite EHR system.

## Files

### Core Modules
- **hipaa-middleware.js** (659 lines)
  - PHI access logging to audit_log table
  - Session management with 15-min timeout
  - Request sanitization (SQL injection prevention)
  - Per-user rate limiting (100 req/min default)
  - Security headers (HSTS, CSP, X-Frame-Options, etc.)
  - Automatic PHI field detection in responses

- **rbac.js** (743 lines)
  - Role-Based Access Control system
  - 7 predefined roles: physician, nurse_practitioner, ma, front_desk, billing, admin, system
  - Resource-level authorization matrix
  - PHI field filtering by role
  - Express middleware for route protection

### Documentation
- **INTEGRATION_GUIDE.md** (502 lines) - Complete integration walkthrough
- **QUICK_REFERENCE.md** (351 lines) - Developer cheat sheet
- **README.md** (this file)

## Key Features

### Security
- HIPAA session timeout (15 minutes inactivity)
- Cryptographic session tokens (256-bit)
- SQL injection detection and prevention
- Rate limiting per user/role
- Automatic error response sanitization
- Security headers (HSTS, CSP, X-Frame-Options, etc.)

### Auditing
- 100% request logging to audit_log table
- PHI field detection and logging
- Session tracking in audit_sessions table
- Patient-level access trails
- Failed authorization logging

### Access Control
- 7-tier role model matching CATC governance
- Resource-level permissions matrix
- Automatic PHI filtering by role
- Signature authority levels (physicians vs. NPs vs. MAs)
- Agent override capabilities

## Usage

### Basic Integration
```javascript
const hipaa = require('./security/hipaa-middleware');
const rbac = require('./security/rbac');

// Initialize
await hipaa.init(db);

// Add to middleware stack
app.use(hipaa.securityHeaders);
app.use(hipaa.sessionTracker);
app.use(hipaa.requestSanitizer);
app.use(hipaa.rateLimiter);
app.use(hipaa.autoLogout);
```

### Protect Routes
```javascript
// Require specific role
app.get('/api/patients/:id',
  rbac.requireRole('physician', 'nurse_practitioner'),
  rbac.filterResponse,
  handler
);

// Require permission
app.post('/api/prescriptions',
  rbac.requireRole('physician', 'nurse_practitioner'),
  rbac.requirePermission('sign', 'prescriptions'),
  handler
);

// Log PHI access
app.get('/api/medications',
  hipaa.phiAccessLogger,
  rbac.requireRole('physician', 'ma'),
  rbac.filterResponse,
  handler
);
```

## Roles

| Role | Tier | Authority | Can Sign | Can Override |
|------|------|-----------|----------|--------------|
| physician | 3 | Full | ✓ | ✓ |
| nurse_practitioner | 3 | Full | ✓ | ✓ |
| ma | 1 | Limited (vitals) | ✗ | ✗ |
| front_desk | 0 | Minimal (scheduling) | ✗ | ✗ |
| billing | 1 | Billing records | ✗ | ✗ |
| admin | 3 | System only | ✗ | ✗ |
| system | 3 | AI agent | ✗ | ✗ |

## Database Tables

### audit_log (created by database.js)
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  user_identity TEXT,
  user_role TEXT,
  action TEXT,              -- READ, CREATE, UPDATE, DELETE
  resource_type TEXT,       -- patients, prescriptions, etc.
  resource_id INTEGER,
  patient_id INTEGER,
  phi_accessed BOOLEAN,     -- 1 if any PHI returned
  phi_fields_accessed TEXT, -- "Name, DOB, Phone"
  ip_address TEXT,
  user_agent TEXT,
  response_status INTEGER,
  duration_ms INTEGER,
  timestamp DATETIME
);
```

### audit_sessions (created by database.js)
```sql
CREATE TABLE audit_sessions (
  id TEXT PRIMARY KEY,       -- Session token
  user_identity TEXT,
  user_role TEXT,
  ip_address TEXT,
  user_agent TEXT,
  started_at DATETIME,
  last_activity DATETIME,
  request_count INTEGER,
  is_active BOOLEAN
);
```

## Session Management

- **Timeout:** 15 minutes inactivity (HIPAA requirement)
- **Token:** 256-bit cryptographic (crypto.randomBytes)
- **Storage:** Database (audit_sessions) + in-memory cache
- **Cleanup:** Automatic every 5 minutes

## PHI Detection

Automatically detects and logs:
- Demographics: name, DOB, phone, email, address
- Identifiers: MRN, SSN
- Clinical: diagnosis, medications, allergies, labs, vitals
- Insurance: carrier, policy numbers

## Rate Limiting

- Normal users: 100 requests/minute
- System agents: 500 requests/minute
- Per-user tracking with automatic window reset

## Security Headers

Applied to all responses:
- Strict-Transport-Security (HSTS)
- Content-Security-Policy
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection
- Referrer-Policy
- Permissions-Policy

## Error Handling

Production mode:
- No stack traces returned
- No internal database details exposed
- Generic "An error occurred" messages for DB errors
- PHI never echoed in error responses

## Testing

With curl:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user@clinic.local","password":"<password>"}'

curl -X GET http://localhost:3000/api/patients/1 \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json"
```

Response headers include:
```
X-RateLimit-Remaining: 99
```

## Files Used

- `database.js` - dbRun, dbGet, dbAll helpers
- `audit_log` table - PHI access records
- `audit_sessions` table - Session tracking

No new npm packages required - uses only Node.js built-ins (crypto, Express).

## Next Steps

1. Integrate both modules into server.js
2. Add authentication middleware that verifies JWTs and populates `req.user` / `req.session`
3. Test with different roles
4. Monitor audit_log table
5. Configure log retention policy (recommend 7 years for HIPAA)
6. Enable HTTPS in production

## Compliance

- HIPAA session timeout requirements ✓
- PHI access audit trail ✓
- Role-based access control ✓
- Data minimization (field-level filtering) ✓
- Integrity (append-only audit log) ✓
- Error handling (no PHI in errors) ✓

See INTEGRATION_GUIDE.md and QUICK_REFERENCE.md for detailed documentation.
