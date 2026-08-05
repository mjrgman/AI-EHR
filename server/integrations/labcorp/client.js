/**
 * LabCorp API Client — Phase 2a Scaffold
 *
 * Mirrors the shape of `server/ai-client.js`:
 *   - Lazy singleton
 *   - Env-gated mode (`LABCORP_MODE=mock|api`, default 'mock')
 *   - 30s timeout via `Promise.race`
 *   - Mock mode reads from `mock-responses/` on disk
 *   - API mode is a STUB — intentionally throws until Phase 2b wires OAuth2
 *
 * Public surface (stable contract for Phase 2b/3 consumers):
 *   submitOrder(order)           — returns { ok, externalOrderId, status, raw }
 *   fetchResults(externalOrderId) — returns parsed result object from parser.js
 *   pollPendingOrders(orderIds)   — returns Array<fetchResults result>
 *   getStatus()                   — returns { mode, hasCredentials, lastError }
 *
 * Why this split exists (Phase 2a vs 2b):
 *   - 2a: no routes, no OAuth, no DB migrations. Everything works end-to-end
 *     in mock mode and every test can run without network.
 *   - 2b: OAuth2 flow + real endpoints + token storage + `LabSynthesisAgent`.
 *   - 2c: docker-compose poller service + `.env.example` + smoke script.
 *
 *   The surface below is frozen in 2a so 2b can swap `_callApi()` without
 *   touching callers.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const parser = require('./parser');
const oauth = require('./oauth');

const LABCORP_MODE = process.env.LABCORP_MODE || 'mock';
const LABCORP_TIMEOUT_MS = parseInt(process.env.LABCORP_TIMEOUT_MS || '30000', 10);

const MOCK_DIR = path.join(__dirname, 'mock-responses');

// ==========================================
// SINGLETON
// ==========================================

let _client = null;
let _lastError = null;

function getClient() {
  if (!_client) {
    _client = new LabCorpClient({ mode: LABCORP_MODE });
  }
  return _client;
}

function getStatus() {
  return {
    mode: LABCORP_MODE,
    hasCredentials: Boolean(process.env.LABCORP_CLIENT_ID && process.env.LABCORP_CLIENT_SECRET),
    lastError: _lastError ? { message: _lastError.message, at: _lastError.at } : null
  };
}

// ==========================================
// CLIENT CLASS
// ==========================================

class LabCorpClient {
  constructor({
    mode = 'mock',
    // API-mode options (ignored in mock mode)
    baseUrl = null,
    tokenUrl = null,
    clientId = null,
    clientSecret = null,
    db = null,
    userId = null,
    timeoutMs = LABCORP_TIMEOUT_MS,
  } = {}) {
    this.mode = mode;
    this.pendingOrders = new Map(); // in-memory tracking (Phase 2b will persist to DB)
    // API-mode wiring — all null-safe so mock mode needs none of them.
    // Construction is cheap; instantiate one per-user or per-request and
    // discard, rather than relying on the process-wide `getClient()`
    // singleton, whenever you need API mode. The singleton remains the
    // right default for mock-mode usage.
    this.baseUrl = baseUrl || process.env.LABCORP_SANDBOX_URL || null;
    this.tokenUrl = tokenUrl || process.env.LABCORP_TOKEN_URL || null;
    this.clientId = clientId || process.env.LABCORP_CLIENT_ID || null;
    this.clientSecret = clientSecret || process.env.LABCORP_CLIENT_SECRET || null;
    this.db = db;
    this.userId = userId;
    this.timeoutMs = timeoutMs;
  }

  // ------- Public API -------

  /**
   * Submit a new lab order.
   *
   * @param {Object} order - { patientId, tests: string[], priority, clinicalContext }
   * @returns {Promise<{ ok, externalOrderId, status, raw }>}
   */
  async submitOrder(order) {
    validateOrder(order);

    if (this.mode === 'mock') {
      return this._submitOrderMock(order);
    }
    return this._submitOrderApi(order);
  }

  /**
   * Fetch a single result by external (LabCorp-issued) order ID.
   * Returns the normalized parser output — see parser.js for shape.
   *
   * @param {string} externalOrderId
   * @returns {Promise<Object>}  — parser result shape
   */
  async fetchResults(externalOrderId) {
    if (!externalOrderId) {
      throw new Error('LabCorpClient.fetchResults: externalOrderId is required');
    }

    if (this.mode === 'mock') {
      return this._fetchResultsMock(externalOrderId);
    }
    return this._fetchResultsApi(externalOrderId);
  }

  /**
   * Poll multiple pending orders. Returns an array of parser results.
   * Any failed fetch is included as `{ ok: false, externalOrderId, error }`
   * so the caller can decide per-order whether to retry.
   *
   * @param {Array<string>} externalOrderIds
   * @returns {Promise<Array<Object>>}
   */
  async pollPendingOrders(externalOrderIds = []) {
    if (!Array.isArray(externalOrderIds)) {
      throw new Error('LabCorpClient.pollPendingOrders: expected an array of ids');
    }
    const out = [];
    for (const id of externalOrderIds) {
      try {
        const result = await this.fetchResults(id);
        out.push(result);
      } catch (err) {
        _lastError = { message: err.message, at: new Date().toISOString() };
        out.push({
          ok: false,
          externalOrderId: id,
          error: err.message,
          source: 'labcorp_fetch_error'
        });
      }
    }
    return out;
  }

  // ------- Mock implementation -------

  _submitOrderMock(order) {
    // Generate a deterministic external order ID from the patient + tests so
    // repeat calls produce the same ID (helps scenarios assert stably).
    const stableKey = [order.patientId, ...order.tests].join('|');
    const externalOrderId = `LC-MOCK-${hashString(stableKey)}`;
    this.pendingOrders.set(externalOrderId, {
      ...order,
      externalOrderId,
      submittedAt: new Date().toISOString(),
      status: 'submitted'
    });
    return {
      ok: true,
      externalOrderId,
      status: 'submitted',
      raw: { mock: true, note: 'LabCorp mock mode — no network call made' }
    };
  }

  async _fetchResultsMock(externalOrderId) {
    // Look up a fixture file by (a) the external order id, (b) the test name
    // derived from the order, or (c) a generic fallback keyed by test code.
    //
    // Mock fixtures live in mock-responses/*.xml and mock-responses/*.pdf.
    // The simpler XML form is the default; PDF fixtures exist to exercise
    // the PDF parser path in unit tests.
    const order = this.pendingOrders.get(externalOrderId);

    // Contract: an unknown order ID is distinct from "known order with no
    // specific fixture." This mirrors Phase 2b's real API: polling an
    // unknown ID would return 404, not empty results. Callers to
    // pollPendingOrders() need to tell the two cases apart so retries can
    // be scoped to transient failures only.
    if (!order) {
      return {
        ok: false,
        source: 'labcorp_mock',
        externalOrderId,
        results: [],
        warnings: [`unknown_order_id:${externalOrderId}`],
        rawExcerpt: ''
      };
    }

    const fixtureName = resolveFixtureName(externalOrderId, order);
    const fixturePath = path.join(MOCK_DIR, fixtureName);

    if (!fs.existsSync(fixturePath)) {
      // Graceful fallback: return an empty-but-valid result so callers can
      // distinguish "no results yet" from "network error"
      return {
        ok: false,
        source: 'labcorp_mock',
        externalOrderId,
        results: [],
        warnings: [`fixture_not_found:${fixtureName}`],
        rawExcerpt: ''
      };
    }

    const buffer = fs.readFileSync(fixturePath);
    let result;
    if (fixturePath.endsWith('.pdf')) {
      result = await parser.parsePdfResult(buffer);
    } else {
      result = parser.parseXmlResult(buffer);
    }

    // Attach the externalOrderId so downstream code can correlate
    result.externalOrderId = externalOrderId;
    if (!result.labOrderId) result.labOrderId = externalOrderId;
    return result;
  }

  // ------- API implementation (Phase 2b) -------

  /**
   * Submit a lab order to the real LabCorp Link API.
   *
   * Flow:
   *   1. Load stored OAuth2 tokens for this.userId (throws if missing)
   *   2. POST JSON body to `${baseUrl}/api/v1/orders` with Bearer auth
   *   3. On 401, refresh tokens, persist, retry once (prevents infinite loops)
   *   4. On success, return the normalized order response
   *
   * Callers must supply `db` + `userId` at construction so token load/store
   * is scoped to the correct user. Production code wires this per-request
   * from the authenticated session; tests wire it from the test harness.
   */
  async _submitOrderApi(order) {
    const response = await this._authorizedRequest({
      method: 'POST',
      path: '/api/v1/orders',
      body: JSON.stringify(order),
      contentType: 'application/json',
      label: 'submitOrder',
    });
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (err) {
      throw new Error(`LabCorp submitOrder: failed to parse response JSON: ${err.message}`);
    }
    // Track locally so pollPendingOrders() still works in API mode
    if (parsed.externalOrderId) {
      this.pendingOrders.set(parsed.externalOrderId, {
        ...order,
        externalOrderId: parsed.externalOrderId,
        submittedAt: parsed.submittedAt || new Date().toISOString(),
        status: parsed.status || 'submitted',
      });
    }
    return {
      ok: true,
      externalOrderId: parsed.externalOrderId,
      status: parsed.status || 'submitted',
      raw: parsed,
    };
  }

  /**
   * Fetch a result by external order ID. Returns the parser output shape,
   * so callers (LabSynthesisAgent in Chunk 6) can treat API-mode and
   * mock-mode results identically.
   */
  async _fetchResultsApi(externalOrderId) {
    const response = await this._authorizedRequest({
      method: 'GET',
      path: `/api/v1/orders/${encodeURIComponent(externalOrderId)}/results`,
      label: 'fetchResults',
    });
    // LabCorp serves XML by default, PDF on request. We pass the raw body
    // buffer through the same parser used by mock mode so downstream code
    // sees a single result shape regardless of mode.
    const contentType = response.headers['content-type'] || '';
    let result;
    if (contentType.includes('application/pdf')) {
      result = await parser.parsePdfResult(response.bodyBuffer);
    } else {
      result = parser.parseXmlResult(response.bodyBuffer);
    }
    result.externalOrderId = externalOrderId;
    if (!result.labOrderId) result.labOrderId = externalOrderId;
    return result;
  }

  // ------- Shared helpers -------

  /**
   * Authorized HTTP request against the LabCorp API with auto-refresh on 401.
   *
   * Responsibilities:
   *   - Require `db` + `userId` so we can load/persist tokens
   *   - Load tokens once; if none, throw a clear "not authorized" error
   *   - Attach `Authorization: Bearer <access_token>` header
   *   - On 401, call oauth.refreshAccessToken(), persist via storeTokens(),
   *     then retry the request exactly once. This caps the retry depth at
   *     1 so a perpetually-broken refresh loop cannot cascade.
   *   - On any other non-2xx, throw with the body for diagnostics
   *   - Return { status, headers, body (string), bodyBuffer } on success
   *
   * Defensive loading of `oauth` at call-time (rather than top-of-file)
   * avoids a circular-require risk if oauth.js ever grows a dependency on
   * client.js (doesn't today, but the lazy require keeps it safe).
   */
  async _authorizedRequest({ method, path, body = null, contentType = null, label = 'labcorp_api' }) {
    if (!this.db || !this.userId) {
      throw new Error(`LabCorp ${label}: db + userId required for API mode`);
    }
    if (!this.baseUrl) {
      throw new Error(`LabCorp ${label}: baseUrl required for API mode`);
    }

    let tokens = await oauth.getTokens(this.db, this.userId);
    if (!tokens) {
      throw new Error(`LabCorp ${label}: not authorized — no tokens stored for user ${this.userId}. Run the OAuth2 flow first.`);
    }

    // First attempt
    let response = await this._rawRequest({
      method,
      path,
      body,
      contentType,
      accessToken: tokens.access_token,
      label,
    });

    // 401 → refresh + retry exactly once
    if (response.status === 401) {
      if (!this.tokenUrl || !this.clientId || !this.clientSecret) {
        throw new Error(`LabCorp ${label}: received 401 but cannot refresh — tokenUrl/clientId/clientSecret missing`);
      }
      const refreshed = await oauth.refreshAccessToken({
        tokenUrl: this.tokenUrl,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        refreshToken: tokens.refresh_token,
        timeoutMs: this.timeoutMs,
      });
      await oauth.storeTokens(this.db, this.userId, refreshed);
      tokens = await oauth.getTokens(this.db, this.userId);
      response = await this._rawRequest({
        method,
        path,
        body,
        contentType,
        accessToken: tokens.access_token,
        label,
      });
      // If still 401 after refresh, do NOT loop — fail loud
      if (response.status === 401) {
        throw new Error(`LabCorp ${label}: still 401 after refresh — stale grant?`);
      }
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`LabCorp ${label}: HTTP ${response.status} — ${response.body}`);
    }
    return response;
  }

  /**
   * Raw HTTP request without any token logic. Returns a normalized response
   * so callers don't have to know http vs https. Includes a 30s timeout
   * via `req.setTimeout()` matching the oauth.js pattern.
   */
  _rawRequest({ method, path, body, contentType, accessToken, label }) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(this.baseUrl + path);
      } catch (err) {
        reject(new Error(`LabCorp ${label}: invalid URL — ${err.message}`));
        return;
      }
      const lib = url.protocol === 'https:' ? https : http;
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json, application/xml, application/pdf',
      };
      if (body) {
        headers['Content-Type'] = contentType || 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const options = {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        headers,
        timeout: this.timeoutMs,
      };

      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => { chunks.push(chunk); });
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: bodyBuffer.toString('utf8'),
            bodyBuffer,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`LabCorp ${label}: request timed out after ${this.timeoutMs}ms`));
      });
      req.on('error', (err) => {
        _lastError = { message: err.message, at: new Date().toISOString() };
        reject(new Error(`LabCorp ${label}: ${err.message}`));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}

// ==========================================
// PURE HELPERS
// ==========================================

function validateOrder(order) {
  if (!order || typeof order !== 'object') {
    throw new Error('LabCorpClient.submitOrder: order must be an object');
  }
  if (!order.patientId) {
    throw new Error('LabCorpClient.submitOrder: order.patientId is required');
  }
  if (!Array.isArray(order.tests) || order.tests.length === 0) {
    throw new Error('LabCorpClient.submitOrder: order.tests must be a non-empty array');
  }
}

// Simple deterministic hash (not cryptographic — mock mode only)
function hashString(input) {
  let h = 0;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).toUpperCase().slice(0, 8);
}

