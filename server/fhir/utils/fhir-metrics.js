'use strict';

/**
 * FHIR Route Metrics
 *
 * Tracks per-resource-type volume, latency, and error counts in memory.
 * A lazy flush to fhir_metrics table occurs when GET /fhir/R4/$stats is called.
 *
 * In-memory schema:
 *   metricsMap: Map<key, { method, resourceType, count, errorCount, totalLatencyMs, p99Bucket }>
 *   key = `${method}:${resourceType}`
 */

const { sendFhir } = require('./fhir-response');

const metricsMap = new Map();
let serverStartTime = Date.now();

// ──────────────────────────────────────────
// INTERNAL HELPERS
// ──────────────────────────────────────────

function keyFor(method, resourceType) {
  return `${method.toUpperCase()}:${resourceType}`;
}

function getOrCreate(method, resourceType) {
  const k = keyFor(method, resourceType);
  if (!metricsMap.has(k)) {
    metricsMap.set(k, {
      method: method.toUpperCase(),
      resourceType,
      count: 0,
      errorCount: 0,
      totalLatencyMs: 0,
      // Simple histogram buckets (ms): <100, <500, <1000, >=1000
      latBuckets: [0, 0, 0, 0]
    });
  }
  return metricsMap.get(k);
}

function recordLatencyBucket(entry, ms) {
  if (ms < 100)       entry.latBuckets[0]++;
  else if (ms < 500)  entry.latBuckets[1]++;
  else if (ms < 1000) entry.latBuckets[2]++;
  else                entry.latBuckets[3]++;
}

// ──────────────────────────────────────────
// PUBLIC: MIDDLEWARE
// ──────────────────────────────────────────

/**
 * Express middleware that records FHIR route metrics.
 * Extracts resource type from req.path (first path segment after /fhir/R4/).
 * Attaches itself to `res.on('finish')` so it captures the final status code.
 */
function fhirMetricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;

    // Extract resource type: /Patient/:id → 'Patient', /$stats → '$stats'
    const segments = req.path.replace(/^\//, '').split('/');
    const resourceType = segments[0] || 'unknown';

    const entry = getOrCreate(req.method, resourceType);
    entry.count++;
    entry.totalLatencyMs += ms;
    recordLatencyBucket(entry, ms);
    if (res.statusCode >= 400) entry.errorCount++;
  });

  next();
}

// ──────────────────────────────────────────
// PUBLIC: SNAPSHOT / RESET
// ──────────────────────────────────────────

/**
 * Return a snapshot of current metrics as a plain object array.
 */
function getSnapshot() {
  const rows = [];
  for (const entry of metricsMap.values()) {
    rows.push({
      ...entry,
      avgLatencyMs: entry.count > 0 ? Math.round(entry.totalLatencyMs / entry.count) : 0,
      uptimeSeconds: Math.round((Date.now() - serverStartTime) / 1000)
    });
  }
  return rows;
}

/**
 * Reset all in-memory metrics (useful for testing).
 */
function resetMetrics() {
  metricsMap.clear();
  serverStartTime = Date.now();
}

// ──────────────────────────────────────────
// PUBLIC: FHIR $stats HANDLER
// ──────────────────────────────────────────

/**
 * GET /fhir/R4/$stats
 * Returns a FHIR Parameters resource with current route metrics.
 */
async function statsHandler(req, res) {
  const snapshot = getSnapshot();

  const parameters = {
    resourceType: 'Parameters',
    parameter: [
      {
        name: 'serverStartTime',
        valueDateTime: new Date(serverStartTime).toISOString()
      },
      {
        name: 'uptimeSeconds',
        valueInteger: snapshot[0]?.uptimeSeconds ?? 0
      },
      ...snapshot.map(row => ({
        name: 'routeMetric',
        part: [
          { name: 'method',        valueString:  row.method },
          { name: 'resourceType',  valueString:  row.resourceType },
          { name: 'count',         valueInteger: row.count },
          { name: 'errorCount',    valueInteger: row.errorCount },
          { name: 'avgLatencyMs',  valueInteger: row.avgLatencyMs },
          { name: 'latBucket_lt100ms',    valueInteger: row.latBuckets[0] },
          { name: 'latBucket_lt500ms',    valueInteger: row.latBuckets[1] },
          { name: 'latBucket_lt1000ms',   valueInteger: row.latBuckets[2] },
          { name: 'latBucket_gte1000ms',  valueInteger: row.latBuckets[3] }
        ]
      }))
    ]
  };

  sendFhir(res, parameters);
}

module.exports = { fhirMetricsMiddleware, statsHandler, getSnapshot, resetMetrics };
