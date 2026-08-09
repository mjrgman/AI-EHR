'use strict';

const express = require('express');
const { throttle } = require('../security/endpoint-throttle');

// Clinician login and refresh are unauthenticated by definition and both
// perform credential work -- login runs bcrypt, refresh hits the token store.
// The per-user limiter in hipaa-middleware.js cannot cover either, because
// there is no identity yet. CodeQL flagged /login as js/missing-rate-limiting.
//
// The per-(username, origin) lockout in auth.js stops repeated guessing at ONE
// account; this stops an origin spraying many accounts, which the lockout by
// design does not see. Two controls, two different attacks.
// Limits are env-overridable so the test suite can raise them rather than
// bypass the middleware. A control that is switched off in the environment you
// test in is a control nobody has run -- the middleware stays in the chain,
// still counts, still sets X-RateLimit-* headers; only the ceiling moves.
// Enforcement behavior itself is covered by test/unit/endpoint-throttle.test.js.
const LOGIN_MAX = Number(process.env.LOGIN_THROTTLE_MAX) || 10;
const REFRESH_MAX = Number(process.env.REFRESH_THROTTLE_MAX) || 30;

const loginThrottle = throttle({ name: 'clinician-login', max: LOGIN_MAX, windowMs: 60 * 1000 });
const refreshThrottle = throttle({ name: 'clinician-refresh', max: REFRESH_MAX, windowMs: 60 * 1000 });

function buildAuthRouter({ auth, db, logger, refreshTokens }) {
  const router = express.Router();

  router.post('/login', loginThrottle, auth.login);
  router.get('/me', auth.requireAuth, auth.me);
  router.post('/logout', auth.requireAuth, auth.logout);

  router.post('/refresh', refreshThrottle, async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
      }

      const result = await refreshTokens.rotate(refreshToken);
      if (!result) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const tokenInfo = await refreshTokens.validate(result.refreshToken);
      if (!tokenInfo) {
        return res.status(401).json({ error: 'Token rotation failed' });
      }

      const userRow = await db.dbGet('SELECT * FROM users WHERE id = ? AND is_active = 1', [tokenInfo.userId]);
      if (!userRow) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      return res.json({
        token: auth.signToken(userRow),
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      logger.error('Refresh token error', { error: error.message });
      return res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  router.post('/logout-all', auth.requireAuth, async (req, res) => {
    try {
      if (!req.user || !req.user.sub) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await refreshTokens.revokeAllForUser(req.user.sub);
      return res.json({ message: 'All sessions revoked' });
    } catch (error) {
      logger.error('Logout-all error', { error: error.message });
      return res.status(500).json({ error: 'Failed to revoke sessions' });
    }
  });

  return router;
}

module.exports = { buildAuthRouter };
