'use strict';

const express = require('express');

function buildAuthRouter({ auth, db, logger, refreshTokens }) {
  const router = express.Router();

  router.post('/login', auth.login);
  router.get('/me', auth.requireAuth, auth.me);
  router.post('/logout', auth.requireAuth, auth.logout);

  router.post('/refresh', async (req, res) => {
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
