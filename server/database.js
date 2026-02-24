const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/mjr-ehr.db');
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Error opening database:', err);
  else console.log('Connected to SQLite database at:', DB_PATH);
});

db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

// ==========================================
// PROMISIFIED DB HELPERS
// ==========================================

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ==========================================
// SCHEMA INITIALIZATION
// ==========================================

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // --- Original 9 tables ---

      db.run(`CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mrn TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        middle_name TEXT,
        last_name TEXT NOT NULL,
        dob DATE NOT NULL,
        sex TEXT CHECK(sex IN ('M', 'F', 'Other')),
        phone TEXT, email TEXT,
        address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, zip TEXT,
        insurance_carrier TEXT, insurance_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        problem_name TEXT NOT NULL,
        icd10_code TEXT,
        onset_date DATE, resolved_date DATE,
        status TEXT CHECK(status IN ('active','resolved','chronic')) DEFAULT 'active',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        medication_name TEXT NOT NULL,
        generic_name TEXT, dose TEXT, route TEXT, frequency TEXT,
        start_date DATE, end_date DATE, discontinued_reason TEXT,
        status TEXT CHECK(status IN ('active','discontinued','completed')) DEFAULT 'active',
        prescriber TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS allergies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        allergen TEXT NOT NULL, reaction TEXT,
        severity TEXT CHECK(severity IN ('mild','moderate','severe')),
        onset_date DATE, verified BOOLEAN DEFAULT 1, notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS encounters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_date DATE NOT NULL,
        encounter_type TEXT, chief_complaint TEXT,
        transcript TEXT, soap_note TEXT,
        status TEXT CHECK(status IN ('in-progress','completed','signed')) DEFAULT 'in-progress',
        provider TEXT, duration_minutes INTEGER, completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS vitals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_id INTEGER,
        recorded_date DATETIME NOT NULL,
        systolic_bp INTEGER, diastolic_bp INTEGER,
        heart_rate INTEGER, respiratory_rate INTEGER,
        temperature REAL, weight REAL, height REAL, bmi REAL, spo2 INTEGER,
        recorded_by TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS labs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        test_name TEXT NOT NULL,
        result_value TEXT, reference_range TEXT, units TEXT, result_date DATE,
        status TEXT CHECK(status IN ('pending','resulted','final')) DEFAULT 'pending',
        abnormal_flag TEXT, notes TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_id INTEGER,
        medication_name TEXT NOT NULL, generic_name TEXT,
        dose TEXT NOT NULL, route TEXT NOT NULL, frequency TEXT NOT NULL,
        quantity INTEGER, refills INTEGER DEFAULT 0,
        instructions TEXT, indication TEXT, icd10_codes TEXT,
        prescriber TEXT NOT NULL, prescribed_date DATE NOT NULL,
        status TEXT CHECK(status IN ('draft','signed','transmitted','dispensed')) DEFAULT 'draft',
        pdf_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS lab_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_id INTEGER,
        test_name TEXT NOT NULL, cpt_code TEXT,
        indication TEXT, icd10_codes TEXT,
        order_date DATE NOT NULL, scheduled_date DATE,
        status TEXT CHECK(status IN ('ordered','scheduled','completed','cancelled')) DEFAULT 'ordered',
        priority TEXT CHECK(priority IN ('routine','urgent','stat')) DEFAULT 'routine',
        fasting_required BOOLEAN DEFAULT 0, special_instructions TEXT,
        ordered_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
      )`);

      // --- 6 New tables ---

      db.run(`CREATE TABLE IF NOT EXISTS workflow_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL UNIQUE,
        patient_id INTEGER NOT NULL,
        current_state TEXT NOT NULL CHECK(current_state IN (
          'scheduled','checked-in','roomed','vitals-recorded',
          'provider-examining','orders-pending','documentation',
          'signed','checked-out'
        )) DEFAULT 'scheduled',
        assigned_ma TEXT,
        assigned_provider TEXT,
        check_in_time DATETIME,
        roomed_time DATETIME,
        vitals_time DATETIME,
        provider_start_time DATETIME,
        provider_end_time DATETIME,
        signed_time DATETIME,
        checkout_time DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS cds_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        suggestion_type TEXT NOT NULL CHECK(suggestion_type IN (
          'differential_diagnosis','lab_order','imaging_order',
          'medication','medication_adjustment','referral',
          'allergy_alert','interaction_alert','vital_alert',
          'preventive_care','dose_adjustment'
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
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS provider_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_name TEXT NOT NULL,
        condition_code TEXT NOT NULL,
        condition_name TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK(action_type IN (
          'lab_order','medication','imaging','referral','follow_up'
        )),
        action_detail TEXT NOT NULL,
        frequency_count INTEGER DEFAULT 1,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        confidence REAL DEFAULT 0.3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS clinical_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_name TEXT NOT NULL UNIQUE,
        rule_type TEXT NOT NULL CHECK(rule_type IN (
          'vital_alert','lab_alert','drug_interaction','drug_allergy',
          'dose_check','differential','screening','follow_up'
        )),
        trigger_condition TEXT NOT NULL,
        suggested_actions TEXT NOT NULL,
        priority INTEGER DEFAULT 50,
        enabled BOOLEAN DEFAULT 1,
        evidence_source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS imaging_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_id INTEGER,
        study_type TEXT NOT NULL,
        body_part TEXT NOT NULL,
        indication TEXT, icd10_codes TEXT, cpt_code TEXT,
        priority TEXT CHECK(priority IN ('routine','urgent','stat')) DEFAULT 'routine',
        contrast_required BOOLEAN DEFAULT 0,
        special_instructions TEXT,
        ordered_by TEXT NOT NULL,
        order_date DATE NOT NULL,
        status TEXT CHECK(status IN ('ordered','scheduled','completed','cancelled')) DEFAULT 'ordered',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        encounter_id INTEGER,
        specialty TEXT NOT NULL,
        reason TEXT NOT NULL,
        urgency TEXT CHECK(urgency IN ('routine','urgent','emergent')) DEFAULT 'routine',
        icd10_codes TEXT,
        referred_by TEXT NOT NULL,
        referred_date DATE NOT NULL,
        status TEXT CHECK(status IN ('pending','scheduled','completed','cancelled')) DEFAULT 'pending',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
      )`);

      // ==========================================
      // AUDIT & COMPLIANCE TABLES
      // ==========================================

      db.run(`CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        user_identity TEXT NOT NULL,
        user_role TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id INTEGER,
        description TEXT,
        request_method TEXT,
        request_path TEXT,
        request_body_summary TEXT,
        response_status INTEGER,
        phi_accessed BOOLEAN DEFAULT 0,
        phi_fields_accessed TEXT,
        patient_id INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT (datetime('now')),
        duration_ms INTEGER,
        error_message TEXT
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS audit_sessions (
        id TEXT PRIMARY KEY,
        user_identity TEXT NOT NULL,
        user_role TEXT,
        ip_address TEXT,
        user_agent TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        request_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1
      )`);

      // Audit indexes for query performance
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_identity)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(patient_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_phi ON audit_log(phi_accessed, timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`, (err) => {
        if (err) reject(err);
        else {
          console.log('Database schema initialized (17 tables + audit indexes)');
          resolve();
        }
      });
    });
  });
}

// ==========================================
// HELPERS
// ==========================================

function generateMRN() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 90000) + 10000;
  return `${year}-${random}`;
}

function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// ==========================================
// SEED DATA: CLINICAL RULES (25 rules)
// ==========================================

function loadClinicalRules() {
  return new Promise(async (resolve, reject) => {
    try {
      const existing = await dbGet('SELECT COUNT(*) as count FROM clinical_rules');
      if (existing.count > 0) {
        console.log('Clinical rules already loaded');
        return resolve();
      }

      console.log('Loading clinical rules...');

      const rules = [
        // --- VITAL ALERTS ---
        {
          rule_name: 'hypertension_stage2',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({
            or: [
              { field: 'systolic_bp', operator: '>=', value: 140 },
              { field: 'diastolic_bp', operator: '>=', value: 90 }
            ]
          }),
          suggested_actions: JSON.stringify({
            title: 'Stage 2 Hypertension Detected',
            description: 'BP exceeds Stage 2 threshold (>=140/90). Consider antihypertensive adjustment.',
            category: 'urgent',
            actions: [
              { type: 'medication_adjustment', description: 'Increase Lisinopril from 20mg to 40mg daily', payload: { medication_name: 'Lisinopril', dose: '40mg', route: 'PO', frequency: 'daily' }},
              { type: 'create_lab_order', description: 'Order BMP to assess renal function', payload: { test_name: 'Basic Metabolic Panel', cpt_code: '80048', priority: 'routine' }}
            ]
          }),
          priority: 10,
          evidence_source: 'AHA/ACC 2017 HTN Guidelines'
        },
        {
          rule_name: 'hypertensive_crisis',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({
            or: [
              { field: 'systolic_bp', operator: '>=', value: 180 },
              { field: 'diastolic_bp', operator: '>=', value: 120 }
            ]
          }),
          suggested_actions: JSON.stringify({
            title: 'HYPERTENSIVE CRISIS',
            description: 'BP >= 180/120. Immediate intervention required. Assess for end-organ damage.',
            category: 'urgent',
            actions: [
              { type: 'vital_alert', description: 'Recheck BP in 5 minutes. Consider IV antihypertensive.' }
            ]
          }),
          priority: 1,
          evidence_source: 'AHA/ACC 2017 HTN Guidelines'
        },
        {
          rule_name: 'tachycardia',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({ field: 'heart_rate', operator: '>', value: 100 }),
          suggested_actions: JSON.stringify({
            title: 'Tachycardia Detected',
            description: 'Heart rate > 100 bpm. Consider EKG and evaluate for underlying cause.',
            category: 'routine',
            actions: [
              { type: 'create_imaging_order', description: 'Order 12-lead EKG', payload: { study_type: 'EKG', body_part: 'Chest', cpt_code: '93000' }},
              { type: 'create_lab_order', description: 'Check TSH', payload: { test_name: 'TSH', cpt_code: '84443', priority: 'routine' }}
            ]
          }),
          priority: 20,
          evidence_source: 'ACC/AHA Arrhythmia Guidelines'
        },
        {
          rule_name: 'bradycardia',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({ field: 'heart_rate', operator: '<', value: 50 }),
          suggested_actions: JSON.stringify({
            title: 'Bradycardia Detected',
            description: 'Heart rate < 50 bpm. Review medications (beta-blockers, CCBs). Consider EKG.',
            category: 'urgent',
            actions: [
              { type: 'create_imaging_order', description: 'Order 12-lead EKG', payload: { study_type: 'EKG', body_part: 'Chest', cpt_code: '93000' }}
            ]
          }),
          priority: 15,
          evidence_source: 'ACC/AHA Arrhythmia Guidelines'
        },
        {
          rule_name: 'hypoxia',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({ field: 'spo2', operator: '<', value: 92 }),
          suggested_actions: JSON.stringify({
            title: 'Hypoxia - SpO2 Below 92%',
            description: 'Oxygen saturation critically low. Apply supplemental O2. Consider CXR and ABG.',
            category: 'urgent',
            actions: [
              { type: 'create_imaging_order', description: 'Order Chest X-ray', payload: { study_type: 'X-ray', body_part: 'Chest', cpt_code: '71046' }}
            ]
          }),
          priority: 5,
          evidence_source: 'BTS Oxygen Guidelines'
        },
        {
          rule_name: 'fever',
          rule_type: 'vital_alert',
          trigger_condition: JSON.stringify({ field: 'temperature', operator: '>', value: 100.4 }),
          suggested_actions: JSON.stringify({
            title: 'Fever Detected',
            description: 'Temperature > 100.4 F. Evaluate for infectious etiology.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'Order CBC with differential', payload: { test_name: 'Complete Blood Count', cpt_code: '85025', priority: 'urgent' }},
              { type: 'create_lab_order', description: 'Order Urinalysis', payload: { test_name: 'Urinalysis', cpt_code: '81003', priority: 'urgent' }}
            ]
          }),
          priority: 15,
          evidence_source: 'IDSA Fever Workup Guidelines'
        },

        // --- LAB ALERTS ---
        {
          rule_name: 'a1c_above_target',
          rule_type: 'lab_alert',
          trigger_condition: JSON.stringify({
            test_name: 'Hemoglobin A1C',
            operator: '>=', value: 7.0,
            requires_problem_prefix: 'E11'
          }),
          suggested_actions: JSON.stringify({
            title: 'A1C Above Target',
            description: 'A1C >= 7.0% in diabetic patient. Consider medication escalation.',
            category: 'routine',
            actions: [
              { type: 'create_prescription', description: 'Consider adding GLP-1 agonist (Ozempic/Semaglutide)', payload: { medication_name: 'Semaglutide (Ozempic)', generic_name: 'Semaglutide', dose: '0.25mg', route: 'SC', frequency: 'weekly', quantity: 4, refills: 0, instructions: 'Inject 0.25mg SC once weekly. Titrate to 0.5mg after 4 weeks.', indication: 'Type 2 Diabetes Mellitus', icd10_codes: 'E11.9' }},
              { type: 'create_referral', description: 'Endocrinology referral if A1C > 9.0', payload: { specialty: 'Endocrinology', reason: 'Uncontrolled Type 2 Diabetes', urgency: 'routine' }}
            ]
          }),
          priority: 20,
          evidence_source: 'ADA Standards of Care 2024'
        },
        {
          rule_name: 'egfr_declining',
          rule_type: 'lab_alert',
          trigger_condition: JSON.stringify({
            test_name: 'eGFR',
            operator: '<', value: 60
          }),
          suggested_actions: JSON.stringify({
            title: 'Declining Kidney Function (eGFR < 60)',
            description: 'eGFR indicates CKD Stage 3+. Monitor closely, consider nephrology referral.',
            category: 'routine',
            actions: [
              { type: 'create_referral', description: 'Nephrology referral', payload: { specialty: 'Nephrology', reason: 'CKD Stage 3 - declining eGFR', urgency: 'routine' }},
              { type: 'create_lab_order', description: 'Order UACR', payload: { test_name: 'Urine Microalbumin', cpt_code: '82043', priority: 'routine' }}
            ]
          }),
          priority: 25,
          evidence_source: 'KDIGO CKD Guidelines 2024'
        },
        {
          rule_name: 'elevated_creatinine',
          rule_type: 'lab_alert',
          trigger_condition: JSON.stringify({
            test_name: 'Creatinine',
            operator: '>', value: 1.2
          }),
          suggested_actions: JSON.stringify({
            title: 'Elevated Creatinine',
            description: 'Creatinine above reference range. Follow up with BMP. Review nephrotoxic medications.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'Follow-up BMP', payload: { test_name: 'Basic Metabolic Panel', cpt_code: '80048', priority: 'routine' }}
            ]
          }),
          priority: 30,
          evidence_source: 'KDIGO Guidelines'
        },
        {
          rule_name: 'elevated_microalbumin',
          rule_type: 'lab_alert',
          trigger_condition: JSON.stringify({
            test_name: 'Urine Microalbumin',
            operator: '>', value: 30
          }),
          suggested_actions: JSON.stringify({
            title: 'Elevated Microalbumin (UACR > 30)',
            description: 'Albumin in urine indicates kidney damage. Maximize ACE/ARB therapy.',
            category: 'routine',
            actions: [
              { type: 'medication_adjustment', description: 'Maximize ACE inhibitor / ARB dose', payload: { medication_name: 'Lisinopril', dose: '40mg', route: 'PO', frequency: 'daily' }}
            ]
          }),
          priority: 25,
          evidence_source: 'ADA/KDIGO Diabetic Kidney Disease Guidelines'
        },

        // --- DRUG-ALLERGY RULES ---
        {
          rule_name: 'penicillin_allergy_cephalosporin',
          rule_type: 'drug_allergy',
          trigger_condition: JSON.stringify({
            allergen: 'Penicillin',
            drug_classes: ['Cephalexin', 'Cefazolin', 'Ceftriaxone', 'Cephalosporin']
          }),
          suggested_actions: JSON.stringify({
            title: 'Penicillin Allergy - Cephalosporin Warning',
            description: 'Patient has Penicillin allergy. ~2% cross-reactivity risk with cephalosporins. Use with caution.',
            category: 'urgent',
            actions: []
          }),
          priority: 5,
          evidence_source: 'AAAAI Drug Allergy Practice Parameter'
        },
        {
          rule_name: 'penicillin_allergy_amoxicillin',
          rule_type: 'drug_allergy',
          trigger_condition: JSON.stringify({
            allergen: 'Penicillin',
            blocked_drugs: ['Amoxicillin', 'Augmentin', 'Ampicillin', 'Penicillin', 'Piperacillin']
          }),
          suggested_actions: JSON.stringify({
            title: 'BLOCKED: Penicillin-Class Drug with Known Allergy',
            description: 'Patient has documented Penicillin allergy. This medication is CONTRAINDICATED.',
            category: 'urgent',
            actions: []
          }),
          priority: 1,
          evidence_source: 'AAAAI Drug Allergy Practice Parameter'
        },
        {
          rule_name: 'sulfa_allergy_check',
          rule_type: 'drug_allergy',
          trigger_condition: JSON.stringify({
            allergen: 'Sulfa',
            blocked_drugs: ['Sulfamethoxazole', 'Bactrim', 'Septra', 'Sulfasalazine']
          }),
          suggested_actions: JSON.stringify({
            title: 'BLOCKED: Sulfa Drug with Known Allergy',
            description: 'Patient has documented Sulfa allergy. This medication is CONTRAINDICATED.',
            category: 'urgent',
            actions: []
          }),
          priority: 1,
          evidence_source: 'AAAAI Drug Allergy Practice Parameter'
        },

        // --- DRUG INTERACTION RULES ---
        {
          rule_name: 'metformin_renal_check',
          rule_type: 'drug_interaction',
          trigger_condition: JSON.stringify({
            drug: 'Metformin',
            lab_condition: { test_name: 'eGFR', operator: '<', value: 45 }
          }),
          suggested_actions: JSON.stringify({
            title: 'Metformin Dose Adjustment for Renal Function',
            description: 'Patient on Metformin with eGFR < 45. Reduce dose to 500mg BID. Discontinue if eGFR < 30.',
            category: 'urgent',
            actions: [
              { type: 'dose_adjustment', description: 'Reduce Metformin to 500mg BID (eGFR 30-45) or discontinue (eGFR < 30)', payload: { medication_name: 'Metformin', dose: '500mg', frequency: 'BID' }}
            ]
          }),
          priority: 10,
          evidence_source: 'FDA Metformin Label / ADA Guidelines'
        },
        {
          rule_name: 'ace_arb_potassium_monitoring',
          rule_type: 'drug_interaction',
          trigger_condition: JSON.stringify({
            drug_classes: ['Lisinopril', 'Enalapril', 'Ramipril', 'Losartan', 'Valsartan', 'Irbesartan'],
            requires_problem_prefix: 'N18'
          }),
          suggested_actions: JSON.stringify({
            title: 'ACE/ARB + CKD: Monitor Potassium',
            description: 'Patient on ACE inhibitor/ARB with CKD. Monitor serum potassium closely.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'Order BMP to check potassium', payload: { test_name: 'Basic Metabolic Panel', cpt_code: '80048', priority: 'routine' }}
            ]
          }),
          priority: 30,
          evidence_source: 'KDIGO CKD Guidelines'
        },
        {
          rule_name: 'nsaid_ckd_warning',
          rule_type: 'drug_interaction',
          trigger_condition: JSON.stringify({
            drug_classes: ['Ibuprofen', 'Naproxen', 'Diclofenac', 'Meloxicam', 'Celecoxib', 'NSAID'],
            requires_problem_prefix: 'N18'
          }),
          suggested_actions: JSON.stringify({
            title: 'NSAID Contraindicated with CKD',
            description: 'NSAIDs can worsen kidney function in CKD patients. Avoid or use alternative analgesic.',
            category: 'urgent',
            actions: []
          }),
          priority: 10,
          evidence_source: 'KDIGO CKD Guidelines'
        },
        {
          rule_name: 'statin_dose_ckd',
          rule_type: 'drug_interaction',
          trigger_condition: JSON.stringify({
            drug_classes: ['Atorvastatin', 'Rosuvastatin', 'Simvastatin'],
            lab_condition: { test_name: 'eGFR', operator: '<', value: 30 }
          }),
          suggested_actions: JSON.stringify({
            title: 'Statin Dose Review for CKD',
            description: 'Consider lower statin dose for severe CKD (eGFR < 30). Check for myopathy risk.',
            category: 'routine',
            actions: []
          }),
          priority: 35,
          evidence_source: 'ACC/AHA Lipid Guidelines'
        },

        // --- DIFFERENTIAL DIAGNOSIS RULES ---
        {
          rule_name: 'diabetes_uncontrolled_ddx',
          rule_type: 'differential',
          trigger_condition: JSON.stringify({
            symptom_keywords: ['blood sugar high', 'sugars high', 'glucose elevated', 'hyperglycemia', 'sugars have been high', 'blood sugars running high'],
            requires_problem_prefix: 'E11'
          }),
          suggested_actions: JSON.stringify({
            title: 'Differential: Uncontrolled Diabetes',
            description: 'Evaluate causes of poor glycemic control.',
            category: 'routine',
            differentials: [
              { name: 'Medication non-compliance', likelihood: 'high', workup: 'Medication reconciliation' },
              { name: 'Dietary non-adherence', likelihood: 'high', workup: 'Nutrition consult' },
              { name: 'Medication inadequacy', likelihood: 'moderate', workup: 'A1C trend review, consider escalation' },
              { name: 'Infection/Stress hyperglycemia', likelihood: 'moderate', workup: 'CBC, UA, CRP' },
              { name: 'Steroid-induced', likelihood: 'low', workup: 'Medication review' },
              { name: 'Thyroid dysfunction', likelihood: 'low', workup: 'TSH' }
            ]
          }),
          priority: 40,
          evidence_source: 'ADA Standards of Care'
        },
        {
          rule_name: 'chest_pain_ddx',
          rule_type: 'differential',
          trigger_condition: JSON.stringify({
            symptom_keywords: ['chest pain', 'chest pressure', 'chest tightness', 'substernal']
          }),
          suggested_actions: JSON.stringify({
            title: 'Differential: Chest Pain',
            description: 'Urgent evaluation for chest pain etiology.',
            category: 'urgent',
            differentials: [
              { name: 'Acute Coronary Syndrome', code: 'I24.9', likelihood: 'high', workup: 'EKG, Troponin, BMP' },
              { name: 'Pulmonary Embolism', code: 'I26.99', likelihood: 'moderate', workup: 'D-dimer, CT-PA' },
              { name: 'GERD', code: 'K21.0', likelihood: 'moderate', workup: 'Trial PPI' },
              { name: 'Musculoskeletal', code: 'M79.3', likelihood: 'moderate', workup: 'Physical exam, reproducible tenderness' },
              { name: 'Anxiety/Panic', code: 'F41.0', likelihood: 'low', workup: 'Diagnosis of exclusion' }
            ],
            actions: [
              { type: 'create_imaging_order', description: 'Stat EKG', payload: { study_type: 'EKG', body_part: 'Chest', cpt_code: '93000', priority: 'stat' }},
              { type: 'create_lab_order', description: 'Troponin', payload: { test_name: 'Troponin', cpt_code: '84484', priority: 'stat' }},
              { type: 'create_imaging_order', description: 'Chest X-ray', payload: { study_type: 'X-ray', body_part: 'Chest', cpt_code: '71046', priority: 'urgent' }}
            ]
          }),
          priority: 5,
          evidence_source: 'ACC/AHA Chest Pain Guidelines 2021'
        },
        {
          rule_name: 'shortness_of_breath_ddx',
          rule_type: 'differential',
          trigger_condition: JSON.stringify({
            symptom_keywords: ['shortness of breath', 'short of breath', 'dyspnea', 'difficulty breathing', 'can\'t breathe', 'SOB']
          }),
          suggested_actions: JSON.stringify({
            title: 'Differential: Shortness of Breath',
            description: 'Evaluate respiratory and cardiac causes.',
            category: 'urgent',
            differentials: [
              { name: 'Heart Failure Exacerbation', code: 'I50.9', likelihood: 'high', workup: 'BNP, CXR, Echo' },
              { name: 'COPD Exacerbation', code: 'J44.1', likelihood: 'high', workup: 'CXR, ABG, PFTs' },
              { name: 'Pneumonia', code: 'J18.9', likelihood: 'moderate', workup: 'CXR, CBC, Procalcitonin' },
              { name: 'Pulmonary Embolism', code: 'I26.99', likelihood: 'moderate', workup: 'D-dimer, CT-PA' },
              { name: 'Anxiety', code: 'F41.0', likelihood: 'low', workup: 'Diagnosis of exclusion' }
            ],
            actions: [
              { type: 'create_imaging_order', description: 'Chest X-ray', payload: { study_type: 'X-ray', body_part: 'Chest', cpt_code: '71046', priority: 'urgent' }},
              { type: 'create_lab_order', description: 'BNP', payload: { test_name: 'BNP', cpt_code: '83880', priority: 'urgent' }},
              { type: 'create_lab_order', description: 'CBC', payload: { test_name: 'Complete Blood Count', cpt_code: '85025', priority: 'urgent' }}
            ]
          }),
          priority: 10,
          evidence_source: 'ATS/ERS Dyspnea Guidelines'
        },

        // --- PREVENTIVE CARE / SCREENING ---
        {
          rule_name: 'diabetes_screening',
          rule_type: 'screening',
          trigger_condition: JSON.stringify({
            requires_problem_prefix: 'E11',
            required_tests: [
              { test_name: 'Hemoglobin A1C', interval_months: 3 },
              { test_name: 'Urine Microalbumin', interval_months: 12 },
              { test_name: 'Lipid Panel', interval_months: 12 }
            ]
          }),
          suggested_actions: JSON.stringify({
            title: 'Diabetes Monitoring Due',
            description: 'Routine diabetes screening tests are due per ADA guidelines.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'A1C', payload: { test_name: 'Hemoglobin A1C', cpt_code: '83036', priority: 'routine' }},
              { type: 'create_lab_order', description: 'UACR', payload: { test_name: 'Urine Microalbumin', cpt_code: '82043', priority: 'routine' }},
              { type: 'create_lab_order', description: 'Lipid Panel', payload: { test_name: 'Lipid Panel', cpt_code: '80061', priority: 'routine' }},
              { type: 'create_referral', description: 'Annual eye exam', payload: { specialty: 'Ophthalmology', reason: 'Diabetic retinopathy screening', urgency: 'routine' }}
            ]
          }),
          priority: 50,
          evidence_source: 'ADA Standards of Care 2024'
        },
        {
          rule_name: 'ckd_monitoring',
          rule_type: 'screening',
          trigger_condition: JSON.stringify({
            requires_problem_prefix: 'N18',
            required_tests: [
              { test_name: 'Basic Metabolic Panel', interval_months: 3 },
              { test_name: 'Urine Microalbumin', interval_months: 12 }
            ]
          }),
          suggested_actions: JSON.stringify({
            title: 'CKD Monitoring Due',
            description: 'Routine CKD monitoring labs are due per KDIGO guidelines.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'BMP', payload: { test_name: 'Basic Metabolic Panel', cpt_code: '80048', priority: 'routine' }},
              { type: 'create_lab_order', description: 'UACR', payload: { test_name: 'Urine Microalbumin', cpt_code: '82043', priority: 'routine' }}
            ]
          }),
          priority: 50,
          evidence_source: 'KDIGO CKD Guidelines 2024'
        },
        {
          rule_name: 'hypertension_monitoring',
          rule_type: 'screening',
          trigger_condition: JSON.stringify({
            requires_problem_prefix: 'I10',
            required_tests: [
              { test_name: 'Basic Metabolic Panel', interval_months: 12 },
              { test_name: 'Lipid Panel', interval_months: 12 }
            ]
          }),
          suggested_actions: JSON.stringify({
            title: 'Hypertension Monitoring Due',
            description: 'Annual HTN monitoring labs are due.',
            category: 'routine',
            actions: [
              { type: 'create_lab_order', description: 'BMP', payload: { test_name: 'Basic Metabolic Panel', cpt_code: '80048', priority: 'routine' }},
              { type: 'create_lab_order', description: 'Lipid Panel', payload: { test_name: 'Lipid Panel', cpt_code: '80061', priority: 'routine' }}
            ]
          }),
          priority: 50,
          evidence_source: 'AHA/ACC HTN Guidelines'
        },

        // --- PROVIDER PREFERENCE META-RULES ---
        {
          rule_name: 'provider_usual_lab_orders',
          rule_type: 'follow_up',
          trigger_condition: JSON.stringify({ source: 'provider_preferences', action_type: 'lab_order', min_confidence: 0.7 }),
          suggested_actions: JSON.stringify({
            title: 'Your Usual Lab Orders',
            description: 'Based on your practice pattern, these labs are typically ordered for this condition.',
            category: 'routine',
            actions: []
          }),
          priority: 60,
          evidence_source: 'Provider preference learning'
        },
        {
          rule_name: 'provider_usual_medications',
          rule_type: 'follow_up',
          trigger_condition: JSON.stringify({ source: 'provider_preferences', action_type: 'medication', min_confidence: 0.7 }),
          suggested_actions: JSON.stringify({
            title: 'Your Usual Medication Choice',
            description: 'Based on your practice pattern, this medication is typically prescribed for this condition.',
            category: 'routine',
            actions: []
          }),
          priority: 60,
          evidence_source: 'Provider preference learning'
        }
      ];

      for (const rule of rules) {
        await dbRun(
          `INSERT OR IGNORE INTO clinical_rules (rule_name, rule_type, trigger_condition, suggested_actions, priority, evidence_source)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rule.rule_name, rule.rule_type, rule.trigger_condition, rule.suggested_actions, rule.priority, rule.evidence_source]
        );
      }

      console.log(`Loaded ${rules.length} clinical rules`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

// ==========================================
// DEMO DATA
// ==========================================

function loadDemoData() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM patients', (err, row) => {
      if (err) { reject(err); return; }
      if (row.count > 0) {
        console.log('Demo data already loaded');
        resolve(); return;
      }

      console.log('Loading demo patient data...');

      db.run(`INSERT INTO patients (mrn, first_name, middle_name, last_name, dob, sex, phone, email,
               address_line1, city, state, zip, insurance_carrier, insurance_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['2018-04792', 'Sarah', 'Ann', 'Mitchell', '1963-01-15', 'F', '478-555-0147',
         'sarah.mitchell@email.com', '456 Oak Street', 'Macon', 'GA', '31201',
         'Blue Cross Blue Shield of Georgia', 'GX-334521'], function (err) {
        if (err) { reject(err); return; }
        const p1 = this.lastID;

        [['Type 2 Diabetes Mellitus','E11.9','2018-03-15',null,'chronic'],
         ['Chronic Kidney Disease Stage 3a','N18.3','2023-06-20',null,'chronic'],
         ['Hypertension','I10','2017-11-10',null,'chronic'],
         ['Obesity','E66.9','2015-05-01',null,'chronic']
        ].forEach(([n,c,o,r,s]) => {
          db.run('INSERT INTO problems (patient_id,problem_name,icd10_code,onset_date,resolved_date,status) VALUES (?,?,?,?,?,?)', [p1,n,c,o,r,s]);
        });

        [['Metformin','Metformin','1000mg','PO','BID','2018-03-15',null,null,'active','Dr. Johnson'],
         ['Lisinopril','Lisinopril','20mg','PO','daily','2017-11-10',null,null,'active','Dr. Johnson'],
         ['Atorvastatin','Atorvastatin','20mg','PO','qHS','2018-03-15',null,null,'active','Dr. Johnson'],
         ['Jardiance','Empagliflozin','10mg','PO','daily','2022-01-10','2024-10-01','Recurrent vulvovaginal candidiasis','discontinued','Dr. Johnson']
        ].forEach(([b,g,d,r,f,s,e,reason,st,pr]) => {
          db.run('INSERT INTO medications (patient_id,medication_name,generic_name,dose,route,frequency,start_date,end_date,discontinued_reason,status,prescriber) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [p1,b,g,d,r,f,s,e,reason,st,pr]);
        });

        db.run('INSERT INTO allergies (patient_id,allergen,reaction,severity,verified) VALUES (?,?,?,?,?)', [p1,'Penicillin','Hives','moderate',1]);

        [['Hemoglobin A1C','8.4','< 7.0','%','2024-11-15','final','High'],
         ['Creatinine','1.3','0.6-1.2','mg/dL','2024-11-15','final','High'],
         ['eGFR','52','> 60','mL/min/1.73m2','2024-11-15','final','Low'],
         ['Urine Microalbumin','45','< 30','mg/g','2024-11-15','final','High']
        ].forEach(([t,v,rng,u,dt,st,fl]) => {
          db.run('INSERT INTO labs (patient_id,test_name,result_value,reference_range,units,result_date,status,abnormal_flag) VALUES (?,?,?,?,?,?,?,?)', [p1,t,v,rng,u,dt,st,fl]);
        });

        // --- Demo patient 2: Robert Chen (COPD + CHF) ---
        db.run(`INSERT INTO patients (mrn, first_name, middle_name, last_name, dob, sex, phone, email,
                 address_line1, city, state, zip, insurance_carrier, insurance_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['2020-18834', 'Robert', 'James', 'Chen', '1955-08-22', 'M', '478-555-0233',
           'robert.chen@email.com', '789 Pine Ave', 'Macon', 'GA', '31204',
           'Medicare', 'MC-7788221'], function (err2) {
          if (err2) { reject(err2); return; }
          const p2 = this.lastID;

          [['COPD','J44.1','2019-04-10',null,'chronic'],
           ['Heart Failure, reduced EF','I50.22','2021-02-15',null,'chronic'],
           ['Atrial Fibrillation','I48.91','2021-02-15',null,'chronic'],
           ['Type 2 Diabetes Mellitus','E11.9','2016-08-01',null,'chronic'],
           ['Hyperlipidemia','E78.5','2010-03-15',null,'chronic']
          ].forEach(([n,c,o,r,s]) => {
            db.run('INSERT INTO problems (patient_id,problem_name,icd10_code,onset_date,resolved_date,status) VALUES (?,?,?,?,?,?)', [p2,n,c,o,r,s]);
          });

          [['Metoprolol Succinate','Metoprolol','50mg','PO','daily','2021-02-15',null,null,'active','Dr. Johnson'],
           ['Lisinopril','Lisinopril','10mg','PO','daily','2021-02-15',null,null,'active','Dr. Johnson'],
           ['Furosemide','Furosemide','40mg','PO','daily','2021-02-15',null,null,'active','Dr. Johnson'],
           ['Eliquis','Apixaban','5mg','PO','BID','2021-02-15',null,null,'active','Dr. Johnson'],
           ['Metformin','Metformin','500mg','PO','BID','2016-08-01',null,null,'active','Dr. Johnson'],
           ['Atorvastatin','Atorvastatin','40mg','PO','qHS','2010-03-15',null,null,'active','Dr. Johnson'],
           ['Tiotropium','Spiriva','18mcg','INH','daily','2019-04-10',null,null,'active','Dr. Johnson']
          ].forEach(([b,g,d,r,f,s,e,reason,st,pr]) => {
            db.run('INSERT INTO medications (patient_id,medication_name,generic_name,dose,route,frequency,start_date,end_date,discontinued_reason,status,prescriber) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [p2,b,g,d,r,f,s,e,reason,st,pr]);
          });

          db.run('INSERT INTO allergies (patient_id,allergen,reaction,severity,verified) VALUES (?,?,?,?,?)', [p2,'Sulfa','Rash','moderate',1]);

          [['BNP','450','< 100','pg/mL','2024-12-01','final','High'],
           ['Hemoglobin A1C','7.1','< 7.0','%','2024-12-01','final','High'],
           ['Creatinine','1.1','0.6-1.2','mg/dL','2024-12-01','final','Normal'],
           ['eGFR','68','> 60','mL/min/1.73m2','2024-12-01','final','Normal'],
           ['PT/INR','2.3','2.0-3.0','ratio','2024-12-01','final','Normal']
          ].forEach(([t,v,rng,u,dt,st,fl]) => {
            db.run('INSERT INTO labs (patient_id,test_name,result_value,reference_range,units,result_date,status,abnormal_flag) VALUES (?,?,?,?,?,?,?,?)', [p2,t,v,rng,u,dt,st,fl]);
          });

          console.log('Demo patients loaded (Sarah Mitchell + Robert Chen)');
          resolve();
        });
      });
    });
  });
}

