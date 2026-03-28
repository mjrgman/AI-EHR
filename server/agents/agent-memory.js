/**
 * Agent Memory System
 * Persistent memory layer for agents to learn and adapt over time.
 *
 * Features:
 * - Per-agent memory namespaces
 * - Multiple memory types (PREFERENCE, PROTOCOL, PATTERN, PATIENT_NOTE)
 * - Confidence scoring with time decay
 * - Search and query capabilities
 * - Bulk import/export for backup
 */

const MEMORY_TYPES = {
  PREFERENCE: 'PREFERENCE',       // Provider/MA preferences (documentation style, ordering patterns)
  PROTOCOL: 'PROTOCOL',           // Clinical protocols set by physician
  PATTERN: 'PATTERN',             // Learned patterns (common orders for conditions)
  PATIENT_NOTE: 'PATIENT_NOTE'    // Agent-specific notes about patients
};

const CONFIDENCE_CONFIG = {
  initialConfidence: 0.3,
  confidenceIncrement: 0.1,
  maxConfidence: 1.0,
  decayFactor: 0.98,              // Decay per day
  decayInterval: 86400000          // ms per day
};

class AgentMemory {
  /**
   * @param {string} agentName - Name of the agent
   * @param {Object} db - Database connection (dbRun, dbGet, dbAll functions)
   */
  constructor(agentName, db) {
    this.agentName = agentName;
    this.db = db;
    this.cacheSize = 1000; // Limit in-memory cache
  }

