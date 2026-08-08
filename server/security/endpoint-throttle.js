'use strict';

/**
 * Endpoint-specific throttling for unauthenticated, credential-handling routes.
 *
 * The existing limiter in hipaa-middleware.js keys on `userId`, so it cannot
 * cover the surfaces that most need covering: the SMART token, introspection,
 * revocation, authorize and registration endpoints all run BEFORE a user
 * identity exists. CodeQL flags them as js/missing-rate-limiting, and it is
 * right -- an unauthenticated endpoint that checks a secret is a guessing
 * surface, and one that does bcrypt work is also a cheap way to burn CPU.
 *
 * Keyed on client IP, because that is the only signal available pre-auth.
 *
 * Deliberate limitation, stated rather than hidden: IP keying is weak. It
 * over-counts users behind a shared NAT and under-counts a distributed
 * attacker. It is the right control for a local demo and is NOT a substitute
 * for the account-and-network composite keying a production deployment needs.
 * The counter is per-process and in-memory, so it also resets on restart and
 * does not span instances.
 */

const buckets = new Map(); // key -> { count, resetAt }

// Bound the map. Without this a spray of unique IPs is itself a memory leak,
// which would make the mitigation into the vulnerability.
const MAX_TRACKED_KEYS = 10000;

function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/**
 * @param {object}  opts
 * @param {string}  opts.name        bucket namespace, so two endpoints do not share a counter
 * @param {number}  opts.max         requests allowed per window
 * @param {number}  opts.windowMs    window length
 * @returns {import('express').RequestHandler}
 */
function throttle({ name, max = 30, windowMs = 60 * 1000 } = {}) {
  if (!name) throw new Error('throttle requires a name so buckets do not collide');

  return function throttleMiddleware(req, res, next) {
    const now = Date.now();
    const key = `${name}:${clientIp(req)}`;

    if (buckets.size > MAX_TRACKED_KEYS) sweep(now);

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        error_description: `Too many requests. Retry in ${retryAfter}s.`,
      });
    }

    return next();
  };
}

/** Test seam: drop all counters. */
function _resetAll() {
  buckets.clear();
}

module.exports = { throttle, _resetAll, _buckets: buckets };
