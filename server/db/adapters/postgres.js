/**
 * PostgreSQL Adapter for Agentic EHR (STUB)
 *
 * This is a placeholder for the PostgreSQL migration.
 * Implement this adapter when scaling beyond SQLite.
 *
 * Required: npm install pg
 *
 * Key differences from SQLite:
 *   - Use $1, $2 instead of ? for parameterized queries
 *   - Connection pooling (pg.Pool) instead of single connection
 *   - SERIAL instead of AUTOINCREMENT
 *   - No PRAGMA statements
 *   - BOOLEAN is native (not 0/1)
 *   - datetime → TIMESTAMPTZ
 */

const logger = require('../../utils/logger').child({ _module: 'postgres' });

const adapter = {
  type: 'postgres',

  async init() {
    // TODO: Implement
    // const { Pool } = require('pg');
    // pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    // await pool.query('SELECT 1');
    throw new Error('PostgreSQL adapter not yet implemented. Contributions welcome.');
  },

  async run(sql, params = []) {
    // TODO: translate ? → $1, $2, ...
    throw new Error('Not implemented');
  },

  async get(sql, params = []) {
    throw new Error('Not implemented');
  },

  async all(sql, params = []) {
    throw new Error('Not implemented');
  },

  close() {
    // TODO: pool.end()
  },
};

module.exports = adapter;
