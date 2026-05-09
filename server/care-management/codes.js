'use strict';

/**
 * Care management CPT/HCPCS code catalog (CY 2026).
 *
 * Single source of truth for code definitions used by the care-management
 * engine. Each entry carries: cpt, family, time threshold, who performs,
 * frequency, and base/add-on relationship.
 *
 * Reference: docs/research/PRIMARY_CARE_DEEPENING_RESEARCH_2026-05-03.md §4.
 */

// ==========================================
// CHRONIC CARE MANAGEMENT (CCM)
// ==========================================

const CCM_CODES = {
  '99490': {
    cpt: '99490',
    family: 'CCM',
    label: 'Non-complex CCM, clinical staff time',
    minMinutes: 20,
    maxMinutes: 39,
    performedBy: 'clinical_staff_directed_by_physician',
    frequency: 'once_per_calendar_month',
    isBase: true,
    addOnTo: null,
    eligibility: { minChronicConditions: 2 }
  },
  '99439': {
    cpt: '99439',
    family: 'CCM',
    label: 'CCM add-on: each additional 20 min staff time',
    minMinutes: 20,
    incrementMinutes: 20,
    performedBy: 'clinical_staff',
    frequency: 'up_to_2_per_99490',
    isBase: false,
    addOnTo: '99490',
    maxUnits: 2
  },
  '99491': {
    cpt: '99491',
    family: 'CCM',
    label: 'CCM personally by physician/QHP',
    minMinutes: 30,
    performedBy: 'physician_or_qhp_personally',
    frequency: 'once_per_calendar_month',
    isBase: true,
    addOnTo: null,
    incidentTo: false,
    eligibility: { minChronicConditions: 2 }
  },
  '99437': {
    cpt: '99437',
    family: 'CCM',
    label: 'CCM add-on: each additional 30 min by physician/QHP',
    minMinutes: 30,
    incrementMinutes: 30,
    performedBy: 'physician_or_qhp_personally',
    frequency: 'no_cap',
    isBase: false,
    addOnTo: '99491'
  },
  '99487': {
    cpt: '99487',
    family: 'CCM',
    subFamily: 'complex',
    label: 'Complex CCM, clinical staff',
    minMinutes: 60,
    performedBy: 'clinical_staff_directed_by_physician',
    frequency: 'once_per_calendar_month',
    isBase: true,
    addOnTo: null,
    eligibility: { minChronicConditions: 2, mdmComplexity: 'moderate_or_high' }
  },
  '99489': {
    cpt: '99489',
    family: 'CCM',
    subFamily: 'complex',
    label: 'Complex CCM add-on: each additional 30 min',
    minMinutes: 30,
    incrementMinutes: 30,
    performedBy: 'clinical_staff',
    frequency: 'no_cap',
    isBase: false,
    addOnTo: '99487'
  }
};

// ==========================================
// PRINCIPAL CARE MANAGEMENT (PCM) — single high-risk condition
// ==========================================

const PCM_CODES = {
  '99424': {
    cpt: '99424', family: 'PCM',
    label: 'PCM personally by physician/QHP',
    minMinutes: 30, performedBy: 'physician_or_qhp_personally',
    frequency: 'once_per_calendar_month',
    isBase: true, addOnTo: null,
    eligibility: { minChronicConditions: 1, requiresHighRiskCondition: true }
  },
  '99425': {
    cpt: '99425', family: 'PCM',
    label: 'PCM add-on: each additional 30 min by physician/QHP',
    minMinutes: 30, incrementMinutes: 30,
    performedBy: 'physician_or_qhp_personally',
    isBase: false, addOnTo: '99424'
  },
  '99426': {
    cpt: '99426', family: 'PCM',
    label: 'PCM clinical staff time',
    minMinutes: 30, performedBy: 'clinical_staff_directed_by_physician',
    frequency: 'once_per_calendar_month',
    isBase: true, addOnTo: null,
    eligibility: { minChronicConditions: 1, requiresHighRiskCondition: true }
  },
  '99427': {
    cpt: '99427', family: 'PCM',
    label: 'PCM clinical staff add-on: each additional 30 min',
    minMinutes: 30, incrementMinutes: 30,
    performedBy: 'clinical_staff',
    isBase: false, addOnTo: '99426'
  }
};

// ==========================================
// TRANSITIONAL CARE MANAGEMENT (TCM)
// ==========================================

const TCM_CODES = {
  '99495': {
    cpt: '99495', family: 'TCM',
    label: 'TCM Moderate complexity',
    mdmRequired: 'moderate',
    faceToFaceWithinDaysOfDischarge: 14,
    interactiveContactWithinBusinessDays: 2,
    isBase: true, addOnTo: null
  },
  '99496': {
    cpt: '99496', family: 'TCM',
    label: 'TCM High complexity',
    mdmRequired: 'high',
    faceToFaceWithinDaysOfDischarge: 7,
    interactiveContactWithinBusinessDays: 2,
    isBase: true, addOnTo: null
  }
};

// ==========================================
// BEHAVIORAL HEALTH INTEGRATION (BHI)
// ==========================================

