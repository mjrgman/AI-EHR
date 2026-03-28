/**
 * Agentic EHR Clinical Decision Support Agent
 * Evaluates clinical rules, generates alerts, and provides evidence-based suggestions.
 *
 * Capabilities:
 *   - Vital sign alerts (hypertension, tachycardia, fever, hypoxia)
 *   - Lab result alerts (abnormal values, overdue screenings)
 *   - Drug-allergy and drug-interaction checks
 *   - Differential diagnosis suggestions
 *   - Preventive care / screening reminders
 *   - Age/sex-appropriate screening recommendations
 *   - Provider preference learning
 *
 * Wraps and extends the existing cds-engine.js functionality.
 */

const { BaseAgent } = require('./base-agent');
const cdsEngine = require('../cds-engine');

class CDSAgent extends BaseAgent {
  constructor(options = {}) {
    super('cds', {
      description: 'Clinical decision support — alerts, drug interactions, differentials, preventive care',
      dependsOn: [],         // CDS runs in parallel with Scribe (Phase 1)
      priority: 10,
      autonomyTier: 2, // Tier 2: Supervised — recommendations reviewed, not auto-executed
      ...options
    });

    // Age/sex screening guidelines (USPSTF-aligned)
    this.screeningGuidelines = [
      {
        name: 'Colorectal Cancer Screening',
        condition: (p) => this._age(p.dob) >= 45,
        testNames: ['FIT', 'Cologuard', 'Colonoscopy'],
        intervalMonths: 12,  // FIT annually (colonoscopy 120 months handled separately)
        evidence: 'USPSTF Grade A: Screen adults 45-75 for colorectal cancer',
        icd10: 'Z12.11'
      },
      {
        name: 'Breast Cancer Screening (Mammography)',
        condition: (p) => p.sex === 'F' && this._age(p.dob) >= 40,
        testNames: ['Mammogram', 'Mammography'],
        intervalMonths: 24,
        evidence: 'USPSTF Grade B: Biennial mammography for women 40-74',
        icd10: 'Z12.31'
      },
      {
        name: 'Cervical Cancer Screening',
        condition: (p) => p.sex === 'F' && this._age(p.dob) >= 21 && this._age(p.dob) <= 65,
        testNames: ['Pap Smear', 'HPV Test', 'Cervical Cytology'],
        intervalMonths: 36,
        evidence: 'USPSTF Grade A: Screen women 21-65 with cytology every 3 years',
        icd10: 'Z12.4'
      },
      {
        name: 'Lipid Panel Screening',
        condition: (p) => this._age(p.dob) >= 40,
        testNames: ['Lipid Panel'],
        intervalMonths: 60,
        evidence: 'USPSTF: Statin use for adults 40-75 with CVD risk factors',
        icd10: 'Z13.220'
      },
      {
        name: 'Diabetes Screening (A1C)',
        condition: (p) => this._age(p.dob) >= 35,
        testNames: ['Hemoglobin A1C', 'Fasting Glucose', 'Glucose Tolerance'],
        intervalMonths: 36,
        evidence: 'USPSTF Grade B: Screen for prediabetes/T2DM in adults 35-70 with overweight/obesity',
        icd10: 'Z13.1'
      },
      {
        name: 'Depression Screening (PHQ-9)',
        condition: (p) => this._age(p.dob) >= 12,
        testNames: ['PHQ-9', 'PHQ-2', 'Depression Screening'],
        intervalMonths: 12,
        evidence: 'USPSTF Grade B: Screen for depression in the general adult population',
        icd10: 'Z13.31'
      },
      {
        name: 'Lung Cancer Screening (Low-Dose CT)',
        condition: (p) => this._age(p.dob) >= 50 && this._age(p.dob) <= 80,
        testNames: ['Low-Dose CT Chest', 'LDCT'],
        intervalMonths: 12,
        evidence: 'USPSTF Grade B: Annual LDCT for adults 50-80 with 20+ pack-year smoking history',
        icd10: 'Z87.891'  // Note: requires smoking history confirmation
      },
      {
        name: 'AAA Screening',
        condition: (p) => p.sex === 'M' && this._age(p.dob) >= 65 && this._age(p.dob) <= 75,
        testNames: ['Abdominal Aorta Ultrasound', 'AAA Screening'],
        intervalMonths: 0,  // One-time screening
        evidence: 'USPSTF Grade B: One-time screening for AAA in men 65-75 who have ever smoked',
        icd10: 'Z13.6'
      },
      {
        name: 'Hepatitis C Screening',
        condition: (p) => this._age(p.dob) >= 18 && this._age(p.dob) <= 79,
        testNames: ['Hepatitis C Antibody', 'HCV Ab'],
        intervalMonths: 0,  // One-time
        evidence: 'USPSTF Grade B: Screen adults 18-79 for HCV',
        icd10: 'Z11.59'
      },
      {
        name: 'HIV Screening',
        condition: (p) => this._age(p.dob) >= 15 && this._age(p.dob) <= 65,
        testNames: ['HIV Test', 'HIV 1/2 Antigen/Antibody'],
        intervalMonths: 0,  // One-time unless high risk
        evidence: 'USPSTF Grade A: Screen adolescents and adults 15-65 for HIV',
        icd10: 'Z11.4'
      },
      {
        name: 'Osteoporosis Screening (DEXA)',
        condition: (p) => p.sex === 'F' && this._age(p.dob) >= 65,
        testNames: ['DEXA Scan', 'Bone Density'],
        intervalMonths: 24,
        evidence: 'USPSTF Grade B: Screen women 65+ for osteoporosis with bone measurement testing',
        icd10: 'Z13.820'
      }
    ];
  }

