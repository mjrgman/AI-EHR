'use strict';

/**
 * HL7 CDS Hooks Server Implementation
 *
 * Implements the CDS Hooks specification (https://cds-hooks.hl7.org/)
 * for the Agentic EHR. Provides:
 *   - Discovery endpoint (GET /cds-services)
 *   - External service registration (POST /cds-services/register)
 *   - Hook evaluation with merged card responses (POST /cds-services/:hookId/evaluate)
 *
 * Mounts at /cds-services in the main server.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');

// ==========================================
// CONSTANTS
// ==========================================

const EXTERNAL_CALL_TIMEOUT_MS = 2000;

const SUPPORTED_HOOKS = [
  'patient-view',
  'order-select',
  'order-sign',
  'medication-prescribe',
];

// Built-in service descriptors returned by the discovery endpoint
const BUILTIN_SERVICES = [
  {
    hook: 'patient-view',
    title: 'Patient Summary CDS',
    description: 'Evaluates clinical decision support rules when a patient chart is opened.',
    id: 'ehr-patient-view',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      conditions: 'Condition?patient={{context.patientId}}&clinical-status=active',
    },
  },
  {
    hook: 'order-select',
    title: 'Order Selection CDS',
    description: 'Provides decision support when a clinician selects an order.',
    id: 'ehr-order-select',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
    },
  },
  {
    hook: 'order-sign',
    title: 'Order Signing CDS',
    description: 'Final safety checks before an order is signed.',
    id: 'ehr-order-sign',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
      allergies: 'AllergyIntolerance?patient={{context.patientId}}',
    },
  },
  {
    hook: 'medication-prescribe',
    title: 'Medication Prescribe CDS',
    description: 'Drug interaction and formulary checks during prescribing.',
    id: 'ehr-medication-prescribe',
    prefetch: {
      patient: 'Patient/{{context.patientId}}',
      medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
      allergies: 'AllergyIntolerance?patient={{context.patientId}}',
    },
  },
];

// ==========================================
// TABLE INITIALIZATION
// ==========================================

async function initCdsHooksTables() {
  await db.dbRun(`CREATE TABLE IF NOT EXISTS cds_hook_services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hook TEXT NOT NULL,
    url TEXT NOT NULL,
    prefetch TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

// Initialize on module load
initCdsHooksTables().catch(err => {
  console.error('[CDS-Hooks] Failed to initialize cds_hook_services table:', err.message);
});

// ==========================================
// HELPERS
// ==========================================

/**
 * Build a CDS Hooks spec-compliant card.
 */
function buildCard({ summary, detail, indicator, source, suggestions, links, selectionBehavior }) {
  const card = {
    summary: summary || 'Clinical Decision Support',
    indicator: indicator || 'info',
    source: source || { label: 'MJR-EHR CDS Engine' },
  };

  if (detail) card.detail = detail;
  if (suggestions && suggestions.length > 0) card.suggestions = suggestions;
  if (links && links.length > 0) card.links = links;
  if (selectionBehavior) card.selectionBehavior = selectionBehavior;

  return card;
}

/**
 * Call an external CDS service with a timeout.
 * Returns an array of cards or an empty array on failure.
 */
async function callExternalService(service, hookContext) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_CALL_TIMEOUT_MS);

  const requestBody = {
    hookInstance: hookContext.hookInstance || crypto.randomUUID(),
    fhirServer: hookContext.fhirServer || null,
    hook: service.hook,
    context: hookContext.context || {},
    prefetch: hookContext.prefetch || {},
  };

  try {
    const response = await fetch(service.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[CDS-Hooks] External service "${service.name}" returned ${response.status}`);
      return [];
    }

    const data = await response.json();

    // CDS Hooks spec: response must contain a "cards" array
    if (data && Array.isArray(data.cards)) {
      return data.cards;
    }

    console.warn(`[CDS-Hooks] External service "${service.name}" returned malformed response (no cards array)`);
    return [];
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[CDS-Hooks] External service "${service.name}" timed out after ${EXTERNAL_CALL_TIMEOUT_MS}ms`);
    } else {
      console.warn(`[CDS-Hooks] External service "${service.name}" call failed:`, err.message);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate that a hook type is supported.
 */
function isValidHook(hook) {
  return SUPPORTED_HOOKS.includes(hook);
}

// ==========================================
// ROUTES
// ==========================================

/**
 * GET /cds-services
 * CDS Hooks Discovery Endpoint
 *
 * Returns a JSON object with a "services" array listing all available
 * hook points (both built-in and registered external services).
 */
router.get('/', async (req, res) => {
  try {
    // Fetch active registered external services
    const externalServices = await db.dbAll(
      'SELECT id, name, hook, url, prefetch FROM cds_hook_services WHERE is_active = 1'
    );

    // Map external services to CDS Hooks discovery format
    const externalDescriptors = externalServices.map(svc => {
      let prefetch = null;
      if (svc.prefetch) {
        try {
          prefetch = JSON.parse(svc.prefetch);
        } catch {
          prefetch = null;
        }
      }
      return {
        hook: svc.hook,
        title: svc.name,
        description: `External CDS service: ${svc.name}`,
        id: svc.id,
        prefetch,
      };
    });

    res.json({
      services: [...BUILTIN_SERVICES, ...externalDescriptors],
    });
  } catch (err) {
    console.error('[CDS-Hooks] Discovery endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve CDS services' });
  }
});

/**
 * POST /cds-services/register
 * Register an external CDS service.
 *
 * Body: { id, name, hook, url, prefetch? }
 */
