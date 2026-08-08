'use strict';

// Unit tests for sec-xml-recursive-walk-10 in
// server/integrations/labcorp/parser.js.
//
// Covers the DoS hardening on the LabCorp XML ingestion path:
//   - oversized buffers are rejected before decode/parse (fail-soft)
//   - the recursive findAll() walk is bounded on depth and total nodes so a
//     hostile deeply-nested / very-wide parsed tree cannot exhaust the stack
//     or pin CPU
//   - the walk still finds matches within the limits (no functional regression)
//
// Test data is synthetic — no real PHI or LabCorp payloads appear in fixtures.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../../server/integrations/labcorp/parser');
const { findAll, MAX_XML_BYTES, MAX_WALK_DEPTH, MAX_WALK_NODES } = parser._internal;

describe('labcorp parser: limit constants are sane (sec-xml-recursive-walk-10)', () => {
  test('MAX_XML_BYTES is a positive, MB-scale cap', () => {
    assert.equal(typeof MAX_XML_BYTES, 'number');
    assert.ok(MAX_XML_BYTES > 0);
    assert.ok(MAX_XML_BYTES <= 50 * 1024 * 1024, 'cap should be tens-of-MB at most');
  });

  test('MAX_WALK_DEPTH and MAX_WALK_NODES are positive integers', () => {
    assert.ok(Number.isInteger(MAX_WALK_DEPTH) && MAX_WALK_DEPTH > 0);
    assert.ok(Number.isInteger(MAX_WALK_NODES) && MAX_WALK_NODES > 0);
  });
});

describe('labcorp parser: oversized XML is rejected before parse (sec-xml-recursive-walk-10)', () => {
  test('a buffer larger than MAX_XML_BYTES fails soft (ok:false, never throws)', () => {
    // Build a buffer just over the cap. Content is irrelevant — it must be
    // rejected before the XML parser ever sees it.
    const big = Buffer.alloc(MAX_XML_BYTES + 1, 0x20); // spaces
    let out;
    assert.doesNotThrow(() => { out = parser.parseXmlResult(big); });
    assert.equal(out.ok, false);
    assert.ok(
      out.warnings.some((w) => w.startsWith('xml_too_large:')),
      `expected an xml_too_large warning, got: ${JSON.stringify(out.warnings)}`
    );
    // Should not have attempted to extract any results.
    assert.equal(out.results.length, 0);
  });

  test('a normally-sized XML buffer is NOT rejected on size grounds', () => {
    const xml = Buffer.from('<LabCorpResult><results></results></LabCorpResult>', 'utf8');
    const out = parser.parseXmlResult(xml);
    assert.ok(
      !out.warnings.some((w) => w.startsWith('xml_too_large:')),
      'small buffer must not trip the size cap'
    );
  });
});

describe('findAll: depth is bounded (sec-xml-recursive-walk-10)', () => {
  test('a pathologically deep tree does not blow the stack and fails soft', () => {
    // Build a linked chain far deeper than MAX_WALK_DEPTH. Without the bound
    // this recursion would risk a RangeError (stack overflow) on big inputs;
    // with the bound it simply stops descending.
    let node = { OBX: 'leaf' };
    for (let i = 0; i < MAX_WALK_DEPTH + 5000; i++) {
      node = { child: node };
    }
    let found;
    assert.doesNotThrow(() => { found = findAll(node, 'OBX'); });
    // The OBX leaf is buried below the depth cap, so the bounded walk must
    // NOT have reached it. Critically, it returns without throwing.
    assert.ok(Array.isArray(found));
    assert.equal(found.length, 0, 'leaf beyond MAX_WALK_DEPTH must be unreachable');
  });

  test('a match within the depth limit is still found', () => {
    let node = { OBX: 'leaf' };
    for (let i = 0; i < 5; i++) {
      node = { child: node };
    }
    const found = findAll(node, 'OBX');
    assert.deepEqual(found, ['leaf']);
  });
});

describe('findAll: node budget is bounded (sec-xml-recursive-walk-10)', () => {
  test('an extremely wide tree is capped at MAX_WALK_NODES visited', () => {
    // A single array with far more entries than the node budget. Each entry is
    // a tiny object so memory stays reasonable for the test while still
    // exceeding MAX_WALK_NODES in count.
    const wide = [];
    const count = MAX_WALK_NODES + 100;
    for (let i = 0; i < count; i++) {
      wide.push({ OBX: i });
    }
    let found;
    assert.doesNotThrow(() => { found = findAll(wide, 'OBX'); });
    // The walk must have stopped at the budget — it cannot have collected all
    // entries. (We assert it collected fewer than the total to prove the cap
    // fired; the exact number depends on traversal order.)
    assert.ok(found.length < count, 'node budget must cap a runaway wide walk');
  });

  test('a small wide tree returns all matches', () => {
    const small = [{ OBX: 1 }, { OBX: 2 }, { OBX: 3 }];
    const found = findAll(small, 'OBX');
    assert.deepEqual(found.sort(), [1, 2, 3]);
  });
});
