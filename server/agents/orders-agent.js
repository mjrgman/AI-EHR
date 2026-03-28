/**
 * Agentic EHR Orders Agent
 * Manages order entry — lab orders, imaging, referrals, and prescriptions
 * based on encounter context, CDS suggestions, and Scribe extractions.
 *
 * Capabilities:
 *   - Consolidate orders from Scribe extraction + CDS suggestions
 *   - Validate orders against patient context (allergies, duplicates)
 *   - Suggest indication/ICD-10 pairing for each order
 *   - Detect duplicate or redundant orders
 *   - Generate fasting instructions for relevant labs
 *   - Priority assignment (routine/urgent/stat)
 *   - Prescription completeness validation
 */

const { BaseAgent } = require('./base-agent');

class OrdersAgent extends BaseAgent {
  constructor(options = {}) {
    super('orders', {
      description: 'Order management — consolidates labs, imaging, referrals, prescriptions with validation',
      dependsOn: ['scribe', 'cds'],  // Needs Scribe extractions + CDS suggestions
      priority: 30,
      autonomyTier: 3, // Tier 3: Orders require physician approval before transmission
      ...options
    });

    // Labs that require fasting
    this.fastingLabs = new Set([
      'Lipid Panel', 'Fasting Glucose', 'Fasting Lipids',
      'Basic Metabolic Panel', 'Comprehensive Metabolic Panel',
      'Triglycerides', 'Fasting Insulin'
    ]);

    // Lab-to-indication mapping for common primary care scenarios
    this.labIndicationMap = {
      'Hemoglobin A1C': { indication: 'Diabetes management/screening', icd10: ['E11.65', 'Z13.1'] },
      'Lipid Panel': { indication: 'Cardiovascular risk assessment', icd10: ['E78.5', 'Z13.220'] },
      'TSH': { indication: 'Thyroid function evaluation', icd10: ['E03.9', 'Z01.812'] },
      'Complete Blood Count': { indication: 'Anemia evaluation / routine screening', icd10: ['D64.9', 'Z01.811'] },
      'Basic Metabolic Panel': { indication: 'Metabolic evaluation', icd10: ['Z01.812'] },
      'Comprehensive Metabolic Panel': { indication: 'Metabolic evaluation', icd10: ['Z01.812', 'N18.9'] },
      'Urinalysis': { indication: 'UTI evaluation / screening', icd10: ['N39.0', 'Z01.812'] },
      'Urine Microalbumin/Creatinine Ratio': { indication: 'Diabetic nephropathy screening', icd10: ['E11.65', 'N18.9'] },
      'PT/INR': { indication: 'Anticoagulation monitoring', icd10: ['Z79.01'] },
      'Liver Function Tests': { indication: 'Hepatic function evaluation', icd10: ['R94.5'] },
      'PSA': { indication: 'Prostate cancer screening', icd10: ['Z12.5'] },
      'Vitamin D, 25-Hydroxy': { indication: 'Vitamin D deficiency evaluation', icd10: ['E55.9'] },
      'Ferritin': { indication: 'Iron stores evaluation', icd10: ['D50.9'] },
      'Vitamin B12': { indication: 'B12 deficiency evaluation', icd10: ['E53.8'] },
      'BNP/NT-proBNP': { indication: 'Heart failure evaluation', icd10: ['I50.9'] },
      'Creatinine': { indication: 'Renal function evaluation', icd10: ['N18.9'] },
      'Magnesium': { indication: 'Electrolyte evaluation', icd10: ['E83.42'] },
      'Free T4': { indication: 'Thyroid function evaluation', icd10: ['E03.9'] },
    };
  }

  /**
   * @param {PatientContext} context
   * @param {Object} agentResults - Results from Scribe and CDS agents
   * @returns {Promise<OrdersResult>}
   */
  async process(context, agentResults = {}) {
    const scribeResult = agentResults.scribe?.result || {};
    const cdsResult = agentResults.cds?.result || {};

    // Collect all proposed orders from multiple sources
    const rawLabOrders = this._collectLabOrders(scribeResult, cdsResult, context);
    const rawImagingOrders = this._collectImagingOrders(scribeResult, cdsResult, context);
    const rawReferrals = this._collectReferrals(cdsResult, context);
    const rawPrescriptions = this._collectPrescriptions(scribeResult, context);

    // Validate and deduplicate
    const labOrders = this._deduplicateOrders(rawLabOrders, 'test_name');
    const imagingOrders = this._deduplicateOrders(rawImagingOrders, 'study_type');
    const referrals = this._deduplicateOrders(rawReferrals, 'specialty');

    // Validate prescriptions against allergies
    const { valid: validRx, warnings: rxWarnings } = this._validatePrescriptions(rawPrescriptions, context);

    // Check for duplicate orders against existing pending orders
    const duplicateWarnings = this._checkDuplicates(labOrders, imagingOrders, context);

    // Enrich orders with indications and fasting instructions
    const enrichedLabs = labOrders.map(order => this._enrichLabOrder(order, context));
    const enrichedImaging = imagingOrders.map(order => this._enrichImagingOrder(order, context));

    // Build the complete proposed orders package
    const proposedOrders = [
      ...enrichedLabs.map(o => ({ ...o, orderType: 'lab' })),
      ...enrichedImaging.map(o => ({ ...o, orderType: 'imaging' })),
      ...referrals.map(o => ({ ...o, orderType: 'referral' })),
      ...validRx.map(o => ({ ...o, orderType: 'prescription' }))
    ];

    return {
      proposedOrders,
      labOrders: enrichedLabs,
      imagingOrders: enrichedImaging,
      referrals,
      prescriptions: validRx,
      warnings: [...rxWarnings, ...duplicateWarnings],
      counts: {
        labs: enrichedLabs.length,
        imaging: enrichedImaging.length,
        referrals: referrals.length,
        prescriptions: validRx.length,
        warnings: rxWarnings.length + duplicateWarnings.length
      },
      sources: {
        fromScribe: (scribeResult.labOrders || []).length + (scribeResult.imagingOrders || []).length + (scribeResult.medications || []).length,
        fromCDS: (cdsResult.suggestions || []).filter(s =>
          ['lab_order', 'imaging_order', 'referral', 'medication'].includes(s.suggestion_type)
        ).length
      }
    };
  }

