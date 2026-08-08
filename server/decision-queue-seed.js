/**
 * Decision Queue demo seed.
 *
 * Ensures the provider Decision Queue is NON-EMPTY on first load of the demo,
 * fully offline, with SYNTHETIC DATA ONLY. Reuses the existing demo patients
 * (Sarah Mitchell, Robert Chen — loaded by database.js loadDemoData) and, for
 * each, creates:
 *   - one synthetic encounter with a clinically meaningful chief complaint,
 *   - a workflow_state row advanced to 'provider-examining' (the provider-
 *     actionable state from which a decision legally transitions the encounter
 *     to 'orders-pending' — see server/workflow-engine.js),
 *   - a synthetic vitals set on the encounter (so triage derives from real data),
 *   - a pending decision_queue row.
 *
 * Idempotent: keyed off the (patient, exact chief-complaint) pair, so repeated
 * server starts do not duplicate rows. No sentinel marker leaks into the
 * clinician-facing chief complaint or AI-generated option text.
 */

'use strict';

// Synthetic encounters keyed to the two demo patients by MRN. Vitals are chosen
// to exercise the triage tiers: Robert Chen (COPD/CHF) presents with SOB +
// borderline-low SpO2 (urgent/emergent), Sarah Mitchell (diabetic) presents
// with a routine hyperglycemia follow-up (urgent same-day / routine).
const SEED_ENCOUNTERS = [
  {
    mrn: '2020-18834', // Robert Chen
    chief_complaint: 'Shortness of breath and lower-extremity swelling for 3 days',
    vitals: { systolic_bp: 148, diastolic_bp: 92, heart_rate: 104, respiratory_rate: 24, temperature: 98.9, spo2: 91, weight: 198, height: 70 },
  },
  {
    mrn: '2018-04792', // Sarah Mitchell
    chief_complaint: 'Blood sugars running high, increased thirst and fatigue',
    vitals: { systolic_bp: 138, diastolic_bp: 86, heart_rate: 88, respiratory_rate: 16, temperature: 98.6, spo2: 98, weight: 187, height: 64 },
  },
];

async function seedDecisionQueue(db) {
  try {
    for (const seed of SEED_ENCOUNTERS) {
      const patient = await db.dbGet('SELECT id FROM patients WHERE mrn = ?', [seed.mrn]);
      if (!patient) continue; // demo patient not present — skip silently

      // Idempotency: skip if a seeded encounter with this exact (clean) chief
      // complaint already exists for the patient. No marker leaks into the
      // clinician-facing text.
      const existing = await db.dbGet(
        `SELECT id FROM encounters WHERE patient_id = ? AND chief_complaint = ?`,
        [patient.id, seed.chief_complaint]
      );
      if (existing) continue;

      // 1) Encounter.
      const enc = await db.createEncounter({
        patient_id: patient.id,
        encounter_date: new Date().toISOString().split('T')[0],
        encounter_type: 'office_visit',
        chief_complaint: seed.chief_complaint,
        provider: process.env.PROVIDER_NAME || 'Dr. MJR',
      });

      // 2) Workflow row, advanced to provider-examining (provider-actionable).
      await db.createWorkflow({
        encounter_id: enc.id,
        patient_id: patient.id,
        assigned_ma: 'Demo MA',
        assigned_provider: process.env.PROVIDER_NAME || 'Dr. MJR',
      });
      await db.updateWorkflowState(enc.id, { current_state: 'provider-examining' });

      // 3) Synthetic vitals for this encounter (triage derives from these).
      await db.addVitals({
        patient_id: patient.id,
        encounter_id: enc.id,
        ...seed.vitals,
        recorded_by: 'Demo MA',
      });

      // 4) Pending decision-queue row.
      await db.createDecisionQueueItem({ encounter_id: enc.id, patient_id: patient.id });
    }
    console.log('[SEED] Decision queue demo seed ready');
  } catch (err) {
    // Non-fatal: a seed failure must never block server startup.
    console.warn('[SEED] Decision queue seed failed (non-fatal):', err.message);
  }
}

module.exports = { seedDecisionQueue };
