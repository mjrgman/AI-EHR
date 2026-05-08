'use strict';

/**
 * LabCorp HTTP routes (Phase 2b — Chunk 5)
 *
 * Four endpoints that expose the Phase 2b pieces to the web tier:
 *
 *   GET  /api/integrations/labcorp/status          — config health check
 *   POST /api/integrations/labcorp/oauth/start     — issue state + authorize URL
 *   GET  /api/integrations/labcorp/oauth/callback  — exchange code → store tokens
 *   POST /api/orders/:id/submit-to-labcorp         — submit an existing lab order
 *
 * Mounting contract: callers pass `{ db }` (the server/database wrapper)
 * explicitly rather than doing `require('../database')` in-module. This
 * keeps the routes test-mountable on a fresh Express app and matches the
 * patient-portal.js precedent (which pulls db from the shared wrapper but
 * accepts no wiring surface). We diverge here because the test harness
 * needs to inject the same wrapper the rest of the suite uses.
 *
 * OAuth2 state store: we keep `state → { userId, expiresAt }` in a
 * module-level Map with a 10-minute TTL. OAuth2 authorization-code flows
 * complete in seconds in practice, so in-memory is sufficient for the MVP.
 * A production deployment that needs HA or cross-process state should move
 * this to the DB (e.g. a `labcorp_oauth_states` table). The helper
 * `_internal.*` exports exist so tests or Phase 2b operators can sweep it.
 *
 * Auth notes: the callback handler does NOT rely on req.user — OAuth2
 * providers redirect the browser back with only `code` and `state`, and
 * the JWT header this app uses isn't carried on cross-site redirects.
 * Instead the callback derives userId from the pending-state record, which
 * was written when the user called /oauth/start while authenticated. This
 * is the standard OAuth2 callback pattern.
 */

const express = require('express');
const crypto = require('crypto');
const oauth = require('../integrations/labcorp/oauth');
const { LabCorpClient } = require('../integrations/labcorp/client');

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — OAuth flows complete in seconds

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

async function _sweepExpiredStates(db, now = Date.now()) {
  await db.dbRun(
    `DELETE FROM labcorp_oauth_states
      WHERE consumed_at IS NOT NULL OR expires_at <= ?`,
    [new Date(now).toISOString()]
  );
}

async function _storePendingState(db, state, userId, now = Date.now()) {
  const expiresAt = new Date(now + STATE_TTL_MS).toISOString();
  await db.dbRun(
    `INSERT INTO labcorp_oauth_states (state_hash, user_id, expires_at)
     VALUES (?, ?, ?)`,
    [hashState(state), userId, expiresAt]
  );
  return { userId, expiresAt };
}

async function _consumePendingState(db, state, now = Date.now()) {
  const stateHash = hashState(state);
  const row = await db.dbGet(
    `SELECT * FROM labcorp_oauth_states
      WHERE state_hash = ? AND consumed_at IS NULL`,
    [stateHash]
  );
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= now) {
    await db.dbRun('DELETE FROM labcorp_oauth_states WHERE state_hash = ?', [stateHash]);
    return { expired: true };
  }

  await db.dbRun(
    `UPDATE labcorp_oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = ?`,
    [stateHash]
  );
  return row;
}

/**
 * Mount all LabCorp routes onto an Express app.
 *
 * @param {express.Application} app
 * @param {Object} deps
 * @param {Object} deps.db - server/database wrapper (dbRun/dbGet/dbAll/db)
 */
