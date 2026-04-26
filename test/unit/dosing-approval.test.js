'use strict';

// Unit tests for BaseAgent.requestDosingApproval — the load-bearing Tier 3
// safety primitive that gates HRT/peptide/functional-medicine dosing changes.
// The integration suite covers end-to-end behavior; these tests pin the
// validation surface and approval-id format in isolation.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { BaseAgent, AUTONOMY_TIER, ACTION_TYPE } = require('../../server/agents/base-agent');

// Minimal in-memory message bus stub for these tests — implements only what
// requestDosingApproval reaches for: sendRequest (returns a configurable
// payload) and sendMessage (no-op). The real bus has many more methods.
function makeStubBus({ approval = true, approverId = 'physician-test', notes = null, throwOnSend = false } = {}) {
  const sent = [];
  return {
    sent,
    sendRequest: async (from, to, type, payload) => {
      sent.push({ from, to, type, payload, kind: 'request' });
      if (throwOnSend) throw new Error('bus_error_simulated');
      return {
        payload: { approved: approval, approverId, notes },
      };
    },
    sendMessage: async (from, to, type, payload) => {
      sent.push({ from, to, type, payload, kind: 'message' });
    },
  };
}

function makeAgent({ tier = AUTONOMY_TIER.TIER_3, bus = makeStubBus() } = {}) {
  const agent = new BaseAgent('domain_logic_test', {
    description: 'test agent',
    autonomyTier: tier,
    messageBus: bus,
  });
  return { agent, bus };
}

const validDosingChange = {
  medication: 'Testosterone Cypionate',
  currentDose: '50mg/week',
  proposedDose: '100mg/week',
  rationale: 'Low total testosterone with hypogonadism symptoms',
  evidenceSource: 'Endocrine Society 2018 Guideline',
};

const synthContext = {
  patient: { id: 999999 },
  encounter: { id: 888888 },
};

describe('requestDosingApproval: input validation', () => {
  test('throws when dosingChange is missing entirely', async () => {
    const { agent } = makeAgent();
    await assert.rejects(
      () => agent.requestDosingApproval(undefined, synthContext),
      /missing required field "medication"/
    );
  });

  test('throws when medication is missing', async () => {
    const { agent } = makeAgent();
    const bad = { ...validDosingChange, medication: undefined };
    await assert.rejects(
      () => agent.requestDosingApproval(bad, synthContext),
      /missing required field "medication"/
    );
  });

  test('throws when proposedDose is missing', async () => {
    const { agent } = makeAgent();
    const bad = { ...validDosingChange, proposedDose: undefined };
    await assert.rejects(
      () => agent.requestDosingApproval(bad, synthContext),
      /missing required field "proposedDose"/
    );
  });

  test('throws when rationale is missing', async () => {
    const { agent } = makeAgent();
    const bad = { ...validDosingChange, rationale: undefined };
    await assert.rejects(
      () => agent.requestDosingApproval(bad, synthContext),
      /missing required field "rationale"/
    );
  });
});

describe('requestDosingApproval: approval flow', () => {
  test('approved request returns approved=true with audit-id-formatted approvalId', async () => {
    const { agent } = makeAgent({ bus: makeStubBus({ approval: true, approverId: 'physician-1' }) });
    const result = await agent.requestDosingApproval(validDosingChange, synthContext);
    assert.equal(result.approved, true);
    assert.match(result.approvalId, /^audit_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'approvalId must be `audit_<uuid>` format');
    assert.equal(result.response.approverId, 'physician-1');
  });

  test('two approval requests produce distinct approval IDs', async () => {
    const { agent } = makeAgent();
    const a = await agent.requestDosingApproval(validDosingChange, synthContext);
    const b = await agent.requestDosingApproval(validDosingChange, synthContext);
    assert.notEqual(a.approvalId, b.approvalId, 'each call produces a fresh audit entry id');
  });

  test('approval broadcasts DOSING_APPROVED to orders agent', async () => {
    const { agent, bus } = makeAgent({ bus: makeStubBus({ approval: true }) });
    await agent.requestDosingApproval(validDosingChange, synthContext);
    const dosingApproved = bus.sent.find((m) => m.type === 'DOSING_APPROVED');
    assert.ok(dosingApproved, 'DOSING_APPROVED message must be sent on approval');
    assert.equal(dosingApproved.to, 'orders');
  });
});

