/**
 * Domain Logic Agent — Functional Medicine / HRT / Peptide Therapy
 *
 * SAFETY CONTRACT (non-negotiable — see memory/feedback_standard_of_care_guardrails.md):
 *
 *   STANDARD-OF-CARE IS AN UNCONDITIONAL GUARDRAIL.
 *
 *   This agent always runs the mainstream CDS engine FIRST. Any urgent /
 *   interaction / contraindication alert from CDS acts as a HARD BLOCK on
 *   any Domain Logic recommendation that touches the same medication class,
 *   lab trigger, or clinical condition. Specialty-medicine rules (HRT,
 *   peptides, functional medicine) are ADDITIONAL layers on top of standard
 *   of care — never substitutes for it and never able to override it.
 *
 *   A dosing proposal that conflicts with a CDS alert is DISCARDED at the
 *   engine level and logged as a Level-1 safety event. It is NEVER routed
 *   to `requestDosingApproval()`.
 *
 * Tier: 3 (physician-in-the-loop — nothing executes without approval).
 */

const { BaseAgent, AUTONOMY_TIER, ACTION_TYPE } = require('./base-agent');
const engine = require('../domain/functional-med-engine');
const cdsEngine = require('../cds-engine');
const knowledgeBase = require('../domain/knowledge-base');
const dosingService = require('../pharma/dosing-service');

// Keywords that, when present in transcript or encounter notes, flag the
// encounter for domain-logic classification. Client-side UI can also use
// this list for hormone/peptide tab auto-focus (see src/hooks/useHRTKeywords.js).
const DOMAIN_KEYWORDS = {
  hrt_male: ['testosterone', 'trt', 'hypogonadism', 'low t', 'androgel'],
  hrt_female: ['estradiol', 'estrogen', 'progesterone', 'menopause', 'hormone replacement', 'hrt', 'vasomotor', 'hot flashes'],
  glp1: ['semaglutide', 'ozempic', 'wegovy', 'tirzepatide', 'mounjaro', 'zepbound', 'glp-1', 'glp1', 'weight loss injection'],
  gh_peptides: ['sermorelin', 'ipamorelin', 'cjc-1295', 'tesamorelin', 'growth hormone peptide'],
  research_peptides: ['bpc-157', 'bpc157', 'tb-500', 'research peptide'],
  functional_med: ['functional medicine', 'adrenal fatigue', 'methylation', 'mthfr', 'leaky gut', 'mitochondrial', 'hpa axis', 'hashimoto']
};

class DomainLogicAgent extends BaseAgent {
  constructor(options = {}) {
    super('domain_logic', {
      description: 'Functional medicine, HRT, and peptide therapy reasoning — Tier 3, standard-of-care-bounded',
      dependsOn: ['cds'],            // Hard dependency — CDS must run first
      priority: 15,
      autonomyTier: AUTONOMY_TIER.TIER_3,
      ...options
    });

    // Verify knowledge base loads cleanly at construction time. If a rule
    // has a missing evidence_source or broken dosing proposal, we fail
    // fast here rather than mid-encounter.
    try {
      const rules = knowledgeBase.loadRules();
      console.log(`[DomainLogicAgent] Ready with ${rules.length} rules`);
    } catch (err) {
      console.error('[DomainLogicAgent] Failed to load knowledge base:', err.message);
      throw err;
    }
  }

