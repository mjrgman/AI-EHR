'use strict';

const { createHash } = require('node:crypto');
const { selectActiveMedications } = require('./medication-history');

function failedSafety(drugName) {
  return {
    alerts: [{ type: 'interaction_screening_unavailable', severity: 'warning',
      title: `Interaction check unavailable: ${drugName}`,
      description: 'Drug-safety checking failed. Verify the proposed regimen manually.',
      source: 'drug-safety-service', unavailable: true }],
    interactionScreeningUnavailable: true,
    interactionScreening: { status: 'incomplete', reason: 'safety_check_failed',
      findings: [], inputComplete: false },
    boxedWarning: { hasBoxedWarning: false, warning: null }
  };
}

function validateExtractedMedications(medications) {
  if (!Array.isArray(medications) || medications.some(m => !m || typeof m !== 'object'
    || Array.isArray(m) || ['name', 'dose', 'route', 'frequency'].some(field =>
      typeof m[field] !== 'string' || !m[field].trim()))) {
    const err = new Error('Extracted medications contain invalid prescription entries');
    err.status = 422;
    err.code = 'INVALID_PROPOSED_MEDICATIONS';
    throw err;
  }
}

// Record identity is distinct from drug identity. Repeated names/doses are kept
// as separate drafts, and a reverse check of the same record pair is deduplicated.
async function screenPrescriptionBatch(drafts, history, allergies, checker) {
  const selected = selectActiveMedications(history);
  const stored = Array.isArray(selected) ? selected.map((med, i) => med && ({
    ...med, comparisonId: `stored:${i}:${med.id ?? 'unidentified'}`
  })) : [null];
  const proposed = drafts.map((draft, i) => ({ ...draft, comparisonId: `proposed:${i}` }));
  const findings = new Map();
  const checked = [];
  for (let i = 0; i < proposed.length; i++) {
    const current = proposed[i];
    const others = [...stored, ...proposed.filter((_med, j) => j !== i)];
    let safety;
    try {
      safety = await checker.fullSafetyCheck(current.medication_name, others, allergies);
      if (!safety || !Array.isArray(safety.alerts)
        || safety.alerts.some(a => !a || typeof a !== 'object' || Array.isArray(a)
          || typeof a.title !== 'string')
        || !Array.isArray(safety.interactionScreening?.findings)
        || safety.interactionScreening.status !== (others.length ? 'incomplete' : 'not_applicable')
        || safety.interactionScreeningUnavailable !== (others.length > 0)
        || typeof safety.interactionScreening.inputComplete !== 'boolean'
        || safety.interactionScreening.findings.some(f => !f || !others.some(m =>
          m && m.comparisonId === f.comparisonId))) {
        throw new Error('Invalid drug-safety checker response');
      }
    } catch {
      safety = failedSafety(current.medication_name);
    }
    const local = new Map();
    for (const finding of safety.interactionScreening.findings) {
      const pair = [current.comparisonId, finding.comparisonId].sort();
      const key = JSON.stringify([pair, finding.source, finding.severity, finding.description]);
      const linked = { ...finding, pair, key };
      local.set(key, linked);
      if (!findings.has(key)) findings.set(key, linked);
    }
    safety.interactionScreening.findings = [...local.values()];
    // Retain duplicate-therapy information, including multiple distinct records
    // with the same name. This asks for review without adding pharmacology rules.
    const duplicates = others.filter(m => m && m.medication_name.trim().toLowerCase()
      === current.medication_name.trim().toLowerCase());
    if (duplicates.length) safety.alerts.push({ type: 'duplicate_therapy', severity: 'moderate',
      title: `Repeated medication: ${current.medication_name}`,
      description: 'The same medication name appears in multiple regimen records. Review doses and the intended regimen.',
      records: [current.comparisonId, ...duplicates.map(m => m.comparisonId)],
      source: 'regimen-review' });
    checked.push({ draft: drafts[i], safety });
  }
  // A checker failure for one draft must not hide a finding independently
  // obtained from its partner's check. Attach each known pair to both drafts
  // while keeping the failed draft's incomplete/failure state intact.
  for (let i = 0; i < checked.length; i++) {
    const safety = checked[i].safety;
    for (const finding of findings.values()) {
      if (!finding.pair.includes(`proposed:${i}`)
        || safety.interactionScreening.findings.some(f => f.key === finding.key)) continue;
      safety.interactionScreening.findings.push(finding);
      safety.interactions = [...(safety.interactions || []), finding];
      safety.alerts.push({ type: 'drug_interaction', severity: finding.severity,
        title: `${finding.drug1} ↔ ${finding.drug2} Interaction`,
        description: finding.description, source: finding.source, pair: finding.pair });
    }
  }
  // This endpoint always creates fresh drafts. No approval supplied by a caller
  // is inherited. Any change to the batch or its comparison history changes the
  // review fingerprint; saved draft IDs remain the authority for later actions.
  const fingerprint = createHash('sha256').update(JSON.stringify({ drafts, history })).digest('hex');
  return { checked, findings: [...findings.values()],
    review: { status: 'required', batchFingerprint: fingerprint } };
}

module.exports = { failedSafety, validateExtractedMedications, screenPrescriptionBatch };
