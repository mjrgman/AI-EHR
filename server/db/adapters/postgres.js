/**
 * PostgreSQL Adapter for Agentic EHR (NOT IMPLEMENTED)
 *
 * This file is a placeholder only. The active runtime is SQLite until a
 * real PostgreSQL adapter and migration parity test suite are implemented.
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

const POSTGRES_UNIMPLEMENTED_MESSAGE =
  'PostgreSQL adapter is not implemented. Use the SQLite backend via DATABASE_PATH until adapter and migration parity are complete.';

const adapter = {
  type: 'postgres',

  async init() {
    // TODO: Implement
    // const { Pool } = require('pg');
    // pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    // await pool.query('SELECT 1');
    throw new Error(POSTGRES_UNIMPLEMENTED_MESSAGE);
  },

  async run(sql, _params = []) {
    // TODO: translate ? → $1, $2, ...
    throw new Error(POSTGRES_UNIMPLEMENTED_MESSAGE);
  },

  async get(sql, _params = []) {
    throw new Error(POSTGRES_UNIMPLEMENTED_MESSAGE);
  },

  async all(sql, _params = []) {
    throw new Error(POSTGRES_UNIMPLEMENTED_MESSAGE);
  },

  close() {
    // TODO: pool.end()
  },
};

module.exports = adapter;
