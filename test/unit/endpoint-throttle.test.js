/**
 * Endpoint throttling for unauthenticated credential surfaces.
 *
 * CodeQL (js/missing-rate-limiting) flagged the SMART endpoints: they perform
 * authorization but had no rate limit. The existing limiter keys on userId, so
 * it cannot apply to routes that run before a user identity exists.
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('fs');
const path = require('path');

const { throttle, _resetAll } = require('../../server/security/endpoint-throttle');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: data }));
    }).on('error', reject);
  });
}

beforeEach(() => _resetAll());

describe('throttle behavior', () => {
  test('allows up to the limit, then returns 429 with Retry-After', async () => {
    const app = express();
    app.get('/x', throttle({ name: 't1', max: 3, windowMs: 60000 }), (req, res) => res.json({ ok: true }));
    const { server, port } = await listen(app);

    try {
      for (let i = 1; i <= 3; i++) {
        const r = await get(port, '/x');
        assert.equal(r.status, 200, `request ${i} should pass`);
        assert.equal(r.headers['x-ratelimit-remaining'], String(3 - i));
      }
      const blocked = await get(port, '/x');
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers['retry-after'], 'a 429 must say when to retry');
      assert.equal(JSON.parse(blocked.raw).error, 'rate_limited');
    } finally { server.close(); }
  });

  test('separate names do not share a counter', async () => {
    // Otherwise exhausting introspection would lock out token issuance.
    const app = express();
    app.get('/a', throttle({ name: 'bucket-a', max: 1, windowMs: 60000 }), (req, res) => res.json({ ok: 'a' }));
    app.get('/b', throttle({ name: 'bucket-b', max: 1, windowMs: 60000 }), (req, res) => res.json({ ok: 'b' }));
    const { server, port } = await listen(app);

    try {
      assert.equal((await get(port, '/a')).status, 200);
      assert.equal((await get(port, '/a')).status, 429, 'bucket a is spent');
      assert.equal((await get(port, '/b')).status, 200, 'bucket b must be untouched');
    } finally { server.close(); }
  });

  test('separate client IPs do not share a counter', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.get('/x', throttle({ name: 'per-ip', max: 1, windowMs: 60000 }), (req, res) => res.json({ ok: true }));
    const { server, port } = await listen(app);

    try {
      assert.equal((await get(port, '/x', { 'x-forwarded-for': '203.0.113.1' })).status, 200);
      assert.equal((await get(port, '/x', { 'x-forwarded-for': '203.0.113.1' })).status, 429);
      assert.equal((await get(port, '/x', { 'x-forwarded-for': '203.0.113.2' })).status, 200,
        'a different client must not inherit another client\'s exhausted bucket');
    } finally { server.close(); }
  });

  test('the window expires and the counter resets', async () => {
    const app = express();
    app.get('/x', throttle({ name: 'short-window', max: 1, windowMs: 40 }), (req, res) => res.json({ ok: true }));
    const { server, port } = await listen(app);

    try {
      assert.equal((await get(port, '/x')).status, 200);
      assert.equal((await get(port, '/x')).status, 429);
      await new Promise((r) => setTimeout(r, 60));
      assert.equal((await get(port, '/x')).status, 200, 'the bucket must refill after the window');
    } finally { server.close(); }
  });

  test('a name is required so two endpoints cannot silently share a bucket', () => {
    assert.throws(() => throttle({ max: 5 }), /name/);
  });
});

describe('the SMART endpoints are throttled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'server.js'), 'utf8');

  const ROUTES = [
    "app.post('/smart/token'",
    "app.get('/smart/introspect'",
    "app.post('/smart/introspect'",
    "app.get('/smart/authorize'",
    "app.post('/smart/revoke'",
    "app.post('/smart/register'",
  ];

  for (const route of ROUTES) {
    test(`${route.replace(/app\.\w+\('/, '').replace("'", '')} has a throttle in its chain`, () => {
      const line = src.split('\n').find((l) => l.includes(route));
      assert.ok(line, `route not found: ${route}`);
      assert.ok(/Throttle\b/.test(line), `no throttle on: ${line.trim()}`);
    });
  }

  test('client registration is throttled harder than token issuance', () => {
    // Registration mints credentials; it should not be spammable at the same
    // rate as ordinary token traffic.
    const reg = src.match(/smartRegisterThrottle = throttle\(\{[^}]*max:\s*(\d+)[^}]*windowMs:\s*([^,}]+)/);
    const tok = src.match(/smartTokenThrottle = throttle\(\{[^}]*max:\s*(\d+)/);
    assert.ok(reg && tok);
    assert.ok(Number(reg[1]) < Number(tok[1]),
      'registration must allow fewer requests than token issuance');
  });
});
