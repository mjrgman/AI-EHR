'use strict';

/**
 * MediVault HTTP routes — Phase 3c
 *
 * Single endpoint (for now): the patient-owned export.
 *
 *   GET /api/medivault/export/:patientId
 *     → 200 application/fhir+json — FHIR R4 Bundle (type=collection)
 *       Content-Disposition: attachment; filename="medivault-<id>-<date>.json"
 *     → 404 OperationOutcome when the patient does not exist
 *
 * Mounting contract: callers pass `{ db }` explicitly, matching
 * `mountLabCorpRoutes(app, { db })` in routes/labcorp-routes.js. This
 * keeps the module test-mountable on a fresh Express app and avoids a
 * circular require with server/database.js during cold start.
 *
 * Access auditing: every successful export writes a row into
 * `vault_access_log` with access_type='EXPORT'. That row names the
 * caller (req.user.username or sub), NOT "system" — because the whole
 * point of a patient-owned export is to have a durable record of "who
 * pulled this patient's file on what date". If the audit write fails
 * we still return the bundle (the patient shouldn't be blocked by an
 * infrastructure issue), but we log a warning so ops can investigate.
 */

const express = require('express');
const { buildPatientBundle } = require('../medivault');
const { sendFhir, sendError } = require('../fhir/utils/fhir-response');
const rbac = require('../security/rbac');

/**
 * Mount the MediVault routes onto an Express app.
 *
 * @param {express.Application} app
 * @param {{ db: object }} deps - must carry { dbRun, dbGet, dbAll, ... }
 */
function mountMediVaultRoutes(app, { db } = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('mountMediVaultRoutes: app is required');
  }
  if (!db || typeof db.dbRun !== 'function') {
    throw new Error('mountMediVaultRoutes: db wrapper is required');
  }

  const router = express.Router();

  // ----------------------------------------------------------
  // GET /api/medivault/export/:patientId
  // ----------------------------------------------------------
  router.get('/medivault/export/:patientId', rbac.requireRole('physician', 'nurse_practitioner', 'system'), async (req, res) => {
    const patientId = Number(req.params.patientId);
    if (!Number.isFinite(patientId) || patientId <= 0) {
      return sendError(res, 400, 'invalid', 'patientId must be a positive integer');
    }

    let bundle;
    try {
      bundle = await buildPatientBundle(patientId);
    } catch (err) {
      if (err && err.code === 'PATIENT_NOT_FOUND') {
        return sendError(res, 404, 'not-found', `Patient not found: ${patientId}`);
      }
      console.error('[MediVault] export failed:', err);
      return sendError(res, 500, 'exception', `export failed: ${err.message}`);
    }

    // Audit the access. We do this AFTER the bundle assembles cleanly so
    // a 404/500 doesn't leave a misleading "EXPORT succeeded" log row.
    try {
      const accessedBy =
        (req.user && (req.user.username || req.user.sub || req.user.id)) || 'unknown';
      await db.dbRun(
        `INSERT INTO vault_access_log (patient_id, accessed_by, access_type, resource_accessed, authorized)
         VALUES (?, ?, 'EXPORT', 'patient_bundle', 1)`,
        [patientId, String(accessedBy)]
      );
    } catch (auditErr) {
      // Don't block the response on audit failure — but log loudly so ops
      // can triage. This is a deliberate trade-off: we favor patient access
      // to their own data over a perfect audit trail.
      console.warn('[MediVault] vault_access_log write failed:', auditErr.message);
    }

    // Build the filename. Date is the export day in YYYY-MM-DD so a patient
    // downloading twice on the same day gets the same file name (browsers
    // will suffix "(1)" automatically) and two exports on different days
    // are trivially distinguishable.
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `medivault-${patientId}-${dateStr}.json`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);

    return sendFhir(res, bundle, 200);
  });

  app.use('/api', router);
}

module.exports = { mountMediVaultRoutes };
