/**
 * Educational-only quarantine for non-FDA-approved compounds.
 *
 * peptide-rules.js states as a safety contract that compounded / non-FDA
 * peptides must carry `educational_only: true`. Before this test the flag was
 * decoration: it propagated to the client but nothing stopped such a rule from
 * emitting a patient-specific dose alongside it.
 *
 * These tests assert the contract is now enforced in the engine, not merely
 * documented in a comment.
 */

const test = require('node:test');
const assert = require('node:assert');

const { PEPTIDE_RULES } = require('../../server/domain/rules/peptide-rules');
const engine = require('../../server/domain/functional-med-engine');

const DOSING_TYPES = ['dose_adjustment', 'prescribe', 'start_medication', 'titrate'];

test('every educational_only rule in the shipped rule set emits no dosing action', () => {
  const educational = PEPTIDE_RULES.filter((r) => r.educational_only === true);
  assert.ok(educational.length > 0, 'precondition: some peptide rules are educational_only');

  for (const rule of educational) {
    const actions = (rule.suggested_actions && rule.suggested_actions.actions) || [];
    const dosing = actions.filter((a) => DOSING_TYPES.includes(a.type));
    assert.deepEqual(
      dosing, [],
      `rule '${rule.id}' is educational_only but declares dosing action(s): ${dosing.map((d) => d.type).join(', ')}`
    );
  }
});

test('BPC-157 is present, educational only, and recommends no dose', () => {
  const bpc = PEPTIDE_RULES.find((r) => r.id === 'pep-bpc157-note');
  assert.ok(bpc, 'the BPC-157 rule must exist so patient use is documented for safety');
  assert.equal(bpc.educational_only, true, 'BPC-157 must be quarantined as educational only');
  assert.equal(bpc.suggested_actions.actions?.some((a) => DOSING_TYPES.includes(a.type)) ?? false, false);

  const text = JSON.stringify(bpc).toLowerCase();
  assert.ok(text.includes('not') && text.includes('fda'), 'must state it is not FDA approved');
});

test('the engine WITHHOLDS a dosing action from an educational_only rule', () => {
  // The real defense: even if a future rule author adds a dose to an
  // educational-only rule, the engine must not pass it through.
  const rogue = {
    id: 'test-rogue-educational-dose',
    rule_name: 'Rogue compounded peptide with a dose',
    rule_type: 'peptide_initiation',
    category: 'research_peptide',
    educational_only: true,
    evidence_source: 'none - synthetic test fixture',
    suggested_actions: {
      title: 'Rogue',
      description: 'Should not carry a dose',
      actions: [
        { type: 'dose_adjustment', payload: { proposedDose: '500 mcg SQ daily' }, requiresDosingApproval: true },
        { type: 'document', payload: { note: 'patient reports use' } }
      ]
    }
  };

  const suggestion = engine._test_ruleToSuggestion
    ? engine._test_ruleToSuggestion(rogue)
    : null;
  assert.ok(suggestion, 'engine must expose ruleToSuggestion for this assertion');

  const emittedTypes = suggestion.suggested_action.map((a) => a.type);
  assert.ok(!emittedTypes.includes('dose_adjustment'), 'the dose must be withheld');
  assert.deepEqual(emittedTypes, ['document'], 'non-dosing actions must survive');
  assert.equal(suggestion.withheld_dosing_actions, 1, 'the withholding must be reported, not silent');
  assert.equal(suggestion.educational_only, true);
  // With the dose stripped, nothing is left that needs dosing approval.
  assert.equal(suggestion.requiresDosingApproval, false);
});

test('a non-educational rule keeps its dosing action untouched', () => {
  // FDA-approved GLP-1 titration must still work. The quarantine targets
  // compounds with no approved indication, not standard-of-care prescribing.
  const approved = {
    id: 'test-approved-dose',
    rule_name: 'Approved drug titration',
    rule_type: 'peptide_initiation',
    category: 'glp1_t2dm',
    evidence_source: 'package insert',
    suggested_actions: {
      title: 'Titrate',
      actions: [
        { type: 'dose_adjustment', payload: { proposedDose: '0.5 mg SQ weekly' }, requiresDosingApproval: true }
      ]
    }
  };

  const suggestion = engine._test_ruleToSuggestion(approved);
  assert.equal(suggestion.suggested_action.length, 1);
  assert.equal(suggestion.suggested_action[0].type, 'dose_adjustment');
  assert.equal(suggestion.withheld_dosing_actions, 0);
  assert.equal(suggestion.requiresDosingApproval, true, 'Tier 3 approval gate must still apply');
});
