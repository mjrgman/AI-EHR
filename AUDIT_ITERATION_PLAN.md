# EHR — Audit Iteration Plan
**Generated:** 2026-03-28 | **Source:** Project Auditor Pass 1
**Updated:** 2026-03-28 | **Pass 2-4 Complete**
**Root:** `C:\Users\micha\files\EHR`
**Stack:** React + Vite frontend, Node.js/Express backend, SQLite, Multi-agent AI architecture
**Files:** 163 → 103 source files (Pass 1 cleanup)

## STATUS: All Iterations Complete (Pass 1-4)

**Iteration 2 (Security):** All 6 items complete — JWT auth, full RBAC coverage (65 middleware calls), PHI encryption wired, CORS restricted, SQL keyword filter removed, duplicate route deleted.

**Iteration 3 (Code Quality):** All 7 items complete — MRN collision-safe, timer leaks fixed, rate limit pruning, enum validation, calculateAge deduplicated, crypto.randomUUID for audits, nonce-based CSP.

**Iteration 4 (Documentation):** All 4 items complete — VISION.md agent count, DEPLOYMENT.md scripts, sandbox paths, DB files untracked.

---

## STATUS: Pass 1 Complete — What Was Done

### Fixes Already Applied (11 total)
- [x] Deleted accidental `nul` file
- [x] Deleted 2 root-level tar.gz archives (~76MB)
- [x] Deleted entire `archive/` directory (superseded content)
- [x] Deleted 26 generated test result JSON files
- [x] Deleted 7 `.fuse_hidden*` filesystem artifacts
- [x] Deleted temp test database files
- [x] Deleted 3 redundant doc files (BUILD_SUMMARY, IMPLEMENTATION_SUMMARY, AGENT_BUILD_SUMMARY)
- [x] Moved `test-message-bus-memory.js` from `server/agents/` to `test/`
- [x] Fixed README agent count: 14 → 9
- [x] Added 4 missing `patient_id` indexes (vitals, labs, prescriptions, lab_orders)
- [x] Added missing `created_at` column to vitals table

---

## ITERATION 2: CRITICAL SECURITY FIXES

> **These are blocking issues for any deployment, even demo/development.**

### S-1. Authentication System — Build Real Auth
**Priority:** CRITICAL | **Est. effort:** 4-6 hours
**Files:** `server/security/hipaa-middleware.js`, `server/server.js`

**Problem:** There is no authentication. Sessions auto-create for anonymous users (line ~438-480). User identity and role come from client-supplied `x-user-id` and `x-user-role` headers — any client can claim any role.

**Action steps:**
1. Implement a proper auth middleware (JWT or session-based):
   ```javascript
   // server/security/auth.js (NEW FILE)
   // - Login endpoint: POST /api/auth/login (username + password → JWT)
   // - JWT verification middleware
   // - Role extracted from JWT claims, NOT from request headers
   // - Session management with secure httpOnly cookies
   ```
2. Remove the `x-user-id` / `x-user-role` header trust from `hipaa-middleware.js` lines ~438-440
3. Replace session auto-creation with auth-required middleware
4. Add `auth.requireAuth()` middleware to ALL routes in `server.js`

**Verification:** Try hitting `/api/patients` without a token — should return 401.

### S-2. RBAC Coverage — Protect All Endpoints
**Priority:** CRITICAL | **Est. effort:** 2 hours
**File:** `server/server.js`

**Problem:** Only ~14 of ~55 API routes have `rbac.requireRole()`. All agent endpoints, most GET endpoints, all workflow endpoints, and all CDS endpoints are unprotected.

**Action steps:**
1. Audit every route in `server.js` and assign RBAC requirements:
   ```
   GET /api/patients → requireRole('physician', 'ma', 'front_desk')
   POST /api/patients → requireRole('physician', 'front_desk')
   GET /api/patients/:id/encounters → requireRole('physician', 'ma')
   POST /api/encounter/:id/soap → requireRole('physician')
   POST /api/agents/* → requireRole('physician', 'ma')
   GET /api/dashboard → requireRole('physician', 'ma', 'admin')
   ```
