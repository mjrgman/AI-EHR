/**
 * Synthetic-only baseline regression tests.
 *
 * These assert the two boundaries that must hold for this repository to remain
 * a local synthetic-data demo: no external-AI runtime, and no live laboratory
 * integration. They are behavioral, not string-matching -- each one either
 * executes the guard or inspects the resolved dependency graph.
 *
 * If any of these fail, a code path to a third-party endpoint has been
 * reintroduced. See docs/SYNTHETIC_ONLY_BASELINE.md.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const AI_CLIENT = path.join(ROOT, 'server', 'ai-client.js');
const LABCORP_CLIENT = path.join(ROOT, 'server', 'integrations', 'labcorp', 'client.js');

/**
 * Load a module in a *fresh* child process with a given env. Required because
 * both guards run at require() time, and this test file has already loaded the
 * modules once -- the module cache would mask a re-evaluation.
 * Returns { ok, stderr }.
 */
function requireInChild(modulePath, env) {
  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)})`], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    return { ok: true, stderr: '' };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr || err.message) };
  }
}

// ==========================================
// EXTERNAL AI
// ==========================================

test('ai-client: AI_MODE=api is refused at load time', () => {
  const r = requireInChild(AI_CLIENT, { AI_MODE: 'api' });
  assert.equal(r.ok, false, 'requiring ai-client with AI_MODE=api must throw');
  assert.match(r.stderr, /AI_MODE='api' is not supported/);
});

test('ai-client: an arbitrary non-mock AI_MODE is also refused', () => {
  const r = requireInChild(AI_CLIENT, { AI_MODE: 'anthropic' });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /is not supported/);
});

test('ai-client: AI_MODE=mock and unset AI_MODE both load', () => {
  assert.equal(requireInChild(AI_CLIENT, { AI_MODE: 'mock' }).ok, true);
  assert.equal(requireInChild(AI_CLIENT, { AI_MODE: '' }).ok, true);
});

test('ai-client: an API key present does NOT enable an api path', () => {
  // The pre-hardening code read ANTHROPIC_API_KEY and switched mode on it.
  // A key in the environment must now be inert.
  const r = requireInChild(AI_CLIENT, { AI_MODE: 'mock', ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key' });
  assert.equal(r.ok, true, 'a stray API key must not break loading');

  const out = execFileSync(
    process.execPath,
    ['-e', `const c=require(${JSON.stringify(AI_CLIENT)});process.stdout.write(c.getMode()+','+c.isClaudeEnabled())`],
    { env: { ...process.env, AI_MODE: 'mock', ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key' }, encoding: 'utf8' }
  );
  assert.equal(out, 'mock,false', 'mode must stay mock and Claude must stay disabled');
});

test('ai-client: no external-AI symbols remain in the module source', () => {
  const src = fs.readFileSync(AI_CLIENT, 'utf8');
  // Strip block comments so the explanatory header does not trip the check.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const symbol of ['@anthropic-ai/sdk', 'new Anthropic', 'callClaude', '_claudeExtractClinicalData', '_claudeGenerateSOAPNote']) {
    assert.ok(!code.includes(symbol), `external-AI symbol reintroduced: ${symbol}`);
  }
});

test('ai-client: mock extraction and SOAP generation still work', async () => {
  const client = require(AI_CLIENT);
  const transcript = 'Blood pressure 142 over 88, heart rate 76, temperature 98.6.';
  const vitals = client.extractVitals(transcript);
  assert.equal(vitals.systolic_bp, 142);
  assert.equal(vitals.diastolic_bp, 88);
  assert.equal(vitals.heart_rate, 76);

  const note = await client.generateSOAPNote(
    transcript,
    { first_name: 'Test', last_name: 'Patient', dob: '1980-01-01', sex: 'F' },
    vitals
  );
  assert.ok(typeof note === 'string' && note.length > 0, 'SOAP note must still be generated');
});

// ==========================================
// EXTERNAL LABORATORY
// ==========================================

test('labcorp: LABCORP_MODE=api is refused at load time', () => {
  const r = requireInChild(LABCORP_CLIENT, { LABCORP_MODE: 'api' });
  assert.equal(r.ok, false, 'requiring the labcorp client with LABCORP_MODE=api must throw');
  assert.match(r.stderr, /LABCORP_MODE='api' is not supported/);
});

test('labcorp: LABCORP_MODE=mock and unset both load', () => {
  assert.equal(requireInChild(LABCORP_CLIENT, { LABCORP_MODE: 'mock' }).ok, true);
  assert.equal(requireInChild(LABCORP_CLIENT, { LABCORP_MODE: '' }).ok, true);
});

test('labcorp: constructing a client in api mode is refused independently of env', () => {
  // Defense in depth: server/routes/labcorp-routes.js builds a client from a
  // caller-supplied mode, so the env guard alone is not sufficient.
  const { LabCorpClient } = require(LABCORP_CLIENT);
  assert.throws(() => new LabCorpClient({ mode: 'api' }), /is not supported/);
  assert.doesNotThrow(() => new LabCorpClient({ mode: 'mock' }));
});

test('labcorp: credentials in the environment do not enable api mode', () => {
  const r = requireInChild(LABCORP_CLIENT, {
    LABCORP_MODE: 'mock',
    LABCORP_CLIENT_ID: 'test-id-not-real',
    LABCORP_CLIENT_SECRET: 'test-secret-not-real'
  });
  assert.equal(r.ok, true, 'stray credentials must not break loading');

  const { getStatus } = require(LABCORP_CLIENT);
  assert.equal(getStatus().mode, 'mock');
});

// ==========================================
// DEPENDENCY GRAPH
// ==========================================

test('package.json declares no external-AI or cloud-inference SDK', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const forbidden = [
    '@anthropic-ai/sdk',
    'openai',
    '@google-cloud/aiplatform',
    '@google/generative-ai',
    '@aws-sdk/client-bedrock-runtime',
    '@aws-sdk/client-bedrock',
    '@azure/openai',
    'cohere-ai',
    '@mistralai/mistralai'
  ];
  for (const name of forbidden) {
    assert.ok(!declared.includes(name), `forbidden inference SDK declared: ${name}`);
  }
});

test('no server source requires an external inference SDK', () => {
  const offenders = [];
  const forbidden = /require\(\s*['"](@anthropic-ai\/sdk|openai|@google\/generative-ai|@google-cloud\/aiplatform|@aws-sdk\/client-bedrock[^'"]*|@azure\/openai|cohere-ai|@mistralai\/mistralai)['"]\s*\)/;

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.js')) {
        const m = fs.readFileSync(full, 'utf8').match(forbidden);
        if (m) offenders.push(`${path.relative(ROOT, full)} -> ${m[1]}`);
      }
    }
  })(path.join(ROOT, 'server'));

  assert.deepEqual(offenders, [], `external inference SDK required in: ${offenders.join(', ')}`);
});
