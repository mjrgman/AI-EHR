'use strict';

// Unit test for the Dashboard queue-summary key set (finding
// naming-workflow-state-vocab-01 / backlog P1-5).
//
// The bug: src/pages/DashboardPage.jsx QUEUE_CONFIG used non-canonical keys
// (`waiting`, `with_provider`) that never match the workflow engine's
// hyphenated state vocabulary. The /dashboard endpoint builds `queue_counts`
// keyed by `wf.current_state` (canonical hyphenated states), so the "Waiting"
// and "With Provider" cards always rendered 0.
//
// The canonical source of truth for the workflow-state vocabulary is
// WorkflowTracker's STATE_CONFIG (src/components/workflow/WorkflowTracker.jsx),
// which itself mirrors server/workflow-engine.js STATES. This test enforces
// that every Dashboard QUEUE_CONFIG `key` is a member of that canonical key
// set — so the two can never drift apart again.
//
// Both files are JSX/ESM (React) and cannot be require()'d in a node:test
// CommonJS runner, so we parse the key sets out of source text. This is a
// deliberately source-level assertion: it fails loudly if either the dashboard
// keys or the canonical STATE_CONFIG keys change shape.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.resolve(__dirname, '../../src/pages/DashboardPage.jsx');
const trackerPath = path.resolve(__dirname, '../../src/components/workflow/WorkflowTracker.jsx');

// Extract the canonical workflow-state key set from WorkflowTracker's
// STATE_CONFIG object literal (the single source of truth).
function extractCanonicalStateKeys(source) {
  const start = source.indexOf('const STATE_CONFIG');
  assert.ok(start !== -1, 'WorkflowTracker must define const STATE_CONFIG');
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  assert.ok(open !== -1 && close !== -1, 'STATE_CONFIG object literal not found');
  const body = source.slice(open + 1, close);
  // Object keys are quoted string literals, e.g.  'provider-examining': { ... }
  const keys = [];
  const re = /['"]([a-z][a-z-]*)['"]\s*:\s*\{/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

// Extract the `key:` values from the Dashboard QUEUE_CONFIG array literal.
function extractDashboardQueueKeys(source) {
  const start = source.indexOf('const QUEUE_CONFIG');
  assert.ok(start !== -1, 'DashboardPage must define const QUEUE_CONFIG');
  const open = source.indexOf('[', start);
  const close = source.indexOf('];', open);
  assert.ok(open !== -1 && close !== -1, 'QUEUE_CONFIG array literal not found');
  const body = source.slice(open + 1, close);
  const keys = [];
  const re = /\bkey:\s*['"]([a-z][a-z-]*)['"]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

describe('Dashboard queue-config key set (P1-5 / naming-workflow-state-vocab-01)', () => {
  const dashboardSrc = fs.readFileSync(dashboardPath, 'utf8');
  const trackerSrc = fs.readFileSync(trackerPath, 'utf8');

  const canonicalKeys = extractCanonicalStateKeys(trackerSrc);
  const dashboardKeys = extractDashboardQueueKeys(dashboardSrc);

  test('canonical STATE_CONFIG key set is the expected workflow vocabulary', () => {
    // Guards against the source-of-truth itself silently changing shape.
    assert.deepEqual(canonicalKeys, [
      'scheduled',
      'checked-in',
      'roomed',
      'vitals-recorded',
      'provider-examining',
      'orders-pending',
      'documentation',
      'signed',
      'checked-out',
    ]);
  });

  test('dashboard exposes four queue cards', () => {
    assert.equal(dashboardKeys.length, 4);
  });

  test('every dashboard queue key is a canonical workflow state', () => {
    const canonical = new Set(canonicalKeys);
    for (const key of dashboardKeys) {
      assert.ok(
        canonical.has(key),
        `Dashboard QUEUE_CONFIG key "${key}" is not a canonical workflow state. ` +
          `Allowed: ${canonicalKeys.join(', ')}`
      );
    }
  });

  test('regression: the old divergent keys are gone', () => {
    // These keys never matched queue_counts and always rendered 0.
    assert.ok(!dashboardKeys.includes('waiting'), 'stale "waiting" key must not return');
    assert.ok(!dashboardKeys.includes('with_provider'), 'stale "with_provider" key must not return');
  });

  test('the triage-relevant states are represented', () => {
    // Waiting -> checked-in, With Provider -> provider-examining are the two
    // that were previously broken; assert their canonical keys are present.
    assert.ok(dashboardKeys.includes('checked-in'), 'Waiting card must key on "checked-in"');
    assert.ok(dashboardKeys.includes('provider-examining'), 'With Provider card must key on "provider-examining"');
  });
});
