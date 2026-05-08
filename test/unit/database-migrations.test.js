'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();

const migrations = require('../../server/database-migrations');

let db;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function seedLegacyBaseSchema() {
  await run(`CREATE TABLE provider_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name TEXT NOT NULL,
    condition_code TEXT NOT NULL,
    condition_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_detail TEXT NOT NULL,
    frequency_count INTEGER DEFAULT 1,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
    confidence REAL DEFAULT 0.3,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    dob DATE
  )`);
  await run(`CREATE TABLE problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    status TEXT
  )`);
  await run(`CREATE TABLE medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    status TEXT
  )`);
  await run(`CREATE TABLE encounters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    encounter_date DATE
  )`);
  await run(`CREATE TABLE prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    medication_name TEXT
  )`);
  await run(`CREATE TABLE lab_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    test_name TEXT
  )`);
  await run(`CREATE TABLE clinical_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL UNIQUE,
    rule_type TEXT NOT NULL,
    trigger_condition TEXT NOT NULL,
    suggested_actions TEXT NOT NULL,
    priority INTEGER DEFAULT 50,
    enabled BOOLEAN DEFAULT 1,
    evidence_source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE cds_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id INTEGER,
    patient_id INTEGER,
    suggestion_type TEXT,
    category TEXT,
    priority INTEGER,
    title TEXT,
    description TEXT,
    rationale TEXT,
    suggested_action TEXT,
    status TEXT,
    provider_response_time DATETIME,
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(
    `INSERT INTO provider_preferences
      (provider_name, condition_code, condition_name, action_type, action_detail)
     VALUES ('Dr. Legacy', 'E11.9', 'Type 2 Diabetes', 'lab_order', '{"test_name":"A1C"}')`
  );
}

describe('database migrations', () => {
  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await run('PRAGMA foreign_keys=ON');
    await seedLegacyBaseSchema();
  });

  afterEach(async () => {
    await new Promise((resolve, reject) => db.close(err => (err ? reject(err) : resolve())));
  });

  test('runMigrations is idempotent on a populated legacy database', async () => {
    await migrations.runMigrations(db);
    await migrations.runMigrations(db);

    const providerColumns = await all('PRAGMA table_info(provider_preferences)');
    assert.ok(providerColumns.some(column => column.name === 'tenant_id'), 'provider_preferences should gain tenant_id');

    const legacyRow = (await all('SELECT tenant_id FROM provider_preferences WHERE provider_name = ?', ['Dr. Legacy']))[0];
    assert.equal(legacyRow.tenant_id, 'default', 'existing provider preferences should backfill default tenant');

    const encounterColumns = await all('PRAGMA table_info(encounters)');
    assert.ok(encounterColumns.some(column => column.name === 'ai_degraded'), 'encounters should gain ai_degraded');

    const labOrderColumns = await all('PRAGMA table_info(lab_orders)');
    assert.ok(labOrderColumns.some(column => column.name === 'external_order_id'), 'lab_orders should gain external_order_id');

    const tables = new Set((await all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name));
    assert.ok(tables.has('labcorp_oauth_states'), 'LabCorp OAuth state table should exist');

    const indexes = new Set((await all("SELECT name FROM sqlite_master WHERE type='index'")).map(row => row.name));
    assert.ok(indexes.has('idx_provider_preferences_tenant_provider'), 'tenant/provider preference index should exist');
    assert.ok(indexes.has('idx_encounters_patient_date_desc'), 'encounter date index should exist');
  });
});
