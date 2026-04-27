// test/unit/data.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/data.js');
const { PATIENT, AGENTS, CDS, SOAP_DRAFT, PATIENT_VOICE, TRANSCRIPT } = mod;

describe('data module exports', () => {
  it('PATIENT exists and has a name', () => {
    assert.ok(PATIENT, 'PATIENT is defined');
    assert.strictEqual(typeof PATIENT.name, 'string', 'PATIENT.name is a string');
  });

  it('AGENTS is an object with agent group keys', () => {
    assert.ok(AGENTS && typeof AGENTS === 'object' && !Array.isArray(AGENTS), 'AGENTS is an object');
    assert.ok(Object.keys(AGENTS).length > 0, 'AGENTS has group keys');
  });

  it('CDS is a non-empty array', () => {
    assert.ok(Array.isArray(CDS), 'CDS is an array');
    assert.ok(CDS.length > 0, 'CDS has entries');
  });

  it('SOAP_DRAFT has subjective field', () => {
    assert.ok(SOAP_DRAFT, 'SOAP_DRAFT is defined');
    assert.ok('subjective' in SOAP_DRAFT, 'SOAP_DRAFT.subjective exists');
  });

  it('PATIENT_VOICE is a non-empty array', () => {
    assert.ok(Array.isArray(PATIENT_VOICE), 'PATIENT_VOICE is an array');
    assert.ok(PATIENT_VOICE.length > 0, 'PATIENT_VOICE has entries');
  });

  it('TRANSCRIPT is a non-empty array', () => {
    assert.ok(Array.isArray(TRANSCRIPT), 'TRANSCRIPT is an array');
    assert.ok(TRANSCRIPT.length > 0, 'TRANSCRIPT has entries');
  });
});
