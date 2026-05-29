/**
 * MediVault browser client — Phase 3c
 *
 * Thin wrapper around the `/api/medivault/export/:patientId` endpoint.
 * Triggers a browser download of a patient-owned FHIR R4 Bundle.
 *
 * Why this lives in its own module instead of src/api/client.js:
 *   The shared `request()` helper in client.js parses every response as
 *   JSON and returns the parsed object. An export response is a FHIR
 *   Bundle that we want to save to disk, not render — so we need raw
 *   fetch access to read the Blob and grab the Content-Disposition
 *   filename. Keeping this isolated avoids adding a binary-return
 *   branch to the shared helper.
 *
 * Audit: the server writes a vault_access_log row (see
 * server/routes/medivault-routes.js) AND the global audit-logger
 * middleware writes an audit_log row via the PHI_ROUTES entry added in
 * server/audit-logger.js. The client is not responsible for any
 * client-side audit — the server is authoritative.
 */

// Mirrors client.js's AUTH_STORAGE_KEY. The session object stored under this
// key is shaped `{ token, refreshToken, expiresAt }` (see setStoredAuthSession
// in src/api/client.js). We read it directly rather than importing client.js
// to preserve this module's intentional isolation (raw-fetch / Blob handling).
const AUTH_STORAGE_KEY = 'ehr_auth_session_v1';

/**
 * Read the bearer token from the stored auth session, if present.
 * Returns null when storage is unavailable, the session is absent, or the
 * stored JSON is malformed — callers send the request without an Authorization
 * header in that case (the server then fails closed with 401/403).
 *
 * @returns {string|null}
 */
function getAuthToken() {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return (session && typeof session.token === 'string' && session.token) || null;
  } catch {
    return null;
  }
}

/**
 * Download the patient's MediVault export as a FHIR Bundle JSON file.
 *
 * @param {number|string} patientId
 * @returns {Promise<{filename: string, size: number}>} — resolves after
 *   the browser has been handed the download; does NOT wait for the user
 *   to choose a save location.
 * @throws {Error} on non-2xx response or network failure
 */
export async function exportPatient(patientId) {
  if (!patientId) {
    throw new Error('exportPatient: patientId is required');
  }

  // Reuse the same audit headers the rest of the app sends. If the
  // session isn't populated yet (first page load) these are simply
  // absent — the server tolerates that.
  const headers = { Accept: 'application/fhir+json' };
  if (typeof sessionStorage !== 'undefined') {
    const sid = sessionStorage.getItem('audit_session_id');
    if (sid) headers['X-Audit-Session-Id'] = sid;
  }

  // gaps-03: the export route is RBAC-gated server-side
  // (rbac.requireRole('physician','nurse_practitioner','system') in
  // server/routes/medivault-routes.js). This wrapper uses raw fetch instead
  // of the shared client.js request() helper, so it must attach the Bearer
  // token itself — otherwise the request arrives unauthenticated and the
  // server resolves the caller as role 'guest', returning 403 (masked in dev
  // only by ENABLE_DEV_AUTH_BYPASS). We read the same session object and
  // storage key that client.js uses (AUTH_STORAGE_KEY = 'ehr_auth_session_v1').
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/medivault/export/${encodeURIComponent(patientId)}`, {
    method: 'GET',
    headers,
    credentials: 'same-origin'
  });

  if (!res.ok) {
    // Try to read a FHIR OperationOutcome for a useful message; fall
    // back to the raw text if the server returned something else.
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.issue?.[0]?.diagnostics || body?.error || JSON.stringify(body);
    } catch {
      try { detail = await res.text(); } catch { /* keep statusText */ }
    }
    const err = new Error(`MediVault export failed (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }

  // Parse filename from Content-Disposition: attachment; filename="medivault-<id>-<date>.json"
  // Fall back to a sane default if the header is absent (e.g. a proxy
  // stripped it) so the user still gets a usable file.
  const disposition = res.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch
    ? filenameMatch[1]
    : `medivault-${patientId}-${new Date().toISOString().slice(0, 10)}.json`;

  const blob = await res.blob();

  // Programmatic download via a transient anchor element — the standard
  // browser idiom that works in every modern browser without needing the
  // experimental File System Access API.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Small delay before revoking so Safari has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 100);

  return { filename, size: blob.size };
}

export default { exportPatient };
