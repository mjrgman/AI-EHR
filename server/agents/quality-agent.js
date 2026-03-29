/**
 * Agentic EHR Quality Agent
 * Tracks quality measures (HEDIS/MIPS), identifies care gaps, and monitors compliance.
 *
 * Capabilities:
 *   - MIPS quality measure evaluation (primary care relevant)
 *   - HEDIS measure tracking
 *   - Care gap identification
 *   - Annual wellness visit components
 *   - Immunization status assessment
 *   - Fall risk screening (65+)
 *   - Tobacco use screening & cessation
 *   - Documentation compliance scoring
 *   - Quality dashboard data
 */

const { BaseAgent } = require('./base-agent');

class QualityAgent extends BaseAgent {
  constructor(options = {}) {
    super('quality', {
      description: 'Quality measures — HEDIS/MIPS tracking, care gaps, compliance monitoring',
      dependsOn: ['scribe', 'cds', 'orders', 'coding'],  // Runs last, needs all data
      priority: 50,
      autonomyTier: 2, // Tier 2: Quality reporting — gaps flagged, not auto-ordered
      ...options
    });

    // MIPS Quality Measures relevant to primary care
    this.mipsMeasures = [
      {
        id: 'MIPS-001',
        name: 'Diabetes: Hemoglobin A1c (HbA1c) Poor Control (>9%)',
        measureId: '001',
        description: 'Percentage of patients 18-75 with diabetes whose most recent HbA1c level is >9.0%',
        condition: (ctx) => this._hasDiagnosis(ctx, ['E10', 'E11']),
        evaluate: (ctx) => {
          const a1c = this._getLatestLab(ctx, 'a1c');
          if (!a1c) return { status: 'gap', message: 'No A1C on file', action: 'Order Hemoglobin A1C' };
          const val = parseFloat(a1c.result_value);
          if (isNaN(val)) return { status: 'gap', message: 'A1C result not numeric' };
          if (val > 9) return { status: 'not_met', message: `A1C ${val}% — poor control (>9%)`, action: 'Intensify diabetes management' };
          return { status: 'met', message: `A1C ${val}% — controlled` };
        }
      },
      {
        id: 'MIPS-236',
        name: 'Controlling High Blood Pressure',
        measureId: '236',
        description: 'Percentage of patients 18-85 with hypertension whose BP is <140/90',
        condition: (ctx) => this._hasDiagnosis(ctx, ['I10', 'I11', 'I12', 'I13']),
        evaluate: (ctx) => {
          const vitals = ctx.vitals || {};
          if (!vitals.systolic_bp || !vitals.diastolic_bp) {
            return { status: 'gap', message: 'No blood pressure recorded', action: 'Record blood pressure' };
          }
          if (vitals.systolic_bp < 140 && vitals.diastolic_bp < 90) {
            return { status: 'met', message: `BP ${vitals.systolic_bp}/${vitals.diastolic_bp} — controlled` };
          }
          return { status: 'not_met', message: `BP ${vitals.systolic_bp}/${vitals.diastolic_bp} — not at goal (<140/90)`, action: 'Adjust antihypertensive therapy' };
        }
      },
      {
        id: 'MIPS-226',
        name: 'Preventive Care: Tobacco Use Screening and Cessation',
        measureId: '226',
        description: 'Percentage of patients 18+ screened for tobacco use and, if user, received cessation intervention',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 18,
        evaluate: (ctx) => {
          const transcript = (ctx.encounter?.transcript || '').toLowerCase();
          const hasScreening = /(?:tobacco|smok|cigarette|vap|nicotine)/.test(transcript);
          if (!hasScreening) {
            return { status: 'gap', message: 'No tobacco screening documented', action: 'Screen for tobacco use' };
          }
          const hasCessation = /(?:quit|cessation|counsel|patch|gum|chantix|wellbutrin|varenicline)/.test(transcript);
          const isSmoker = /(?:smokes?|smoking|pack|tobacco\s*use|current\s*smok)/.test(transcript);
          if (isSmoker && !hasCessation) {
            return { status: 'not_met', message: 'Tobacco user — cessation intervention not documented', action: 'Provide cessation counseling or pharmacotherapy' };
          }
          return { status: 'met', message: 'Tobacco screening documented' };
        }
      },
      {
        id: 'MIPS-134',
        name: 'Preventive Care: Screening for Depression (PHQ-9)',
        measureId: '134',
        description: 'Percentage of patients 12+ screened for depression with follow-up plan',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 12,
        evaluate: (ctx) => {
          const transcript = (ctx.encounter?.transcript || '').toLowerCase();
          const labs = ctx.labs || [];
          const hasScreening = /(?:phq|depression\s*screen|beck\s*depression)/.test(transcript) ||
            labs.some(l => l.test_name && l.test_name.toLowerCase().includes('phq'));
          if (!hasScreening) {
            return { status: 'gap', message: 'No depression screening documented', action: 'Administer PHQ-9' };
          }
          return { status: 'met', message: 'Depression screening documented' };
        }
      },
      {
        id: 'MIPS-128',
        name: 'Preventive Care: BMI Screening and Follow-Up',
        measureId: '128',
        description: 'Percentage of patients 18+ with BMI documented and follow-up plan if abnormal',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 18,
        evaluate: (ctx) => {
          const vitals = ctx.vitals || {};
          if (!vitals.weight || !vitals.height) {
            return { status: 'gap', message: 'Height and/or weight not recorded — cannot calculate BMI', action: 'Record height and weight' };
          }
          const bmi = (vitals.weight / (vitals.height * vitals.height)) * 703;
          if (bmi < 18.5 || bmi >= 25) {
            const transcript = (ctx.encounter?.transcript || '').toLowerCase();
            const hasPlan = /(?:diet|exercise|nutrition|weight\s*(?:management|loss)|refer|counseling|bariatric)/.test(transcript);
            if (!hasPlan) {
              return { status: 'not_met', message: `BMI ${bmi.toFixed(1)} — abnormal, no follow-up plan documented`, action: 'Document diet/exercise counseling or weight management plan' };
            }
            return { status: 'met', message: `BMI ${bmi.toFixed(1)} — abnormal with follow-up plan documented` };
          }
          return { status: 'met', message: `BMI ${bmi.toFixed(1)} — normal range` };
        }
      },
      {
        id: 'MIPS-317',
        name: 'Preventive Care: Screening for High Blood Pressure',
        measureId: '317',
        description: 'Percentage of patients 18+ who had blood pressure recorded',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 18,
        evaluate: (ctx) => {
          const vitals = ctx.vitals || {};
          if (!vitals.systolic_bp || !vitals.diastolic_bp) {
            return { status: 'gap', message: 'Blood pressure not recorded', action: 'Record blood pressure' };
          }
          return { status: 'met', message: `BP ${vitals.systolic_bp}/${vitals.diastolic_bp} recorded` };
        }
      },
      {
        id: 'MIPS-318',
        name: 'Falls: Screening for Fall Risk',
        measureId: '318',
        description: 'Percentage of patients 65+ screened for fall risk',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 65,
        evaluate: (ctx) => {
          const transcript = (ctx.encounter?.transcript || '').toLowerCase();
          const hasScreening = /(?:fall|balance|gait|timed\s*up|TUG|morse\s*fall|fall\s*risk)/.test(transcript);
          if (!hasScreening) {
            return { status: 'gap', message: 'No fall risk screening documented for patient 65+', action: 'Perform fall risk assessment' };
          }
          return { status: 'met', message: 'Fall risk screening documented' };
        }
      },
      {
        id: 'MIPS-047',
        name: 'Advance Care Plan',
        measureId: '047',
        description: 'Percentage of patients 65+ with an advance care plan or surrogate decision maker documented',
        condition: (ctx) => this._age(ctx.patient?.dob) >= 65,
        evaluate: (ctx) => {
          const transcript = (ctx.encounter?.transcript || '').toLowerCase();
          const hasACP = /(?:advance\s*(?:care|directive)|living\s*will|health\s*care\s*proxy|power\s*of\s*attorney|code\s*status|DNR|POLST|surrogate)/.test(transcript);
          if (!hasACP) {
            return { status: 'gap', message: 'No advance care planning documented for patient 65+', action: 'Discuss advance care planning' };
          }
          return { status: 'met', message: 'Advance care planning documented' };
        }
      }
    ];

    // Immunization schedule (adult)
    this.immunizations = [
      { name: 'Influenza', condition: (p) => this._age(p.dob) >= 6, intervalMonths: 12, season: true },
      { name: 'COVID-19', condition: (p) => this._age(p.dob) >= 6, intervalMonths: 12 },
      { name: 'Tdap/Td', condition: (p) => this._age(p.dob) >= 19, intervalMonths: 120 },  // Every 10 years
      { name: 'Shingles (Shingrix)', condition: (p) => this._age(p.dob) >= 50, intervalMonths: 0 },  // 2-dose series
      { name: 'Pneumococcal (PCV20)', condition: (p) => this._age(p.dob) >= 65, intervalMonths: 0 },  // Once
      { name: 'Hepatitis B', condition: (p) => this._age(p.dob) >= 19 && this._age(p.dob) <= 59, intervalMonths: 0 }
    ];
  }

