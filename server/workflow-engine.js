/**
 * MJR-EHR Workflow State Machine
 * Manages encounter workflow from scheduling through checkout.
 */

const db = require('./database');

const STATES = {
  'scheduled':          { next: ['checked-in'], role: 'reception', timeField: null },
  'checked-in':         { next: ['roomed'], role: 'reception', timeField: 'check_in_time' },
  'roomed':             { next: ['vitals-recorded'], role: 'ma', timeField: 'roomed_time' },
  'vitals-recorded':    { next: ['provider-examining'], role: 'ma', timeField: 'vitals_time' },
  'provider-examining': { next: ['orders-pending', 'documentation'], role: 'provider', timeField: 'provider_start_time' },
  'orders-pending':     { next: ['documentation'], role: 'provider', timeField: null },
  'documentation':      { next: ['signed'], role: 'provider', timeField: null },
  'signed':             { next: ['checked-out'], role: 'reception', timeField: 'signed_time' },
  'checked-out':        { next: [], role: null, timeField: 'checkout_time' }
};

async function createWorkflow(encounterId, patientId, metadata = {}) {
  const existing = await db.getWorkflowState(encounterId);
  if (existing) {
    const updates = {};

    if (metadata.assigned_ma && metadata.assigned_ma !== existing.assigned_ma) {
      updates.assigned_ma = metadata.assigned_ma;
    }
    if (metadata.assigned_provider && metadata.assigned_provider !== existing.assigned_provider) {
      updates.assigned_provider = metadata.assigned_provider;
    }

    if (Object.keys(updates).length > 0) {
      await db.updateWorkflowState(encounterId, updates);
    }

    return {
      id: existing.id,
      state: existing.current_state,
      encounter_id: encounterId,
      existing: true
    };
  }

  try {
    const result = await db.createWorkflow({
      encounter_id: encounterId,
      patient_id: patientId,
      assigned_ma: metadata.assigned_ma || null,
      assigned_provider: metadata.assigned_provider || null
    });
    return { id: result.id, state: 'scheduled', encounter_id: encounterId, existing: false };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed: workflow_state.encounter_id')) {
      const race = await db.getWorkflowState(encounterId);
      return { id: race.id, state: race.current_state, encounter_id: encounterId, existing: true };
    }
    throw err;
  }
}

async function getCurrentState(encounterId) {
  const wf = await db.getWorkflowState(encounterId);
  if (!wf) throw new Error(`No workflow found for encounter ${encounterId}`);
  return wf;
}

function getValidTransitions(currentState) {
  const config = STATES[currentState];
  if (!config) return [];
  return config.next;
}

async function transitionState(encounterId, targetState, metadata = {}, userRole = null) {
  const wf = await getCurrentState(encounterId);
  const config = STATES[wf.current_state];

  if (!config || !config.next.includes(targetState)) {
    throw new Error(`Invalid transition: ${wf.current_state} -> ${targetState}. Valid: ${config ? config.next.join(', ') : 'none'}`);
  }

  // Enforce role requirement for the target state (physician can override any transition)
  const targetConfig = STATES[targetState];
  if (userRole && userRole !== 'physician' && targetConfig && targetConfig.role) {
    // Map role names: 'provider' in STATES matches physician/nurse_practitioner
    const requiredRole = targetConfig.role;
    const roleMatches =
      requiredRole === 'provider'
        ? ['physician', 'nurse_practitioner', 'provider'].includes(userRole)
        : requiredRole === 'reception'
          ? ['front_desk', 'reception', 'admin'].includes(userRole)
          : requiredRole === 'ma'
            ? ['ma', 'medical_assistant'].includes(userRole)
            : userRole === requiredRole;
    if (!roleMatches) {
      throw new Error(`Role '${userRole}' cannot transition to '${targetState}'. Required role: '${requiredRole}'.`);
    }
  }

  const updates = { current_state: targetState };

  // Set the timestamp for the state we're entering
  if (targetConfig && targetConfig.timeField) {
    updates[targetConfig.timeField] = new Date().toISOString();
  }

  // Merge any metadata
  if (metadata.assigned_ma) updates.assigned_ma = metadata.assigned_ma;
  if (metadata.assigned_provider) updates.assigned_provider = metadata.assigned_provider;

  await db.updateWorkflowState(encounterId, updates);

  return {
    encounter_id: encounterId,
    previous_state: wf.current_state,
    current_state: targetState,
    timestamp: new Date().toISOString(),
    valid_transitions: getValidTransitions(targetState)
  };
}

async function getWorkflowTimeline(encounterId) {
  const wf = await getCurrentState(encounterId);
  const timeline = [];
  const stateOrder = ['scheduled', 'checked-in', 'roomed', 'vitals-recorded',
    'provider-examining', 'orders-pending', 'documentation', 'signed', 'checked-out'];

  for (const state of stateOrder) {
    const config = STATES[state];
    const entry = {
      state,
      role: config.role,
      status: 'pending'
    };

    if (state === wf.current_state) {
      entry.status = 'current';
    } else if (stateOrder.indexOf(state) < stateOrder.indexOf(wf.current_state)) {
      entry.status = 'completed';
      if (config.timeField && wf[config.timeField]) {
        entry.timestamp = wf[config.timeField];
      }
    }

    timeline.push(entry);
  }

  return { encounter_id: encounterId, current_state: wf.current_state, timeline };
}

async function getQueue(state) {
  return db.getEncountersByState(state);
}

async function getAllWorkflows() {
  return db.getAllWorkflows();
}

module.exports = {
  STATES,
  createWorkflow,
  getCurrentState,
  getValidTransitions,
  transitionState,
  getWorkflowTimeline,
  getQueue,
  getAllWorkflows
};
