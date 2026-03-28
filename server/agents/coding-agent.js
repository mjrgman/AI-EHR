/**
 * Agentic EHR Coding/Billing Agent
 * Determines E&M level, maps ICD-10 codes, and validates documentation completeness.
 *
 * Capabilities:
 *   - E&M level calculation (2021 MDM-based guidelines)
 *   - ICD-10 code validation and specificity checking
 *   - Documentation completeness scoring
 *   - Missing documentation element identification
 *   - Time-based coding support
 *   - Modifier suggestions (25, 59, etc.)
 *   - Risk adjustment (HCC) flagging
 *
 * Uses 2021 E&M guidelines (MDM-based, not 1995/1997 component counting):
 *   Level 2 (99212/99202): Straightforward MDM
 *   Level 3 (99213/99203): Low MDM
 *   Level 4 (99214/99204): Moderate MDM
 *   Level 5 (99215/99205): High MDM
 */

const { BaseAgent } = require('./base-agent');

class CodingAgent extends BaseAgent {
  constructor(options = {}) {
    super('coding', {
      description: 'Coding & billing — E&M level, ICD-10 mapping, documentation completeness',
      dependsOn: ['scribe', 'cds'],  // Needs documentation + clinical suggestions
      priority: 30,
      autonomyTier: 2, // Tier 2: Billing codes reviewed by billing specialist
      ...options
    });

    // HCC-relevant ICD-10 prefixes (CMS-HCC v28 — partial list for primary care)
    this.hccCodes = new Map([
      ['E10', { hcc: 19, description: 'Diabetes Type 1' }],
      ['E11', { hcc: 19, description: 'Diabetes Type 2' }],
      ['I50', { hcc: 85, description: 'Heart Failure' }],
      ['J44', { hcc: 111, description: 'COPD' }],
      ['N18.3', { hcc: 138, description: 'CKD Stage 3' }],
      ['N18.4', { hcc: 137, description: 'CKD Stage 4' }],
      ['N18.5', { hcc: 136, description: 'CKD Stage 5' }],
      ['I48', { hcc: 96, description: 'Atrial Fibrillation' }],
      ['F32', { hcc: 155, description: 'Major Depressive Disorder' }],
      ['F33', { hcc: 155, description: 'Recurrent Major Depression' }],
      ['I25', { hcc: 87, description: 'Chronic Ischemic Heart Disease' }],
      ['G62', { hcc: 75, description: 'Peripheral Neuropathy' }],
      ['E66', { hcc: 48, description: 'Morbid Obesity' }],  // E66.01 specifically
      ['I10', { hcc: null, description: 'Hypertension (not HCC-relevant, but common)' }],
    ]);

    // E&M CPT code mapping
    this.emCodes = {
      new: { 2: '99202', 3: '99203', 4: '99204', 5: '99205' },
      established: { 2: '99212', 3: '99213', 4: '99214', 5: '99215' }
    };

    // Time-based thresholds (2021 guidelines, total time on date of encounter)
    this.timeThresholds = {
      new: { 2: 15, 3: 30, 4: 45, 5: 60 },
      established: { 2: 10, 3: 20, 4: 30, 5: 40 }
    };
  }