router.post('/register', async (req, res) => {
  const { id, name, hook, url, prefetch } = req.body;

  // Validate required fields
  if (!id || !name || !hook || !url) {
    return res.status(400).json({
      error: 'Missing required fields: id, name, hook, and url are required',
    });
  }

  // Validate hook type
  if (!isValidHook(hook)) {
    return res.status(400).json({
      error: `Unsupported hook type: "${hook}". Supported hooks: ${SUPPORTED_HOOKS.join(', ')}`,
    });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Validate id format (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({
      error: 'Service id must contain only alphanumeric characters, hyphens, and underscores',
    });
  }

  const prefetchJson = prefetch ? JSON.stringify(prefetch) : null;

  try {
    // Check for existing service with same id
    const existing = await db.dbGet('SELECT id FROM cds_hook_services WHERE id = ?', [id]);

    if (existing) {
      // Update existing service
      await db.dbRun(
        'UPDATE cds_hook_services SET name = ?, hook = ?, url = ?, prefetch = ?, is_active = 1 WHERE id = ?',
        [name, hook, url, prefetchJson, id]
      );

      return res.json({
        message: 'CDS service updated',
        service: { id, name, hook, url, prefetch: prefetch || null },
      });
    }

    // Insert new service
    await db.dbRun(
      'INSERT INTO cds_hook_services (id, name, hook, url, prefetch) VALUES (?, ?, ?, ?, ?)',
      [id, name, hook, url, prefetchJson]
    );

    res.status(201).json({
      message: 'CDS service registered',
      service: { id, name, hook, url, prefetch: prefetch || null },
    });
  } catch (err) {
    console.error('[CDS-Hooks] Registration error:', err.message);
    res.status(500).json({ error: 'Failed to register CDS service' });
  }
});

/**
 * POST /cds-services/:hookId/evaluate
 * Evaluate a CDS hook.
 *
 * Calls all registered external services for the given hook type,
 * collects their response cards, and returns a merged CDS Hooks response.
 *
 * Body: {
 *   hookInstance: string (UUID),
 *   fhirServer?: string,
 *   context: object,
 *   prefetch?: object
 * }
 */
router.post('/:hookId/evaluate', async (req, res) => {
  const { hookId } = req.params;

  if (!isValidHook(hookId)) {
    return res.status(400).json({
      error: `Unsupported hook: "${hookId}". Supported hooks: ${SUPPORTED_HOOKS.join(', ')}`,
    });
  }

  const hookContext = {
    hookInstance: req.body.hookInstance || crypto.randomUUID(),
    fhirServer: req.body.fhirServer || null,
    context: req.body.context || {},
    prefetch: req.body.prefetch || {},
  };

  try {
    // Get all active external services registered for this hook
    const services = await db.dbAll(
      'SELECT id, name, hook, url, prefetch FROM cds_hook_services WHERE hook = ? AND is_active = 1',
      [hookId]
    );

    // Call all external services in parallel
    const cardArrays = await Promise.all(
      services.map(svc => callExternalService(svc, hookContext))
    );

    // Flatten all card arrays into a single merged array
    const allCards = cardArrays.flat();

    // If no external services returned cards, provide a default informational card
    if (allCards.length === 0 && services.length === 0) {
      allCards.push(buildCard({
        summary: `No external CDS services registered for hook: ${hookId}`,
        detail: 'Register external services via POST /cds-services/register to enable decision support for this hook point.',
        indicator: 'info',
        source: { label: 'MJR-EHR CDS Hooks', url: null },
      }));
    }

    // Return CDS Hooks spec-compliant response
    res.json({ cards: allCards });
  } catch (err) {
    console.error(`[CDS-Hooks] Evaluation error for hook "${hookId}":`, err.message);
    res.status(500).json({
      cards: [
        buildCard({
          summary: 'CDS evaluation error',
          detail: 'An internal error occurred while evaluating clinical decision support services.',
          indicator: 'warning',
          source: { label: 'MJR-EHR CDS Hooks' },
        }),
      ],
    });
  }
});

/**
 * DELETE /cds-services/:serviceId
 * Deactivate a registered external CDS service.
 */
router.delete('/:serviceId', async (req, res) => {
  const { serviceId } = req.params;

  try {
    const result = await db.dbRun(
      'UPDATE cds_hook_services SET is_active = 0 WHERE id = ?',
      [serviceId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: `CDS service "${serviceId}" not found` });
    }

    res.json({ message: `CDS service "${serviceId}" deactivated` });
  } catch (err) {
    console.error('[CDS-Hooks] Deactivation error:', err.message);
    res.status(500).json({ error: 'Failed to deactivate CDS service' });
  }
});

/**
 * GET /cds-services/:serviceId
 * Get details of a specific CDS service (built-in or registered).
 */
router.get('/:serviceId', async (req, res) => {
  const { serviceId } = req.params;

  // Check built-in services first
  const builtin = BUILTIN_SERVICES.find(s => s.id === serviceId);
  if (builtin) {
    return res.json(builtin);
  }

  // Check registered external services
  try {
    const svc = await db.dbGet(
      'SELECT id, name, hook, url, prefetch, is_active, created_at FROM cds_hook_services WHERE id = ?',
      [serviceId]
    );

    if (!svc) {
      return res.status(404).json({ error: `CDS service "${serviceId}" not found` });
    }

    let prefetch = null;
    if (svc.prefetch) {
      try {
        prefetch = JSON.parse(svc.prefetch);
      } catch {
        prefetch = null;
      }
    }

    res.json({
      hook: svc.hook,
      title: svc.name,
      description: `External CDS service: ${svc.name}`,
      id: svc.id,
      url: svc.url,
      prefetch,
      is_active: Boolean(svc.is_active),
      created_at: svc.created_at,
    });
  } catch (err) {
    console.error('[CDS-Hooks] Service lookup error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve CDS service' });
  }
});

module.exports = router;
