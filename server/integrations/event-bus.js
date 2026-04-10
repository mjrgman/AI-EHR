'use strict';

/**
 * Event Bus for External Systems
 *
 * Extends the internal agent message bus with outbound event emission.
 * External systems register webhook URLs to receive EHR events.
 *
 * Events: encounter.started, order.placed, note.signed, prescription.created,
 *         lab.resulted, appointment.scheduled, care_gap.detected
 *
 * Security: HMAC-SHA256 signature on all outbound payloads.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const db = require('../database');

const WEBHOOK_TIMEOUT_MS = 5000;
const VALID_EVENTS = [
  'encounter.started', 'encounter.completed',
  'order.placed', 'order.completed',
  'note.signed', 'note.updated',
  'prescription.created', 'prescription.signed',
  'lab.resulted', 'lab.abnormal',
  'appointment.scheduled', 'appointment.cancelled',
  'care_gap.detected', 'referral.created'
];

// ──────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────

async function initEventBusTables() {
  await db.dbRun(`CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    failure_count INTEGER DEFAULT 0,
    last_success DATETIME,
    last_failure DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.dbRun(`CREATE TABLE IF NOT EXISTS webhook_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT,
    status_code INTEGER,
    response_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
  )`);
}

// Initialize on load
initEventBusTables().catch(err =>
  console.warn('[EventBus] Table init deferred:', err.message)
);

// ──────────────────────────────────────────
// WEBHOOK SIGNATURE
// ──────────────────────────────────────────

function signPayload(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ──────────────────────────────────────────
// WEBHOOK DELIVERY
// ──────────────────────────────────────────

function deliverWebhook(url, payload, secret) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const signature = signPayload(body, secret);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const startTime = Date.now();

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-EHR-Signature': `sha256=${signature}`,
        'X-EHR-Event': payload.event,
        'X-EHR-Delivery-ID': crypto.randomUUID()
      }
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          responseMs: Date.now() - startTime
        });
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, statusCode: 0, responseMs: Date.now() - startTime, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, statusCode: 0, responseMs: WEBHOOK_TIMEOUT_MS, error: 'timeout' });
    });

    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────
// EVENT EMISSION
// ──────────────────────────────────────────

/**
 * Emit an event to all subscribed webhooks.
 * Non-blocking — fires and logs results asynchronously.
 *
 * @param {string} eventType - Event name (e.g. 'prescription.created')
 * @param {object} data - Event payload data
 */
async function emit(eventType, data) {
  if (!VALID_EVENTS.includes(eventType)) {
    console.warn(`[EventBus] Unknown event type: ${eventType}`);
    return;
  }

  let subscriptions;
  try {
    subscriptions = await db.dbAll(
      'SELECT * FROM webhook_subscriptions WHERE is_active = 1',
      []
    );
  } catch {
    return; // Table may not exist yet during startup
  }

  const payload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data
  };

  for (const sub of subscriptions) {
    const subscribedEvents = JSON.parse(sub.events || '[]');
    if (!subscribedEvents.includes(eventType) && !subscribedEvents.includes('*')) continue;

    // Fire and forget — don't block the clinical workflow
    deliverWebhook(sub.endpoint_url, payload, sub.secret_key).then(async (result) => {
      try {
        await db.dbRun(
          `INSERT INTO webhook_delivery_log (subscription_id, event_type, status_code, response_ms, success, error_message)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [sub.id, eventType, result.statusCode, result.responseMs, result.success ? 1 : 0, result.error || null]
        );

        if (result.success) {
          await db.dbRun('UPDATE webhook_subscriptions SET last_success = datetime(\'now\'), failure_count = 0 WHERE id = ?', [sub.id]);
        } else {
          await db.dbRun('UPDATE webhook_subscriptions SET last_failure = datetime(\'now\'), failure_count = failure_count + 1 WHERE id = ?', [sub.id]);
          // Auto-disable after 10 consecutive failures
          if (sub.failure_count >= 9) {
            await db.dbRun('UPDATE webhook_subscriptions SET is_active = 0 WHERE id = ?', [sub.id]);
            console.warn(`[EventBus] Disabled subscription ${sub.id} (${sub.subscriber_name}) after 10 failures`);
          }
        }
      } catch (err) {
        console.warn(`[EventBus] Delivery log failed: ${err.message}`);
      }
    });
  }
}

// ──────────────────────────────────────────
// SUBSCRIPTION MANAGEMENT
// ──────────────────────────────────────────

async function subscribe(subscriberName, endpointUrl, events) {
  const invalidEvents = events.filter(e => e !== '*' && !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    throw new Error(`Invalid event types: ${invalidEvents.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}`);
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const result = await db.dbRun(
    `INSERT INTO webhook_subscriptions (subscriber_name, endpoint_url, events, secret_key)
     VALUES (?, ?, ?, ?)`,
    [subscriberName, endpointUrl, JSON.stringify(events), secret]
  );

  return { id: result.lastID, secret, subscriberName, endpointUrl, events };
}

async function unsubscribe(subscriptionId) {
  await db.dbRun('UPDATE webhook_subscriptions SET is_active = 0 WHERE id = ?', [subscriptionId]);
}

async function listSubscriptions() {
  return db.dbAll('SELECT id, subscriber_name, endpoint_url, events, is_active, failure_count, last_success, last_failure, created_at FROM webhook_subscriptions', []);
}

async function getDeliveryLog(subscriptionId, limit = 50) {
  return db.dbAll(
    'SELECT * FROM webhook_delivery_log WHERE subscription_id = ? ORDER BY delivered_at DESC LIMIT ?',
    [subscriptionId, limit]
  );
}

// ──────────────────────────────────────────
// EXPRESS ROUTER
// ──────────────────────────────────────────

const express = require('express');
const router = express.Router();

// GET /api/webhooks — list subscriptions
router.get('/', async (req, res) => {
  try {
    const subs = await listSubscriptions();
    res.json({ subscriptions: subs, available_events: VALID_EVENTS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks — create subscription
router.post('/', async (req, res) => {
  try {
    const { subscriber_name, endpoint_url, events } = req.body;
    if (!subscriber_name || !endpoint_url || !events) {
      return res.status(400).json({ error: 'Required: subscriber_name, endpoint_url, events[]' });
    }
    const sub = await subscribe(subscriber_name, endpoint_url, events);
    res.status(201).json(sub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/webhooks/:id — deactivate subscription
router.delete('/:id', async (req, res) => {
  try {
    await unsubscribe(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webhooks/:id/log — delivery log
router.get('/:id/log', async (req, res) => {
  try {
    const log = await getDeliveryLog(parseInt(req.params.id, 10));
    res.json({ deliveries: log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  emit,
  subscribe,
  unsubscribe,
  listSubscriptions,
  VALID_EVENTS,
  router
};