const BHI_CODES = {
  '99484': {
    cpt: '99484', family: 'BHI',
    label: 'General Behavioral Health Integration',
    minMinutes: 20, performedBy: 'clinical_staff_directed_by_physician',
    frequency: 'once_per_calendar_month', isBase: true, addOnTo: null,
    eligibility: { requiresBehavioralHealthDiagnosis: true }
  },
  '99492': {
    cpt: '99492', family: 'BHI', subFamily: 'CoCM',
    label: 'Initial Collaborative Care Management (CoCM), first month',
    minMinutes: 70, performedBy: 'behavioral_health_care_manager',
    frequency: 'first_month_only', isBase: true, addOnTo: null,
    eligibility: { requiresBehavioralHealthDiagnosis: true }
  },
  '99493': {
    cpt: '99493', family: 'BHI', subFamily: 'CoCM',
    label: 'Subsequent CoCM',
    minMinutes: 60, performedBy: 'behavioral_health_care_manager',
    frequency: 'monthly_after_99492', isBase: true, addOnTo: null
  },
  '99494': {
    cpt: '99494', family: 'BHI', subFamily: 'CoCM',
    label: 'CoCM add-on: each additional 30 min',
    minMinutes: 30, incrementMinutes: 30,
    performedBy: 'behavioral_health_care_manager',
    isBase: false, addOnTo: ['99492', '99493']
  }
};

// ==========================================
// ADVANCE CARE PLANNING (ACP)
// ==========================================

const ACP_CODES = {
  '99497': {
    cpt: '99497', family: 'ACP',
    label: 'Advance Care Planning, first 30 minutes',
    minMinutes: 16, isBase: true, addOnTo: null,
    waivedDeductibleSameDayAsAWV: true
  },
  '99498': {
    cpt: '99498', family: 'ACP',
    label: 'ACP add-on: each additional 30 min',
    minMinutes: 30, incrementMinutes: 30,
    isBase: false, addOnTo: '99497'
  }
};

// ==========================================
// REMOTE PATIENT MONITORING (RPM) — physiologic
// ==========================================

const RPM_CODES = {
  '99453': {
    cpt: '99453', family: 'RPM',
    label: 'RPM initial setup + patient education on equipment',
    isBase: true, frequency: 'once_per_episode_of_care'
  },
  '99454': {
    cpt: '99454', family: 'RPM',
    label: 'RPM device supply with daily recordings, 30-day period',
    minDaysOfData: 16, frequency: 'per_30_day_period',
    isBase: true
  },
  '99457': {
    cpt: '99457', family: 'RPM',
    label: 'RPM treatment management, first 20 min/month',
    minMinutes: 20, frequency: 'once_per_calendar_month',
    isBase: true
  },
  '99458': {
    cpt: '99458', family: 'RPM',
    label: 'RPM treatment management add-on: each additional 20 min/month',
    minMinutes: 20, incrementMinutes: 20,
    isBase: false, addOnTo: '99457'
  }
};

// ==========================================
// REMOTE THERAPEUTIC MONITORING (RTM) — non-physiologic
// ==========================================

const RTM_CODES = {
  '98975': { cpt: '98975', family: 'RTM', label: 'RTM initial setup', isBase: true, frequency: 'once_per_episode_of_care' },
  '98976': { cpt: '98976', family: 'RTM', label: 'RTM device supply, respiratory system, 30 days', frequency: 'per_30_day_period', isBase: true },
  '98977': { cpt: '98977', family: 'RTM', label: 'RTM device supply, musculoskeletal, 30 days', frequency: 'per_30_day_period', isBase: true },
  '98980': { cpt: '98980', family: 'RTM', label: 'RTM treatment management, first 20 min/month', minMinutes: 20, frequency: 'once_per_calendar_month', isBase: true },
  '98981': { cpt: '98981', family: 'RTM', label: 'RTM treatment management add-on: each additional 20 min/month', minMinutes: 20, incrementMinutes: 20, isBase: false, addOnTo: '98980' }
};

// ==========================================
// APCM — Advanced Primary Care Management (CY 2026 NEW)
// ==========================================

const APCM_CODES = {
  'G0556': { cpt: 'G0556', family: 'APCM', label: 'APCM Level 1 (≤1 chronic condition)', frequency: 'per_beneficiary_per_month', isBase: true },
  'G0557': { cpt: 'G0557', family: 'APCM', label: 'APCM Level 2 (≥2 chronic conditions)', frequency: 'per_beneficiary_per_month', isBase: true },
  'G0558': { cpt: 'G0558', family: 'APCM', label: 'APCM Level 3 (dual-eligible OR ≥2 chronic + high complexity)', frequency: 'per_beneficiary_per_month', isBase: true }
};

// ==========================================
// MASTER REGISTRY
// ==========================================

const ALL_CODES = {
  ...CCM_CODES,
  ...PCM_CODES,
  ...TCM_CODES,
  ...BHI_CODES,
  ...ACP_CODES,
  ...RPM_CODES,
  ...RTM_CODES,
  ...APCM_CODES
};

const FAMILIES = {
  CCM: Object.keys(CCM_CODES),
  PCM: Object.keys(PCM_CODES),
  TCM: Object.keys(TCM_CODES),
  BHI: Object.keys(BHI_CODES),
  ACP: Object.keys(ACP_CODES),
  RPM: Object.keys(RPM_CODES),
  RTM: Object.keys(RTM_CODES),
  APCM: Object.keys(APCM_CODES)
};

function getCode(cpt) {
  return ALL_CODES[cpt] || null;
}

function getFamilyCodes(family) {
  return FAMILIES[family] ? FAMILIES[family].map(cpt => ALL_CODES[cpt]) : [];
}

module.exports = {
  CCM_CODES,
  PCM_CODES,
  TCM_CODES,
  BHI_CODES,
  ACP_CODES,
  RPM_CODES,
  RTM_CODES,
  APCM_CODES,
  ALL_CODES,
  FAMILIES,
  getCode,
  getFamilyCodes
};
