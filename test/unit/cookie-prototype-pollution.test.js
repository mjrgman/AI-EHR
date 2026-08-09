/**
 * Cookie parsing must not be prototype-pollutable.
 *
 * CodeQL js/remote-property-injection: a cookie NAME is attacker-controlled and
 * was used directly as a property key on a `{}` accumulator.
 *
 * Two distinct problems, both closed here:
 *   1. `Cookie: __proto__=...` writes through to Object.prototype.
 *   2. A lookup for a cookie named `constructor` or `toString` returns an
 *      INHERITED function rather than undefined. That matters because the
 *      caller does `cookies[COOKIE_NAME] || req.headers['x-portal-session']` --
 *      an inherited function is truthy and would have been taken as a session
 *      token.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseCookies } = require('../../server/services/portal-session-service');

describe('parseCookies is not prototype-pollutable', () => {
  test('the result has a null prototype', () => {
    assert.equal(Object.getPrototypeOf(parseCookies('a=1')), null);
    assert.equal(Object.getPrototypeOf(parseCookies('')), null);
    assert.equal(Object.getPrototypeOf(parseCookies(undefined)), null);
  });

  test('a __proto__ cookie does not pollute Object.prototype', () => {
    parseCookies('__proto__=polluted; session=abc');
    assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
    // eslint-disable-next-line no-proto
    assert.notEqual(Object.prototype.toString, 'polluted');
  });

  test('inherited member names read as absent, not as functions', () => {
    const cookies = parseCookies('session=abc');
    for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      assert.equal(cookies[name], undefined,
        `${name} must not resolve to an inherited member — it would be truthy`);
    }
  });

  test('the truthiness path a caller relies on is safe', () => {
    // requirePortalSession does: cookies[COOKIE_NAME] || req.headers[...]
    const cookies = parseCookies('unrelated=1');
    assert.ok(!cookies.constructor, 'an inherited constructor would be truthy and taken as a token');
    assert.ok(!cookies.toString);
  });

  test('ordinary cookies still parse, including URL-encoded values', () => {
    const cookies = parseCookies('portal_session=abc123; other=hello%20world; empty=');
    assert.equal(cookies.portal_session, 'abc123');
    assert.equal(cookies.other, 'hello world');
    assert.equal(cookies.empty, '');
  });

  test('values containing = are preserved whole', () => {
    // Base64 padding is the common case that a naive split(=)[1] breaks.
    const cookies = parseCookies('t=YWJjZA==');
    assert.equal(cookies.t, 'YWJjZA==');
  });

  test('malformed input does not throw', () => {
    for (const header of ['; ;;', '=novalue', 'noequals', '   ', 'a=1;;b=2']) {
      assert.doesNotThrow(() => parseCookies(header), `threw on: ${header}`);
    }
    assert.equal(parseCookies('a=1;;b=2').b, '2');
  });
});