  /**
   * @param {PatientContext} context
   * @param {Object} agentResults
   * @returns {Promise<CDSResult>}
   */
  async process(context, agentResults = {}) {
    const suggestions = [];

    // 1. Run the existing CDS rule engine
    let ruleSuggestions = [];
    try {
      ruleSuggestions = await cdsEngine.evaluatePatientContext(
        context.encounter?.id,
        context.patient?.id,
        {
          vitals: context.vitals || {},
          labs: context.labs || [],
          medications: context.medications || [],
          allergies: context.allergies || [],
          problems: context.problems || [],
          chiefComplaint: context.encounter?.chief_complaint || '',
          transcript: context.encounter?.transcript || ''
        }
      );
      suggestions.push(...ruleSuggestions);
    } catch (err) {
      console.error('CDS rule engine error:', err.message);
    }

    // 2. Age/sex-appropriate screening recommendations
    const screeningGaps = this._evaluateScreenings(context);
    suggestions.push(...screeningGaps);

    // 3. Medication reconciliation alerts
    const medAlerts = this._checkMedicationReconciliation(context);
    suggestions.push(...medAlerts);

    // 4. Chronic disease management reminders
    const chronicReminders = this._checkChronicDiseaseManagement(context);
    suggestions.push(...chronicReminders);

    // 5. BMI-based alerts
    const bmiAlerts = this._checkBMI(context);
    suggestions.push(...bmiAlerts);

    // Deduplicate
    const seen = new Set();
    const unique = suggestions.filter(s => {
      if (seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    });

    // Sort by priority
    unique.sort((a, b) => (a.priority || 50) - (b.priority || 50));

    // Categorize
    const byCategory = {
      urgent: unique.filter(s => s.category === 'urgent'),
      routine: unique.filter(s => s.category === 'routine'),
      preventive: unique.filter(s => s.category === 'preventive' || s.suggestion_type === 'preventive_care'),
      informational: unique.filter(s => s.category === 'informational')
    };

    return {
      suggestions: unique,
      byCategory,
      counts: {
        total: unique.length,
        urgent: byCategory.urgent.length,
        routine: byCategory.routine.length,
        preventive: byCategory.preventive.length,
        informational: byCategory.informational.length
      },
      ruleEngineResults: ruleSuggestions.length,
      screeningGapsFound: screeningGaps.length
    };
  }

  /**
   * Evaluate age/sex screening guidelines.
   */
  _evaluateScreenings(context) {
    const patient = context.patient;
    if (!patient || !patient.dob) return [];

    const suggestions = [];
    const labs = context.labs || [];

    for (const guideline of this.screeningGuidelines) {
      if (!guideline.condition(patient)) continue;

      // Check if screening has been done within interval
      const matchingLab = labs
        .filter(l => guideline.testNames.some(t =>
          l.test_name && l.test_name.toLowerCase().includes(t.toLowerCase())
        ))
        .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))[0];

      const isDue = !matchingLab ||
        (guideline.intervalMonths > 0 && this._monthsSince(matchingLab.result_date) >= guideline.intervalMonths);

      if (isDue) {
        suggestions.push({
          suggestion_type: 'preventive_care',
          category: 'preventive',
          priority: 40,
          title: `${guideline.name} Due`,
          description: matchingLab
            ? `Last ${guideline.testNames[0]}: ${matchingLab.result_date}. ${guideline.evidence}`
            : `No prior ${guideline.testNames[0]} on file. ${guideline.evidence}`,
          rationale: guideline.evidence,
          suggested_action: [{
            type: 'create_lab_order',
            description: `Order ${guideline.testNames[0]}`,
            payload: {
              test_name: guideline.testNames[0],
              indication: guideline.name,
              icd10_codes: guideline.icd10,
              priority: 'routine'
            }
          }],
          source: 'screening_agent'
        });
      }
    }

