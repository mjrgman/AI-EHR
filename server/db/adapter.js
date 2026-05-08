/**
 * Database Adapter Interface for Agentic EHR
 *
 * Provides the database interface used by future adapters without
 * claiming unfinished backends are safe to run.
 *
 * Current supported runtime backend: SQLite.
 * Planned, not implemented: PostgreSQL.
 *
 * Usage:
 *   const db = require('./db/adapter');
 *   await db.init();
 *   const rows = await db.all('SELECT * FROM patients WHERE id = ?', [1]);
 */

const logger = require('../utils/logger').child({ _module: 'db' });

// ==========================================
// DETECT ADAPTER
// ==========================================

function getAdapter() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgresql://')) {
    throw new Error(
      'PostgreSQL adapter is intentionally disabled: no production-ready adapter or migration parity exists yet. ' +
      'Unset DATABASE_URL and set DATABASE_PATH to use the supported SQLite backend.'
    );
  }
  return require('./adapters/sqlite');
}

// ==========================================
// ADAPTER INTERFACE
// ==========================================

/**
 * All adapters must implement these methods:
 *
 *   init()          → Promise<void>    — connect and set up
 *   run(sql, params) → Promise<{ lastID, changes }>
 *   get(sql, params) → Promise<row | undefined>
 *   all(sql, params) → Promise<row[]>
 *   close()         → void
 *   isHealthy()     → Promise<boolean>
 *
 * Parameterized queries use ? placeholders (SQLite style).
 * A future PostgreSQL adapter must translate ? placeholders, pass
 * migration parity tests, and update docs before DATABASE_URL is accepted.
 */

let adapter = null;

const db = {
  async init() {
    adapter = getAdapter();
    await adapter.init();
    logger.info('Database adapter initialized', { type: adapter.type });
  },

  async run(sql, params = []) {
    return adapter.run(sql, params);
  },

  async get(sql, params = []) {
    return adapter.get(sql, params);
  },

  async all(sql, params = []) {
    return adapter.all(sql, params);
  },

  close() {
    if (adapter) adapter.close();
  },

  async isHealthy() {
    try {
      const row = await adapter.get('SELECT 1 as ok');
      return row && row.ok === 1;
    } catch {
      return false;
    }
  },

  /** Expose the raw adapter for edge cases */
  get raw() {
    return adapter;
  },

  /** Adapter type: 'sqlite' | 'postgres' */
  get type() {
    return adapter ? adapter.type : 'none';
  },
};

module.exports = db;
