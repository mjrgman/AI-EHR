'use strict';

/**
 * MediVault — Patient-Directed Data Governance Module
 *
 * Six-agent system for clinical document management, reconciliation,
 * and patient-facing communication within the Agentic EHR.
 *
 * Agents:
 *   1. Ingestion Agent     — document intake, classification, date extraction
 *   2. Dedup Agent         — timeline deduplication with provenance preservation
 *   3. Reconciliation Agent — cross-source medication, allergy, and problem reconciliation
 *   4. Specialty Packaging — specialty-tailored clinical packet generation
 *   5. Translation Agent   — plain-language conversion at 6th-grade reading level
 *   6. Red Flag Agent      — critical lab values, medication interactions, care gaps
 *
 * All agents operate at CATC Tier 3 (Physician-in-the-Loop).
 * No MediVault output enters the patient record or reaches the patient
 * without explicit physician review.
 *
 * Usage:
 *   const medivault = require('./medivault');
 *
 *   // Access agents
 *   const ingestion = new medivault.IngestionAgent();
 *   const dedup = new medivault.DedupAgent();
 *
 *   // Tables are initialized on require()
 */

const { dbRun } = require('../database');

// ==========================================
// AGENT IMPORTS
// ==========================================

const { IngestionAgent } = require('./agents/ingestion-agent');
const { DedupAgent } = require('./agents/dedup-agent');
const { ReconciliationAgent } = require('./agents/reconciliation-agent');
const { SpecialtyPackagingAgent } = require('./agents/specialty-packaging-agent');
const { TranslationAgent } = require('./agents/translation-agent');
const { RedFlagAgent } = require('./agents/red-flag-agent');

// ==========================================
// DATABASE TABLE INITIALIZATION
// ==========================================

const INIT_TABLES = [
  `CREATE TABLE IF NOT EXISTS vault_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    document_type TEXT,
    source_system TEXT,
    original_filename TEXT,
    ocr_text TEXT,
    ocr_confidence REAL,
    classification TEXT,
    extracted_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS vault_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    event_type TEXT,
    event_date TEXT,
    description TEXT,
    source_document_id INTEGER,
    deduplicated BOOLEAN DEFAULT 0,
    canonical_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL,
    FOREIGN KEY (canonical_id) REFERENCES vault_timeline(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS vault_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    conflict_type TEXT,
    item_name TEXT,
    source1_value TEXT,
    source1_document_id INTEGER,
    source2_value TEXT,
    source2_document_id INTEGER,
    resolution_status TEXT DEFAULT 'pending',
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source1_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL,
    FOREIGN KEY (source2_document_id) REFERENCES vault_documents(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS vault_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    accessed_by TEXT,
    access_type TEXT,
    resource_accessed TEXT,
    authorized BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS specialty_packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    specialty TEXT,
    content TEXT,
    generated_by TEXT,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS patient_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    source_packet_id INTEGER,
    plain_language_text TEXT,
    reading_level TEXT DEFAULT '6th-grade',
    reviewed_by TEXT,
    reviewed_at DATETIME,
    status TEXT CHECK(status IN ('draft','physician_review','approved','delivered')) DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (source_packet_id) REFERENCES specialty_packets(id) ON DELETE SET NULL
  )`
];

// Initialize all tables on module load
(async function initMediVaultTables() {
  for (const sql of INIT_TABLES) {
    try {
      await dbRun(sql);
    } catch (err) {
      console.error('[MediVault] Table initialization error:', err.message);
    }
  }
  console.log('[MediVault] Database tables initialized');
})();

// ==========================================
// MODULE EXPORTS
// ==========================================

module.exports = {
  // Agent classes
  IngestionAgent,
  DedupAgent,
  ReconciliationAgent,
  SpecialtyPackagingAgent,
  TranslationAgent,
  RedFlagAgent,

  // Convenience: all agents as an array for bulk registration
  getAllAgents() {
    return [
      new IngestionAgent(),
      new DedupAgent(),
      new ReconciliationAgent(),
      new SpecialtyPackagingAgent(),
      new TranslationAgent(),
      new RedFlagAgent()
    ];
  }
};
