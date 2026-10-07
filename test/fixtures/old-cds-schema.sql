CREATE TABLE IF NOT EXISTS cds_suggestions (
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
      );
