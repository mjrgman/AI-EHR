/**
 * Database Migrations for Agentic EHR
 *
 * Adds migration-managed tables to support:
 * - RBAC (Role-Based Access Control) — users
 * - HIPAA consent tracking (CATC requirement) — patient_consent
 * - Agent governance audit trail — agent_audit_trail
 * - Safety event logging (4-level system) — safety_events
 * - Physician override learning — physician_overrides
 * - Security event tracking — login_attempts
 * - Scheduling — appointments
 * - Revenue cycle — charges
 * - FHIR ingestion staging — fhir_ingest_jobs, fhir_ingest_items, fhir_id_map
 *
 * Run after database initialization. Called on every server start.
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
    await repairRefreshTokensFk(db);
    await createPatientConsentTable(db);
    await createAgentAuditTrailTable(db);
    await createSafetyEventsTable(db);
    await createPhysicianOverridesTable(db);
    await createLoginAttemptsTable(db);
    await createPatientMessagesTable(db);
    await createPatientPortalSessionsTable(db);
    await createIndexes(db);
    await migrateCdsRules(db);
    await migrateSuggestionTypes(db);
    await createAppointmentsTable(db);
    await createChargesTable(db);
    await createFhirIngestTables(db);
    await addRxNormColumns(db);
    await createLabCorpTokensTable(db);
    await addLabCorpColumns(db);

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
  const usersTableSql = `
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
        'admin',
        'system'
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
  `;

  await dbRun(db, usersTableSql);

  const userColumns = await dbAllCompat(db, `PRAGMA table_info(users)`);
  const columnNames = new Set(userColumns.map(column => column.name));
  const needsRebuild =
    columnNames.has('display_name') ||
    !columnNames.has('full_name') ||
    !columnNames.has('email') ||
    !columnNames.has('phone') ||
    !columnNames.has('npi_number') ||
    !columnNames.has('failed_login_count') ||
    !columnNames.has('locked_until');

  if (!needsRebuild) {
    return;
  }

  const existingUsers = await dbAllCompat(db, 'SELECT * FROM users');
  await dbRun(db, 'PRAGMA foreign_keys=OFF');
  await dbRun(db, 'ALTER TABLE users RENAME TO users_legacy');
  await dbRun(db, usersTableSql);

  for (const user of existingUsers) {
    const fullName = user.full_name || user.display_name || user.username;
    const email = user.email || (String(user.username).includes('@') ? user.username : `${user.username}@local.invalid`);
    await dbRun(
      db,
      `INSERT INTO users (
        id, username, password_hash, role, full_name, npi_number, email, phone,
        is_active, last_login, failed_login_count, locked_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.username,
        user.password_hash,
        user.role || 'admin',
        fullName,
        user.npi_number || null,
        email,
        user.phone || null,
        user.is_active ?? 1,
        user.last_login || null,
        user.failed_login_count ?? 0,
        user.locked_until || null,
        user.created_at || null,
        user.updated_at || null
      ]
    );
  }

  await dbRun(db, 'DROP TABLE users_legacy');
  await dbRun(db, 'PRAGMA foreign_keys=ON');
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

async function createPatientMessagesTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS patient_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      message_type TEXT NOT NULL CHECK(message_type IN (
        'general','refill_notification','lab_result','triage'
      )) DEFAULT 'general',
      subject TEXT,
      content TEXT NOT NULL,
      plain_language_content TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'draft','submitted','physician_review','approved','sent','read','closed'
      )) DEFAULT 'draft',
      tier INTEGER NOT NULL DEFAULT 2,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);
}

async function createPatientPortalSessionsTable(db) {
  return dbRun(db, `
    CREATE TABLE IF NOT EXISTS patient_portal_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_hash TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked BOOLEAN DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
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
    'CREATE INDEX IF NOT EXISTS idx_login_success ON login_attempts(success)',

    // patient_messages table
    'CREATE INDEX IF NOT EXISTS idx_patient_messages_patient ON patient_messages(patient_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_patient_messages_status ON patient_messages(status)',

    // patient_portal_sessions table
    'CREATE INDEX IF NOT EXISTS idx_portal_sessions_hash ON patient_portal_sessions(session_hash)',
    'CREATE INDEX IF NOT EXISTS idx_portal_sessions_patient ON patient_portal_sessions(patient_id, revoked)',
    'CREATE INDEX IF NOT EXISTS idx_portal_sessions_expiry ON patient_portal_sessions(expires_at)'
  ];

  // All indexes are independent — create in parallel to minimize startup latency.
  await Promise.all(indexes.map(indexSql =>
    dbRun(db, indexSql).catch(err => {
      if (!err.message.includes('already exists')) throw err;
    })
  ));
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
  // Step 1: Rebuild clinical_rules to add 'prescribing_advisory' to the rule_type CHECK constraint.
  // SQLite requires full table recreation to modify CHECK constraints.
  // Guard: skip if constraint already includes the new type (idempotency on repeated starts).
  const existing = await dbGetCompat(db,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='clinical_rules'");
  const needsConstraintUpgrade = !existing?.sql?.includes('prescribing_advisory');

  if (needsConstraintUpgrade) {
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
  }

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
        title: 'Hypoxia - Low Oxygen Saturation (SpO2 < 95%)',
        description: 'Oxygen saturation below normal threshold (< 95%). Evaluate for respiratory compromise. Apply supplemental O2 if SpO2 < 92%.',
        category: 'urgent',
        actions: [
          { type: 'create_imaging_order', description: 'Order Chest X-ray', payload: { study_type: 'X-ray', body_part: 'Chest', cpt_code: '71046' } }
        ]
      })
    ]
  );

  // Step 2b: Normalize hypoxia title so the word "Hypoxia" appears in the string.
  // The scenario test runner matches CDS alerts by substring — "Low Oxygen Saturation"
  // alone won't match an expected_cds entry of "Hypoxia". WHERE clause makes this idempotent.
  await dbRun(db,
    `UPDATE clinical_rules SET suggested_actions = json_set(suggested_actions, '$.title', 'Hypoxia - Low Oxygen Saturation (SpO2 < 95%)')
     WHERE rule_name = 'hypoxia'
       AND json_extract(suggested_actions, '$.title') NOT LIKE '%Hypoxia%'`
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
  const row = await dbGetCompat(
    db,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='cds_suggestions'"
  );

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
// FHIR INGESTION STAGING TABLES
// ==========================================

/**
 * Three-table ingestion staging layer:
 *   fhir_ingest_jobs  — one row per POST /fhir/R4/Bundle request
 *   fhir_ingest_items — one row per resource entry within a job
 *   fhir_id_map       — durable map: external FHIR ID -> internal table ID (idempotency anchor)
 */