// Decide which fixture file to return based on order test names. If the
// order doesn't exist (e.g., caller is fetching by raw ID), return a
// deterministic default so the parser path still gets exercised.
function resolveFixtureName(externalOrderId, order) {
  if (!order || !Array.isArray(order.tests)) {
    return 'default.xml';
  }
  const joined = order.tests.join(' ').toLowerCase();
  if (/cbc|complete blood count|hematocrit/.test(joined)) return 'cbc.xml';
  if (/cmp|comp metabolic|metabolic panel/.test(joined)) return 'cmp.xml';
  if (/lipid|cholesterol|ldl|hdl|triglyceride/.test(joined)) return 'lipid.xml';
  if (/a1c|hemoglobin a1c|hba1c|glycohemoglobin/.test(joined)) return 'a1c.xml';
  if (/tsh|t3|t4|thyroid/.test(joined)) return 'thyroid.xml';
  if (/testosterone/.test(joined)) return 'testosterone.xml';
  if (/estradiol|estrogen/.test(joined)) return 'estradiol.xml';
  if (/igf|insulin-like/.test(joined)) return 'igf1.xml';
  return 'default.xml';
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  getClient,
  getStatus,
  LabCorpClient,
  // Internal helpers exported only for unit tests
  _internal: {
    validateOrder,
    hashString,
    resolveFixtureName
  }
};
