'use strict';

/**
 * HEDIS HTTP routes.
 *
 * Surfaces the HEDIS adapter over /api/quality/hedis/*. The adapter is
 * pure-function (server/quality/hedis/index.js); these routes only translate
 * HTTP into adapter inputs and back.
 *
 * Per-patient evaluation accepts the FHIR-shaped data inline (the adapter
 * doesn't need a Bundle) — this matches how our FHIR mappers produce data
 * already.
 *
 * Mount: mountHedisRoutes(app, { db })
 */

const express = require('express');
const hedis = require('../quality/hedis');
const rbac = require('../security/rbac');

const HEDIS_ROLES = ['physician', 'nurse_practitioner', 'ma', 'billing', 'system'];

function mountHedisRoutes(app, { db: _db } = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('mountHedisRoutes: app is required');
  }

  const router = express.Router();
  router.use('/quality/hedis', rbac.requireRole(...HEDIS_ROLES));

  // ----------------------------------------------------------
  // GET /api/quality/hedis/measures
  //   List available HEDIS measure IDs.
  // ----------------------------------------------------------
  router.get('/quality/hedis/measures', async (_req, res) => {
    return res.json({
      measures: hedis.listMeasures(),
      measurement_year_default: new Date().getFullYear()
    });
  });

  // ----------------------------------------------------------
  // POST /api/quality/hedis/evaluate/:measureId
  //   Body: { patient, problems?, procedures?, bp_observations?, measurementYearEnd? }
  // ----------------------------------------------------------
  router.post('/quality/hedis/evaluate/:measureId', async (req, res) => {
    const measureId = String(req.params.measureId || '').toUpperCase();
    if (!measureId) {
      return res.status(400).json({ error: 'measureId is required' });
    }
    const body = req.body || {};
    if (!body.patient || !body.patient.id) {
      return res.status(400).json({ error: 'patient.id is required' });
    }

    const result = hedis.evaluateMeasure(measureId, body);

    // Adapter returns { error: '...' } when the measure ID is unknown
    if (result && result.error) {
      return res.status(404).json({ error: result.error, measureId });
    }
    return res.json(result);
  });

  // ----------------------------------------------------------
  // POST /api/quality/hedis/all
  //   Body: { patient, problems?, procedures?, bp_observations?, measurementYearEnd? }
  //   Returns every registered measure's status for this patient.
  // ----------------------------------------------------------
  router.post('/quality/hedis/all', async (req, res) => {
    const body = req.body || {};
    if (!body.patient || !body.patient.id) {
      return res.status(400).json({ error: 'patient.id is required' });
    }
    const result = hedis.evaluateAllForPatient(body);
    return res.json(result);
  });

  app.use('/api', router);
}

module.exports = { mountHedisRoutes };
