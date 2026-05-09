'use strict';

/**
 * Care management HTTP routes.
 *
 * Surfaces the care-management engine over /api/care-management/*. The engine
 * itself is pure-function (server/care-management/engine.js); these routes
 * only translate HTTP request shape into engine inputs and back.
 *
 * Persistence (enrollment + time-log writes) is deferred until DB migrations
 * land — the GET endpoints accept enrollment + timeLog in the query/body for
 * stateless evaluation today, and POST `/billable` does the same.
 *
 * Mount: mountCareManagementRoutes(app, { db })
 */

const express = require('express');
const engine = require('../care-management/engine');
const eligibility = require('../care-management/eligibility');
const codes = require('../care-management/codes');
const stacking = require('../care-management/stacking-rules');
const rbac = require('../security/rbac');

const CARE_MANAGEMENT_ROLES = ['physician', 'nurse_practitioner', 'billing', 'system'];

function mountCareManagementRoutes(app, { db } = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('mountCareManagementRoutes: app is required');
  }

  const router = express.Router();
  router.use('/care-management', rbac.requireRole(...CARE_MANAGEMENT_ROLES));

  // ----------------------------------------------------------
  // GET /api/care-management/codes
  //   Returns the full CPT/HCPCS catalog. Useful for billing UIs.
  // ----------------------------------------------------------
  router.get('/care-management/codes', async (_req, res) => {
    return res.json({
      total: Object.keys(codes.ALL_CODES).length,
      families: codes.FAMILIES,
      codes: codes.ALL_CODES
    });
  });

  // ----------------------------------------------------------
  // POST /api/care-management/eligibility
  //   Body: { patient, problems, consent, recentDischarge?, deviceData? }
  //   Returns per-program eligibility for the patient.
  // ----------------------------------------------------------
  router.post('/care-management/eligibility', async (req, res) => {
    const body = req.body || {};
    const patient = body.patient || {};
    const problems = body.problems || [];
    const consent = body.consent || null;

    if (!patient.id) {
      return res.status(400).json({ error: 'patient.id is required' });
    }

    const result = {
      patient_id: patient.id,
      ccm: eligibility.checkCCMEligibility(patient, problems, consent),
      pcm: eligibility.checkPCMEligibility(patient, problems, consent),
      bhi: eligibility.checkBHIEligibility(patient, problems, consent),
      tcm: body.recentDischarge
        ? eligibility.checkTCMEligibility(patient, body.recentDischarge)
        : { eligible: false, reason: 'No recentDischarge provided.' },
      rpm: body.deviceData
        ? eligibility.checkRPMEligibility(patient, problems, consent, body.deviceData)
        : { eligible: false, reason: 'No deviceData provided.' }
    };

    return res.json(result);
  });

  // ----------------------------------------------------------
  // POST /api/care-management/billable
  //   Body: { patient, problems, enrollment, timeLog, activeBillingCpts?, ... }
  //   Returns the billable code set for the month.
  // ----------------------------------------------------------
  router.post('/care-management/billable', async (req, res) => {
    const body = req.body || {};

    if (!body.patient || !body.patient.id) {
      return res.status(400).json({ error: 'patient.id is required' });
    }
    if (!body.enrollment || !body.enrollment.program_type) {
      return res.status(400).json({ error: 'enrollment.program_type is required' });
    }

    const result = engine.computeMonthlyBillableCodes({
      patient: body.patient,
      problems: body.problems || [],
      enrollment: body.enrollment,
      timeLog: body.timeLog || [],
      activeBillingCpts: body.activeBillingCpts || [],
      recentDischarge: body.recentDischarge || null,
      tcmContext: body.tcmContext || null,
      apcmOptions: body.apcmOptions || null
    });

    return res.json({
      patient_id: body.patient.id,
      ...result
    });
  });

  // ----------------------------------------------------------
  // POST /api/care-management/conflict-check
  //   Body: { proposedCpt, activeCpts, tcmActiveServicePeriod? }
  //   Pure helper — useful for pre-flight checks in billing UIs.
  // ----------------------------------------------------------
  router.post('/care-management/conflict-check', async (req, res) => {
    const body = req.body || {};
    if (!body.proposedCpt) {
      return res.status(400).json({ error: 'proposedCpt is required' });
    }
    const result = stacking.checkConflict(
      body.proposedCpt,
      body.activeCpts || [],
      { tcmActiveServicePeriod: !!body.tcmActiveServicePeriod }
    );
    return res.json(result);
  });

  app.use('/api', router);
}

module.exports = { mountCareManagementRoutes };
