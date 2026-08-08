'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = [
  '../../src/components/workflow/QueueDashboard.jsx',
  '../../src/pages/DecisionQueuePage.jsx',
  '../../src/pages/SchedulePage.jsx',
];

for (const relativePath of files) {
  test(`${path.basename(relativePath)} exposes load failure and retry`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
    assert.match(source, /loadError/);
    assert.match(source, /Retry/);
    assert.doesNotMatch(source, /\.catch\(\(\)\s*=>\s*(?:null|\{\})\)/);
  });
}

test('DecisionQueuePage refreshes every ten seconds', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/pages/DecisionQueuePage.jsx'),
    'utf8'
  );
  assert.match(source, /setInterval\(load,\s*10000\)/);
  assert.match(source, /clearInterval\(intervalId\)/);
});