// ==========================================
// DATABASE QUERY HELPERS
// ==========================================

const db_helpers = {
  // --- Patients ---
  getAllPatients: () => dbAll('SELECT * FROM patients ORDER BY last_name, first_name'),
  getPatientById: (id) => dbGet('SELECT * FROM patients WHERE id = ?', [id]),

  createPatient: (data) => {
    const mrn = generateMRN();
    const { first_name, middle_name, last_name, dob, sex, phone, email,
            address_line1, address_line2, city, state, zip, insurance_carrier, insurance_id } = data;
    return dbRun(`INSERT INTO patients (mrn,first_name,middle_name,last_name,dob,sex,phone,email,
                  address_line1,address_line2,city,state,zip,insurance_carrier,insurance_id)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mrn,first_name,middle_name,last_name,dob,sex,phone,email,
       address_line1,address_line2,city,state,zip,insurance_carrier,insurance_id])
      .then(r => ({ id: r.lastID, mrn }));
  },

  // --- Problems ---
  getPatientProblems: (patientId) => dbAll('SELECT * FROM problems WHERE patient_id = ? ORDER BY status DESC, onset_date DESC', [patientId]),

  addProblem: (data) => {
    const { patient_id, problem_name, icd10_code, onset_date, status, notes } = data;
    return dbRun('INSERT INTO problems (patient_id,problem_name,icd10_code,onset_date,status,notes) VALUES (?,?,?,?,?,?)',
      [patient_id, problem_name, icd10_code, onset_date, status || 'active', notes])
      .then(r => ({ id: r.lastID }));
  },

  // --- Medications ---
  getPatientMedications: (patientId) => dbAll('SELECT * FROM medications WHERE patient_id = ? ORDER BY status, medication_name', [patientId]),

  addMedication: (data) => {
    const { patient_id, medication_name, generic_name, dose, route, frequency, start_date, status, prescriber } = data;
    return dbRun('INSERT INTO medications (patient_id,medication_name,generic_name,dose,route,frequency,start_date,status,prescriber) VALUES (?,?,?,?,?,?,?,?,?)',
      [patient_id, medication_name, generic_name, dose, route, frequency, start_date, status || 'active', prescriber])
      .then(r => ({ id: r.lastID }));
  },

  // --- Allergies ---
  getPatientAllergies: (patientId) => dbAll('SELECT * FROM allergies WHERE patient_id = ?', [patientId]),

  addAllergy: (data) => {
    const { patient_id, allergen, reaction, severity, onset_date, verified, notes } = data;
    return dbRun('INSERT INTO allergies (patient_id,allergen,reaction,severity,onset_date,verified,notes) VALUES (?,?,?,?,?,?,?)',
      [patient_id, allergen, reaction, severity || 'moderate', onset_date || null, verified !== undefined ? verified : 1, notes || null])
      .then(r => ({ id: r.lastID }));
  },

  // --- Encounters ---
  createEncounter: (data) => {
    const { patient_id, encounter_date, encounter_type, chief_complaint, provider } = data;
    return dbRun('INSERT INTO encounters (patient_id,encounter_date,encounter_type,chief_complaint,provider) VALUES (?,?,?,?,?)',
      [patient_id, encounter_date || new Date().toISOString().split('T')[0], encounter_type, chief_complaint, provider])
      .then(r => ({ id: r.lastID }));
  },

  updateEncounter: (encounterId, updates) => {
    const { transcript, soap_note, status, duration_minutes } = updates;
    return dbRun(`UPDATE encounters SET transcript=COALESCE(?,transcript), soap_note=COALESCE(?,soap_note),
                  status=COALESCE(?,status), duration_minutes=COALESCE(?,duration_minutes),
                  completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?`,
      [transcript, soap_note, status, duration_minutes, status, encounterId])
      .then(r => ({ changes: r.changes }));
  },

  getEncounterById: (id) => dbGet('SELECT * FROM encounters WHERE id = ?', [id]),

  // --- Vitals ---
  addVitals: (data) => {
    const { patient_id, encounter_id, systolic_bp, diastolic_bp, heart_rate,
            respiratory_rate, temperature, weight, height, spo2, recorded_by } = data;
    const bmi = height && weight ? (weight / (height * height) * 703).toFixed(1) : null;
    return dbRun(`INSERT INTO vitals (patient_id,encounter_id,recorded_date,systolic_bp,diastolic_bp,
                  heart_rate,respiratory_rate,temperature,weight,height,bmi,spo2,recorded_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patient_id, encounter_id, new Date().toISOString(), systolic_bp, diastolic_bp,
       heart_rate, respiratory_rate, temperature, weight, height, bmi, spo2, recorded_by])
      .then(r => ({ id: r.lastID }));
  },

  getPatientVitals: (patientId) => dbAll('SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_date DESC', [patientId]),

  // --- Labs ---
  getPatientLabs: (patientId) => dbAll('SELECT * FROM labs WHERE patient_id = ? ORDER BY result_date DESC', [patientId]),

  addLab: (data) => {
    const { patient_id, test_name, result_value, reference_range, units, result_date, status, abnormal_flag, notes } = data;
    return dbRun('INSERT INTO labs (patient_id,test_name,result_value,reference_range,units,result_date,status,abnormal_flag,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [patient_id, test_name, result_value, reference_range, units, result_date || new Date().toISOString().split('T')[0], status || 'final', abnormal_flag || null, notes || null])
      .then(r => ({ id: r.lastID }));
  },

  // --- Prescriptions ---
  createPrescription: (data) => {
    const { patient_id, encounter_id, medication_name, generic_name, dose, route,
            frequency, quantity, refills, instructions, indication, icd10_codes,
            prescriber, prescribed_date, status } = data;
    return dbRun(`INSERT INTO prescriptions (patient_id,encounter_id,medication_name,generic_name,
                  dose,route,frequency,quantity,refills,instructions,indication,icd10_codes,
                  prescriber,prescribed_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patient_id, encounter_id, medication_name, generic_name, dose, route, frequency,
       quantity, refills, instructions, indication, icd10_codes, prescriber,
       prescribed_date, status || 'draft'])
      .then(r => ({ id: r.lastID }));
  },

  // --- Lab Orders ---
  createLabOrder: (data) => {
    const { patient_id, encounter_id, test_name, cpt_code, indication, icd10_codes,
            order_date, scheduled_date, priority, fasting_required, special_instructions, ordered_by } = data;
    return dbRun(`INSERT INTO lab_orders (patient_id,encounter_id,test_name,cpt_code,indication,
                  icd10_codes,order_date,scheduled_date,priority,fasting_required,special_instructions,ordered_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patient_id, encounter_id, test_name, cpt_code, indication, icd10_codes,
       order_date, scheduled_date, priority || 'routine', fasting_required || 0, special_instructions, ordered_by])
      .then(r => ({ id: r.lastID }));
  },

  // --- Workflow State ---
  createWorkflow: (data) => {
    const { encounter_id, patient_id, assigned_ma, assigned_provider } = data;
    return dbRun(`INSERT INTO workflow_state (encounter_id,patient_id,current_state,assigned_ma,assigned_provider)
                  VALUES (?,?,'scheduled',?,?)`,
      [encounter_id, patient_id, assigned_ma, assigned_provider])
      .then(r => ({ id: r.lastID }));
  },

  getWorkflowState: (encounterId) => dbGet('SELECT * FROM workflow_state WHERE encounter_id = ?', [encounterId]),

  updateWorkflowState: (encounterId, updates) => {
    const fields = [];
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(encounterId);
    return dbRun(`UPDATE workflow_state SET ${fields.join(', ')} WHERE encounter_id = ?`, params)
      .then(r => ({ changes: r.changes }));
  },

  getEncountersByState: (state) => {
    return dbAll(`SELECT ws.*, p.first_name, p.last_name, p.mrn, p.dob, e.encounter_type, e.chief_complaint
                  FROM workflow_state ws
                  JOIN patients p ON ws.patient_id = p.id
                  JOIN encounters e ON ws.encounter_id = e.id
                  WHERE ws.current_state = ?
                  ORDER BY ws.created_at`, [state]);
  },

  getAllWorkflows: () => {
    return dbAll(`SELECT ws.*, p.first_name, p.last_name, p.mrn, p.dob, e.encounter_type, e.chief_complaint
                  FROM workflow_state ws
                  JOIN patients p ON ws.patient_id = p.id
                  JOIN encounters e ON ws.encounter_id = e.id
                  ORDER BY ws.created_at DESC`);
  },

  // --- CDS Suggestions ---
  createSuggestion: (data) => {
    const { encounter_id, patient_id, suggestion_type, category, priority, title, description, rationale, suggested_action, source } = data;
    return dbRun(`INSERT INTO cds_suggestions (encounter_id,patient_id,suggestion_type,category,priority,
                  title,description,rationale,suggested_action,source) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [encounter_id, patient_id, suggestion_type, category || 'routine', priority || 50,
       title, description, rationale, typeof suggested_action === 'string' ? suggested_action : JSON.stringify(suggested_action), source || 'rule_engine'])
      .then(r => ({ id: r.lastID }));
  },

  getSuggestionById: (id) => dbGet('SELECT * FROM cds_suggestions WHERE id = ?', [id]),

  getEncounterSuggestions: (encounterId, status) => {
    if (status) {
      return dbAll('SELECT * FROM cds_suggestions WHERE encounter_id = ? AND status = ? ORDER BY priority ASC', [encounterId, status]);
    }
    return dbAll('SELECT * FROM cds_suggestions WHERE encounter_id = ? ORDER BY priority ASC', [encounterId]);
  },

  updateSuggestionStatus: (id, status) => {
    return dbRun('UPDATE cds_suggestions SET status = ?, provider_response_time = CURRENT_TIMESTAMP WHERE id = ?', [status, id])
      .then(r => ({ changes: r.changes }));
  },

  // --- Clinical Rules ---
  getAllClinicalRules: () => dbAll('SELECT * FROM clinical_rules WHERE enabled = 1 ORDER BY priority ASC'),
  getRulesByType: (type) => dbAll('SELECT * FROM clinical_rules WHERE rule_type = ? AND enabled = 1 ORDER BY priority ASC', [type]),

  // --- Imaging Orders ---
  createImagingOrder: (data) => {
    const { patient_id, encounter_id, study_type, body_part, indication, icd10_codes,
            cpt_code, priority, contrast_required, special_instructions, ordered_by, order_date } = data;
    return dbRun(`INSERT INTO imaging_orders (patient_id,encounter_id,study_type,body_part,indication,
                  icd10_codes,cpt_code,priority,contrast_required,special_instructions,ordered_by,order_date)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patient_id, encounter_id, study_type, body_part, indication, icd10_codes,
       cpt_code, priority || 'routine', contrast_required || 0, special_instructions, ordered_by,
       order_date || new Date().toISOString().split('T')[0]])
      .then(r => ({ id: r.lastID }));
  },

  getPatientImagingOrders: (patientId) => dbAll('SELECT * FROM imaging_orders WHERE patient_id = ? ORDER BY order_date DESC', [patientId]),

  // --- Referrals ---
  createReferral: (data) => {
    const { patient_id, encounter_id, specialty, reason, urgency, icd10_codes, referred_by, referred_date, notes } = data;
    return dbRun(`INSERT INTO referrals (patient_id,encounter_id,specialty,reason,urgency,
                  icd10_codes,referred_by,referred_date,notes) VALUES (?,?,?,?,?,?,?,?,?)`,
      [patient_id, encounter_id, specialty, reason, urgency || 'routine', icd10_codes,
       referred_by, referred_date || new Date().toISOString().split('T')[0], notes])
      .then(r => ({ id: r.lastID }));
  },

  getPatientReferrals: (patientId) => dbAll('SELECT * FROM referrals WHERE patient_id = ? ORDER BY referred_date DESC', [patientId]),

  // --- Provider Preferences ---
  getProviderPreferences: (providerName, conditionCode) => {
    if (conditionCode) {
      return dbAll('SELECT * FROM provider_preferences WHERE provider_name = ? AND condition_code = ? ORDER BY confidence DESC',
        [providerName, conditionCode]);
    }
    return dbAll('SELECT * FROM provider_preferences WHERE provider_name = ? ORDER BY confidence DESC', [providerName]);
  },

  upsertProviderPreference: async (data) => {
    const { provider_name, condition_code, condition_name, action_type, action_detail } = data;
    const detailStr = typeof action_detail === 'string' ? action_detail : JSON.stringify(action_detail);

    const existing = await dbGet(
      'SELECT * FROM provider_preferences WHERE provider_name = ? AND condition_code = ? AND action_type = ? AND action_detail = ?',
      [provider_name, condition_code, action_type, detailStr]
    );

    if (existing) {
      const newCount = existing.frequency_count + 1;
      const newConf = Math.min(1.0, 0.3 + (newCount * 0.1));
      return dbRun('UPDATE provider_preferences SET frequency_count = ?, confidence = ?, last_used = CURRENT_TIMESTAMP WHERE id = ?',
        [newCount, newConf, existing.id])
        .then(() => ({ id: existing.id, confidence: newConf, frequency_count: newCount }));
    } else {
      return dbRun(`INSERT INTO provider_preferences (provider_name,condition_code,condition_name,action_type,action_detail)
                    VALUES (?,?,?,?,?)`,
        [provider_name, condition_code, condition_name, action_type, detailStr])
        .then(r => ({ id: r.lastID, confidence: 0.3, frequency_count: 1 }));
    }
  },

  deleteProviderPreference: (id) => dbRun('DELETE FROM provider_preferences WHERE id = ?', [id])
};

// ==========================================
// CLOSE HANDLER
// ==========================================

function close() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) { console.error('Error closing database:', err); reject(err); }
      else { console.log('Database connection closed'); resolve(); }
    });
  });
}

// ==========================================
// INITIALIZATION
// ==========================================

const ready = initializeDatabase()
  .then(() => loadDemoData())
  .then(() => loadClinicalRules())
  .catch(err => console.error('Database initialization error:', err));

module.exports = {
  db, dbRun, dbGet, dbAll,
  ready, close,
  ...db_helpers,
  generateMRN, calculateAge
};