function mountLabCorpRoutes(app, { db } = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('mountLabCorpRoutes: app is required');
  }
  if (!db || typeof db.dbRun !== 'function') {
    throw new Error('mountLabCorpRoutes: db wrapper is required');
  }

  const router = express.Router();

  // ------------------------------------------
  // GET /status — config health check
  // ------------------------------------------
  // No auth required for a simple boolean check. Leaks no secrets — only
  // reports which env vars are SET, not their values.
  router.get('/integrations/labcorp/status', (req, res) => {
    const mode = process.env.LABCORP_MODE || 'mock';
    const hasCredentials = Boolean(
      process.env.LABCORP_CLIENT_ID && process.env.LABCORP_CLIENT_SECRET
    );
    res.json({
      mode,
      hasCredentials,
      hasAuthUrl: Boolean(process.env.LABCORP_AUTH_URL),
      hasTokenUrl: Boolean(process.env.LABCORP_TOKEN_URL),
      hasRedirectUri: Boolean(process.env.LABCORP_REDIRECT_URI),
      hasSandboxUrl: Boolean(process.env.LABCORP_SANDBOX_URL),
    });
  });

  // ------------------------------------------
  // POST /oauth/start — issue CSRF state, return authorize URL
  // ------------------------------------------
  // Returns `{ authorizeUrl, state }` so the SPA can window.location.assign()
  // the user to LabCorp. We could 302 here instead, but the SPA pattern
  // needs the URL in JSON so it can track the navigation.
  router.post('/integrations/labcorp/oauth/start', async (req, res) => {
    const userId = req.user && req.user.sub;
    if (!userId) {
      return res.status(401).json({ error: 'authentication_required' });
    }

    const authUrl = process.env.LABCORP_AUTH_URL;
    const clientId = process.env.LABCORP_CLIENT_ID;
    const redirectUri = process.env.LABCORP_REDIRECT_URI;
    if (!authUrl || !clientId || !redirectUri) {
      return res.status(500).json({
        error: 'labcorp_not_configured',
        detail: 'LABCORP_AUTH_URL, LABCORP_CLIENT_ID, and LABCORP_REDIRECT_URI must be set',
      });
    }

    // Sweep here (not on callback) so expired states linger the minimum time.
    await _sweepExpiredStates(db);

    const state = oauth.generateState();
    await _storePendingState(db, state, userId);

    const scope = (req.body && req.body.scope) || process.env.LABCORP_SCOPE || 'lab.read lab.write';
    const authorizeUrl = oauth.buildAuthorizeUrl({
      authUrl,
      clientId,
      redirectUri,
      scope,
      state,
    });

    return res.json({ authorizeUrl, state });
  });

  // ------------------------------------------
  // GET /oauth/callback — exchange code + store tokens
  // ------------------------------------------
  // This handler is called by the browser after LabCorp redirects, so it
  // has NO Authorization header. The userId comes from the state record.
  //
  // Order of validation matters here. We check state lookup FIRST (before
  // parseCallback) because a missing state is the most common error and
  // surfaces a cleaner message. If state is valid we then run parseCallback
  // which handles the `error` param from LabCorp, code validation, and a
  // redundant timing-safe state equality check.
  router.get('/integrations/labcorp/oauth/callback', async (req, res) => {
    const stateParam = req.query && req.query.state;
    if (!stateParam) {
      return res.status(400).json({ error: 'invalid_state', detail: 'state missing' });
    }

    const stateRec = await _consumePendingState(db, stateParam);
    if (!stateRec) {
      return res.status(400).json({ error: 'invalid_state', detail: 'unknown or expired state' });
    }
    if (stateRec.expired) {
      return res.status(400).json({ error: 'invalid_state', detail: 'state expired' });
    }

    // Validate the callback shape (throws on error param, state mismatch, missing code)
    try {
      oauth.parseCallback(req.query, stateParam);
    } catch (err) {
      return res.status(400).json({ error: 'callback_error', detail: err.message });
    }

    const tokenUrl = process.env.LABCORP_TOKEN_URL;
    const clientId = process.env.LABCORP_CLIENT_ID;
    const clientSecret = process.env.LABCORP_CLIENT_SECRET;
    const redirectUri = process.env.LABCORP_REDIRECT_URI;
    if (!tokenUrl || !clientId || !clientSecret || !redirectUri) {
      return res.status(500).json({ error: 'labcorp_not_configured' });
    }

    try {
      const tokens = await oauth.exchangeCodeForTokens({
        tokenUrl,
        clientId,
        clientSecret,
        code: req.query.code,
        redirectUri,
      });
      await oauth.storeTokens(db, stateRec.user_id, tokens);
      return res.json({
        ok: true,
        userId: stateRec.user_id,
        scope: tokens.scope || null,
      });
    } catch (err) {
      // Upstream failure: 502 is semantically correct (gateway error).
      return res.status(502).json({
        error: 'token_exchange_failed',
        detail: err.message,
      });
    }
  });

  // ------------------------------------------
  // POST /api/orders/:id/submit-to-labcorp
  // ------------------------------------------
  // Load the lab_order, submit via the API-mode client, write the returned
  // externalOrderId + labcorp_status back to the row. This couples
  // lab_orders persistence to LabCorp's response, which matches the plan's
  // "lab_orders table additions" contract (external_order_id, labcorp_status).
  router.post('/orders/:id/submit-to-labcorp', async (req, res) => {
    const userId = req.user && req.user.sub;
    if (!userId) {
      return res.status(401).json({ error: 'authentication_required' });
    }

    const orderId = parseInt(req.params.id, 10);
    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ error: 'invalid_order_id' });
    }

    const order = await db.dbGet(
      `SELECT id, patient_id, test_name, indication, priority, fasting_required
         FROM lab_orders WHERE id = ?`,
      [orderId]
    );
    if (!order) {
      return res.status(404).json({ error: 'lab_order_not_found' });
    }

    const mode = process.env.LABCORP_MODE || 'mock';
    const client = new LabCorpClient({
      mode,
      baseUrl: process.env.LABCORP_SANDBOX_URL,
      tokenUrl: process.env.LABCORP_TOKEN_URL,
      clientId: process.env.LABCORP_CLIENT_ID,
      clientSecret: process.env.LABCORP_CLIENT_SECRET,
      db,
      userId,
    });

    try {
      const result = await client.submitOrder({
        patientId: order.patient_id,
        tests: [order.test_name],
        indication: order.indication,
        priority: order.priority,
        fasting: Boolean(order.fasting_required),
      });

      if (result && result.externalOrderId) {
        await db.dbRun(
          `UPDATE lab_orders
              SET external_order_id = ?, labcorp_status = ?
            WHERE id = ?`,
          [result.externalOrderId, result.status || 'submitted', orderId]
        );
      }

      return res.json(result);
    } catch (err) {
      return res.status(502).json({
        error: 'submit_failed',
        detail: err.message,
      });
    }
  });

  app.use('/api', router);
}

module.exports = {
  mountLabCorpRoutes,
  // Exported for tests or operators that need to inspect/sweep state
  _internal: {
    hashState,
    _sweepExpiredStates,
    _storePendingState,
    _consumePendingState,
    STATE_TTL_MS,
  },
};