  /**
   * @param {PatientContext} context
   * @param {Object} agentResults
   * @returns {Promise<QualityResult>}
   */
  async process(context, agentResults = {}) {
    const codingResult = agentResults.coding?.result || {};

    // 1. Evaluate MIPS measures
    const measureResults = this._evaluateMIPSMeasures(context);

    // 2. Identify care gaps
    const gaps = measureResults.filter(m => m.status === 'gap' || m.status === 'not_met');

    // 3. Check immunization status
    const immunizationGaps = this._checkImmunizations(context);

    // 4. AWV components (if annual wellness visit)
    const awvComponents = this._checkAWVComponents(context);

    // 5. Documentation compliance
    const complianceChecks = this._checkDocumentationCompliance(context, codingResult);

    // 6. Build quality dashboard data
    const dashboard = this._buildDashboard(measureResults, gaps, immunizationGaps, complianceChecks);

    return {
      measures: measureResults,
      gaps,
      immunizationGaps,
      awvComponents,
      complianceChecks,
      dashboard,
      counts: {
        measuresEvaluated: measureResults.length,
        measuresMet: measureResults.filter(m => m.status === 'met').length,
        measuresNotMet: measureResults.filter(m => m.status === 'not_met').length,
        careGaps: gaps.length,
        immunizationGaps: immunizationGaps.length,
        complianceIssues: complianceChecks.filter(c => !c.passed).length
      },
      qualityScore: this._calculateQualityScore(measureResults)
    };
  }

