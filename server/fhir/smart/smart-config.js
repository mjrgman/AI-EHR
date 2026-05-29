'use strict';

/**
 * SMART-on-FHIR Configuration
 *
 * Defines:
 *   - buildSmartConfiguration(baseUrl) → SMART discovery document
 *   - ROLE_SCOPES                      → role → default granted scopes
 *   - RESOURCE_SCOPE_MAP               → FHIR resource type → required scope(s)
 *   - scopeSatisfies(granted, required) → scope wildcard evaluation
 *
 * Spec: https://hl7.org/fhir/smart-app-launch/conformance.html
 */

// ──────────────────────────────────────────
// SCOPE DEFINITIONS
// ──────────────────────────────────────────

const ALL_SCOPES = [
  'openid',
  'fhirUser',
  'offline_access',
  'launch',
  'launch/patient',
  // patient-level read
  'patient/Patient.read',
  'patient/Encounter.read',
  'patient/Condition.read',
  'patient/Observation.read',
  'patient/AllergyIntolerance.read',
  'patient/MedicationRequest.read',
  'patient/Appointment.read',
  'patient/*.read',
  // user-level read
  'user/Practitioner.read',
  'user/Patient.read',
  'user/*.read',
  // system
  'system/Bundle.write',
  'system/*.write',
];

// ──────────────────────────────────────────
// ROLE → DEFAULT SCOPES
// ──────────────────────────────────────────

/** Default scopes granted per internal role at token issuance. */
const ROLE_SCOPES = {
  physician: [
    'openid', 'fhirUser', 'offline_access',
    'patient/*.read', 'user/*.read', 'system/Bundle.write',
  ],
  nurse_practitioner: [
    'openid', 'fhirUser', 'offline_access',
    'patient/*.read', 'user/*.read', 'system/Bundle.write',
  ],
  physician_assistant: [
    'openid', 'fhirUser', 'offline_access',
    'patient/*.read', 'user/*.read', 'system/Bundle.write',
  ],
  ma: [
    'openid', 'fhirUser',
    'patient/Patient.read', 'patient/Encounter.read',
    'patient/Observation.read', 'patient/AllergyIntolerance.read',
    'patient/Appointment.read',
  ],
  front_desk: [
    'openid', 'fhirUser',
    'patient/Patient.read', 'patient/Appointment.read',
  ],
  billing: [
    'openid', 'fhirUser',
    'patient/Patient.read', 'patient/Encounter.read',
  ],
  admin: [
    'openid', 'fhirUser',
    'user/*.read',
  ],
};

// ──────────────────────────────────────────
// RESOURCE → REQUIRED SCOPE
// ──────────────────────────────────────────

/**
 * Maps FHIR resource type + HTTP method to the required SMART scope.
 * Key: "<ResourceType>.<METHOD>" or "<ResourceType>" for all methods.
 */
const RESOURCE_SCOPE_MAP = {
  'Patient.GET':              'patient/Patient.read',
  'Encounter.GET':            'patient/Encounter.read',
  'Condition.GET':            'patient/Condition.read',
  'Observation.GET':          'patient/Observation.read',
  'AllergyIntolerance.GET':   'patient/AllergyIntolerance.read',
  'MedicationRequest.GET':    'patient/MedicationRequest.read',
  'Appointment.GET':          'patient/Appointment.read',
  'Practitioner.GET':         'user/Practitioner.read',
  // ── WRITE scopes (sec-fhir-write-unscoped-03) ──
  // Each write method requires an EXPLICIT write scope. Writes must NEVER fall
  // back to the resource's read scope (the prior vulnerability). No internal
  // role is granted these write scopes in ROLE_SCOPES, so all FHIR writes
  // fail closed for app-login tokens — FHIR ingestion is system-to-system only.
  'Patient.POST':             'system/Patient.write',
  'Patient.PUT':              'system/Patient.write',
  'Observation.POST':         'system/Observation.write',
  'Observation.PUT':          'system/Observation.write',
  'Condition.POST':           'system/Condition.write',
  'Condition.PUT':            'system/Condition.write',
  'AllergyIntolerance.POST':  'system/AllergyIntolerance.write',
  'AllergyIntolerance.PUT':   'system/AllergyIntolerance.write',
  'Bundle.POST':              'system/Bundle.write',
  // Public / non-PHI endpoints — no scope required.
  'metadata.GET':             null,
  '$stats.GET':               null,
};

// ──────────────────────────────────────────
// SCOPE WILDCARD EVALUATION
// ──────────────────────────────────────────

/**
 * Returns true if the grantedScopes array satisfies the requiredScope.
 *
 * Wildcard rules:
 *   patient/*.read  satisfies  patient/Patient.read, patient/Encounter.read, etc.
 *   user/*.read     satisfies  user/Practitioner.read, etc.
 *   system/*.write  satisfies  system/Bundle.write, etc.
 *
 * @param {string[]} grantedScopes - scopes in the token
 * @param {string}   requiredScope - scope required for this resource/operation
 * @returns {boolean}
 */
function scopeSatisfies(grantedScopes, requiredScope) {
  if (!requiredScope) return true;        // public endpoint
  if (!grantedScopes || grantedScopes.length === 0) return false;

  return grantedScopes.some(granted => {
    if (granted === requiredScope) return true;
    // Wildcard: patient/*.read satisfies patient/Patient.read
    if (granted.endsWith('/*.read') && requiredScope.endsWith('.read')) {
      const grantedCtx = granted.split('/')[0];
      const requiredCtx = requiredScope.split('/')[0];
      return grantedCtx === requiredCtx;
    }
    if (granted.endsWith('/*.write') && requiredScope.endsWith('.write')) {
      const grantedCtx = granted.split('/')[0];
      const requiredCtx = requiredScope.split('/')[0];
      return grantedCtx === requiredCtx;
    }
    return false;
  });
}

// ──────────────────────────────────────────
// DISCOVERY DOCUMENT
// ──────────────────────────────────────────

/**
 * Build the SMART-on-FHIR discovery document.
 * Returned at GET /.well-known/smart-configuration (unauthenticated).
 *
 * @param {string} baseUrl - e.g. "https://ehr.example.com"
 * @returns {Object}
 */
function buildSmartConfiguration(baseUrl) {
  return {
    issuer: baseUrl,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    authorization_endpoint: `${baseUrl}/smart/authorize`,
    token_endpoint: `${baseUrl}/smart/token`,
    introspection_endpoint: `${baseUrl}/smart/introspect`,
    revocation_endpoint: `${baseUrl}/smart/revoke`,
    capabilities: [
      'launch-ehr',
      'launch-standalone',
      'client-public',
      'client-confidential-symmetric',
      'sso-openid-connect',
      'context-passthrough-banner',
      'context-style-simple',
      'context-ehr-patient',
      'permission-offline',
      'permission-patient',
      'permission-user',
      'permission-system',
    ],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ALL_SCOPES,
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    token_endpoint_auth_signing_alg_values_supported: ['HS256'],
  };
}

module.exports = {
  buildSmartConfiguration,
  ROLE_SCOPES,
  RESOURCE_SCOPE_MAP,
  scopeSatisfies,
  ALL_SCOPES,
};