async function createFhirIngestTables(db) {
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS fhir_ingest_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT UNIQUE NOT NULL,
      source TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'pending','processing','completed','failed','partial'
      )) DEFAULT 'pending',
      bundle_type TEXT,
      resource_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      submitted_by TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS fhir_ingest_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      entry_index INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'pending','success','failed','skipped'
      )) DEFAULT 'pending',
      internal_id INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES fhir_ingest_jobs(job_id)
    )
  `);

  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS fhir_id_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      internal_id INTEGER NOT NULL,
      internal_table TEXT NOT NULL,
      first_seen_job TEXT NOT NULL,
      last_updated_job TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(resource_type, external_id)
    )
  `);

  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_fhir_id_map_lookup
    ON fhir_id_map(resource_type, external_id)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_fhir_ingest_items_job
    ON fhir_ingest_items(job_id)`);

  console.log('[MIGRATIONS] FHIR ingestion staging tables ready');
}

/**
 * If the users table was renamed during a prior migration, the refresh_tokens
 * table may have a stale FK pointing to users_legacy. Drop and let refresh-tokens.js
 * recreate it on the same startup. Safe — the table has no persistent data on fresh/dev.
 */
async function repairRefreshTokensFk(db) {
  const row = await dbGetCompat(db,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='refresh_tokens'");
  if (row && row.sql && row.sql.includes('users_legacy')) {
    await dbRun(db, 'PRAGMA foreign_keys=OFF');
    await dbRun(db, 'DROP TABLE IF EXISTS refresh_tokens');
    await dbRun(db, 'PRAGMA foreign_keys=ON');
    console.log('[MIGRATIONS] Repaired stale refresh_tokens FK (was pointing to users_legacy)');
  }
}

// ==========================================
// DATABASE HELPER (PROMISIFIED)
// ==========================================

/**
 * Promisified db.run() for use with async/await.
 * Accepts either the raw sqlite handle or the app's database wrapper.
 */
function dbRun(db, sql, params = []) {
  if (db && typeof db.dbRun === 'function') {
    return db.dbRun(sql, params);
  }

  const rawDb = db && typeof db.run === 'function' ? db : db?.db;
  if (!rawDb || typeof rawDb.run !== 'function') {
    throw new TypeError('Database handle must expose dbRun() or sqlite run()');
  }

  return new Promise((resolve, reject) => {
    rawDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAllCompat(db, sql, params = []) {
  if (db && typeof db.dbAll === 'function') {
    return db.dbAll(sql, params);
  }

  const rawDb = db && typeof db.all === 'function' ? db : db?.db;
  if (!rawDb || typeof rawDb.all !== 'function') {
    throw new TypeError('Database handle must expose dbAll() or sqlite all()');
  }

  return new Promise((resolve, reject) => {
    rawDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGetCompat(db, sql, params = []) {
  if (db && typeof db.dbGet === 'function') {
    return db.dbGet(sql, params);
  }

  const rawDb = db && typeof db.get === 'function' ? db : db?.db;
  if (!rawDb || typeof rawDb.get !== 'function') {
    throw new TypeError('Database handle must expose dbGet() or sqlite get()');
  }

  return new Promise((resolve, reject) => {
    rawDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ==========================================
// EXPORTS
// ==========================================
// RXNORM COLUMNS
// ==========================================

/**
 * Add rxnorm_cui column to medications and prescriptions tables.
 * Enables canonical drug identification via NLM RxNorm API.
 */
async function addRxNormColumns(db) {
  // server/server.js passes the database module's exports object; unwrap to the
  // raw sqlite3 instance so .all()/.run() resolve. Mirrors dbAllCompat (L806).
  const rawDb = db && typeof db.all === 'function' ? db : db?.db;
  const tables = ['medications', 'prescriptions'];
  for (const table of tables) {
    try {
      const cols = await new Promise((resolve, reject) => {
        rawDb.all(`PRAGMA table_info(${table})`, (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });
      if (!cols.some(c => c.name === 'rxnorm_cui')) {
        await new Promise((resolve, reject) => {
          rawDb.run(`ALTER TABLE ${table} ADD COLUMN rxnorm_cui TEXT`, (err) => {
            if (err) reject(err);
            else {
              console.log(`[MIGRATIONS] Added rxnorm_cui column to ${table}`);
              resolve();
            }
          });
        });
      }
    } catch (err) {
      console.warn(`[MIGRATIONS] rxnorm_cui migration for ${table}: ${err.message}`);
    }
  }
}

// ==========================================
// LABCORP TOKENS TABLE (Phase 2b)
// ==========================================

/**
 * Create labcorp_tokens table for OAuth2 access + refresh token storage.
 *
 * Tokens are stored ENCRYPTED via server/security/phi-encryption.js. Never
 * store plaintext. The caller is responsible for encryption; this table
 * only holds ciphertext.
 *
 * Each row represents the OAuth2 grant for one (user, LabCorp account)
 * pairing. Refreshes update the row in place; expires_at drives the
 * rotation decision.
 *
 * Idempotent via CREATE TABLE IF NOT EXISTS.
 */
async function createLabCorpTokensTable(db) {
  await dbRun(db, `
    CREATE TABLE IF NOT EXISTS labcorp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT NOT NULL,
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      expires_at DATETIME NOT NULL,
      scope TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_refresh_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // UNIQUE(user_id) enforces one OAuth grant per user. Upserts via INSERT
  // ... ON CONFLICT(user_id) DO UPDATE rely on this constraint to replace
  // the row in place instead of accumulating historical grants.
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_labcorp_tokens_user ON labcorp_tokens(user_id)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_labcorp_tokens_expires ON labcorp_tokens(expires_at)`);
  console.log('[MIGRATIONS] labcorp_tokens table ready');
}

/**
 * Add LabCorp-specific columns to lab_orders so Phase 2b can track external
 * order lifecycle and raw PDF storage paths.
 *
 * - external_order_id: LabCorp-issued order identifier (returned from submit)
 * - labcorp_status:    LabCorp-side lifecycle ('submitted','in_transit',
 *                      'partial_result','complete','error','cancelled')
 * - labcorp_raw_pdf_path: filesystem path to raw result PDF for audit
 *
 * Uses the same PRAGMA-then-ALTER pattern as addRxNormColumns. Idempotent.
 */
async function addLabCorpColumns(db) {
  // server/server.js passes the database module's exports object; unwrap to the
  // raw sqlite3 instance so .all()/.run() resolve. Mirrors dbAllCompat (L806).
  const rawDb = db && typeof db.all === 'function' ? db : db?.db;
  const columns = [
    { name: 'external_order_id', type: 'TEXT' },
    { name: 'labcorp_status', type: 'TEXT' },
    { name: 'labcorp_raw_pdf_path', type: 'TEXT' },
  ];
  try {
    const cols = await new Promise((resolve, reject) => {
      rawDb.all('PRAGMA table_info(lab_orders)', (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    for (const col of columns) {
      if (!cols.some(c => c.name === col.name)) {
        await new Promise((resolve, reject) => {
          rawDb.run(`ALTER TABLE lab_orders ADD COLUMN ${col.name} ${col.type}`, (err) => {
            if (err) reject(err);
            else {
              console.log(`[MIGRATIONS] Added ${col.name} column to lab_orders`);
              resolve();
            }
          });
        });
      }
    }
  } catch (err) {
    console.warn(`[MIGRATIONS] lab_orders column migration: ${err.message}`);
  }
}

// ==========================================

module.exports = {
  runMigrations,
  createUsersTable,
  createPatientConsentTable,
  createAgentAuditTrailTable,
  createSafetyEventsTable,
  createPhysicianOverridesTable,
  createLoginAttemptsTable,
  createPatientMessagesTable,
  createPatientPortalSessionsTable,
  createIndexes,
  migrateCdsRules,
  migrateSuggestionTypes,
  createAppointmentsTable,
  createChargesTable,
  createFhirIngestTables,
  addRxNormColumns,
  createLabCorpTokensTable,
  addLabCorpColumns
};