  /**
   * Evaluate all applicable MIPS measures for this patient.
   */
  _evaluateMIPSMeasures(context) {
    const results = [];

    for (const measure of this.mipsMeasures) {
      if (!measure.condition(context)) continue;

      const evaluation = measure.evaluate(context);
      results.push({
        measureId: measure.id,
        measureName: measure.name,
        description: measure.description,
        status: evaluation.status,
        message: evaluation.message,
        suggestedAction: evaluation.action || null
      });
    }

    return results;
  }

  /**
   * Check immunization status.
   */
  _checkImmunizations(context) {
    const patient = context.patient;
    if (!patient || !patient.dob) return [];

    const gaps = [];
    // Note: In a real system, this would check an immunization history table.
    // For now, we flag reminders based on age criteria.
    for (const vaccine of this.immunizations) {
      if (!vaccine.condition(patient)) continue;

      gaps.push({
        vaccine: vaccine.name,
        status: 'review_needed',
        message: `${vaccine.name} — verify immunization status for ${this._age(patient.dob)}yo patient`,
        action: `Review ${vaccine.name} immunization history`
      });
    }

    return gaps;
  }

  /**
   * Check AWV (Annual Wellness Visit) components if applicable.
   */
  _checkAWVComponents(context) {
    const encounterType = (context.encounter?.encounter_type || '').toLowerCase();
    if (!encounterType.includes('wellness') && !encounterType.includes('awv') && !encounterType.includes('annual')) {
      return { applicable: false, components: [] };
    }

    const transcript = (context.encounter?.transcript || '').toLowerCase();
    const vitals = context.vitals || {};

    const components = [
      {
        name: 'Health Risk Assessment',
        required: true,
        documented: /(?:health\s*risk|hra|questionnaire)/.test(transcript),
        action: 'Complete Health Risk Assessment questionnaire'
      },
      {
        name: 'Medical/Family History Update',
        required: true,
        documented: /(?:family\s*history|medical\s*history|past\s*medical)/.test(transcript),
        action: 'Update medical and family history'
      },
      {
        name: 'Depression Screening',
        required: true,
        documented: /(?:phq|depression\s*screen)/.test(transcript),
        action: 'Administer PHQ-2/PHQ-9'
      },
      {
        name: 'Cognitive Assessment',
        required: this._age(context.patient?.dob) >= 65,
        documented: /(?:cognitive|memory|mini.?mental|mmse|moca|clock\s*draw)/.test(transcript),
        action: 'Perform cognitive assessment (Mini-Cog or similar)'
      },
      {
        name: 'Fall Risk Assessment',
        required: this._age(context.patient?.dob) >= 65,
        documented: /(?:fall|balance|gait|timed\s*up)/.test(transcript),
        action: 'Perform fall risk assessment'
      },
      {
        name: 'BMI Documented',
        required: true,
        documented: !!(vitals.weight && vitals.height),
        action: 'Record height and weight'
      },
      {
        name: 'Blood Pressure',
        required: true,
        documented: !!(vitals.systolic_bp && vitals.diastolic_bp),
        action: 'Record blood pressure'
      },
      {
        name: 'Visual Acuity Screening',
        required: true,
        documented: /(?:visual\s*acuity|vision\s*screen|snellen)/.test(transcript),
        action: 'Perform visual acuity screening'
      },
      {
        name: 'Written Screening Schedule / Prevention Plan',
        required: true,
        documented: /(?:screening\s*schedule|prevention\s*plan|health\s*maintenance)/.test(transcript),
        action: 'Provide written screening schedule and prevention plan'
      }
    ];

    const applicable = components.filter(c => c.required);
    const complete = applicable.filter(c => c.documented).length;

    return {
      applicable: true,
      components: applicable,
      completeness: {
        complete,
        total: applicable.length,
        percentage: Math.round((complete / applicable.length) * 100)
      },
      missingComponents: applicable.filter(c => !c.documented)
    };
  }