2. Add `rbac.requireRole()` to every route that currently lacks it
3. Create a route-permission matrix and store as `server/security/ROUTE_PERMISSIONS.md`

**Verification:** Run through all endpoints with role='ma' — physician-only endpoints should return 403.

### S-3. PHI Encryption — Wire It In
**Priority:** CRITICAL | **Est. effort:** 3-4 hours
**Files:** `server/security/phi-encryption.js`, `server/database.js`, `server/server.js`

**Problem:** PHI encryption module exists but is never called. All PHI (patient names, SSNs, clinical notes) is stored in plaintext in SQLite. Additionally, the encryption uses a hardcoded static PBKDF2 salt.

**Action steps:**
1. Fix the static salt in `phi-encryption.js` line ~34:
   ```javascript
   // Replace: const salt = Buffer.from('agentic-ehr-phi')
   // With: const salt = crypto.randomBytes(32) stored per deployment
   ```
2. Fix the key rotation race condition in `phi-encryption.js` lines ~287-301:
   ```javascript
   // Use a lock or queue instead of mutating process.env
   ```
3. Wire encryption into the data pipeline:
   ```javascript
   // In database.js, wrap patient insert/select:
   // INSERT: encryptFields(['first_name', 'last_name', 'ssn', 'dob', ...])
   // SELECT: decryptFields(['first_name', 'last_name', 'ssn', 'dob', ...])
   ```
4. Add migration to encrypt existing plaintext data

**Verification:** Insert a patient → check SQLite directly → fields should be encrypted blobs, not plaintext.

### S-4. CORS Restriction
**Priority:** HIGH | **Est. effort:** 15 min
**File:** `server/server.js`, line ~35

**Action:**
```javascript
// Replace: app.use(cors())
// With:
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}))
```

### S-5. Remove SQL Injection Keyword Filter
**Priority:** HIGH | **Est. effort:** 20 min
**File:** `server/security/hipaa-middleware.js`, lines ~297-325

**Problem:** The keyword blocklist (SELECT, UPDATE, DELETE, DROP, etc.) strips fields from request bodies. This will silently destroy clinical data — a SOAP note containing "SELECT the appropriate antibiotic" will have "SELECT" stripped. Parameterized queries (already used throughout `database.js`) are the correct defense.

**Action:** Remove the entire `sanitizeInput` function and its middleware registration. Add a comment explaining why: `// SQL injection prevented by parameterized queries in database.js. Keyword filtering removed because it corrupts clinical text.`

### S-6. Duplicate Health Route
**Priority:** LOW | **Est. effort:** 5 min
**File:** `server/server.js`, lines ~89 and ~1489

**Action:** Delete the second `/api/health` route definition at line ~1489.

---

## ITERATION 3: CODE QUALITY FIXES

### C-1. MRN Collision Fix
**Priority:** MEDIUM | **Est. effort:** 30 min
**File:** `server/database.js`, lines ~428-432

**Problem:** MRN format allows only 90,000 values per year. ~50% collision probability at ~300 patients.

**Action:**
```javascript
// Replace random MRN with UUID-based or check-and-retry:
function generateMRN() {
  const year = new Date().getFullYear().toString().slice(-2);
  const seq = crypto.randomInt(100000, 999999); // 900,000 possible values
  const mrn = `MRN-${year}-${seq}`;
  // Verify uniqueness before returning
  const existing = db.get('SELECT id FROM patients WHERE mrn = ?', [mrn]);
  if (existing) return generateMRN(); // Retry on collision
  return mrn;
}
```

### C-2. Agent Timeout Timer Leak
**Priority:** MEDIUM | **Est. effort:** 15 min
**File:** `server/agents/orchestrator.js`, lines ~192-193

**Action:** Store timeout references and clear them in agent cleanup:
```javascript
// Track timeouts
this.activeTimeouts = new Map();
// In startTask:
const timeout = setTimeout(() => { ... }, TIMEOUT_MS);
this.activeTimeouts.set(taskId, timeout);
// In completeTask:
clearTimeout(this.activeTimeouts.get(taskId));
this.activeTimeouts.delete(taskId);
```

