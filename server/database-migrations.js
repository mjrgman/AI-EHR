/**
 * Database Migrations for Agentic EHR
 *
 * Adds 5 new tables to support:
 * - RBAC (Role-Based Access Control)
 * - HIPAA consent tracking (CATC requirement)
 * - Agent governance audit trail
 * - Safety event logging (4-level system)
 * - Physician override learning
 * - Security event tracking (login attempts)
 *
 * Run after database initialization with existing 19 tables.
 * Idempotent - safe to run multiple times.
 *
 * Usage:
 *   const migrations = require('./database-migrations');
 *   await migrations.runMigrations(db);
 */

/**
 * Run all pending migrations
 * @param {sqlite3.Database} db - SQLite database instance
 * @returns {Promise}
 */
async function runMigrations(db) {
  console.log('[MIGRATIONS] Starting database migrations...');

  try {
    await createUsersTable(db);
    await createPatientConsentTable(db);
    await createAgentAuditTrailTable(db);
    await createSafetyEventsTable(db);
    await createPhysicianOverridesTable(db);
    await createLoginAttemptsTable(db);
    await createIndexes(db);

    console.log('[MIGRATIONS] All migrations completed successfully');
    return { success: true, message: 'All migrations completed' };
  } catch (err) {
    console.error('[MIGRATIONS] Migration failed:', err.message);
    throw err;
  }
}

// ==========================================
// TABLE CREATION FUNCTIONS
// ==========================================

/**
 * Create users table for RBAC (Role-Based Access Control)
 * Stores system users with roles and authentication metadata
 */
async function createUsersTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN (
        'physician',
        'nurse_practitioner',
        'physician_assistant',
        'ma',
        'front_desk',
        'billing',
        'admin'
      )),
      full_name TEXT NOT NULL,
      npi_number TEXT,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      is_active BOOLEAN DEFAULT 1,
      last_login DATETIME,
      failed_login_count INTEGER DEFAULT 0,
      locked_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK(
        (role IN ('physician', 'nurse_practitioner', 'physician_assistant') AND npi_number IS NOT NULL)
        OR role NOT IN ('physician', 'nurse_practitioner', 'physician_assistant')
      )
    )
  `);
}

/**
 * Create patient_consent table for HIPAA consent tracking
 * CATC (Clinical AI Tenets and Commitments) requirement:
 * Explicit consent before AI-assisted care
 */
async function createPatientConsentTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS patient_consent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      consent_type TEXT NOT NULL CHECK(consent_type IN (
        'ai_assisted_care',
        'data_sharing',
        'research',
        'telehealth',
        'recording',
        'ai_documentation'
      )),
      consented BOOLEAN NOT NULL,
      consent_date DATETIME NOT NULL,
      expiration_date DATETIME,
      witnessed_by TEXT,
      consent_method TEXT CHECK(consent_method IN (
        'verbal',
        'written',
        'electronic'
      )) NOT NULL,
      document_path TEXT,
      revoked_date DATETIME,
      revoked_reason TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      UNIQUE(patient_id, consent_type)
    )
  `);
}

/**
 * Create agent_audit_trail table
 * Persistent storage for agent governance audit events
 * Mirrors in-memory auditTrail from base-agent.js
 */
async function createAgentAuditTrailTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS agent_audit_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      autonomy_tier TEXT NOT NULL CHECK(autonomy_tier IN (
        'tier_0_observational',
        'tier_1_suggested',
        'tier_2_conditional',
        'tier_3_autonomous'
      )),
      action_type TEXT NOT NULL,
      details TEXT,
      patient_id INTEGER,
      encounter_id INTEGER,
      requires_approval BOOLEAN DEFAULT 0,
      approved BOOLEAN,
      approved_by TEXT,
      approved_at DATETIME,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create safety_events table
 * 4-level safety event system for agent governance
 *
 * Level 1: Low-severity issues (e.g., minor documentation gap)
 * Level 2: Moderate issues (e.g., potential interaction, needs review)
 * Level 3: High-severity (e.g., critical alert, override required)
 * Level 4: Critical (e.g., data integrity, immediate escalation)
 */