describe('requestDosingApproval: rejection flow', () => {
  test('rejected request returns approved=false and reports a Level-1 safety event', async () => {
    const { agent, bus } = makeAgent({ bus: makeStubBus({ approval: false, notes: null }) });
    const result = await agent.requestDosingApproval(validDosingChange, synthContext);
    assert.equal(result.approved, false);
    assert.equal(agent.safetyEvents.length, 1, 'rejection must enqueue a safety event');
    assert.equal(agent.safetyEvents[0].level, 1, 'rejected dosing changes are Level-1 safety events');
    const dosingRejected = bus.sent.find((m) => m.type === 'DOSING_REJECTED');
    assert.ok(dosingRejected, 'DOSING_REJECTED message must be broadcast');
    assert.equal(dosingRejected.to, 'medivault_redflag');
  });

  test('bus error is treated as rejection (fail-safe) and reports a Level-2 safety event', async () => {
    const { agent } = makeAgent({ bus: makeStubBus({ throwOnSend: true }) });
    const result = await agent.requestDosingApproval(validDosingChange, synthContext);
    assert.equal(result.approved, false, 'bus failure must fail safe to rejection');
    assert.equal(agent.safetyEvents.length, 1);
    assert.equal(agent.safetyEvents[0].level, 2, 'bus errors are Level-2 (operational), not Level-1 (clinical)');
  });
});

describe('requestDosingApproval: tier and audit', () => {
  test('audit trail is updated with an ESCALATION entry before the approval round-trip', async () => {
    const { agent } = makeAgent();
    await agent.requestDosingApproval(validDosingChange, synthContext);
    const escalation = agent.auditTrail.find((e) => e.actionType === ACTION_TYPE.ESCALATION);
    assert.ok(escalation, 'an ESCALATION audit entry must exist for every dosing approval request');
    assert.equal(escalation.details.dosingChange.medication, validDosingChange.medication);
  });

  test('Tier 1 caller still goes through Tier 3 gate (warns but does not bypass)', async () => {
    const originalWarn = console.warn;
    let warningSeen = false;
    console.warn = (msg) => { if (String(msg).includes('forcing physician approval')) warningSeen = true; };
    try {
      const { agent } = makeAgent({ tier: AUTONOMY_TIER.TIER_1 });
      const result = await agent.requestDosingApproval(validDosingChange, synthContext);
      assert.equal(result.approved, true, 'Tier 1 caller must still get a real result, not a bypass');
      assert.equal(warningSeen, true, 'Tier 1 caller must trigger a warning about forcing physician approval');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('throws when messageBus is missing entirely', async () => {
    const agent = new BaseAgent('no_bus_test', {
      autonomyTier: AUTONOMY_TIER.TIER_3,
      messageBus: null,
    });
    await assert.rejects(
      () => agent.requestDosingApproval(validDosingChange, synthContext),
      /messageBus not initialized/
    );
  });

  test('missing evidenceSource flags a Level-3 safety event but does not block', async () => {
    const { agent } = makeAgent();
    const noEvidence = { ...validDosingChange, evidenceSource: undefined };
    const result = await agent.requestDosingApproval(noEvidence, synthContext);
    assert.equal(result.approved, true, 'missing evidence does not block — only flags');
    const flagged = agent.safetyEvents.find((e) => e.level === 3);
    assert.ok(flagged, 'a Level-3 safety event must be reported when evidenceSource is missing');
  });
});
