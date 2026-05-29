'use strict';

/**
 * FHIR R4 Practitioner Mapper
 * Translates internal users table → FHIR Practitioner resource
 * Spec: https://hl7.org/fhir/R4/practitioner.html
 */

const { codeableConcept } = require('../utils/fhir-response');

// Internal role → FHIR PractitionerRole code
const ROLE_MAP = {
  'physician': { code: '112247003', display: 'Medical doctor', system: 'http://snomed.info/sct' },
  'nurse_practitioner': { code: '224571005', display: 'Nurse practitioner', system: 'http://snomed.info/sct' },
  'physician_assistant': { code: '449161006', display: 'Physician assistant', system: 'http://snomed.info/sct' },
  'ma': { code: '224608005', display: 'Medical assistant', system: 'http://snomed.info/sct' },
  'front_desk': { code: '159561009', display: 'Receptionist', system: 'http://snomed.info/sct' },
  'billing': { code: '768820003', display: 'Health care billing professional', system: 'http://snomed.info/sct' },
  'admin': { code: '224570006', display: 'Health care administrator', system: 'http://snomed.info/sct' }
};

/**
 * Map internal user record to FHIR R4 Practitioner resource
 * @param {Object} user - Internal user row from database
 * @returns {Object} FHIR Practitioner resource
 */
function toFhirPractitioner(user) {
  const resource = {
    resourceType: 'Practitioner',
    id: String(user.id),
    meta: {
      lastUpdated: user.updated_at || user.created_at
    },
    active: user.is_active === 1 || user.is_active === true,
    identifier: []
  };

  // NPI
  if (user.npi_number) {
    resource.identifier.push({
      use: 'official',
      system: 'http://hl7.org/fhir/sid/us-npi',
      value: user.npi_number
    });
  }

  // Username as local identifier
  resource.identifier.push({
    use: 'usual',
    system: 'urn:oid:2.16.840.1.113883.19.5',
    value: user.username
  });

  // Name (parse full_name into family/given)
  if (user.full_name) {
    const parts = user.full_name.trim().split(/\s+/);
    const name = { use: 'official' };
    if (parts.length >= 2) {
      name.family = parts[parts.length - 1];
      name.given = parts.slice(0, -1);
    } else {
      name.text = user.full_name;
    }
    resource.name = [name];
  }

  // Telecom
  resource.telecom = [];
  if (user.email) {
    resource.telecom.push({ system: 'email', value: user.email, use: 'work' });
  }
  if (user.phone) {
    resource.telecom.push({ system: 'phone', value: user.phone, use: 'work' });
  }
  if (resource.telecom.length === 0) delete resource.telecom;

  // Qualification (role mapping)
  const roleInfo = ROLE_MAP[user.role];
  if (roleInfo) {
    resource.qualification = [{
      code: codeableConcept(roleInfo.system, roleInfo.code, roleInfo.display)
    }];
  }

  return resource;
}

module.exports = { toFhirPractitioner };