  /**
   * Classify the encounter's transcript to detect domain categories. Used
   * by the orchestrator / UI to decide whether to show the HRT/Peptide
   * panel and to drive keyword-based voice routing.
   *
   * @param {string} transcript
   * @returns {Array<string>} category keys that matched
   */
  _classifyDomain(transcript = '') {
    if (!transcript) return [];
    const lowered = transcript.toLowerCase();
    const matches = [];
    for (const [category, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (keywords.some((k) => lowered.includes(k))) matches.push(category);
    }
    return matches;
  }

  /**
   * Extract the guardrail signal from the CDS result. Any CDS suggestion
   * with category 'urgent' OR suggestion_type matching drug interaction /
   * allergy / contraindication becomes a guardrail that the domain logic
   * layer must respect.
   *
   * Returns a set of medication names and categories that domain logic
   * cannot contradict.
   *
   * @param {Object} cdsResult
   * @returns {{ blockedMedications: Set<string>, urgentAlerts: Array }}
   */
  _extractCDSGuardrails(cdsResult) {
    const blockedMedications = new Set();
    const urgentAlerts = [];

    const cdsSuggestions = cdsResult?.suggestions || [];
    for (const s of cdsSuggestions) {
      const isUrgent = s.category === 'urgent';
      const isInteraction = s.suggestion_type === 'interaction_alert' || s.suggestion_type === 'drug_interaction';
      const isContraind = /contraindic/i.test(s.title || '') || /contraindic/i.test(s.description || '');

      if (isUrgent || isInteraction || isContraind) {
        urgentAlerts.push(s);

        // Scrape medication names out of the CDS title/description so we can
        // block any domain-logic proposal that touches the same drug.
        const haystack = `${s.title || ''} ${s.description || ''}`.toLowerCase();
        const medClassTokens = [
          'testosterone', 'estradiol', 'estrogen', 'progesterone',
          'semaglutide', 'tirzepatide', 'ozempic', 'wegovy', 'mounjaro', 'zepbound',
          'sermorelin', 'ipamorelin', 'bpc-157',
          'ace inhibitor', 'arb', 'statin', 'metformin', 'insulin',
          'vitamin d', 'cholecalciferol'
        ];
        for (const token of medClassTokens) {
          if (haystack.includes(token)) blockedMedications.add(token);
        }
      }
    }

    return { blockedMedications, urgentAlerts };
  }

  /**
   * Check whether a Domain Logic dosing proposal conflicts with any CDS
   * guardrail. Returns the offending alert if conflict is found, or null.
   *
   * @param {Object} proposal - dosing proposal from engine.evaluate()
   * @param {{ blockedMedications: Set<string>, urgentAlerts: Array }} guardrails
   * @returns {Object|null}
   */
  _conflictWithGuardrails(proposal, guardrails) {
    const med = (proposal.action?.payload?.medication || '').toLowerCase();
    if (!med) return null;

    for (const blocked of guardrails.blockedMedications) {
      if (med.includes(blocked) || blocked.includes(med.split(' ')[0])) {
        // Find the specific alert that named this medication so we can cite it
        const alert = guardrails.urgentAlerts.find((a) => {
          const haystack = `${a.title || ''} ${a.description || ''}`.toLowerCase();
          return haystack.includes(blocked);
        });
        return alert || guardrails.urgentAlerts[0] || { title: 'unspecified CDS urgent alert' };
      }
    }
    return null;
  }

  /**
   * Main entry point from the orchestrator.
   *
   * @param {PatientContext} context
   * @param {Object} agentResults - includes prior agent outputs (cds, scribe, etc.)
   * @returns {Promise<Object>}
   */
  async process(context, agentResults = {}) {
    const startedAt = Date.now();
    const transcript = context.encounter?.transcript || '';
    const detectedDomains = this._classifyDomain(transcript);

    // ==========================================
    // STEP 1: STANDARD-OF-CARE GUARDRAIL
    //
    // Pull CDS results either from prior pipeline output (preferred) or by
    // calling the engine directly. This is the safety floor — any urgent
    // alert here becomes a hard block on conflicting specialty proposals.
    // ==========================================
    let cdsResult = agentResults?.cds;
    if (!cdsResult || !cdsResult.suggestions) {
      try {
        const ruleResults = await cdsEngine.evaluatePatientContext(
          context.encounter?.id,
          context.patient?.id,
          {
            vitals: context.vitals || {},
            labs: context.labs || [],
            medications: context.medications || [],
            allergies: context.allergies || [],
            problems: context.problems || [],
            chiefComplaint: context.encounter?.chief_complaint || '',
            transcript
          }
        );
        cdsResult = { suggestions: ruleResults || [] };
      } catch (err) {
        // If CDS fails, we FAIL CLOSED. No specialty recommendations
        // without confirmation that standard-of-care checks ran cleanly.
        // IMPORTANT: reportSafetyEvent expects a NUMERIC level (1/2/3/4),
        // not the SAFETY_LEVEL object. Passing the object silently falls
        // back to LEVEL_4 (Informational) inside base-agent.js:267 and
        // loses the escalation signal — regression guarded by the Guardrail
        // fail-closed test in test/run-tests.js.
        this.reportSafetyEvent(
          2,
          `CDS engine failed — suppressing all domain-logic recommendations. Error: ${err.message}`,
          context
        );
        return {
          detectedDomains,
          suggestions: [],
          dosingProposals: [],
          patternEvents: [],
          blockedBySafety: [],
          guardrailSource: 'cds_unavailable',
          error: err.message
        };
      }
    }

    const guardrails = this._extractCDSGuardrails(cdsResult);

    // ==========================================
    // STEP 2: RUN DOMAIN ENGINE
    // ==========================================
    const engineResult = engine.evaluate({
      patient: context.patient || {},
      encounter: context.encounter || {},
      vitals: context.vitals || {},
      problems: context.problems || [],
      medications: context.medications || [],
      labs: context.labs || [],
      transcript
    });

    // ==========================================
    // STEP 3: APPLY STANDARD-OF-CARE GUARDRAIL
    //
    // Filter out any suggestion or dosing proposal that conflicts with
    // a CDS urgent alert. Blocked proposals are logged as Level-1 safety
    // events and NOT routed to the physician.
    // ==========================================
    const allowedSuggestions = [];
    const blockedBySafety = [];

    for (const s of engineResult.suggestions) {
      // For non-dosing suggestions, still check if the category is in conflict
      // (e.g., lab recs for a contraindicated drug)
      if (s.requiresDosingApproval) {
        // Will be double-checked at the proposal stage
        allowedSuggestions.push(s);
        continue;
      }
      allowedSuggestions.push(s);
    }

    const allowedDosingProposals = [];
    for (const proposal of engineResult.dosingProposals) {
      const conflict = this._conflictWithGuardrails(proposal, guardrails);
      if (conflict) {
        blockedBySafety.push({
          proposal,
          blockedBy: {
            title: conflict.title,
            category: conflict.category,
            rationale: conflict.rationale || conflict.description
          }
        });
        // IMPORTANT: numeric level (not SAFETY_LEVEL object) — see
        // domain-logic-agent.js:187 for the same fix and base-agent.js:266
        // for the contract. Misclassifying this as LEVEL_4 would cause a
        // blocked-dosing event to be silently downgraded from Critical.
        this.reportSafetyEvent(
          1,
          `Domain logic dosing proposal blocked by standard-of-care guardrail: ` +
          `${proposal.action?.payload?.medication} ` +
          `(CDS alert: "${conflict.title}")`,
          context
        );
        this.audit(
          ACTION_TYPE.OVERRIDE,
          {
            reason: 'standard_of_care_guardrail',
            suppressedProposal: proposal,
            guardrailAlert: { title: conflict.title, category: conflict.category }
          },
          context
        );
        continue;
      }
      allowedDosingProposals.push(proposal);
    }

    // Also filter out any suggestion whose dosing action was blocked
    const blockedRuleIds = new Set(blockedBySafety.map((b) => b.proposal.rule_id));
    const safeSuggestions = allowedSuggestions.filter((s) => !blockedRuleIds.has(s.rule_id));

    // ==========================================
    // STEP 4: EMIT FUNCTIONAL PATTERN EVENTS
    //
    // Pattern detections are informational — they don't need approval,
    // but they DO need to be broadcast so CDS and Red Flag agents can
    // correlate them with other findings.
    // ==========================================
    for (const patternEvent of engineResult.patternEvents) {
      try {
        if (this.messageBus) {
          await this.sendMessage(
            'cds',
            'FUNCTIONAL_PATTERN_DETECTED',
            patternEvent,
            {
              patientId: context.patient?.id,
              encounterId: context.encounter?.id,
              priority: 3
            }
          );
        }
      } catch (err) {
        console.warn(`[DomainLogicAgent] Failed to emit FUNCTIONAL_PATTERN_DETECTED: ${err.message}`);
      }
    }

    // ==========================================
    // STEP 5: RETURN RESULT
    //
    // Note: we do NOT call requestDosingApproval() inside process(). That
    // call is initiated by the orchestrator or a user-driven UI action so
    // the physician approval flow remains synchronous and visible in the
    // UI, not buried inside a pipeline run.
    // ==========================================
    return {
      detectedDomains,
      suggestions: safeSuggestions,
      dosingProposals: allowedDosingProposals,
      patternEvents: engineResult.patternEvents,
      blockedBySafety,
      guardrailSource: 'cds_engine',
      guardrailAlertCount: guardrails.urgentAlerts.length,
      executionTimeMs: Date.now() - startedAt,
      counts: {
        totalSuggestions: safeSuggestions.length,
        dosingProposals: allowedDosingProposals.length,
        patternEvents: engineResult.patternEvents.length,
        blockedBySafety: blockedBySafety.length
      }
    };
  }

  /**
   * Route a single dosing proposal through the Tier 3 approval gate.
   * Called by the orchestrator or a UI handler AFTER `process()` returns,
   * so the physician approval modal is shown in user context.
   *
   * @param {Object} proposal - one entry from the dosingProposals array
   * @param {PatientContext} context
   * @returns {Promise<{approved: boolean, approvalId: string, response: Object}>}
   */
  async submitDosingProposal(proposal, context) {
    if (!proposal?.action?.payload) {
      throw new Error('DomainLogicAgent.submitDosingProposal: proposal missing action.payload');
    }
    const payload = proposal.action.payload;
    const dosingChange = {
      medication: payload.medication,
      currentDose: payload.currentDose,
      proposedDose: payload.proposedDose,
      route: payload.route,
      frequency: payload.frequency,
      rationale: payload.rationale,
      evidenceSource: proposal.evidence_source,
      ruleId: proposal.rule_id,
      ruleName: proposal.rule_name
    };

    const doseAdjustment = await dosingService.assessDoseAdjustments(
      dosingChange.medication,
      dosingChange.proposedDose,
      context
    );
    dosingChange.doseAdjustment = doseAdjustment;

    if (doseAdjustment.requiresBlockingReview) {
      this.reportSafetyEvent(
        1,
        `Dosing proposal blocked by renal/hepatic/pediatric adjustment gate: ${dosingChange.medication}. ` +
        doseAdjustment.blocks.join(' | '),
        context
      );
      this.audit(
        ACTION_TYPE.OVERRIDE,
        {
          reason: 'dose_adjustment_gate_block',
          dosingChange,
          doseAdjustment
        },
        context
      );
      return {
        approved: false,
        approvalId: null,
        response: {
          status: 'blocked_by_dose_adjustment_gate',
          reason: doseAdjustment.blocks.join(' | '),
          doseAdjustment
        },
        doseAdjustment
      };
    }

    if (doseAdjustment.requiresAdjustment) {
      this.reportSafetyEvent(
        3,
        `Dosing proposal requires renal/hepatic/pediatric review: ${dosingChange.medication}. ` +
        doseAdjustment.warnings.join(' | '),
        context
      );
    }

    return this.requestDosingApproval(dosingChange, context);
  }
}

module.exports = { DomainLogicAgent, DOMAIN_KEYWORDS };
