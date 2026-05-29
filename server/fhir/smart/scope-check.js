'use strict';

/**
 * SMART Scope Enforcement Middleware  (FAIL-CLOSED)
 *
 * Enforces the required SMART scope for every authenticated FHIR request.
 *
 * Effective-scope derivation (sec-smart-scope-noop-02):
 *   - SMART tokens carry an explicit `scope` claim → use it verbatim.
 *   - App login tokens carry NO `scope` claim → derive effective scopes from
 *     the authenticated `role` via ROLE_SCOPES. This is the primary auth path
 *     and previously self-disabled (the middleware returned next() on absent
 *     scope, silently granting full access). It now fails closed.
 *
 * Fail-closed guarantees:
 *   - A request with no resolvable identity (no user / no role / no scope) is
 *     DENIED, never passed through.
 *   - A write method (POST/PUT/PATCH/DELETE) with no explicit scope mapping is
 *     DENIED — writes never fall back to a read scope.
 *   - Only an explicitly null-mapped endpoint (e.g. metadata) is public.
 *
 * Denied requests are logged to audit_log with action 'smart_scope_denied'.
 */

const db = require('../../database');
const { RESOURCE_SCOPE_MAP, scopeSatisfies, ROLE_SCOPES } = require('./smart-config');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolve the effective granted scopes for a request.
 *   1. Explicit token `scope` claim (SMART clients) wins.
 *   2. Otherwise derive from the authenticated role (app login tokens).
 *   3. No identity / unknown role → empty set (fail closed downstream).
 *
 * @returns {string[]} granted scopes (possibly empty)
 */
function effectiveScopes(user) {
  if (!user) return [];
  if (user.scope) {
    return typeof user.scope === 'string'
      ? user.scope.split(' ').filter(Boolean)
      : (Array.isArray(user.scope) ? user.scope : []);
  }
  if (user.role && Array.isArray(ROLE_SCOPES[user.role])) {
    return ROLE_SCOPES[user.role];
  }
  return [];
}

/**
 * Extract the FHIR resource type from a FHIR router path.
 * Handles: /Patient/:id, /Patient, /Bundle, /metadata, etc.
 *
 * @param {string} path - req.path within the FHIR router (e.g. "/Patient/1")
 * @returns {string} resource type (e.g. "Patient") or "unknown"
 */
function extractResourceType(path) {
  // Strip leading slash and take first segment
  const seg = path.replace(/^\//, '').split('/')[0];
  return seg || 'unknown';
}

/**
 * Build the scope map key for a resource + method.
 * e.g. resource "Patient", method "GET" → "Patient.GET"
 */
function scopeKey(resourceType, method) {
  return `${resourceType}.${method.toUpperCase()}`;
}

/**
 * Log a scope denial to audit_log (fire-and-forget; errors are swallowed).
 */
async function logScopeDenial(req, resourceType, requiredScope, grantedScopes) {
  try {
    await db.dbRun(`
      INSERT INTO audit_log (
        user_identity, user_role, action, resource_type,
        description, request_method, request_path, response_status, phi_accessed
      ) VALUES (?, ?, 'smart_scope_denied', ?, ?, ?, ?, 403, 0)
    `, [
      req.user?.username || 'anonymous',
      req.user?.role || 'unknown',
      resourceType,
      `Required scope '${requiredScope}' not in granted [${grantedScopes.join(' ')}]`,
      req.method,
      req.originalUrl,
    ]);
  } catch (_) { /* audit failure must not block the response */ }
}

/**
 * SMART scope-check middleware.
 * Mount this on the FHIR router AFTER auth.requireAuth.
 */
function smartScopeCheck(req, res, next) {
  const user = req.user;
  const resourceType = extractResourceType(req.path);
  const key = scopeKey(resourceType, req.method);
  const isWrite = WRITE_METHODS.has(req.method.toUpperCase());

  // Effective scopes: explicit token scope claim OR role-derived (login tokens).
  const grantedScopes = effectiveScopes(user);

  // Determine the required scope for this resource + method.
  // FAIL-CLOSED for writes: a write method with no explicit mapping is denied;
  // writes NEVER fall back to the resource's read scope (sec-fhir-write-unscoped-03).
  let requiredScope;
  if (Object.prototype.hasOwnProperty.call(RESOURCE_SCOPE_MAP, key)) {
    requiredScope = RESOURCE_SCOPE_MAP[key];
  } else if (isWrite) {
    // Unmapped WRITE → no scope can satisfy → deny (a write could reach a
    // handler; never let an unmapped write fall back to a read scope).
    requiredScope = '__deny__';
  } else {
    // Reads fall back to the resource's read scope when it exists. A read
    // resource type with NO mapping has no handler on this router (every PHI
    // read resource IS mapped), so let it fall through to the router's
    // catch-all 404 — there is no data path to expose. The RBAC guard remains
    // the explicit second gate for every known PHI resource.
    requiredScope = RESOURCE_SCOPE_MAP[`${resourceType}.GET`];
    if (requiredScope === undefined) return next();
  }

  // Only an explicit null mapping is public (e.g. metadata).
  if (requiredScope === null) return next();

  if (requiredScope !== '__deny__' && scopeSatisfies(grantedScopes, requiredScope)) {
    return next();
  }

  // Denied — fail closed.
  const reqLabel = requiredScope === '__deny__'
    ? `write to ${resourceType} (no role/scope grants this)`
    : requiredScope;
  logScopeDenial(req, resourceType, reqLabel, grantedScopes);
  return res.status(403).json({
    resourceType: 'OperationOutcome',
    issue: [{
      severity: 'error',
      code: 'forbidden',
      diagnostics: `Insufficient scope. Required: ${reqLabel}`,
    }],
  });
}

module.exports = { smartScopeCheck, extractResourceType, scopeKey, effectiveScopes };