  /**
   * Collect lab orders from Scribe extractions and CDS suggestions.
   */
  _collectLabOrders(scribeResult, cdsResult, context) {
    const orders = [];
    const today = new Date().toISOString().split('T')[0];
    const provider = context.encounter?.provider || 'Provider';

    // From Scribe extraction
    for (const lab of (scribeResult.labOrders || [])) {
      orders.push({
        test_name: lab.name,
        cpt_code: lab.cpt,
        order_date: today,
        ordered_by: provider,
        priority: 'routine',
        source: 'scribe_extraction',
        status: 'proposed'
      });
    }

    // From CDS suggestions
    for (const suggestion of (cdsResult.suggestions || [])) {
      if (suggestion.suggestion_type !== 'lab_order' && suggestion.suggestion_type !== 'preventive_care') continue;
      const actions = Array.isArray(suggestion.suggested_action)
        ? suggestion.suggested_action
        : (suggestion.suggested_action?.actions || []);

      for (const action of actions) {
        if (action.type === 'create_lab_order' && action.payload) {
          orders.push({
            test_name: action.payload.test_name || suggestion.title,
            cpt_code: action.payload.cpt_code || '',
            indication: action.payload.indication || suggestion.title,
            icd10_codes: action.payload.icd10_codes || '',
            order_date: today,
            ordered_by: provider,
            priority: action.payload.priority || (suggestion.category === 'urgent' ? 'urgent' : 'routine'),
            source: 'cds_suggestion',
            cds_suggestion_id: suggestion.id,
            status: 'proposed'
          });
        }
      }
    }

    return orders;
  }

  /**
   * Collect imaging orders from Scribe and CDS.
   */
  _collectImagingOrders(scribeResult, cdsResult, context) {
    const orders = [];
    const today = new Date().toISOString().split('T')[0];
    const provider = context.encounter?.provider || 'Provider';

    // From Scribe extraction
    for (const img of (scribeResult.imagingOrders || [])) {
      orders.push({
        study_type: img.study_type || img.name,
        body_part: img.body_part || 'Unspecified',
        order_date: today,
        ordered_by: provider,
        priority: 'routine',
        source: 'scribe_extraction',
        status: 'proposed'
      });
    }

    // From CDS suggestions
    for (const suggestion of (cdsResult.suggestions || [])) {
      if (suggestion.suggestion_type !== 'imaging_order') continue;
      const actions = Array.isArray(suggestion.suggested_action)
        ? suggestion.suggested_action
        : (suggestion.suggested_action?.actions || []);

      for (const action of actions) {
        if (action.type === 'create_imaging_order' && action.payload) {
          orders.push({
            study_type: action.payload.study_type || suggestion.title,
            body_part: action.payload.body_part || 'Unspecified',
            indication: action.payload.indication || suggestion.title,
            order_date: today,
            ordered_by: provider,
            priority: action.payload.priority || 'routine',
            source: 'cds_suggestion',
            status: 'proposed'
          });
        }
      }
    }

    return orders;
  }

  /**
   * Collect referrals from CDS suggestions.
   */
  _collectReferrals(cdsResult, context) {
    const referrals = [];
    const today = new Date().toISOString().split('T')[0];
    const provider = context.encounter?.provider || 'Provider';

    for (const suggestion of (cdsResult.suggestions || [])) {
      if (suggestion.suggestion_type !== 'referral') continue;
      const actions = Array.isArray(suggestion.suggested_action)
        ? suggestion.suggested_action
        : (suggestion.suggested_action?.actions || []);

      for (const action of actions) {
        if (action.type === 'create_referral' && action.payload) {
          referrals.push({
            specialty: action.payload.specialty || 'Unspecified',
            reason: action.payload.reason || suggestion.title,
            urgency: action.payload.urgency || 'routine',
            referred_by: provider,
            referred_date: today,
            source: 'cds_suggestion',
            status: 'proposed'
          });
        }
      }
    }

    return referrals;
  }