    return suggestions;
  }

  /**
   * Check for medication reconciliation issues.
   */
  _checkMedicationReconciliation(context) {
    const meds = context.medications || [];
    const problems = context.problems || [];
    const suggestions = [];

    // Check for medications without matching active problems
    const problemCodes = new Set(problems.filter(p => p.status !== 'resolved').map(p => p.icd10_code));

    // Diabetes meds without diabetes diagnosis
    const diabetesMeds = ['metformin', 'glipizide', 'glimepiride', 'insulin', 'ozempic', 'trulicity', 'jardiance', 'farxiga'];
    const onDiabetesMed = meds.some(m => m.status === 'active' && diabetesMeds.some(d => m.medication_name.toLowerCase().includes(d)));
    const hasDiabetes = [...problemCodes].some(c => c && (c.startsWith('E10') || c.startsWith('E11') || c.startsWith('E13')));

    if (onDiabetesMed && !hasDiabetes) {
      suggestions.push({
        suggestion_type: 'medication',
        category: 'routine',
        priority: 30,
        title: 'Diabetes Medication Without Active Diagnosis',
        description: 'Patient is on diabetes medication but diabetes is not on active problem list. Consider adding diagnosis.',
        rationale: 'Medication-problem list reconciliation',
        suggested_action: [],
        source: 'med_reconciliation_agent'
      });
    }

    // Statin without hyperlipidemia
    const statins = ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin', 'pitavastatin'];
    const onStatin = meds.some(m => m.status === 'active' && statins.some(d => m.medication_name.toLowerCase().includes(d)));
    const hasLipids = [...problemCodes].some(c => c && c.startsWith('E78'));

    if (onStatin && !hasLipids) {
      suggestions.push({
        suggestion_type: 'medication',
        category: 'informational',
        priority: 45,
        title: 'Statin Without Hyperlipidemia Diagnosis',
        description: 'Patient is on a statin but hyperlipidemia is not on the active problem list.',
        rationale: 'Medication-problem list reconciliation',
        suggested_action: [],
        source: 'med_reconciliation_agent'
      });
    }

    // Duplicate therapy check (two meds from same class)
    const aceInhibitors = ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril', 'fosinopril', 'quinapril'];
    const arbs = ['losartan', 'valsartan', 'irbesartan', 'olmesartan', 'telmisartan', 'candesartan'];
    const activeACE = meds.filter(m => m.status === 'active' && aceInhibitors.some(d => m.medication_name.toLowerCase().includes(d)));
    const activeARB = meds.filter(m => m.status === 'active' && arbs.some(d => m.medication_name.toLowerCase().includes(d)));

    if (activeACE.length > 0 && activeARB.length > 0) {
      suggestions.push({
        suggestion_type: 'interaction_alert',
        category: 'urgent',
        priority: 5,
        title: 'Dual RAAS Blockade — ACE Inhibitor + ARB',
        description: `Patient on both ${activeACE[0].medication_name} and ${activeARB[0].medication_name}. Dual RAAS blockade increases risk of hyperkalemia, renal dysfunction, and hypotension.`,
        rationale: 'ONTARGET trial: Dual RAAS blockade provides no benefit with increased adverse events',
        suggested_action: [],
        source: 'med_reconciliation_agent'
      });
    }

    return suggestions;
  }

  /**
   * Check chronic disease management tasks.
   */
  _checkChronicDiseaseManagement(context) {
    const problems = context.problems || [];
    const labs = context.labs || [];
    const suggestions = [];

    // Diabetes management checks
    const hasDiabetes = problems.some(p => p.icd10_code && (p.icd10_code.startsWith('E10') || p.icd10_code.startsWith('E11')));
    if (hasDiabetes) {
      const lastA1C = labs
        .filter(l => l.test_name && l.test_name.toLowerCase().includes('a1c'))
        .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))[0];

      if (!lastA1C || this._monthsSince(lastA1C.result_date) >= 3) {
        suggestions.push({
          suggestion_type: 'preventive_care',
          category: 'routine',
          priority: 25,
          title: 'Hemoglobin A1C Due (Diabetes Management)',
          description: lastA1C
            ? `Last A1C: ${lastA1C.result_value} on ${lastA1C.result_date}. ADA recommends A1C every 3 months if not at goal.`
            : 'No A1C on file. ADA recommends A1C at least twice yearly.',
          rationale: 'ADA Standards of Care 2025: A1C testing at least twice yearly; quarterly if therapy changed or not at goal',
          suggested_action: [{
            type: 'create_lab_order',
            description: 'Order Hemoglobin A1C',
            payload: { test_name: 'Hemoglobin A1C', cpt_code: '83036', indication: 'Diabetes management', priority: 'routine' }
          }],
          source: 'chronic_disease_agent'
        });
      }

      // Check for annual eye exam referral
      const referrals = context.referrals || [];
      const eyeReferral = referrals
        .filter(r => r.specialty && r.specialty.toLowerCase().includes('ophthalmol'))
        .sort((a, b) => new Date(b.referred_date) - new Date(a.referred_date))[0];

      if (!eyeReferral || this._monthsSince(eyeReferral.referred_date) >= 12) {
        suggestions.push({
          suggestion_type: 'referral',
          category: 'preventive',
          priority: 35,
          title: 'Annual Diabetic Eye Exam Due',
          description: 'ADA recommends annual dilated eye exam for all patients with diabetes.',
          rationale: 'ADA Standards of Care: Annual comprehensive eye exam to detect diabetic retinopathy',
          suggested_action: [{
            type: 'create_referral',
            description: 'Refer to Ophthalmology',
            payload: { specialty: 'Ophthalmology', reason: 'Annual diabetic eye exam', urgency: 'routine' }
          }],
          source: 'chronic_disease_agent'
        });
      }
    }

    // CKD management checks
    const hasCKD = problems.some(p => p.icd10_code && p.icd10_code.startsWith('N18'));
    if (hasCKD) {
      const lastCMP = labs
        .filter(l => l.test_name && (l.test_name.toLowerCase().includes('metabolic') || l.test_name.toLowerCase().includes('creatinine')))
        .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))[0];

      if (!lastCMP || this._monthsSince(lastCMP.result_date) >= 3) {
        suggestions.push({
          suggestion_type: 'preventive_care',
          category: 'routine',
          priority: 25,
          title: 'Renal Function Monitoring Due (CKD)',
          description: 'KDIGO recommends monitoring eGFR and electrolytes at least every 3-6 months in CKD patients.',
          rationale: 'KDIGO 2024 Guidelines',
          suggested_action: [{
            type: 'create_lab_order',
            description: 'Order Comprehensive Metabolic Panel',
            payload: { test_name: 'Comprehensive Metabolic Panel', cpt_code: '80053', indication: 'CKD monitoring', priority: 'routine' }
          }],
          source: 'chronic_disease_agent'
        });
      }
    }

    return suggestions;
  }

  /**
   * BMI-based clinical alerts.
   */
  _checkBMI(context) {
    const vitals = context.vitals || {};
    if (!vitals.weight || !vitals.height) return [];

    const bmi = (vitals.weight / (vitals.height * vitals.height)) * 703;
    const suggestions = [];

    if (bmi >= 30) {
      const problems = context.problems || [];
      const hasObesityDx = problems.some(p => p.icd10_code && p.icd10_code.startsWith('E66'));

      if (!hasObesityDx) {
        suggestions.push({
          suggestion_type: 'medication',
          category: 'informational',
          priority: 45,
          title: `BMI ${bmi.toFixed(1)} — Obesity Not on Problem List`,
          description: `Calculated BMI is ${bmi.toFixed(1)}. Consider adding obesity (E66.x) to the problem list. USPSTF recommends intensive behavioral interventions for BMI >= 30.`,
          rationale: 'USPSTF Grade B: Refer adults with BMI >= 30 to intensive, multicomponent behavioral interventions',
          suggested_action: [],
          source: 'bmi_agent'
        });
      }
    }

    if (bmi >= 40) {
      suggestions.push({
        suggestion_type: 'referral',
        category: 'routine',
        priority: 35,
        title: `BMI ${bmi.toFixed(1)} — Consider Bariatric Surgery Referral`,
        description: 'BMI >= 40 meets criteria for bariatric surgery evaluation. Consider referral if conservative measures have failed.',
        rationale: 'ASMBS/IFSO 2022 Guidelines: BMI >= 40 or BMI >= 35 with comorbidities',
        suggested_action: [{
          type: 'create_referral',
          description: 'Refer to Bariatric Surgery',
          payload: { specialty: 'Bariatric Surgery', reason: 'Morbid obesity evaluation', urgency: 'routine' }
        }],
        source: 'bmi_agent'
      });
    }

    return suggestions;
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

  _monthsSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    const now = new Date();
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  }
}

module.exports = { CDSAgent };
