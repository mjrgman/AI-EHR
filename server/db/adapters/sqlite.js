/**
 * SQLite Adapter for Agentic EHR
 *
 * Wraps sqlite3 in the standard adapter interface.
 * Used for single-provider deployments and development.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger').child({ _module: 'sqlite' });

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../data/mjr-ehr.db');
const DATA_DIR = path.dirname(DB_PATH);

let db = null;

const adapter = {
  type: 'sqlite',

  async init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          logger.error('Failed to open SQLite database', { path: DB_PATH, error: err.message });
          return reject(err);
        }
        logger.info('Connected to SQLite', { path: DB_PATH });

        // Enable WAL mode and foreign keys
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA foreign_keys = ON');
        resolve();
      });
    });
  },

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  close() {
    if (db) {
      db.close();
      logger.info('SQLite connection closed');
    }
  },

  /** Expose raw sqlite3.Database for serialize() and other sqlite-specific operations */
  get raw() {
    return db;
  },
};

module.exports = adapter;