  /**
   * Store or update a memory entry
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key (e.g., "ordering_pattern_hypertension")
   * @param {*} value - Memory value (auto-JSON serialized if object)
   * @param {Object} options - Additional options
   * @param {number} options.confidence - Initial confidence (0-1)
   * @param {string} options.patientId - Associated patient ID
   * @param {string} options.encounterId - Associated encounter ID
   * @returns {Promise<Object>} Memory entry
   */
  async remember(memoryType, key, value, options = {}) {
    if (!MEMORY_TYPES[memoryType]) {
      throw new Error(`Invalid memory type: ${memoryType}`);
    }

    const {
      confidence = CONFIDENCE_CONFIG.initialConfidence,
      patientId = null,
      encounterId = null
    } = options;

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const now = new Date().toISOString();

    try {
      // Check if memory exists
      const existing = await this.db.dbGet(
        'SELECT * FROM agent_memory WHERE agent_name = ? AND memory_type = ? AND key = ?',
        [this.agentName, memoryType, key]
      );

      if (existing) {
        // Update: increment access count, increase confidence
        const newAccessCount = existing.access_count + 1;
        const newConfidence = Math.min(
          CONFIDENCE_CONFIG.maxConfidence,
          existing.confidence + CONFIDENCE_CONFIG.confidenceIncrement
        );

        await this.db.dbRun(
          `UPDATE agent_memory
            SET value = ?, confidence = ?, access_count = ?, last_accessed = ?
            WHERE id = ?`,
          [valueStr, newConfidence, newAccessCount, now, existing.id]
        );

        return {
          id: existing.id,
          agent_name: this.agentName,
          memory_type: memoryType,
          key,
          value: value,
          confidence: newConfidence,
          access_count: newAccessCount,
          last_accessed: now,
          created_at: existing.created_at,
          updated_at: now
        };
      } else {
        // Create new memory entry
        const result = await this.db.dbRun(
          `INSERT INTO agent_memory
            (agent_name, memory_type, key, value, confidence, access_count, patient_id, encounter_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.agentName, memoryType, key, valueStr, confidence, 1,
            patientId, encounterId, now, now
          ]
        );

        return {
          id: result.lastID,
          agent_name: this.agentName,
          memory_type: memoryType,
          key,
          value: value,
          confidence: confidence,
          access_count: 1,
          patient_id: patientId,
          encounter_id: encounterId,
          last_accessed: now,
          created_at: now,
          updated_at: now
        };
      }
    } catch (err) {
      console.error('AgentMemory.remember error:', err);
      throw err;
    }
  }

  /**
   * Retrieve a specific memory entry
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key
   * @returns {Promise<Object|null>} Memory entry or null
   */
  async recall(memoryType, key) {
    if (!MEMORY_TYPES[memoryType]) {
      throw new Error(`Invalid memory type: ${memoryType}`);
    }

    try {
      const memory = await this.db.dbGet(
        'SELECT * FROM agent_memory WHERE agent_name = ? AND memory_type = ? AND key = ?',
        [this.agentName, memoryType, key]
      );

      if (memory) {
        // Parse value
        try {
          memory.value = JSON.parse(memory.value);
        } catch (e) {
          // Leave as string if not JSON
        }

        // Update last_accessed
        const now = new Date().toISOString();
        await this.db.dbRun(
          'UPDATE agent_memory SET last_accessed = ? WHERE id = ?',
          [now, memory.id]
        );

        return memory;
      }
      return null;
    } catch (err) {
      console.error('AgentMemory.recall error:', err);
      return null;
    }
  }

  /**
   * Retrieve all memories of a specific type
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default 50)
   * @param {number} options.minConfidence - Minimum confidence threshold (0-1)
   * @returns {Promise<Array>} Memory entries
   */
  async recallByType(memoryType, options = {}) {
    if (!MEMORY_TYPES[memoryType]) {
      throw new Error(`Invalid memory type: ${memoryType}`);
    }

    const {
      limit = 50,
      minConfidence = 0
    } = options;

    try {
      let query = `SELECT * FROM agent_memory
                   WHERE agent_name = ? AND memory_type = ?`;
      const params = [this.agentName, memoryType];

      if (minConfidence > 0) {
        query += ' AND confidence >= ?';
        params.push(minConfidence);
      }

      query += ' ORDER BY confidence DESC, access_count DESC LIMIT ?';
      params.push(limit);

      const memories = await this.db.dbAll(query, params);

      // Parse values
      memories.forEach(m => {
        try {
          m.value = JSON.parse(m.value);
        } catch (e) {
          // Leave as string if not JSON
        }
      });

      return memories;
    } catch (err) {
      console.error('AgentMemory.recallByType error:', err);
      return [];
    }
  }

  /**
   * Search memories by key pattern
   * @param {string} query - Search query (wildcard supported)
   * @param {Object} options - Search options
   * @param {string} options.memoryType - Filter by type
   * @param {number} options.limit - Max results (default 50)
   * @returns {Promise<Array>} Matching memories
   */
  async search(query, options = {}) {
    const {
      memoryType = null,
      limit = 50
    } = options;

    try {
      let sql = `SELECT * FROM agent_memory
                 WHERE agent_name = ? AND (key LIKE ? OR value LIKE ?)`;
      const params = [this.agentName, `%${query}%`, `%${query}%`];

      if (memoryType && MEMORY_TYPES[memoryType]) {
        sql += ' AND memory_type = ?';
        params.push(memoryType);
      }

      sql += ' ORDER BY confidence DESC LIMIT ?';
      params.push(limit);

      const memories = await this.db.dbAll(sql, params);

      // Parse values
      memories.forEach(m => {
        try {
          m.value = JSON.parse(m.value);
        } catch (e) {
          // Leave as string if not JSON
        }
      });

      return memories;
    } catch (err) {
      console.error('AgentMemory.search error:', err);
      return [];
    }
  }

  /**
   * Retrieve memories for a specific patient
   * @param {string} patientId - Patient ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default 50)
   * @returns {Promise<Array>} Memories associated with patient
   */
  async recallForPatient(patientId, options = {}) {
    const { limit = 50 } = options;

    try {
      const memories = await this.db.dbAll(
        `SELECT * FROM agent_memory
         WHERE agent_name = ? AND patient_id = ?
         ORDER BY updated_at DESC LIMIT ?`,
        [this.agentName, patientId, limit]
      );

      // Parse values
      memories.forEach(m => {
        try {
          m.value = JSON.parse(m.value);
        } catch (e) {
          // Leave as string if not JSON
        }
      });

      return memories;
    } catch (err) {
      console.error('AgentMemory.recallForPatient error:', err);
      return [];
    }
  }

  /**
   * Forget a specific memory
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @param {string} key - Memory key
   * @returns {Promise<number>} Number of rows deleted
   */
  async forget(memoryType, key) {
    if (!MEMORY_TYPES[memoryType]) {
      throw new Error(`Invalid memory type: ${memoryType}`);
    }

    try {
      const result = await this.db.dbRun(
        'DELETE FROM agent_memory WHERE agent_name = ? AND memory_type = ? AND key = ?',
        [this.agentName, memoryType, key]
      );

      return result.changes;
    } catch (err) {
      console.error('AgentMemory.forget error:', err);
      return 0;
    }
  }

  /**
   * Clear all memories of a specific type
   * @param {string} memoryType - Type from MEMORY_TYPES
   * @returns {Promise<number>} Number of rows deleted
   */
  async forgetByType(memoryType) {
    if (!MEMORY_TYPES[memoryType]) {
      throw new Error(`Invalid memory type: ${memoryType}`);
    }

    try {
      const result = await this.db.dbRun(
        'DELETE FROM agent_memory WHERE agent_name = ? AND memory_type = ?',
        [this.agentName, memoryType]
      );

      return result.changes;
    } catch (err) {
      console.error('AgentMemory.forgetByType error:', err);
      return 0;
    }
  }

  /**
   * Export all memories for backup (with optional type filter)
   * @param {string} memoryType - Optional type filter
   * @returns {Promise<Array>} All memories
   */
  async export(memoryType = null) {
    try {
      let query = 'SELECT * FROM agent_memory WHERE agent_name = ?';
      const params = [this.agentName];

      if (memoryType && MEMORY_TYPES[memoryType]) {
        query += ' AND memory_type = ?';
        params.push(memoryType);
      }

      const memories = await this.db.dbAll(query, params);

      // Parse values
      memories.forEach(m => {
        try {
          m.value = JSON.parse(m.value);
        } catch (e) {
          // Leave as string if not JSON
        }
      });

      return memories;
    } catch (err) {
      console.error('AgentMemory.export error:', err);
      return [];
    }
  }

  /**
   * Import memories from backup (bulk insert)
   * @param {Array} memories - Array of memory objects to import
   * @returns {Promise<number>} Number imported
   */
  async import(memories) {
    if (!Array.isArray(memories)) {
      throw new Error('Import requires array of memory objects');
    }

    let imported = 0;
    try {
      for (const mem of memories) {
        const valueStr = typeof mem.value === 'string' ? mem.value : JSON.stringify(mem.value);

        await this.db.dbRun(
          `INSERT INTO agent_memory
            (agent_name, memory_type, key, value, confidence, access_count, patient_id, encounter_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.agentName,
            mem.memory_type,
            mem.key,
            valueStr,
            mem.confidence || CONFIDENCE_CONFIG.initialConfidence,
            mem.access_count || 0,
            mem.patient_id || null,
            mem.encounter_id || null,
            mem.created_at || new Date().toISOString(),
            mem.updated_at || new Date().toISOString()
          ]
        );

        imported++;
      }
    } catch (err) {
      console.error('AgentMemory.import error:', err);
    }

    return imported;
  }

  /**
   * Get memory statistics for this agent
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const total = await this.db.dbGet(
        'SELECT COUNT(*) as count FROM agent_memory WHERE agent_name = ?',
        [this.agentName]
      );

      const byType = await this.db.dbAll(
        'SELECT memory_type, COUNT(*) as count, AVG(confidence) as avg_confidence FROM agent_memory WHERE agent_name = ? GROUP BY memory_type',
        [this.agentName]
      );

      const highConfidence = await this.db.dbGet(
        'SELECT COUNT(*) as count FROM agent_memory WHERE agent_name = ? AND confidence >= 0.8',
        [this.agentName]
      );

      return {
        totalMemories: total?.count || 0,
        byType: byType || [],
        highConfidenceCount: highConfidence?.count || 0,
        agentName: this.agentName
      };
    } catch (err) {
      console.error('AgentMemory.getStats error:', err);
      return {
        totalMemories: 0,
        byType: [],
        highConfidenceCount: 0,
        agentName: this.agentName,
        error: err.message
      };
    }
  }
}

module.exports = {
  AgentMemory,
  MEMORY_TYPES,
  CONFIDENCE_CONFIG
};
