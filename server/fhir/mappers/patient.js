'use strict';

/**
 * FHIR R4 Patient Mapper
 * Translates internal patients table → FHIR Patient resource
 * Spec: https://hl7.org/fhir/R4/patient.html
 */

const { codeableConcept } = require('../utils/fhir-response');

// Internal sex → FHIR AdministrativeGender
const GENDER_MAP = {
  'M': 'male',
  'F': 'female',
  'Other': 'other'
};

/**
 * Map internal patient record to FHIR R4 Patient resource
 * @param {Object} pt - Internal patient row from database
 * @returns {Object} FHIR Patient resource
 */
function toFhirPatient(pt) {
  const resource = {
    resourceType: 'Patient',
    id: String(pt.id),
    meta: {
      lastUpdated: pt.updated_at || pt.created_at
    },
    identifier: [
      {
        use: 'usual',
        type: codeableConcept('http://terminology.hl7.org/CodeSystem/v2-0203', 'MR', 'Medical Record Number'),
        system: 'urn:oid:2.16.840.1.113883.19.5',  // Local MRN system
        value: pt.mrn
      }
    ],
    name: [{
      use: 'official',
      family: pt.last_name,
      given: [pt.first_name]
    }],
    birthDate: pt.dob,
    gender: GENDER_MAP[pt.sex] || 'unknown'
  };

  // Middle name
  if (pt.middle_name) {
    resource.name[0].given.push(pt.middle_name);
  }

  // Telecom (phone, email)
  resource.telecom = [];
  if (pt.phone) {
    resource.telecom.push({ system: 'phone', value: pt.phone, use: 'home' });
  }
  if (pt.email) {
    resource.telecom.push({ system: 'email', value: pt.email });
  }
  if (resource.telecom.length === 0) delete resource.telecom;

  // Address
  if (pt.address_line1 || pt.city || pt.state || pt.zip) {
    const addr = { use: 'home', type: 'physical' };
    const lines = [];
    if (pt.address_line1) lines.push(pt.address_line1);
    if (pt.address_line2) lines.push(pt.address_line2);
    if (lines.length) addr.line = lines;
    if (pt.city) addr.city = pt.city;
    if (pt.state) addr.state = pt.state;
    if (pt.zip) addr.postalCode = pt.zip;
    addr.country = 'US';
    resource.address = [addr];
  }

  // Insurance as coverage identifier (non-standard but useful)
  if (pt.insurance_carrier && pt.insurance_id) {
    resource.identifier.push({
      use: 'secondary',
      type: codeableConcept('http://terminology.hl7.org/CodeSystem/v2-0203', 'SN', 'Subscriber Number'),
      system: `urn:insurance:${pt.insurance_carrier.toLowerCase().replace(/\s+/g, '-')}`,
      value: pt.insurance_id
    });
  }

  return resource;
}

module.exports = { toFhirPatient };
