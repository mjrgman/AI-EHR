'use strict';

/**
 * Care management eligibility checks.
 *
 * Each function takes patient context (problems, demographics, consent) and
 * returns whether the patient is eligible for a given program family + the
 * basis for the decision.
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §4.
 */

const { CHRONIC_CONDITION_PREFIXES } = require('../coding/apcm');

// Behavioral health diagnoses that qualify for BHI/CoCM
const BHI_DIAGNOSIS_PREFIXES = [
  'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19',  // Substance use disorders
  'F20', 'F21', 'F22', 'F23', 'F24', 'F25',  // Schizophrenia spectrum
  'F30', 'F31', 'F32', 'F33', 'F34',         // Mood disorders
  'F40', 'F41', 'F42', 'F43', 'F44', 'F45',  // Anxiety / stress / dissociative
  'F50',                                       // Eating disorders
  'F60', 'F61',                                // Personality disorders
  'F90', 'F91', 'F92', 'F93'                   // Childhood/adolescent BH
];

// High-risk conditions that qualify a single condition for PCM
const PCM_HIGH_RISK_PREFIXES = [
  'I50',     // Heart failure
  'J44',     // COPD
  'C',       // Active malignancies
  'N18.4', 'N18.5', 'N18.6',  // CKD 4+
  'I69',     // Stroke sequelae
  'G20',     // Parkinson's
  'G35',     // Multiple sclerosis
  'B20',     // HIV
  'K72', 'K74'  // Liver failure / cirrhosis
];

function activeChronic(problems) {
  return (problems || []).filter(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return CHRONIC_CONDITION_PREFIXES.some(prefix => code.startsWith(prefix));
  });
}

function countActiveChronic(problems) {
  return activeChronic(problems).length;
}

function hasActiveBehavioralHealthDx(problems) {
  return (problems || []).some(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return BHI_DIAGNOSIS_PREFIXES.some(prefix => code.startsWith(prefix));
  });
}

function hasHighRiskCondition(problems) {
  return (problems || []).some(p => {
    if (!p) return false;
    if (p.status && p.status !== 'active' && p.status !== 'chronic') return false;
    const code = String(p.icd10_code || '').toUpperCase();
    return PCM_HIGH_RISK_PREFIXES.some(prefix => code.startsWith(prefix));
  });
}

function consentValid(consent, today = new Date()) {
  if (!consent || !consent.consent_date) return { valid: false, reason: 'No consent record on file.' };
  const consentDate = new Date(consent.consent_date);
  if (isNaN(consentDate.getTime())) return { valid: false, reason: 'Invalid consent date.' };
  // Annual consent renewal required
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (consentDate < oneYearAgo) {
    return {
      valid: false,
      reason: `Consent dated ${consentDate.toISOString().slice(0, 10)} is older than 12 months; annual renewal required.`
    };
  }
  return { valid: true, consentDate: consentDate.toISOString().slice(0, 10) };
}

// ==========================================
// PER-PROGRAM ELIGIBILITY
// ==========================================

function checkCCMEligibility(patient, problems, consent) {
  const chronicCount = countActiveChronic(problems);
  if (chronicCount < 2) {
    return {
      eligible: false,
      reason: `CCM requires ≥2 chronic conditions; patient has ${chronicCount}.`,
      chronicCount
    };
  }
  const c = consentValid(consent);
  if (!c.valid) return { eligible: false, reason: c.reason, chronicCount };
  return { eligible: true, chronicCount, basis: `${chronicCount} chronic conditions; consent on file ${c.consentDate}.` };
}

function checkPCMEligibility(patient, problems, consent) {
  if (!hasHighRiskCondition(problems)) {
    return {
      eligible: false,
      reason: 'PCM requires ≥1 high-risk single condition (e.g., HF, COPD, active cancer, CKD 4+, stroke sequelae).'
    };
  }
  const c = consentValid(consent);
  if (!c.valid) return { eligible: false, reason: c.reason };
  return { eligible: true, basis: 'High-risk single condition documented; consent on file.' };
}

function checkTCMEligibility(patient, recentDischarge) {
  if (!recentDischarge || !recentDischarge.discharge_date) {
    return { eligible: false, reason: 'TCM requires a recent inpatient/observation discharge.' };
  }
  const discharge = new Date(recentDischarge.discharge_date);
  const daysSince = Math.floor((Date.now() - discharge) / (24 * 60 * 60 * 1000));
  if (daysSince > 30) {
    return {
      eligible: false,
      reason: `Discharge was ${daysSince} days ago; TCM service period (30 days) has elapsed.`
    };
  }
  return {
    eligible: true,
    daysSinceDischarge: daysSince,
    basis: `Discharge ${daysSince} day(s) ago; within 30-day TCM service period.`
  };
}

function checkBHIEligibility(patient, problems, consent) {
  if (!hasActiveBehavioralHealthDx(problems)) {
    return { eligible: false, reason: 'BHI/CoCM requires an active behavioral-health diagnosis (F-code).' };
  }
  const c = consentValid(consent);
  if (!c.valid) return { eligible: false, reason: c.reason };
  return { eligible: true, basis: 'Active behavioral-health diagnosis; consent on file.' };
}

function checkRPMEligibility(patient, problems, consent, deviceData) {
  const c = consentValid(consent);
  if (!c.valid) return { eligible: false, reason: c.reason };
  if (!deviceData || (deviceData.daysOfData || 0) < 16) {
    return {
      eligible: false,
      reason: `RPM 99454 requires ≥16 days of data in a 30-day period; have ${deviceData ? deviceData.daysOfData : 0}.`
    };
  }
  return { eligible: true, basis: `Consent on file; ${deviceData.daysOfData} days of device data in current period.` };
}

module.exports = {
  activeChronic,
  countActiveChronic,
  hasActiveBehavioralHealthDx,
  hasHighRiskCondition,
  consentValid,
  checkCCMEligibility,
  checkPCMEligibility,
  checkTCMEligibility,
  checkBHIEligibility,
  checkRPMEligibility,
  BHI_DIAGNOSIS_PREFIXES,
  PCM_HIGH_RISK_PREFIXES
};
