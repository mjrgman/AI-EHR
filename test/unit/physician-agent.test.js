'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { PhysicianAgent } = require('../../server/agents/physician-agent');
const { MAAgent } = require('../../server/agents/ma-agent');

describe('Physician escalation policy', () => {
  test('template-matched escalation defaults to physician review when auto responses are disabled', async () => {
    const physicianAgent = new PhysicianAgent();
    const result = await physicianAgent.handleEscalation({}, {
      escalation: {
        escalation_id: 'ESC-111',
        type: 'refill_request_protocol_condition_failed',
        patient_name: 'Jane Patient',
        patient_context: { active_problems: ['HTN'] }
      }
    });

    assert.equal(result.status, 'escalation_received');
    assert.equal(result.decision, 'requires_physician_review');
    assert.equal(result.auto_approved, false);
    assert.equal(result.action_required, 'PHYSICIAN REVIEW PENDING');
    assert.equal(result.escalation_type, 'refill_request_protocol_condition_failed');
  });

  test('unknown escalation type returns physician review', async () => {
    const physicianAgent = new PhysicianAgent();
    const result = await physicianAgent.handleEscalation({}, {
      escalation: {
        escalation_id: 'ESC-112',
        type: 'nonexistent_escalation_type',
        patient_name: 'Sam Patient',
        patient_context: { active_problems: ['Dementia'] }
      }
    });

    assert.equal(result.status, 'escalation_received');
    assert.equal(result.decision, 'requires_physician_review');
    assert.equal(result.auto_approved, false);
  });
});

describe('MAAgent escalation response handling', () => {
  test('processEscalationResponse executes valid physician directives', async () => {
    const maAgent = new MAAgent();
    const result = await maAgent.processEscalationResponse({}, {
      directive: {
        directive_id: 'DIR-1',
        instructions: 'Approve refill for 30 days.'
      }
    });

    assert.equal(result.status, 'directive_received_and_executed');
    assert.equal(result.directive_id, 'DIR-1');
    assert.equal(result.from_physician_agent, true);
    assert.equal(result.instructions, 'Approve refill for 30 days.');
    assert.deepEqual(result.actions_taken, [
      'Instruction logged: Approve refill for 30 days.',
      'Orders queued for transmission'
    ]);
  });
});
