#!/usr/bin/env node
// Dev-only bootstrap: injects safe development env vars then loads the main
// server. Keeps production start paths (`npm start`, Docker) untouched —
// they continue to rely on real env vars from the host/secret manager.
// Used by .claude/launch.json so the preview tooling gets NODE_ENV=development
// without requiring dotenv to be pulled into the runtime dependencies.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.AI_MODE = process.env.AI_MODE || 'mock';
process.env.LABCORP_MODE = process.env.LABCORP_MODE || 'mock';
// Deterministic dev-only secrets. Safe to bake in here because this file
// only runs under .claude/launch.json; production deploys never touch it.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'dev_only_jwt_secret_phase3a_verification_abcd1234efgh5678ijkl9012mnop3456';
process.env.PHI_ENCRYPTION_KEY =
  process.env.PHI_ENCRYPTION_KEY ||
  'dev00000000000000000000000000000000000000000000000000000000dead';

require('../server/server.js');
