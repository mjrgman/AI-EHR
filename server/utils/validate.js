/**
 * Request Validation Middleware for Agentic EHR
 * Zero-dependency schema validation for Express routes.
 */

const validators = {
  string(value, rules, field) {
    if (typeof value !== 'string') return `${field} must be a string`;
    const trimmed = value.trim();
    if (rules.required && trimmed.length === 0) return `${field} is required`;
    if (rules.minLength && trimmed.length < rules.minLength) return `${field} must be at least ${rules.minLength} characters`;
    if (rules.maxLength && trimmed.length > rules.maxLength) return `${field} must be at most ${rules.maxLength} characters`;
    if (rules.pattern && !rules.pattern.test(trimmed)) return `${field} has invalid format`;
    return null;
  },
  number(value, rules, field) {
    const num = Number(value);
    if (isNaN(num)) return `${field} must be a number`;
    if (rules.min !== undefined && num < rules.min) return `${field} must be >= ${rules.min}`;
    if (rules.max !== undefined && num > rules.max) return `${field} must be <= ${rules.max}`;
    if (rules.integer && !Number.isInteger(num)) return `${field} must be an integer`;
    return null;
  },
  enum(value, rules, field) {
    if (!rules.values.includes(value)) return `${field} must be one of: ${rules.values.join(', ')}`;
    return null;
  },
  date(value, rules, field) {
    if (typeof value !== 'string') return `${field} must be a date string`;
    if (isNaN(new Date(value).getTime())) return `${field} is not a valid date`;
    return null;
  },
  boolean(value, rules, field) {
    if (typeof value !== 'boolean') return `${field} must be a boolean`;
    return null;
  },
  array(value, rules, field) {
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (rules.minItems && value.length < rules.minItems) return `${field} must have at least ${rules.minItems} items`;
    if (rules.maxItems && value.length > rules.maxItems) return `${field} must have at most ${rules.maxItems} items`;
    return null;
  },
  object(value, rules, field) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${field} must be an object`;
    return null;
  },
};

function schema(definition) { return definition; }

function validate(schemaObj, options = {}) {
  const { source = 'body', stripUnknown = true } = options;
  return (req, res, next) => {
    const data = req[source];
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Request body is required' });
    const errors = [];
    const sanitized = {};
    for (const [field, rules] of Object.entries(schemaObj)) {
      const value = data[field];
      if (value === undefined || value === null || value === '') {
        if (rules.required) errors.push(`${field} is required`);
        if (rules.default !== undefined) sanitized[field] = rules.default;
        continue;
      }
      const validatorFn = validators[rules.type];
      if (validatorFn) {
        const err = validatorFn(value, rules, field);
        if (err) { errors.push(err); continue; }
      }
      if (rules.type === 'string' && typeof value === 'string') {
        sanitized[field] = value.trim().slice(0, rules.maxLength || 10000);
      } else {
        sanitized[field] = value;
      }
    }
    if (errors.length > 0) return res.status(400).json({ error: 'Validation failed', details: errors });
    req[source] = { ...data, ...sanitized };
    next();
  };
}

const schemas = {
  createPatient: schema({
    first_name: { type: 'string', required: true, maxLength: 100 },
    middle_name: { type: 'string', maxLength: 100 },
    last_name: { type: 'string', required: true, maxLength: 100 },
    dob: { type: 'date', required: true },
    sex: { type: 'enum', values: ['M', 'F', 'Other'] },
    phone: { type: 'string', maxLength: 20, pattern: /^[\d\-\(\)\s\+]*$/ },
    email: { type: 'string', maxLength: 200 },
    address_line1: { type: 'string', maxLength: 200 },
    address_line2: { type: 'string', maxLength: 200 },
    city: { type: 'string', maxLength: 100 },
    state: { type: 'string', maxLength: 2 },
    zip: { type: 'string', maxLength: 10, pattern: /^\d{5}(-\d{4})?$/ },
    insurance_carrier: { type: 'string', maxLength: 200 },
    insurance_id: { type: 'string', maxLength: 50 },
  }),
  addProblem: schema({
    problem_name: { type: 'string', required: true, maxLength: 300 },
    icd10_code: { type: 'string', maxLength: 10, pattern: /^[A-Z]\d{2}(\.\d{1,4})?$/ },
    onset_date: { type: 'date' },
    status: { type: 'enum', values: ['active', 'resolved', 'chronic', 'inactive'], default: 'active' },
    notes: { type: 'string', maxLength: 1000 },
  }),
  addMedication: schema({
    medication_name: { type: 'string', required: true, maxLength: 200 },
    dose: { type: 'string', maxLength: 100 },
    frequency: { type: 'string', maxLength: 100 },
    route: { type: 'string', maxLength: 50 },
    status: { type: 'enum', values: ['active', 'discontinued', 'on_hold'], default: 'active' },
    prescriber: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 1000 },
  }),
  addAllergy: schema({
    allergen: { type: 'string', required: true, maxLength: 200 },
    reaction: { type: 'string', maxLength: 500 },
    severity: { type: 'enum', values: ['mild', 'moderate', 'severe'] },
    status: { type: 'enum', values: ['active', 'inactive'], default: 'active' },
  }),
  addVitals: schema({
    systolic: { type: 'number', min: 40, max: 300 },
    diastolic: { type: 'number', min: 20, max: 200 },
    heart_rate: { type: 'number', min: 20, max: 300, integer: true },
    respiratory_rate: { type: 'number', min: 4, max: 60, integer: true },
    temperature: { type: 'number', min: 90, max: 110 },
    o2_saturation: { type: 'number', min: 50, max: 100 },
    weight: { type: 'number', min: 0, max: 1500 },
    height: { type: 'number', min: 0, max: 300 },
    bmi: { type: 'number', min: 5, max: 100 },
    pain_level: { type: 'number', min: 0, max: 10, integer: true },
  }),
  login: schema({
    username: { type: 'string', required: true, maxLength: 100 },
    password: { type: 'string', required: true, maxLength: 200 },
  }),
  createEncounter: schema({
    patient_id: { type: 'number', required: true, integer: true, min: 1 },
    encounter_type: { type: 'enum', values: ['office_visit', 'telehealth', 'phone', 'procedure', 'follow_up'], default: 'office_visit' },
    chief_complaint: { type: 'string', maxLength: 500 },
    provider_id: { type: 'string', maxLength: 100 },
  }),
};

module.exports = { schema, validate, schemas };