  /**
   * @param {PatientContext} context
   * @param {Object} agentResults
   * @returns {Promise<CodingResult>}
   */
  async process(context, agentResults = {}) {
    const scribeResult = agentResults.scribe?.result || {};
    const cdsResult = agentResults.cds?.result || {};
    const encounter = context.encounter || {};

    // 1. Determine E&M level via MDM
    const mdmAssessment = this._assessMDM(context, scribeResult, cdsResult);

    // 2. Check if time-based coding would yield a higher level
    const timeBasedLevel = this._assessTimeBased(encounter);

    // 3. Use the higher of MDM vs time-based
    const isNewPatient = (encounter.encounter_type || '').toLowerCase().includes('new');
    const patientType = isNewPatient ? 'new' : 'established';
    const finalLevel = Math.max(mdmAssessment.level, timeBasedLevel.level);
    const cptCode = this.emCodes[patientType][finalLevel] || this.emCodes.established[3];
    const codingMethod = finalLevel === timeBasedLevel.level && timeBasedLevel.level > mdmAssessment.level
      ? 'time-based' : 'mdm-based';

    // 3. Map and validate ICD-10 codes
    const icd10Codes = this._mapICD10Codes(context, scribeResult);

    // 4. Flag HCC-relevant codes
    const hccFlags = this._flagHCCCodes(icd10Codes);

    // 5. Assess documentation completeness
    const completeness = this._assessDocumentationCompleteness(scribeResult, context);

    // 6. Check for modifier opportunities
    const modifiers = this._checkModifiers(context, scribeResult, cdsResult);

    // 7. Identify missing elements
    const missingElements = this._identifyMissingElements(scribeResult, context, finalLevel);

    return {
      emLevel: finalLevel,
      cptCode,
      patientType,
      codingMethod,
      mdmAssessment,
      timeBasedLevel,
      icd10Codes,
      hccFlags,
      completenessScore: completeness.score,
      completeness,
      modifiers,
      missingElements,
      codingSummary: {
        primaryDx: icd10Codes[0] || null,
        additionalDx: icd10Codes.slice(1),
        emCode: `${cptCode} (Level ${finalLevel}, ${patientType} patient, ${codingMethod})`,
        hccCount: hccFlags.length,
        documentationLevel: completeness.level,
        warnings: missingElements.length > 0
          ? `${missingElements.length} documentation gap(s) identified`
          : 'Documentation appears complete for selected E&M level'
      }
    };
  }

  /**
   * Assess Medical Decision Making (2021 guidelines).
   * MDM has 3 elements — must meet 2 of 3:
   *   1. Number and Complexity of Problems
   *   2. Amount and/or Complexity of Data Reviewed
   *   3. Risk of Complications / Morbidity / Mortality
   */
  _assessMDM(context, scribeResult, cdsResult) {
    // --- Element 1: Number & Complexity of Problems ---
    const problems = context.problems || [];
    const activeProblems = problems.filter(p => p.status === 'active' || p.status === 'chronic');
    const extractedProblems = scribeResult.problems || [];
    const allProblems = [...new Set([...activeProblems.map(p => p.icd10_code), ...extractedProblems.map(p => p.code)])].filter(Boolean);

    let problemComplexity = 1; // minimal
    const hasChronicWithExacerbation = activeProblems.some(p =>
      p.status === 'chronic' && (context.encounter?.transcript || '').toLowerCase().includes('worsen')
    );
    const hasNewProblem = extractedProblems.length > 0;
    const hasAcuteProblem = (cdsResult.suggestions || []).some(s => s.category === 'urgent');

    if (hasAcuteProblem || (allProblems.length >= 3 && hasChronicWithExacerbation)) {
      problemComplexity = 4; // high
    } else if (allProblems.length >= 2 || hasChronicWithExacerbation || hasNewProblem) {
      problemComplexity = 3; // moderate
    } else if (allProblems.length >= 1) {
      problemComplexity = 2; // low
    }

    // --- Element 2: Data Reviewed ---
    const labs = context.labs || [];
    const medications = context.medications || [];
    const orderedLabs = (scribeResult.labOrders || []).length;
    const orderedImaging = (scribeResult.imagingOrders || []).length;
    const recentLabs = labs.filter(l => {
      const d = new Date(l.result_date);
      const now = new Date();
      return (now - d) / (1000 * 60 * 60 * 24) <= 90;
    }).length;

    let dataComplexity = 1;
    if (orderedLabs + orderedImaging >= 3 || recentLabs >= 5) {
      dataComplexity = 4; // extensive
    } else if (orderedLabs + orderedImaging >= 2 || recentLabs >= 3) {
      dataComplexity = 3; // moderate
    } else if (orderedLabs + orderedImaging >= 1 || recentLabs >= 1) {
      dataComplexity = 2; // limited
    }

    // --- Element 3: Risk ---
    const urgentAlerts = (cdsResult.suggestions || []).filter(s => s.category === 'urgent').length;
    const prescribedControlled = false; // Would need DEA schedule data
    const hasDrugInteraction = (cdsResult.suggestions || []).some(s => s.suggestion_type === 'interaction_alert');

    let riskLevel = 1;
    if (urgentAlerts >= 2 || hasDrugInteraction) {
      riskLevel = 4; // high
    } else if (urgentAlerts >= 1 || medications.length >= 5 || orderedLabs >= 2) {
      riskLevel = 3; // moderate
    } else if (medications.length >= 1 || orderedLabs >= 1) {
      riskLevel = 2; // low
    }

    // MDM level = 2 of 3 elements (sort and take the middle)
    const elements = [problemComplexity, dataComplexity, riskLevel].sort((a, b) => a - b);
    const mdmLevel = Math.max(2, Math.min(5, elements[1])); // Middle value, clamped to 2-5

    return {
      level: mdmLevel,
      problemComplexity: { score: problemComplexity, activeCount: activeProblems.length, totalIcd10: allProblems.length },
      dataComplexity: { score: dataComplexity, labsReviewed: recentLabs, ordersPlaced: orderedLabs + orderedImaging },
      riskLevel: { score: riskLevel, urgentAlerts, hasDrugInteraction },
      elements: { problems: problemComplexity, data: dataComplexity, risk: riskLevel },
      levelLabels: {
        [problemComplexity]: this._complexityLabel(problemComplexity),
        [dataComplexity]: this._complexityLabel(dataComplexity),
        [riskLevel]: this._complexityLabel(riskLevel)
      }
    };
  }

