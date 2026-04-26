#!/usr/bin/env node
// Dev-only bootstrap: injects safe development env vars then loads the main
// server. Keeps production start paths (`npm start`, Docker) untouched —
// they continue to rely on real env vars from the host/secret manager.
// Used by .claude/launch.json so the preview tooling gets NODE_ENV=development
// without requiring dotenv to be pulled into the runtime dependencies.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.AI_MODE = process.env.AI_MODE || 'mock';
process.env.LABCORP_MODE = process.env.LABCORP_MODE || 'mock';
// Default the scheduling backend to 'db' under preview so the new appointment
// endpoints actually persist. Scenario tests still default to 'mock' via their
// own runner, so this only affects npm run dev / preview tooling.
process.env.SCHEDULER_MODE = process.env.SCHEDULER_MODE || 'db';
// Deterministic dev-only secrets. Safe to bake in here because this file
// only runs under .claude/launch.json; production deploys never touch it.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'dev_only_jwt_secret_phase3a_verification_abcd1234efgh5678ijkl9012mnop3456';
process.env.PHI_ENCRYPTION_KEY =
  process.env.PHI_ENCRYPTION_KEY ||
  'dev00000000000000000000000000000000000000000000000000000000dead';

// require.main is dev-server.js (not server.js), so server.js's
// `if (require.main === module)` block won't fire. Start the server explicitly.
const server = require('../server/server.js');
server.startServer().catch((err) => {
  console.error('[dev-server] Failed to start:', err.message);
  process.exit(1);
});