### C-3. Rate Limit Memory Leak
**Priority:** MEDIUM | **Est. effort:** 15 min
**File:** `server/security/hipaa-middleware.js`

**Action:** Add periodic pruning of expired entries from the rate limit Map:
```javascript
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > WINDOW_MS) rateLimitStore.delete(key);
  }
}, 60000); // Prune every minute
```

### C-4. Enum Validation Middleware
**Priority:** MEDIUM | **Est. effort:** 30 min
**File:** `server/server.js`

**Action:** Add validation for status, priority, and urgency fields in POST/PUT routes:
```javascript
function validateEnum(field, allowed) {
  return (req, res, next) => {
    if (req.body[field] && !allowed.includes(req.body[field])) {
      return res.status(400).json({ error: `Invalid ${field}. Allowed: ${allowed.join(', ')}` });
    }
    next();
  };
}
```

### C-5. Deduplicate calculateAge()
**Priority:** LOW | **Est. effort:** 10 min
**Files:** `server/ai-client.js`, `server/database.js`

**Action:** Extract to a shared utility: `server/utils/date-helpers.js`. Import in both files.

### C-6. Audit Trail ID — Use crypto.randomUUID()
**Priority:** LOW | **Est. effort:** 10 min
**File:** `server/agents/base-agent.js`, lines ~225, 259

**Action:** Replace `Math.random().toString(36)` with `crypto.randomUUID()`.

### C-7. CSP — Remove unsafe-inline
**Priority:** LOW | **Est. effort:** 30 min
**File:** `server/security/hipaa-middleware.js`, line ~73

**Action:** Replace `'unsafe-inline'` with nonce-based CSP for scripts. This requires generating a nonce per request and passing it to the frontend.

---

## ITERATION 4: DOCUMENTATION UPDATES

### Doc-1. VISION.md Agent Count
Update "six core agents" to "nine specialized agents" with the correct list.

### Doc-2. DEPLOYMENT.md Script Names
Replace `npm run dev:server` / `npm run dev:frontend` with actual scripts from package.json (`npm run server` / `npm run client`).

### Doc-3. INTER_AGENT_COMMUNICATION.md — Fix Sandbox Paths
Replace all `/sessions/upbeat-quirky-pasteur/mnt/EHR/` paths with actual project paths.

### Doc-4. Database File in Git History
**Priority:** MEDIUM | **Requires manual execution**
```bash
# Remove tracked database files (they're in .gitignore but already committed)
git rm --cached data/mjr-ehr.db data/mjr-ehr.db-wal data/test-mjr-ehr.db 2>/dev/null
git rm --cached server/data/test-mjr-ehr.db server/data/test-mjr-ehr.db-journal 2>/dev/null
git commit -m "Remove tracked database files from index (HIPAA hygiene)"

# Optional: purge from history entirely
# git filter-repo --invert-paths --path data/mjr-ehr.db --path data/mjr-ehr.db-wal
```

---

## VERIFICATION CHECKLIST

After each iteration:
```bash
# Server starts without errors
npm run server

# Frontend builds
npm run build

# No hardcoded secrets
grep -rn "sk-\|api_key\|password.*=" server/ --include="*.js" | grep -v node_modules | grep -v '.sample'

# RBAC coverage (should return route count = total routes)
grep -c "rbac.requireRole\|auth.requireAuth" server/server.js

# No .db files tracked
git ls-files "*.db" "*.db-wal" "*.db-journal"  # Should be empty

# Agent count matches
grep -c "class.*Agent extends BaseAgent" server/agents/*.js  # Should be 9

# No .fuse_hidden artifacts
find . -name ".fuse_hidden*" -not -path "./.git/*"  # Should be empty
```

---

## PRIORITY SEQUENCE

| Phase | Focus | Est. Time | Impact |
|---|---|---|---|
| **Iteration 2** | Security (S-1 through S-6) | 8-10 hours | Blocks any deployment |
| **Iteration 3** | Code quality (C-1 through C-7) | 2-3 hours | Performance + reliability |
| **Iteration 4** | Documentation (Doc-1 through Doc-4) | 1 hour | Accuracy + onboarding |