  /**
   * Assess time-based coding.
   */
  _assessTimeBased(encounter) {
    const duration = encounter.duration_minutes || 0;
    if (duration === 0) return { level: 0, duration: 0, method: 'not_applicable' };

    const isNew = (encounter.encounter_type || '').toLowerCase().includes('new');
    const thresholds = isNew ? this.timeThresholds.new : this.timeThresholds.established;

    let level = 2;
    for (const [lvl, minutes] of Object.entries(thresholds).sort((a, b) => b[1] - a[1])) {
      if (duration >= minutes) {
        level = parseInt(lvl);
        break;
      }
    }

    return { level, duration, method: 'time_based' };
  }

  /**
   * Map ICD-10 codes from problems and Scribe extraction.
   */
  _mapICD10Codes(context, scribeResult) {
    const codes = [];
    const seen = new Set();

    // Chief complaint / primary diagnosis first
    const extractedProblems = scribeResult.problems || [];
    for (const p of extractedProblems) {
      if (p.code && !seen.has(p.code)) {
        seen.add(p.code);
        codes.push({
          code: p.code,
          description: p.name,
          source: 'encounter_extraction',
          isPrimary: codes.length === 0,
          specificity: this._checkSpecificity(p.code)
        });
      }
    }

    // Active problems from patient chart
    const activeProblems = (context.problems || []).filter(p => p.status === 'active' || p.status === 'chronic');
    for (const p of activeProblems) {
      if (p.icd10_code && !seen.has(p.icd10_code)) {
        seen.add(p.icd10_code);
        codes.push({
          code: p.icd10_code,
          description: p.problem_name || p.name,
          source: 'problem_list',
          isPrimary: codes.length === 0,
          specificity: this._checkSpecificity(p.icd10_code)
        });
      }
    }

    return codes;
  }

  /**
   * Check ICD-10 code specificity.
   */
  _checkSpecificity(code) {
    if (!code) return 'missing';
    // Codes ending in .9 or without a decimal are often unspecified
    if (code.endsWith('.9') || code.endsWith('.90') || code.endsWith('.99')) return 'unspecified';
    if (!code.includes('.')) return 'unspecified';
    if (code.split('.')[1].length >= 2) return 'specific';
    return 'moderate';
  }

  /**
   * Flag HCC-relevant codes for risk adjustment.
   */
  _flagHCCCodes(icd10Codes) {
    const flags = [];
    for (const dx of icd10Codes) {
      for (const [prefix, hccInfo] of this.hccCodes) {
        if (dx.code && dx.code.startsWith(prefix) && hccInfo.hcc !== null) {
          flags.push({
            code: dx.code,
            description: dx.description,
            hccCategory: hccInfo.hcc,
            hccDescription: hccInfo.description,
            message: `HCC ${hccInfo.hcc}: ${hccInfo.description} — ensure documentation supports this diagnosis for risk adjustment`
          });
          break;
        }
      }
    }
    return flags;
  }

