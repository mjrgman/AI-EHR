'use strict';

/**
 * MediVault HTTP routes — Phase 3c
 *
 * Single endpoint (for now): the MediVault export.
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
 * Access control: a clinician JWT with role physician / nurse_practitioner /
 * system may export any patient's bundle. A patient-portal session may export
 * only its own patient's bundle.
 *
 * Access auditing: every successful export writes a row into
 * `vault_access_log` with access_type='EXPORT'. That row names the
 * caller (req.user.username or sub), NOT "system" — because the whole
 * point of the export is to have a durable record of "who pulled this
 * patient's file on what date". If the audit write fails we still return
 * the bundle, but we log a warning so ops can investigate.
 */

const express = require('express');
const auth = require('../security/auth');
const { buildPatientBundle } = require('../medivault');
const { requirePortalSession } = require('../services/portal-session-service');
const { sendFhir, sendError } = require('../fhir/utils/fhir-response');

const CLINICIAN_EXPORT_ROLES = new Set(['physician', 'nurse_practitioner', 'system']);

function getRequestRole(req) {
  return req.session?.userRole || req.user?.role || 'guest';
}

function getRequestUserId(req) {
  return String(req.session?.userId || req.user?.username || req.user?.sub || 'anonymous');
}

function authorizeMediVaultExport(req, res, next) {
  const patientId = Number(req.params.patientId);
  if (!Number.isFinite(patientId) || patientId <= 0) {
    return sendError(res, 400, 'invalid', 'patientId must be a positive integer');
  }

  const authResult = auth.authenticateRequest(req);
  if (authResult.authenticated) {
    const userRole = getRequestRole(req);
    if (!CLINICIAN_EXPORT_ROLES.has(userRole)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        requiredRoles: Array.from(CLINICIAN_EXPORT_ROLES),
        userRole,
      });
    }

    req.medivaultExportContext = {
      accessType: 'clinician',
      patientId,
      userId: getRequestUserId(req),
      userRole,
    };
    return next();
  }

  if (authResult.tokenPresent) {
    return res.status(401).json({ error: authResult.error || 'Authentication required' });
  }

  return requirePortalSession(req, res, (error) => {
    if (error) {
      return next(error);
    }

    if (Number(req.portalPatient.id) !== patientId) {
      return res.status(403).json({
        error: 'Patient portal users may export only their own record',
      });
    }

    req.session = req.session || {};
    req.session.userId = req.user.username;
    req.session.userRole = req.user.role;
    req.medivaultExportContext = {
      accessType: 'portal',
      patientId,
      userId: req.user.username,
      userRole: req.user.role,
    };
    return next();
  });
}

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
  router.get('/medivault/export/:patientId', authorizeMediVaultExport, async (req, res) => {
    const patientId = Number(req.params.patientId);

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

      if (req.medivaultExportContext?.accessType === 'clinician') {
        console.warn(
          `[MediVault] clinician export authorized: patient ${patientId} exported by ${accessedBy} (${getRequestRole(req)})`
        );
      }

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
