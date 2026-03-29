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
    await migrateCdsRules(db);
    await migrateSuggestionTypes(db);
    await createAppointmentsTable(db);
    await createChargesTable(db);

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
// CDS RULE MIGRATIONS
// ==========================================

/**
 * Migrate clinical_rules table to add 'prescribing_advisory' rule type,
 * update hypoxia threshold to clinically correct < 95%, and seed new rules.
 * Idempotent — safe to run multiple times.
 */
async function migrateCdsRules(db) {
  // Step 1: Rebuild clinical_rules with updated CHECK constraint to include prescribing_advisory.
  // SQLite requires full table recreation to modify a CHECK constraint.
  await dbRun(db, 'PRAGMA foreign_keys=OFF');
  await dbRun(db, 'BEGIN TRANSACTION');
  try {
    await dbRun(db, `
      CREATE TABLE IF NOT EXISTS clinical_rules_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_name TEXT NOT NULL UNIQUE,
        rule_type TEXT NOT NULL CHECK(rule_type IN (
          'vital_alert','lab_alert','drug_interaction','drug_allergy',
          'dose_check','differential','screening','follow_up','prescribing_advisory'
        )),
        trigger_condition TEXT NOT NULL,
        suggested_actions TEXT NOT NULL,
        priority INTEGER DEFAULT 50,
        enabled BOOLEAN DEFAULT 1,
        evidence_source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbRun(db, `INSERT OR IGNORE INTO clinical_rules_new SELECT * FROM clinical_rules`);
    await dbRun(db, `DROP TABLE clinical_rules`);
    await dbRun(db, `ALTER TABLE clinical_rules_new RENAME TO clinical_rules`);
    await dbRun(db, 'COMMIT');
    console.log('[MIGRATIONS] clinical_rules table constraint updated');
  } catch (err) {
    await dbRun(db, 'ROLLBACK');
    throw err;
  }
  await dbRun(db, 'PRAGMA foreign_keys=ON');

  // Step 2: Update hypoxia rule from spo2 < 92 to < 95 (clinical standard for alert threshold).
  await dbRun(db,
    `UPDATE clinical_rules SET
       trigger_condition = ?,
       suggested_actions = ?
     WHERE rule_name = 'hypoxia'
       AND json_extract(trigger_condition, '$.value') = 92`,
    [
      JSON.stringify({ field: 'spo2', operator: '<', value: 95 }),
      JSON.stringify({
        title: 'Low Oxygen Saturation - SpO2 Below 95%',
        description: 'Oxygen saturation below normal threshold (< 95%). Evaluate for respiratory compromise. Apply supplemental O2 if SpO2 < 92%.',
        category: 'urgent',
        actions: [
          { type: 'create_imaging_order', description: 'Order Chest X-ray', payload: { study_type: 'X-ray', body_part: 'Chest', cpt_code: '71046' } }
        ]
      })
    ]
  );

  // Step 3: Insert new rules (idempotent via INSERT OR IGNORE).
  await dbRun(db,
    `INSERT OR IGNORE INTO clinical_rules (rule_name, rule_type, trigger_condition, suggested_actions, priority, evidence_source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'fever_low_grade', 'vital_alert',
      JSON.stringify({ field: 'temperature', operator: '>', value: 99.5 }),
      JSON.stringify({
        title: 'Low-Grade Fever Advisory',
        description: 'Temperature 99.5–100.4°F. Monitor for progression to true fever (> 100.4°F). Consider viral etiology. Reassess in 30 minutes.',
        category: 'routine',
        actions: []
      }),
      20,
      'IDSA Fever Definition Guidelines'
    ]
  );

  await dbRun(db,
    `INSERT OR IGNORE INTO clinical_rules (rule_name, rule_type, trigger_condition, suggested_actions, priority, evidence_source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'antibiotic_stewardship_uri', 'prescribing_advisory',
      JSON.stringify({
        drug_classes: ['Amoxicillin', 'Azithromycin', 'Doxycycline', 'Ciprofloxacin', 'Levofloxacin', 'Cephalexin', 'Augmentin', 'Amoxicillin-Clavulanate'],
        chief_complaint_keywords: ['sinus', 'uri', 'upper respiratory', 'cold', 'rhinitis', 'sinusitis', 'pharyngitis', 'otitis', 'cough', 'bronchitis']
      }),
      JSON.stringify({
        title: 'Antibiotic Stewardship — URI/Sinusitis',
        description: 'Antibiotic prescribed for upper respiratory complaint. Per ACP/CDC guidelines, most URIs and acute sinusitis are viral. Consider watchful waiting if symptoms < 10 days without complications (fever > 102°F, purulent discharge, unilateral facial pain). If antibiotic indicated, first-line is Amoxicillin.',
        category: 'routine',
        actions: []
      }),
      35,
      'ACP/CDC Antibiotic Stewardship Guidelines 2023; IDSA Sinusitis Guidelines'
    ]
  );

  console.log('[MIGRATIONS] CDS rules migrated (hypoxia threshold, fever_low_grade, antibiotic_stewardship_uri)');
}

// ==========================================
// MIGRATE CDS SUGGESTION TYPES
// ==========================================

/**
 * Expand cds_suggestions.suggestion_type CHECK constraint to include
 * 'prescribing_advisory' and 'clinical_protocol'.
 * Idempotent — checks constraint text before rebuilding.
 */
async function migrateSuggestionTypes(db) {
  const row = await new Promise((resolve, reject) => {
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='cds_suggestions'", (err, r) => {
      if (err) reject(err); else resolve(r);
    });
  });

  if (!row) return; // Table doesn't exist yet — initial schema already has correct types
  if (row.sql.includes('clinical_protocol')) {
    console.log('[MIGRATIONS] cds_suggestions suggestion_type constraint already current — skipping');
    return;
  }

  console.log('[MIGRATIONS] Expanding cds_suggestions suggestion_type constraint...');
  await dbRun(db, 'PRAGMA foreign_keys=OFF');
  await dbRun(db, 'BEGIN TRANSACTION');
  try {
    await dbRun(db, `
      CREATE TABLE IF NOT EXISTS cds_suggestions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        suggestion_type TEXT NOT NULL CHECK(suggestion_type IN (
          'differential_diagnosis','lab_order','imaging_order',
          'medication','medication_adjustment','referral',
          'allergy_alert','interaction_alert','vital_alert',
          'preventive_care','dose_adjustment',
          'prescribing_advisory','clinical_protocol'
        )),
        category TEXT DEFAULT 'routine',
        priority INTEGER DEFAULT 50,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        rationale TEXT,
        suggested_action TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'pending','accepted','rejected','deferred','expired','auto-applied'
        )) DEFAULT 'pending',
        provider_response_time DATETIME,
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )
    `);
    await dbRun(db, `INSERT INTO cds_suggestions_new SELECT * FROM cds_suggestions`);
    await dbRun(db, `DROP TABLE cds_suggestions`);
    await dbRun(db, `ALTER TABLE cds_suggestions_new RENAME TO cds_suggestions`);
    await dbRun(db, 'COMMIT');
    console.log('[MIGRATIONS] cds_suggestions constraint expanded successfully');
  } catch (err) {
    await dbRun(db, 'ROLLBACK');
    throw err;
  }
  await dbRun(db, 'PRAGMA foreign_keys=ON');
}

// ==========================================
// APPOINTMENTS TABLE
// ==========================================

/**
 * Create appointments table for scheduling system.
 * Idempotent via CREATE TABLE IF NOT EXISTS.
 */
async function createAppointmentsTable(db) {
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      provider_name TEXT NOT NULL,
      appointment_date DATE NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 20,
      appointment_type TEXT NOT NULL CHECK(appointment_type IN (
        'new_patient','follow_up','sick_visit','wellness',
        'procedure','telehealth','referral','urgent'
      )),
      chief_complaint TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'scheduled','confirmed','checked-in','no-show',
        'cancelled','completed','rescheduled'
      )) DEFAULT 'scheduled',
      encounter_id INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (encounter_id) REFERENCES encounters(id)
    )
  `);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(provider_name, appointment_date)`);
  console.log('[MIGRATIONS] appointments table ready');
}

// ==========================================
// CHARGES TABLE (BILLING / CHARGE CAPTURE)
// ==========================================

/**
 * Create charges table for billing and charge capture at checkout.
 * Stores E/M level, CPT codes, and ICD-10 linkage per encounter.
 * Idempotent via CREATE TABLE IF NOT EXISTS.
 */
async function createChargesTable(db) {
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_id INTEGER NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      provider_name TEXT NOT NULL,
      em_level TEXT CHECK(em_level IN (
        '99202','99203','99204','99205',
        '99211','99212','99213','99214','99215',
        '99241','99242','99243','99244','99245'
      )),
      cpt_codes TEXT NOT NULL DEFAULT '[]',
      icd10_codes TEXT NOT NULL DEFAULT '[]',
      modifiers TEXT NOT NULL DEFAULT '[]',
      em_suggestion TEXT,
      total_rvu REAL,
      status TEXT NOT NULL CHECK(status IN (
        'draft','finalized','submitted','billed','paid','denied','voided'
      )) DEFAULT 'draft',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finalized_at DATETIME,
      FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_charges_encounter ON charges(encounter_id)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_charges_patient ON charges(patient_id)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status)`);
  console.log('[MIGRATIONS] charges table ready');
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
  createIndexes,
  migrateCdsRules,
  migrateSuggestionTypes,
  createAppointmentsTable,
  createChargesTable
};