async function createSafetyEventsTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS safety_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      level INTEGER NOT NULL CHECK(level IN (1, 2, 3, 4)),
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      response_required BOOLEAN DEFAULT 0,
      patient_id INTEGER,
      encounter_id INTEGER,
      reported_by TEXT,
      resolved BOOLEAN DEFAULT 0,
      resolved_by TEXT,
      resolved_at DATETIME,
      resolution_notes TEXT,
      root_cause TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create physician_overrides table
 * Track every override of agent output for continuous learning
 * Enables feedback loop: agent output → physician override → learning
 */
async function createPhysicianOverridesTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS physician_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      encounter_id INTEGER,
      original_output TEXT NOT NULL,
      override_value TEXT NOT NULL,
      reason TEXT,
      overriding_provider TEXT NOT NULL,
      override_type TEXT NOT NULL CHECK(override_type IN (
        'documentation',
        'order',
        'coding',
        'assessment',
        'plan',
        'other'
      )),
      fed_to_learning BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create login_attempts table
 * Security tracking for authentication events
 * Enables detection of brute-force attacks and anomalies
 */
async function createLoginAttemptsTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      success BOOLEAN NOT NULL,
      failure_reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ==========================================
// INDEXES
// ==========================================

/**
 * Create indexes for query performance
 * Focus on:
 * - Foreign keys
 * - Frequently queried fields
 * - Audit trail lookups
 */
async function createIndexes(db) {
  const indexes = [
    // users table
    'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
    'CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)',

    // patient_consent table
    'CREATE INDEX IF NOT EXISTS idx_consent_patient_id ON patient_consent(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_consent_type ON patient_consent(consent_type)',
    'CREATE INDEX IF NOT EXISTS idx_consent_consented ON patient_consent(consented)',
    'CREATE INDEX IF NOT EXISTS idx_consent_expiration ON patient_consent(expiration_date)',

    // agent_audit_trail table
    'CREATE INDEX IF NOT EXISTS idx_audit_agent_name ON agent_audit_trail(agent_name)',
    'CREATE INDEX IF NOT EXISTS idx_audit_patient_id ON agent_audit_trail(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_encounter_id ON agent_audit_trail(encounter_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON agent_audit_trail(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_audit_approved ON agent_audit_trail(approved)',
    'CREATE INDEX IF NOT EXISTS idx_audit_autonomy_tier ON agent_audit_trail(autonomy_tier)',

    // safety_events table
    'CREATE INDEX IF NOT EXISTS idx_safety_agent_name ON safety_events(agent_name)',
    'CREATE INDEX IF NOT EXISTS idx_safety_level ON safety_events(level)',
    'CREATE INDEX IF NOT EXISTS idx_safety_patient_id ON safety_events(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_safety_encounter_id ON safety_events(encounter_id)',
    'CREATE INDEX IF NOT EXISTS idx_safety_resolved ON safety_events(resolved)',
    'CREATE INDEX IF NOT EXISTS idx_safety_timestamp ON safety_events(timestamp)',

    // physician_overrides table
    'CREATE INDEX IF NOT EXISTS idx_override_agent_name ON physician_overrides(agent_name)',
    'CREATE INDEX IF NOT EXISTS idx_override_patient_id ON physician_overrides(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_override_encounter_id ON physician_overrides(encounter_id)',
    'CREATE INDEX IF NOT EXISTS idx_override_provider ON physician_overrides(overriding_provider)',
    'CREATE INDEX IF NOT EXISTS idx_override_type ON physician_overrides(override_type)',
    'CREATE INDEX IF NOT EXISTS idx_override_fed_to_learning ON physician_overrides(fed_to_learning)',

    // login_attempts table
    'CREATE INDEX IF NOT EXISTS idx_login_username ON login_attempts(username)',
    'CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip_address)',
    'CREATE INDEX IF NOT EXISTS idx_login_timestamp ON login_attempts(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_login_success ON login_attempts(success)'
  ];

  for (const indexSql of indexes) {
    try {
      await dbRun(db, indexSql);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
    }
  }
}

// ==========================================
// DATABASE HELPER (PROMISIFIED)
// ==========================================

/**
 * Promisified db.run() for use with async/await
 */
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  runMigrations,
  createUsersTable,
  createPatientConsentTable,
  createAgentAuditTrailTable,
  createSafetyEventsTable,
  createPhysicianOverridesTable,
  createLoginAttemptsTable,
  createIndexes
};