  /**
   * Assess documentation completeness for the selected E&M level.
   */
  _assessDocumentationCompleteness(scribeResult, context) {
    const checks = {
      chiefComplaint: !!(context.encounter?.chief_complaint || scribeResult.chiefComplaint),
      hpiPresent: !!(scribeResult.soapNote && scribeResult.soapNote.includes('HPI')),
      rosDocumented: Object.keys(scribeResult.ros || {}).length >= 1,
      rosAdequate: Object.keys(scribeResult.ros || {}).length >= 2,
      vitalsSigned: Object.keys(scribeResult.vitals || {}).length >= 3,
      peDocumented: Object.keys(scribeResult.physicalExam || {}).length >= 1,
      peAdequate: Object.keys(scribeResult.physicalExam || {}).length >= 2,
      assessmentPresent: (scribeResult.problems || []).length > 0 || (context.problems || []).length > 0,
      planDocumented: (scribeResult.labOrders || []).length > 0 || (scribeResult.medications || []).length > 0,
      soapNoteGenerated: !!scribeResult.soapNote
    };

    const score = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;

    return {
      score,
      total,
      percentage: Math.round((score / total) * 100),
      checks,
      level: score >= 9 ? 'excellent' : score >= 7 ? 'good' : score >= 5 ? 'adequate' : 'insufficient'
    };
  }

  /**
   * Check for applicable modifiers.
   */
  _checkModifiers(context, scribeResult, cdsResult) {
    const modifiers = [];

    // Modifier 25: Significant, separately identifiable E&M service
    // If procedures were done during the visit
    const transcript = (context.encounter?.transcript || '').toLowerCase();
    const procedureKeywords = ['injection', 'excision', 'biopsy', 'laceration', 'splint', 'cast', 'I&D', 'incision and drainage'];
    if (procedureKeywords.some(kw => transcript.includes(kw))) {
      modifiers.push({
        modifier: '25',
        description: 'Significant, separately identifiable E&M service on the same day as a procedure',
        rationale: 'Procedure keywords detected in transcript — verify if separate E&M documentation is warranted'
      });
    }

    return modifiers;
  }

  /**
   * Identify missing documentation elements for the selected E&M level.
   */
  _identifyMissingElements(scribeResult, context, emLevel) {
    const missing = [];

    if (!context.encounter?.chief_complaint && !scribeResult.chiefComplaint) {
      missing.push({ element: 'Chief Complaint', severity: 'high', message: 'Chief complaint is required for all E&M levels' });
    }

    if (emLevel >= 3 && Object.keys(scribeResult.ros || {}).length < 2) {
      missing.push({ element: 'Review of Systems', severity: 'medium', message: 'ROS with 2+ systems recommended for Level 3+' });
    }

    if (emLevel >= 4 && Object.keys(scribeResult.physicalExam || {}).length < 2) {
      missing.push({ element: 'Physical Examination', severity: 'medium', message: 'PE with 2+ systems recommended for Level 4+' });
    }

    if ((scribeResult.problems || []).length === 0 && (context.problems || []).length === 0) {
      missing.push({ element: 'Assessment/Diagnoses', severity: 'high', message: 'At least one diagnosis is required' });
    }

    if ((scribeResult.labOrders || []).length === 0 && (scribeResult.medications || []).length === 0) {
      missing.push({ element: 'Plan', severity: 'medium', message: 'Plan should include at least one action item (order, prescription, follow-up)' });
    }

    const icd10s = [...(scribeResult.problems || []).map(p => p.code), ...(context.problems || []).map(p => p.icd10_code)].filter(Boolean);
    const unspecified = icd10s.filter(c => c.endsWith('.9') || !c.includes('.'));
    if (unspecified.length > 0) {
      missing.push({
        element: 'ICD-10 Specificity',
        severity: 'low',
        message: `${unspecified.length} diagnosis code(s) are unspecified (.9). Consider more specific codes for accurate risk adjustment.`,
        codes: unspecified
      });
    }

    return missing;
  }

  _complexityLabel(score) {
    switch (score) {
      case 1: return 'Minimal';
      case 2: return 'Straightforward / Low';
      case 3: return 'Low / Moderate';
      case 4: return 'Moderate / High';
      case 5: return 'High';
      default: return 'Unknown';
    }
  }
}

module.exports = { CodingAgent };