  /**
   * Check documentation compliance.
   */
  _checkDocumentationCompliance(context, codingResult) {
    const checks = [];

    // Check that assessment matches coding
    const icd10Count = (codingResult.icd10Codes || []).length;
    if (icd10Count === 0) {
      checks.push({
        name: 'Diagnosis Coding',
        passed: false,
        message: 'No ICD-10 codes documented — at least one diagnosis required for billing'
      });
    } else {
      checks.push({ name: 'Diagnosis Coding', passed: true, message: `${icd10Count} ICD-10 code(s) documented` });
    }

    // Check E&M level documentation support
    const emLevel = codingResult.emLevel || 0;
    const completeness = codingResult.completenessScore || 0;
    if (emLevel >= 4 && completeness < 70) {
      checks.push({
        name: 'E&M Documentation Support',
        passed: false,
        message: `Level ${emLevel} E&M selected but documentation completeness is only ${completeness}%. Consider strengthening documentation.`
      });
    } else if (emLevel > 0) {
      checks.push({ name: 'E&M Documentation Support', passed: true, message: `Level ${emLevel} supported by documentation (${completeness}% complete)` });
    }

    // Signature / attestation
    const encounterStatus = context.encounter?.status;
    checks.push({
      name: 'Note Signed',
      passed: encounterStatus === 'signed',
      message: encounterStatus === 'signed' ? 'Note is signed' : `Note status: ${encounterStatus || 'unknown'} — signature required`
    });

    // Time documentation for time-based coding
    if (codingResult.codingMethod === 'time-based' && !context.encounter?.duration_minutes) {
      checks.push({
        name: 'Time Documentation',
        passed: false,
        message: 'Time-based coding selected but encounter duration not documented'
      });
    }

    return checks;
  }

  /**
   * Build quality dashboard data.
   */
  _buildDashboard(measures, gaps, immunizationGaps, complianceChecks) {
    const totalMeasures = measures.length;
    const met = measures.filter(m => m.status === 'met').length;
    const compliancePassed = complianceChecks.filter(c => c.passed).length;

    return {
      qualityScore: totalMeasures > 0 ? Math.round((met / totalMeasures) * 100) : 0,
      measuresAtGoal: `${met}/${totalMeasures}`,
      openCareGaps: gaps.length,
      immunizationReviewNeeded: immunizationGaps.length,
      complianceScore: complianceChecks.length > 0
        ? Math.round((compliancePassed / complianceChecks.length) * 100)
        : 100,
      topActions: gaps.slice(0, 3).map(g => ({
        measure: g.measureName,
        action: g.suggestedAction
      }))
    };
  }

  /**
   * Calculate overall quality score.
   */
  _calculateQualityScore(measures) {
    if (measures.length === 0) return { score: 100, label: 'N/A' };
    const met = measures.filter(m => m.status === 'met').length;
    const score = Math.round((met / measures.length) * 100);
    let label = 'Exceptional';
    if (score < 90) label = 'Good';
    if (score < 75) label = 'Needs Improvement';
    if (score < 50) label = 'Below Threshold';
    return { score, label, met, total: measures.length };
  }

  _hasDiagnosis(ctx, prefixes) {
    return (ctx.problems || []).some(p =>
      p.icd10_code && prefixes.some(prefix => p.icd10_code.startsWith(prefix))
    );
  }

  _getLatestLab(ctx, keyword) {
    return (ctx.labs || [])
      .filter(l => l.test_name && l.test_name.toLowerCase().includes(keyword))
      .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))[0] || null;
  }

  _age(dob) {
    if (!dob) return 0;
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }
}

module.exports = { QualityAgent };
