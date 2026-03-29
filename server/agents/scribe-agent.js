/**
 * Agentic EHR Scribe Agent
 * Ambient documentation agent — listens to encounter transcripts and extracts
 * structured clinical data, then generates SOAP notes.
 *
 * Capabilities:
 *   - Vitals extraction from natural language
 *   - Medication extraction with smart defaults
 *   - Problem/diagnosis extraction with ICD-10 mapping
 *   - Lab order extraction with CPT codes
 *   - Imaging order extraction
 *   - Review of Systems (ROS) extraction
 *   - Physical Exam findings extraction
 *   - HPI generation
 *   - Full SOAP note generation
 *
 * Wraps and extends the existing ai-client.js functionality.
 */

const { BaseAgent } = require('./base-agent');
const aiClient = require('../ai-client');

class ScribeAgent extends BaseAgent {
  constructor(options = {}) {
    super('scribe', {
      description: 'Ambient documentation — extracts clinical data from transcripts and generates SOAP notes',
      dependsOn: [],         // Scribe runs first, no dependencies
      priority: 10,          // Highest priority — other agents need its output
      autonomyTier: 3, // Tier 3: Documentation enters medical record — physician must review
      ...options
    });

    // Configurable thresholds
    this.minTranscriptLength = options.minTranscriptLength || 20;
    this.autoGenerateSOAP = options.autoGenerateSOAP !== false;
  }

  /**
   * Process an encounter transcript.
   *
   * @param {PatientContext} context
   * @param {Object} agentResults - Not used (Scribe has no dependencies)
   * @returns {Promise<ScribeResult>}
   */
  async process(context, agentResults = {}) {
    const transcript = context.encounter?.transcript || '';
    const patient = context.patient || {};
    const existingVitals = context.vitals || {};

    // If no transcript, return minimal result
    if (!transcript || transcript.length < this.minTranscriptLength) {
      return {
        status: 'insufficient_data',
        message: 'Transcript too short for extraction',
        vitals: existingVitals,
        medications: [],
        problems: [],
        labOrders: [],
        imagingOrders: [],
        ros: {},
        physicalExam: {},
        soapNote: null,
        extractionStats: { transcriptLength: transcript.length }
      };
    }

    // --- Extract all clinical data from transcript ---
    const vitals = aiClient.extractVitals(transcript);
    const medications = aiClient.extractMedications(transcript);
    const problems = aiClient.extractProblems(transcript);
    const labOrders = aiClient.extractLabOrders(transcript);
    const imagingOrders = aiClient.extractImagingOrders ? aiClient.extractImagingOrders(transcript) : [];
    const clinicalData = aiClient.extractClinicalData ? aiClient.extractClinicalData(transcript, patient) : null;

    // ROS and PE from clinical data or direct extraction
    const ros = clinicalData?.ros || (aiClient.extractROS ? aiClient.extractROS(transcript) : {});
    const physicalExam = clinicalData?.physical_exam || {};

    // Merge extracted vitals with any existing vitals (existing take priority)
    const mergedVitals = { ...vitals, ...existingVitals };
    // But if existing is empty and we extracted something, use extracted
    for (const key of Object.keys(vitals)) {
      if (!mergedVitals[key] && vitals[key]) {
        mergedVitals[key] = vitals[key];
      }
    }

    // --- Generate SOAP note ---
    let soapNote = null;
    if (this.autoGenerateSOAP) {
      // Enrich patient object with problems for SOAP generation
      const enrichedPatient = {
        ...patient,
        problems: context.problems || []
      };
      soapNote = await aiClient.generateSOAPNote(transcript, enrichedPatient, mergedVitals);
    }

    // --- Build extraction statistics ---
    const extractionStats = {
      transcriptLength: transcript.length,
      transcriptWordCount: transcript.split(/\s+/).length,
      vitalsExtracted: Object.keys(vitals).length,
      medicationsExtracted: medications.length,
      problemsExtracted: problems.length,
      labOrdersExtracted: labOrders.length,
      imagingOrdersExtracted: imagingOrders.length,
      rosCategories: Object.keys(ros).length,
      peFindings: Object.keys(physicalExam).length,
      soapGenerated: !!soapNote
    };

    // --- Compute documentation completeness ---
    const completeness = this._assessCompleteness(mergedVitals, ros, physicalExam, problems, soapNote);

    return {
      status: 'complete',
      vitals: mergedVitals,
      medications,
      problems,
      labOrders,
      imagingOrders,
      ros,
      physicalExam,
      soapNote,
      extractionStats,
      completeness,
      chiefComplaint: context.encounter?.chief_complaint || this._extractChiefComplaint(transcript)
    };
  }

  /**
   * Assess documentation completeness based on extracted data.
   */
  _assessCompleteness(vitals, ros, pe, problems, soapNote) {
    const checks = {
      hasVitals: Object.keys(vitals).length >= 3,
      hasBP: !!(vitals.systolic_bp && vitals.diastolic_bp),
      hasROS: Object.keys(ros).length >= 2,
      hasPE: Object.keys(pe).length >= 2,
      hasProblems: problems.length > 0,
      hasSOAP: !!soapNote
    };

    const score = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;

    return {
      score,
      total,
      percentage: Math.round((score / total) * 100),
      checks,
      level: score >= 5 ? 'complete' : score >= 3 ? 'partial' : 'minimal'
    };
  }

  /**
   * Extract chief complaint from transcript if not already set.
   */
  _extractChiefComplaint(transcript) {
    const ccPatterns = [
      /(?:chief\s*complaint|cc|reason\s*for\s*visit)\s*(?:is|:)\s*(.{10,80})/i,
      /(?:here\s*(?:for|about|because\s*of))\s+(.{5,80})/i,
      /(?:presents?\s*(?:with|for))\s+(.{5,80})/i,
    ];

    for (const pattern of ccPatterns) {
      const match = transcript.match(pattern);
      if (match) return match[1].trim().replace(/[.;,]$/, '');
    }

    return null;
  }
}

module.exports = { ScribeAgent };
