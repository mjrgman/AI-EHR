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
const parser = require('./parser');

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
  constructor({ mode = 'mock' } = {}) {
    this.mode = mode;
    this.pendingOrders = new Map(); // in-memory tracking (Phase 2b will persist to DB)
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

  // ------- API implementation (Phase 2b will complete this) -------

  async _submitOrderApi(_order) {
    const err = new Error('LabCorpClient API mode not yet implemented — set LABCORP_MODE=mock. Real OAuth + endpoints land in Phase 2b.');
    _lastError = { message: err.message, at: new Date().toISOString() };
    throw err;
  }

  async _fetchResultsApi(_externalOrderId) {
    const err = new Error('LabCorpClient API mode not yet implemented — set LABCORP_MODE=mock. Real OAuth + endpoints land in Phase 2b.');
    _lastError = { message: err.message, at: new Date().toISOString() };
    throw err;
  }

  // ------- Shared helpers -------

  /**
   * Shared helper for wrapping any API call in a 30s timeout, per the
   * ai-client.js pattern. Phase 2b's real API calls will route through this.
   *
   * @param {Promise} promise
   * @returns {Promise}
   */
  async _withTimeout(promise, label = 'labcorp_api') {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${LABCORP_TIMEOUT_MS}ms`)),
        LABCORP_TIMEOUT_MS
      );
    });
    return Promise.race([promise, timeoutPromise]);
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