  /**
   * Collect prescriptions from Scribe extraction.
   */
  _collectPrescriptions(scribeResult, context) {
    const prescriptions = [];
    const today = new Date().toISOString().split('T')[0];
    const provider = context.encounter?.provider || 'Provider';

    for (const med of (scribeResult.medications || [])) {
      prescriptions.push({
        medication_name: med.name,
        dose: med.dose,
        route: med.route || 'PO',
        frequency: med.frequency || 'daily',
        indication: med.indication || '',
        prescriber: provider,
        prescribed_date: today,
        source: 'scribe_extraction',
        status: 'proposed'
      });
    }

    return prescriptions;
  }

  /**
   * Deduplicate orders by a key field.
   */
  _deduplicateOrders(orders, keyField) {
    const seen = new Map();
    for (const order of orders) {
      const key = (order[keyField] || '').toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, order);
      } else {
        // Prefer CDS source over Scribe (more context-aware)
        const existing = seen.get(key);
        if (order.source === 'cds_suggestion' && existing.source !== 'cds_suggestion') {
          seen.set(key, { ...existing, ...order });
        }
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Validate prescriptions against allergies.
   */
  _validatePrescriptions(prescriptions, context) {
    const allergies = (context.allergies || []).map(a => a.allergen.toLowerCase());
    const valid = [];
    const warnings = [];

    for (const rx of prescriptions) {
      const medLower = rx.medication_name.toLowerCase();
      const allergyMatch = allergies.find(a => medLower.includes(a) || a.includes(medLower));

      if (allergyMatch) {
        warnings.push({
          type: 'allergy_conflict',
          severity: 'high',
          message: `ALLERGY ALERT: ${rx.medication_name} conflicts with documented allergy to ${allergyMatch}`,
          order: rx
        });
      } else {
        valid.push(rx);
      }
    }

    // Check for incomplete prescriptions
    for (const rx of valid) {
      const missing = [];
      if (!rx.dose) missing.push('dose');
      if (!rx.route) missing.push('route');
      if (!rx.frequency) missing.push('frequency');
      if (missing.length > 0) {
        warnings.push({
          type: 'incomplete_prescription',
          severity: 'medium',
          message: `Prescription for ${rx.medication_name} missing: ${missing.join(', ')}`,
          order: rx
        });
      }
    }

    return { valid, warnings };
  }

  /**
   * Check for duplicate orders against existing pending orders.
   */
  _checkDuplicates(proposedLabs, proposedImaging, context) {
    const warnings = [];
    const existingLabOrders = context.labOrders || [];
    const existingImagingOrders = context.imagingOrders || [];

    for (const lab of proposedLabs) {
      const dup = existingLabOrders.find(e =>
        e.status !== 'cancelled' && e.status !== 'completed' &&
        e.test_name && lab.test_name &&
        e.test_name.toLowerCase() === lab.test_name.toLowerCase()
      );
      if (dup) {
        warnings.push({
          type: 'duplicate_order',
          severity: 'medium',
          message: `Duplicate lab order: ${lab.test_name} already ordered on ${dup.order_date} (status: ${dup.status})`,
          order: lab
        });
      }
    }

    for (const img of proposedImaging) {
      const dup = existingImagingOrders.find(e =>
        e.status !== 'cancelled' && e.status !== 'completed' &&
        e.study_type && img.study_type &&
        e.study_type.toLowerCase() === img.study_type.toLowerCase()
      );
      if (dup) {
        warnings.push({
          type: 'duplicate_order',
          severity: 'medium',
          message: `Duplicate imaging order: ${img.study_type} already ordered on ${dup.order_date}`,
          order: img
        });
      }
    }

    return warnings;
  }

  /**
   * Enrich a lab order with indication, fasting instructions, and ICD-10.
   */
  _enrichLabOrder(order, context) {
    const mapping = this.labIndicationMap[order.test_name];
    const enriched = { ...order };

    if (mapping) {
      if (!enriched.indication) enriched.indication = mapping.indication;
      if (!enriched.icd10_codes) {
        // Try to match patient problems to the mapped ICD-10 codes
        const problems = context.problems || [];
        const matchedCode = mapping.icd10.find(code =>
          problems.some(p => p.icd10_code && p.icd10_code.startsWith(code.split('.')[0]))
        );
        enriched.icd10_codes = matchedCode || mapping.icd10[0];
      }
    }

    // Fasting instructions
    if (this.fastingLabs.has(order.test_name)) {
      enriched.fasting_required = true;
      enriched.special_instructions = 'Patient should fast for 8-12 hours before specimen collection. Water is permitted.';
    }

    return enriched;
  }

  /**
   * Enrich imaging order with indication and ICD-10.
   */
  _enrichImagingOrder(order, context) {
    const enriched = { ...order };
    if (!enriched.indication) {
      enriched.indication = context.encounter?.chief_complaint || 'Clinical evaluation';
    }
    return enriched;
  }
}

module.exports = { OrdersAgent };
