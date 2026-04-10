/**
 * MJR-EHR AI Client Module
 * Provides clinical data extraction via pattern matching (mock mode)
 * or Claude API (api mode).
 * Enhanced with ROS extraction, PE findings, HPI generation,
 * and improved SOAP note generation.
 */

const Anthropic = require('@anthropic-ai/sdk');

const AI_MODE = process.env.AI_MODE || 'mock';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function normalizeTranscriptText(text = '') {
  return text
    .replace(/[’‘]/g, '\'')
    .replace(/[“”]/g, '"')
    .replace(/Â°/g, '°');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toMedicationDisplayName(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function validateExtractionResponse(parsed) {
  if (typeof parsed !== 'object' || parsed === null) return false;
  // Ensure no unexpected database-mutation fields
  const dangerousKeys = ['patient_id', 'encounter_id', 'id', 'user_id', 'role'];
  for (const key of dangerousKeys) {
    if (key in parsed) delete parsed[key]; // Strip dangerous fields
  }
  return true;
}

function getMode() {
  return ANTHROPIC_API_KEY && AI_MODE === 'api' ? 'api' : 'mock';
}

function isClaudeEnabled() {
  return getMode() === 'api';
}

// Lazy singleton — only instantiated when API mode is active
let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

/**
 * Call Claude with a system prompt and user message.
 * Returns the text content of the response.
 * @param {string} system
 * @param {string} user
 * @param {string} model - defaults to haiku for cost efficiency
 */
async function callClaude(system, user, model = 'claude-haiku-4-5-20251001') {
  const client = getAnthropicClient();
  const AI_TIMEOUT_MS = 30000; // 30 second timeout

  const apiCall = client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('AI request timed out after 30 seconds')), AI_TIMEOUT_MS);
  });

  const message = await Promise.race([apiCall, timeoutPromise]);
  return message.content[0].type === 'text' ? message.content[0].text : '';
}

// ==========================================
// VITALS EXTRACTION (Enhanced)
// ==========================================

function extractVitals(transcript) {
  const text = normalizeTranscriptText(transcript);
  const vitals = {};

  // Blood pressure: "142 over 88", "142/88", "BP 142/88", "blood pressure 142/88"
  const bpMatch = text.match(/(?:blood\s*pressure|BP)?\s*(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i);
  if (bpMatch) {
    vitals.systolic_bp = parseInt(bpMatch[1], 10);
    vitals.diastolic_bp = parseInt(bpMatch[2], 10);
  }

  // Heart rate: "heart rate is 76", "pulse 76", "HR 76", "rate of 76"
  const hrMatch = text.match(/(?:heart\s*rate|pulse|HR)\s*(?:is|of|:|\s)\s*(\d{2,3})/i);
  if (hrMatch) {
    vitals.heart_rate = parseInt(hrMatch[1], 10);
  }

  // Temperature: "temperature 98.6", "temp 98.6 degrees", "temp is 99.1"
  const tempMatch = text.match(/(?:temperature|temp)\s*(?:is|of|:|\s)\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:degrees|°|F|fahrenheit)?/i);
  if (tempMatch) {
    vitals.temperature = parseFloat(tempMatch[1]);
  }

  // Weight: "weight is 187", "weighs 187 pounds", "187 lbs"
  const weightMatch = text.match(/(?:weight|weighs)\s*(?:is|of|:|\s)\s*(\d{2,4}(?:\.\d{1,2})?)\s*(?:pounds|lbs?|kg)?/i);
  if (weightMatch) {
    vitals.weight = parseFloat(weightMatch[1]);
  }

  // Height: "height is 5 foot 8", "5'8", "height 68 inches"
  const heightFtMatch = text.match(/(?:height\s*(?:is|of|:)?\s*)?(\d)\s*(?:foot|feet|ft|')\s*(\d{1,2})\s*(?:inches|in|")?/i);
  if (heightFtMatch) {
    vitals.height = parseInt(heightFtMatch[1], 10) * 12 + parseInt(heightFtMatch[2], 10);
  } else {
    const heightInMatch = text.match(/height\s*(?:is|of|:|\s)\s*(\d{2,3})\s*(?:inches|in)/i);
    if (heightInMatch) {
      vitals.height = parseInt(heightInMatch[1], 10);
    }
  }

  // Respiratory rate: "respiratory rate 16", "RR 16", "breathing rate 16", "resp rate 16"
  const rrMatch = text.match(/(?:respiratory\s*rate|resp\s*rate|RR|breathing\s*rate)\s*(?:is|of|:|\s)\s*(\d{1,2})/i);
  if (rrMatch) {
    vitals.respiratory_rate = parseInt(rrMatch[1], 10);
  }

  // SpO2: "oxygen sat 98", "SpO2 98%", "O2 sat 98", "pulse ox 98", "sat's at 93"
  const spo2Match = text.match(/(?:oxygen\s*sat(?:uration)?|SpO2|O2\s*sat|pulse\s*ox(?:imetry)?|sat(?:uration)?(?:'s)?)\s*(?:is|of|at|:|\s)\s*(\d{2,3})\s*%?/i);
  if (spo2Match) {
    vitals.spo2 = parseInt(spo2Match[1], 10);
  }

  // BMI: auto-calculate if height and weight available
  if (vitals.weight && vitals.height) {
    vitals.bmi = Math.round((vitals.weight / (vitals.height * vitals.height)) * 703 * 10) / 10;
  }

  return vitals;
}

// ==========================================
// MEDICATION EXTRACTION (Enhanced)
// ==========================================

const FREQUENCY_MAP = {
  'once daily': 'daily', 'once a day': 'daily', 'every day': 'daily', 'daily': 'daily', 'q day': 'daily', 'qd': 'daily',
  'twice daily': 'BID', 'twice a day': 'BID', 'two times a day': 'BID', 'bid': 'BID', 'b.i.d.': 'BID',
  'three times daily': 'TID', 'three times a day': 'TID', 'tid': 'TID', 't.i.d.': 'TID',
  'four times daily': 'QID', 'four times a day': 'QID', 'qid': 'QID', 'q.i.d.': 'QID',
  'at bedtime': 'qHS', 'at night': 'qHS', 'qhs': 'qHS', 'every night': 'qHS', 'nightly': 'qHS',
  'every morning': 'qAM', 'in the morning': 'qAM', 'qam': 'qAM',
  'weekly': 'weekly', 'once weekly': 'weekly', 'once a week': 'weekly', 'every week': 'weekly',
  'every other day': 'QOD', 'every 2 days': 'QOD',
  'as needed': 'PRN', 'prn': 'PRN', 'when needed': 'PRN',
  'every 4 hours': 'q4h', 'every 6 hours': 'q6h', 'every 8 hours': 'q8h', 'every 12 hours': 'q12h',
  'with meals': 'TID with meals', 'before meals': 'AC', 'after meals': 'PC'
};

const ROUTE_MAP = {
  'by mouth': 'PO', 'orally': 'PO', 'oral': 'PO', 'po': 'PO',
  'subcutaneous': 'SC', 'subcutaneously': 'SC', 'subq': 'SC', 'sc': 'SC', 'sub-q': 'SC',
  'intramuscular': 'IM', 'im': 'IM',
  'intravenous': 'IV', 'iv': 'IV',
  'topical': 'topical', 'topically': 'topical', 'apply to skin': 'topical',
  'inhaled': 'INH', 'inhaler': 'INH', 'nebulizer': 'INH',
  'rectal': 'PR', 'rectally': 'PR',
  'sublingual': 'SL', 'under the tongue': 'SL',
  'ophthalmic': 'ophthalmic', 'eye drops': 'ophthalmic',
  'otic': 'otic', 'ear drops': 'otic',
  'nasal': 'nasal', 'nasal spray': 'nasal',
  'transdermal': 'transdermal', 'patch': 'transdermal'
};

// Common medications with typical doses for intelligent suggestions
const COMMON_MEDICATIONS = {
  'metformin': { doses: ['500mg', '850mg', '1000mg'], route: 'PO', freq: 'BID', indication: 'Type 2 Diabetes' },
  'lisinopril': { doses: ['5mg', '10mg', '20mg', '40mg'], route: 'PO', freq: 'daily', indication: 'Hypertension' },
  'amlodipine': { doses: ['2.5mg', '5mg', '10mg'], route: 'PO', freq: 'daily', indication: 'Hypertension' },
  'atorvastatin': { doses: ['10mg', '20mg', '40mg', '80mg'], route: 'PO', freq: 'daily', indication: 'Hyperlipidemia' },
  'rosuvastatin': { doses: ['5mg', '10mg', '20mg', '40mg'], route: 'PO', freq: 'daily', indication: 'Hyperlipidemia' },
  'omeprazole': { doses: ['20mg', '40mg'], route: 'PO', freq: 'daily', indication: 'GERD' },
  'losartan': { doses: ['25mg', '50mg', '100mg'], route: 'PO', freq: 'daily', indication: 'Hypertension' },
  'gabapentin': { doses: ['100mg', '300mg', '600mg', '800mg'], route: 'PO', freq: 'TID', indication: 'Neuropathy' },
  'levothyroxine': { doses: ['25mcg', '50mcg', '75mcg', '100mcg', '125mcg'], route: 'PO', freq: 'daily', indication: 'Hypothyroidism' },
  'albuterol': { doses: ['2 puffs'], route: 'INH', freq: 'PRN', indication: 'Asthma/COPD' },
  'ozempic': { doses: ['0.25mg', '0.5mg', '1mg', '2mg'], route: 'SC', freq: 'weekly', indication: 'Type 2 Diabetes' },
  'insulin glargine': { doses: ['10 units', '20 units', '30 units'], route: 'SC', freq: 'daily', indication: 'Diabetes' },
  'hydrochlorothiazide': { doses: ['12.5mg', '25mg', '50mg'], route: 'PO', freq: 'daily', indication: 'Hypertension' },
  'aspirin': { doses: ['81mg', '325mg'], route: 'PO', freq: 'daily', indication: 'Cardiovascular prevention' },
  'warfarin': { doses: ['1mg', '2mg', '2.5mg', '5mg', '7.5mg', '10mg'], route: 'PO', freq: 'daily', indication: 'Anticoagulation' },
  'apixaban': { doses: ['2.5mg', '5mg'], route: 'PO', freq: 'BID', indication: 'Anticoagulation' },
  'prednisone': { doses: ['5mg', '10mg', '20mg', '40mg'], route: 'PO', freq: 'daily', indication: 'Anti-inflammatory' },
  'acetaminophen': { doses: ['500mg', '650mg', '1000mg'], route: 'PO', freq: 'PRN', indication: 'Pain/Fever' },
  'ibuprofen': { doses: ['200mg', '400mg', '600mg', '800mg'], route: 'PO', freq: 'PRN', indication: 'Pain/Inflammation' },
  'furosemide': { doses: ['20mg', '40mg', '80mg'], route: 'PO', freq: 'daily', indication: 'Edema/CHF' },
  'spironolactone': { doses: ['25mg', '50mg', '100mg'], route: 'PO', freq: 'daily', indication: 'Heart Failure/Hypertension' },
};

const MEDICATION_ALIASES = {
  lasix: 'furosemide',
  glucophage: 'metformin',
  ozempic: 'ozempic',
  furosemide: 'furosemide',
  spironolactone: 'spironolactone',
  metformin: 'metformin',
  lisinopril: 'lisinopril',
  amlodipine: 'amlodipine',
  atorvastatin: 'atorvastatin',
  rosuvastatin: 'rosuvastatin',
  omeprazole: 'omeprazole',
  losartan: 'losartan',
  gabapentin: 'gabapentin',
  levothyroxine: 'levothyroxine',
  albuterol: 'albuterol',
  'insulin glargine': 'insulin glargine',
  hydrochlorothiazide: 'hydrochlorothiazide',
  aspirin: 'aspirin',
  warfarin: 'warfarin',
  apixaban: 'apixaban',
  prednisone: 'prednisone',
  acetaminophen: 'acetaminophen',
  ibuprofen: 'ibuprofen'
};

function normalizeMedicationDose(rawDose, rawUnit, knownMed) {
  if (!rawDose) return knownMed?.doses?.[0] || '';

  if (rawUnit) {
    return `${rawDose}${rawUnit.toLowerCase()}`;
  }

  const inferredDose = knownMed?.doses?.find(candidate => candidate.toLowerCase().startsWith(String(rawDose).toLowerCase()));
  if (inferredDose) {
    return inferredDose;
  }

  return String(rawDose);
}

function extractMedications(transcript) {
  const text = normalizeTranscriptText(transcript);
  const lowerText = text.toLowerCase();
  const medications = [];
  const seen = new Set();
  const sortedFreqs = Object.entries(FREQUENCY_MAP).sort((a, b) => b[0].length - a[0].length);

  const aliasEntries = Object.entries(MEDICATION_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonicalKey] of aliasEntries) {
    const knownMed = COMMON_MEDICATIONS[canonicalKey];
    const pattern = new RegExp(
      `\\b${escapeRegex(alias)}\\b(?:\\s*(?:to|at|dose\\s+of|up\\s+to|increase\\s+to|decrease\\s+to|start(?:ed)?\\s+(?:on\\s+)?)?\\s*(\\d+(?:\\.\\d+)?))?\\s*(mg|mcg|g|ml|units?|iu)?`,
      'ig'
    );

    let aliasMatch;
    while ((aliasMatch = pattern.exec(text)) !== null) {
      const name = toMedicationDisplayName(alias);
      const contextAfter = lowerText.slice(aliasMatch.index, aliasMatch.index + 140);
      const dose = normalizeMedicationDose(aliasMatch[1], aliasMatch[2], knownMed);
      let route = knownMed?.route || 'PO';

      for (const [keyword, routeCode] of Object.entries(ROUTE_MAP)) {
        if (contextAfter.includes(keyword)) {
          route = routeCode;
          break;
        }
      }

      let frequency = knownMed?.freq || 'daily';
      for (const [keyword, freqCode] of sortedFreqs) {
        if (contextAfter.includes(keyword)) {
          frequency = freqCode;
          break;
        }
      }

      const dedupeKey = `${canonicalKey}|${dose}|${route}|${frequency}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        medications.push({ name, dose, route, frequency, indication: knownMed?.indication || '' });
      }
    }
  }

  const medPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|IU))\b/gi;

  let match;
  while ((match = medPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const dose = match[2].replace(/\s+/g, '');

    const skipWords = ['patient', 'doctor', 'nurse', 'blood', 'heart', 'stage', 'type', 'about', 'around', 'level', 'result', 'value'];
    if (skipWords.includes(name.toLowerCase())) continue;

    const afterDose = text.substring(match.index + match[0].length, match.index + match[0].length + 80).toLowerCase();
    let route = 'PO';
    for (const [keyword, routeCode] of Object.entries(ROUTE_MAP)) {
      if (afterDose.includes(keyword)) { route = routeCode; break; }
    }

    const contextAfter = lowerText.substring(match.index, match.index + 140);
    let frequency = 'daily';
    for (const [keyword, freqCode] of sortedFreqs) {
      if (contextAfter.includes(keyword)) { frequency = freqCode; break; }
    }

    // Check if this is a known medication and apply smart defaults
    const knownMed = COMMON_MEDICATIONS[name.toLowerCase()];
    if (knownMed) {
      if (route === 'PO' && knownMed.route !== 'PO') route = knownMed.route;
      if (frequency === 'daily' && knownMed.freq !== 'daily') frequency = knownMed.freq;
    }

    const dedupeKey = `${name.toLowerCase()}|${dose}|${route}|${frequency}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      medications.push({ name, dose, route, frequency, indication: knownMed?.indication || '' });
    }
  }

  return medications;
}

// ==========================================
// PROBLEM/DIAGNOSIS EXTRACTION (Enhanced)
// ==========================================

const DIAGNOSIS_MAP = [
  { patterns: [/type\s*2\s*diabetes/i, /diabetes\s*mellitus\s*type\s*2/i, /T2DM/i, /type\s*II\s*diabetes/i, /DM\s*2/i, /DM2/i], name: 'Type 2 Diabetes Mellitus', code: 'E11.9' },
  { patterns: [/type\s*1\s*diabetes/i, /diabetes\s*mellitus\s*type\s*1/i, /T1DM/i, /DM\s*1/i], name: 'Type 1 Diabetes Mellitus', code: 'E10.9' },
  { patterns: [/hypertension/i, /high\s*blood\s*pressure/i, /HTN/i, /elevated\s*blood\s*pressure/i], name: 'Hypertension', code: 'I10' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*3a/i, /CKD\s*(?:stage\s*)?3a/i], name: 'Chronic Kidney Disease Stage 3a', code: 'N18.3' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*3b/i, /CKD\s*(?:stage\s*)?3b/i], name: 'Chronic Kidney Disease Stage 3b', code: 'N18.3' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*4/i, /CKD\s*(?:stage\s*)?4/i], name: 'Chronic Kidney Disease Stage 4', code: 'N18.4' },
  { patterns: [/chronic\s*kidney\s*disease\s*stage\s*5/i, /CKD\s*(?:stage\s*)?5/i, /ESRD/i, /end\s*stage\s*renal/i], name: 'Chronic Kidney Disease Stage 5', code: 'N18.5' },
  { patterns: [/chronic\s*kidney\s*disease/i, /CKD/i], name: 'Chronic Kidney Disease', code: 'N18.9' },
  { patterns: [/obesity/i, /obese/i, /BMI\s*(?:over|above|>)\s*30/i, /morbid(?:ly)?\s*obese/i], name: 'Obesity', code: 'E66.9' },
  { patterns: [/hyperlipidemia/i, /high\s*cholesterol/i, /dyslipidemia/i, /elevated\s*(?:cholesterol|lipids)/i], name: 'Hyperlipidemia', code: 'E78.5' },
  { patterns: [/COPD/i, /chronic\s*obstructive\s*pulmonary/i, /emphysema/i, /chronic\s*bronchitis/i], name: 'COPD', code: 'J44.1' },
  { patterns: [/asthma/i, /reactive\s*airway/i], name: 'Asthma', code: 'J45.909' },
  { patterns: [/heart\s*failure/i, /CHF/i, /congestive\s*heart/i, /HFrEF/i, /HFpEF/i], name: 'Heart Failure', code: 'I50.9' },
  { patterns: [/atrial\s*fibrillation/i, /a[\s-]*fib/i, /afib/i, /AF\b/i], name: 'Atrial Fibrillation', code: 'I48.91' },
  { patterns: [/coronary\s*artery\s*disease/i, /CAD/i, /ischemic\s*heart/i], name: 'Coronary Artery Disease', code: 'I25.10' },
  { patterns: [/major\s*depressive/i, /MDD/i, /clinical\s*depression/i], name: 'Major Depressive Disorder', code: 'F32.9' },
  { patterns: [/depression/i, /depressed/i], name: 'Depression', code: 'F32.9' },
  { patterns: [/generalized\s*anxiety/i, /GAD/i], name: 'Generalized Anxiety Disorder', code: 'F41.1' },
  { patterns: [/anxiety/i, /anxious/i], name: 'Anxiety Disorder', code: 'F41.9' },
  { patterns: [/hypothyroid/i, /low\s*thyroid/i, /hashimoto/i], name: 'Hypothyroidism', code: 'E03.9' },
  { patterns: [/hyperthyroid/i, /graves/i, /overactive\s*thyroid/i], name: 'Hyperthyroidism', code: 'E05.90' },
  { patterns: [/GERD/i, /acid\s*reflux/i, /gastroesophageal\s*reflux/i, /heartburn/i], name: 'GERD', code: 'K21.0' },
  { patterns: [/osteoarthritis/i, /OA\b/i, /degenerative\s*joint/i, /DJD/i], name: 'Osteoarthritis', code: 'M19.90' },
  { patterns: [/sleep\s*apnea/i, /OSA/i, /obstructive\s*sleep/i], name: 'Obstructive Sleep Apnea', code: 'G47.33' },
  { patterns: [/anemia/i, /low\s*(?:hemoglobin|hgb|red\s*blood)/i], name: 'Anemia', code: 'D64.9' },
  { patterns: [/peripheral\s*neuropathy/i, /neuropathy/i, /diabetic\s*neuropathy/i], name: 'Peripheral Neuropathy', code: 'G62.9' },
  { patterns: [/chronic\s*pain/i], name: 'Chronic Pain Syndrome', code: 'G89.29' },
  { patterns: [/low\s*back\s*pain/i, /lumbago/i, /lumbar\s*pain/i], name: 'Low Back Pain', code: 'M54.5' },
  { patterns: [/migraine/i], name: 'Migraine', code: 'G43.909' },
  { patterns: [/headache/i, /tension\s*headache/i], name: 'Headache', code: 'R51.9' },
  { patterns: [/urinary\s*tract\s*infection/i, /UTI/i], name: 'Urinary Tract Infection', code: 'N39.0' },
  { patterns: [/pneumonia/i], name: 'Pneumonia', code: 'J18.9' },
  { patterns: [/upper\s*respiratory/i, /URI/i, /common\s*cold/i], name: 'Upper Respiratory Infection', code: 'J06.9' },
  { patterns: [/sinusitis/i, /acute\s*sinus\s*infection/i], name: 'Acute Sinusitis', code: 'J01.90' },
  { patterns: [/benign\s*prostatic/i, /BPH/i, /enlarged\s*prostate/i], name: 'Benign Prostatic Hyperplasia', code: 'N40.0' },
  { patterns: [/iron\s*deficiency/i], name: 'Iron Deficiency Anemia', code: 'D50.9' },
  { patterns: [/vitamin\s*D\s*deficiency/i, /low\s*vitamin\s*D/i], name: 'Vitamin D Deficiency', code: 'E55.9' },
  { patterns: [/edema/i, /swollen\s*legs?/i, /lower\s*extremity\s*edema/i, /pitting/i], name: 'Edema', code: 'R60.9' },
  { patterns: [/orthopnea/i], name: 'Orthopnea', code: 'R06.01' },
  { patterns: [/dyspnea\s*on\s*exertion/i, /\bDOE\b/i], name: 'Dyspnea on Exertion', code: 'R06.09' },
  { patterns: [/shortness\s*of\s*breath/i, /\bSOB\b/i, /winded/i], name: 'Shortness of Breath', code: 'R06.02' },
];

function extractProblems(transcript) {
  const text = normalizeTranscriptText(transcript);
  const problems = [];
  const seen = new Set();

  for (const dx of DIAGNOSIS_MAP) {
    for (const pattern of dx.patterns) {
      if (pattern.test(text) && !seen.has(dx.code)) {
        seen.add(dx.code);
        problems.push({ name: dx.name, code: dx.code });
        break;
      }
    }
  }

  return problems;
}

// ==========================================
// LAB ORDER EXTRACTION (Enhanced)
// ==========================================

const LAB_MAP = [
  { patterns: [/A1C/i, /hemoglobin\s*A1C/i, /HbA1c/i, /glycated\s*hemoglobin/i], name: 'Hemoglobin A1C', cpt: '83036' },
  { patterns: [/basic\s*metabolic\s*panel/i, /BMP/i, /chem\s*7/i], name: 'Basic Metabolic Panel', cpt: '80048' },
  { patterns: [/comprehensive\s*metabolic\s*panel/i, /CMP/i, /chem\s*14/i], name: 'Comprehensive Metabolic Panel', cpt: '80053' },
  { patterns: [/CBC/i, /complete\s*blood\s*count/i], name: 'Complete Blood Count', cpt: '85025' },
  { patterns: [/urine\s*microalbumin/i, /microalbumin/i, /urine\s*albumin/i, /UACR/i, /albumin.creatinine\s*ratio/i], name: 'Urine Microalbumin/Creatinine Ratio', cpt: '82043' },
  { patterns: [/lipid\s*panel/i, /lipids/i, /cholesterol\s*panel/i, /fasting\s*lipids/i], name: 'Lipid Panel', cpt: '80061' },
  { patterns: [/TSH/i, /thyroid\s*stimulating/i, /thyroid\s*function/i], name: 'TSH', cpt: '84443' },
  { patterns: [/free\s*T4/i, /thyroxine/i], name: 'Free T4', cpt: '84439' },
  { patterns: [/creatinine/i, /serum\s*creatinine/i], name: 'Creatinine', cpt: '82565' },
  { patterns: [/eGFR/i, /estimated\s*GFR/i, /glomerular\s*filtration/i], name: 'eGFR', cpt: '82565' },
  { patterns: [/urinalysis/i, /UA\b/i, /urine\s*analysis/i], name: 'Urinalysis', cpt: '81003' },
  { patterns: [/liver\s*function/i, /LFTs?/i, /hepatic\s*panel/i, /liver\s*panel/i], name: 'Liver Function Tests', cpt: '80076' },
  { patterns: [/PT\s*\/?\s*INR/i, /prothrombin\s*time/i, /INR/i, /coag/i], name: 'PT/INR', cpt: '85610' },
  { patterns: [/vitamin\s*D/i, /25-hydroxy/i, /25.OH.vitamin/i], name: 'Vitamin D, 25-Hydroxy', cpt: '82306' },
  { patterns: [/ferritin/i, /iron\s*studies/i], name: 'Ferritin', cpt: '82728' },
  { patterns: [/B12/i, /cobalamin/i, /vitamin\s*B.?12/i], name: 'Vitamin B12', cpt: '82607' },
  { patterns: [/PSA/i, /prostate\s*specific/i], name: 'PSA', cpt: '84153' },
  { patterns: [/magnesium/i, /mag\s*level/i], name: 'Magnesium', cpt: '83735' },
  { patterns: [/phosphorus/i, /phos\s*level/i], name: 'Phosphorus', cpt: '84100' },
  { patterns: [/uric\s*acid/i], name: 'Uric Acid', cpt: '84550' },
  { patterns: [/BNP/i, /brain\s*natriuretic/i, /NT.proBNP/i], name: 'BNP/NT-proBNP', cpt: '83880' },
  { patterns: [/troponin/i], name: 'Troponin', cpt: '84484' },
  { patterns: [/sed\s*rate/i, /ESR/i, /erythrocyte\s*sedimentation/i], name: 'ESR', cpt: '85651' },
  { patterns: [/CRP/i, /C.reactive\s*protein/i], name: 'C-Reactive Protein', cpt: '86140' },
  { patterns: [/blood\s*culture/i], name: 'Blood Culture', cpt: '87040' },
  { patterns: [/urine\s*culture/i], name: 'Urine Culture', cpt: '87086' },
  { patterns: [/hemoglobin\s*electrophoresis/i], name: 'Hemoglobin Electrophoresis', cpt: '83020' },
  { patterns: [/folate/i, /folic\s*acid/i], name: 'Folate', cpt: '82746' },
];

function extractLabOrders(transcript) {
  const labs = [];
  const seen = new Set();

  for (const lab of LAB_MAP) {
    for (const pattern of lab.patterns) {
      if (pattern.test(transcript) && !seen.has(lab.cpt)) {
        seen.add(lab.cpt);
        labs.push({ name: lab.name, cpt: lab.cpt });
        break;
      }
    }
  }

  return labs;
}

// ==========================================
// REVIEW OF SYSTEMS EXTRACTION (New)
// ==========================================

const ROS_CATEGORIES = {
  'Constitutional': {
    positive: [/fever/i, /chills/i, /weight\s*(?:loss|gain)/i, /fatigue/i, /malaise/i, /night\s*sweats/i, /weakness/i],
    negative: [/(?:no|denies?)\s*(?:fever|chills|weight\s*(?:loss|gain)|fatigue|night\s*sweats)/i]
  },
  'HEENT': {
    positive: [/headache/i, /vision\s*(?:change|blur)/i, /ear\s*pain/i, /sore\s*throat/i, /nasal\s*congestion/i, /sinus/i],
    negative: [/(?:no|denies?)\s*(?:headache|vision\s*changes?|ear\s*pain|sore\s*throat)/i]
  },
  'Cardiovascular': {
    positive: [/chest\s*pain/i, /palpitation/i, /edema/i, /swelling\s*(?:in\s*)?(?:legs?|ankles?|feet)/i, /syncope/i, /dizziness/i, /orthopnea/i, /PND/i],
    negative: [/(?:no|denies?)\s*(?:chest\s*pain|palpitation|edema|swelling|syncope|dizziness)/i]
  },
  'Respiratory': {
    positive: [/shortness\s*of\s*breath/i, /SOB/i, /cough/i, /wheezing/i, /dyspnea/i, /hemoptysis/i],
    negative: [/(?:no|denies?)\s*(?:shortness\s*of\s*breath|SOB|cough|wheezing|dyspnea)/i]
  },
  'Gastrointestinal': {
    positive: [/nausea/i, /vomiting/i, /abdominal\s*pain/i, /diarrhea/i, /constipation/i, /heartburn/i, /blood\s*in\s*stool/i],
    negative: [/(?:no|denies?)\s*(?:nausea|vomiting|abdominal\s*pain|diarrhea|constipation)/i]
  },
  'Musculoskeletal': {
    positive: [/joint\s*pain/i, /back\s*pain/i, /muscle\s*(?:pain|ache)/i, /stiffness/i, /arthralgia/i, /myalgia/i],
    negative: [/(?:no|denies?)\s*(?:joint\s*pain|back\s*pain|muscle\s*pain|stiffness)/i]
  },
  'Neurological': {
    positive: [/numbness/i, /tingling/i, /paresthesia/i, /tremor/i, /seizure/i, /memory\s*(?:loss|problems?)/i],
    negative: [/(?:no|denies?)\s*(?:numbness|tingling|tremor|seizure)/i]
  },
  'Psychiatric': {
    positive: [/depressed/i, /anxious/i, /insomnia/i, /sleep\s*(?:difficulty|problems?)/i, /stress/i],
    negative: [/(?:no|denies?)\s*(?:depression|anxiety|insomnia|sleep\s*problems?)/i]
  },
  'Endocrine': {
    positive: [/polyuria/i, /polydipsia/i, /polyphagia/i, /heat\s*intolerance/i, /cold\s*intolerance/i, /blood\s*sugar/i],
    negative: [/(?:no|denies?)\s*(?:polyuria|polydipsia|heat\s*intolerance|cold\s*intolerance)/i]
  },
};

function extractROS(transcript) {
  const ros = {};
  for (const [category, { positive, negative }] of Object.entries(ROS_CATEGORIES)) {
    const positiveFindings = [];
    const negativeFindings = [];

    for (const pattern of positive) {
      const m = transcript.match(pattern);
      if (m) positiveFindings.push(m[0].trim());
    }
    for (const pattern of negative) {
      const m = transcript.match(pattern);
      if (m) negativeFindings.push(m[0].trim());
    }

    if (positiveFindings.length > 0 || negativeFindings.length > 0) {
      ros[category] = { positive: positiveFindings, negative: negativeFindings };
    }
  }
  return ros;
}

// ==========================================
// PHYSICAL EXAM EXTRACTION (New)
// ==========================================

function extractPhysicalExam(transcript) {
  const pe = {};
  const text = transcript;

  // General appearance
  const generalPatterns = [
    { pattern: /(?:appears?|looks?)\s*(?:well|good|comfortable)/i, finding: 'Appears well, in no acute distress' },
    { pattern: /(?:alert\s*(?:and\s*)?oriented)/i, finding: 'Alert and oriented' },
    { pattern: /(?:no\s*acute\s*distress|NAD)/i, finding: 'No acute distress' },
    { pattern: /(?:ill.appearing|acutely\s*ill)/i, finding: 'Ill-appearing' },
  ];
  const generalFindings = generalPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (generalFindings.length > 0) pe['General'] = generalFindings.join('. ');

  // Heart/Cardiac
  const cardiacPatterns = [
    { pattern: /(?:regular\s*rate\s*(?:and\s*)?rhythm|RRR)/i, finding: 'Regular rate and rhythm' },
    { pattern: /(?:no\s*murmur)/i, finding: 'No murmurs' },
    { pattern: /(?:murmur)/i, finding: 'Murmur noted' },
    { pattern: /(?:irregular\s*(?:rate|rhythm))/i, finding: 'Irregularly irregular rhythm' },
    { pattern: /(?:S[34]\s*(?:gallop)?)/i, finding: 'Extra heart sounds' },
  ];
  const cardiacFindings = cardiacPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (cardiacFindings.length > 0) pe['Cardiovascular'] = cardiacFindings.join('. ');

  // Lungs
  const lungPatterns = [
    { pattern: /(?:clear\s*to\s*auscultation|CTA)/i, finding: 'Clear to auscultation bilaterally' },
    { pattern: /(?:no\s*(?:wheezes?|crackles?|rales?))/i, finding: 'No wheezes, crackles, or rales' },
    { pattern: /(?:crackles|rales)/i, finding: 'Crackles noted' },
    { pattern: /(?:wheezing|wheeze)/i, finding: 'Wheezing' },
    { pattern: /(?:diminished\s*breath\s*sounds?)/i, finding: 'Diminished breath sounds' },
  ];
  const lungFindings = lungPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (lungFindings.length > 0) pe['Respiratory'] = lungFindings.join('. ');

  // Abdomen
  const abdPatterns = [
    { pattern: /(?:soft|non.?tender|non.?distended)/i, finding: 'Soft, non-tender, non-distended' },
    { pattern: /(?:normal\s*bowel\s*sounds?|(?:positive|active)\s*bowel\s*sounds?)/i, finding: 'Normal bowel sounds' },
    { pattern: /(?:tender(?:ness)?\s*(?:in|at|over)\s*(?:the\s*)?(?:\w+))/i, finding: 'Tenderness noted' },
  ];
  const abdFindings = abdPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (abdFindings.length > 0) pe['Abdomen'] = abdFindings.join('. ');

  // Extremities
  const extPatterns = [
    { pattern: /(?:no\s*(?:edema|swelling))/i, finding: 'No edema' },
    { pattern: /(?:(?:pedal|lower\s*extremity|ankle|bilateral)\s*edema)/i, finding: 'Edema present' },
    { pattern: /(?:(\d)\+\s*(?:pitting\s*)?edema)/i, finding: 'Pitting edema' },
    { pattern: /(?:pulses?\s*(?:intact|palpable|present))/i, finding: 'Pulses intact' },
  ];
  const extFindings = extPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (extFindings.length > 0) pe['Extremities'] = extFindings.join('. ');

  // Skin
  const skinPatterns = [
    { pattern: /(?:no\s*rash)/i, finding: 'No rash' },
    { pattern: /(?:warm\s*(?:and\s*)?dry)/i, finding: 'Warm and dry' },
    { pattern: /(?:rash|lesion|wound)/i, finding: 'Skin findings noted' },
  ];
  const skinFindings = skinPatterns.filter(p => p.pattern.test(text)).map(p => p.finding);
  if (skinFindings.length > 0) pe['Skin'] = skinFindings.join('. ');

  return pe;
}

// ==========================================
// IMAGING ORDER EXTRACTION (New)
// ==========================================

const IMAGING_MAP = [
  { patterns: [/chest\s*(?:x-?ray|XR|radiograph)/i, /CXR/i], study: 'X-ray', bodyPart: 'Chest' },
  { patterns: [/(?:CT|CAT)\s*(?:scan\s*(?:of\s*)?)?(?:the\s*)?(?:chest|thorax)/i], study: 'CT', bodyPart: 'Chest' },
  { patterns: [/(?:CT|CAT)\s*(?:scan\s*(?:of\s*)?)?(?:the\s*)?(?:abdomen|belly)/i, /abdominal\s*CT/i], study: 'CT', bodyPart: 'Abdomen/Pelvis' },
  { patterns: [/(?:CT|CAT)\s*(?:scan\s*(?:of\s*)?)?(?:the\s*)?head/i, /head\s*CT/i], study: 'CT', bodyPart: 'Head' },
  { patterns: [/MRI\s*(?:of\s*(?:the\s*)?)?(?:brain|head)/i, /brain\s*MRI/i], study: 'MRI', bodyPart: 'Brain' },
  { patterns: [/MRI\s*(?:of\s*(?:the\s*)?)?(?:spine|lumbar|cervical)/i, /(?:lumbar|cervical|spine)\s*MRI/i], study: 'MRI', bodyPart: 'Spine' },
  { patterns: [/MRI\s*(?:of\s*(?:the\s*)?)?knee/i, /knee\s*MRI/i], study: 'MRI', bodyPart: 'Knee' },
  { patterns: [/(?:EKG|ECG|electrocardiogram)/i], study: 'EKG', bodyPart: 'Heart' },
  { patterns: [/echocardiogram/i, /echo\b/i, /cardiac\s*ultrasound/i], study: 'Echocardiogram', bodyPart: 'Heart' },
  { patterns: [/ultrasound\s*(?:of\s*(?:the\s*)?)?(?:abdomen|belly)/i, /abdominal\s*ultrasound/i], study: 'Ultrasound', bodyPart: 'Abdomen' },
  { patterns: [/(?:renal|kidney)\s*ultrasound/i], study: 'Ultrasound', bodyPart: 'Kidneys' },
  { patterns: [/(?:carotid)\s*(?:ultrasound|doppler)/i], study: 'Ultrasound', bodyPart: 'Carotid' },
  { patterns: [/DEXA/i, /bone\s*density/i], study: 'DEXA', bodyPart: 'Whole Body' },
  { patterns: [/mammogram/i], study: 'Mammogram', bodyPart: 'Bilateral Breasts' },
  { patterns: [/colonoscopy/i], study: 'Colonoscopy', bodyPart: 'Colon' },
];

function extractImagingOrders(transcript) {
  const orders = [];
  const seen = new Set();

  for (const img of IMAGING_MAP) {
    for (const pattern of img.patterns) {
      const key = `${img.study}-${img.bodyPart}`;
      if (pattern.test(transcript) && !seen.has(key)) {
        seen.add(key);
        orders.push({ study_type: img.study, body_part: img.bodyPart });
        break;
      }
    }
  }

  return orders;
}

// ==========================================
// CLINICAL DATA EXTRACTION (Combined, Enhanced)
// ==========================================

async function extractClinicalData(transcript, patient) {
  if (isClaudeEnabled()) {
    return _claudeExtractClinicalData(transcript, patient);
  }

  // Mock mode: pattern-matching extraction with unified count summary
  const extracted = {
    vitals: extractVitals(transcript),
    medications: extractMedications(transcript),
    problems: extractProblems(transcript),
    labs: extractLabOrders(transcript),
    imaging: extractImagingOrders(transcript),
    ros: extractROS(transcript),
    physical_exam: extractPhysicalExam(transcript)
  };

  // Add unified extraction count summary
  const counts = {
    vitals_fields: Object.values(extracted.vitals).filter(v => v !== null && v !== undefined).length,
    medications: Array.isArray(extracted.medications) ? extracted.medications.length : 0,
    problems: Array.isArray(extracted.problems) ? extracted.problems.length : 0,
    lab_orders: Array.isArray(extracted.labs) ? extracted.labs.length : 0,
    imaging_orders: Array.isArray(extracted.imaging) ? extracted.imaging.length : 0,
    ros_items: Object.values(extracted.ros).filter(v => v !== null && v !== undefined).length,
    exam_items: Object.values(extracted.physical_exam).filter(v => v !== null && v !== undefined).length
  };

  const totalFields = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    extracted,
    extraction_summary: {
      total_fields: totalFields,
      counts
    }
  };
}

async function _claudeExtractClinicalData(transcript, patient) {
  const system = `You are a clinical documentation AI. Extract structured data from a clinical encounter transcript.
Return ONLY valid JSON matching the schema below. Do not include any explanation or markdown.

Schema:
{
  "vitals": {
    "systolic_bp": number|null,
    "diastolic_bp": number|null,
    "heart_rate": number|null,
    "temperature": number|null,
    "weight": number|null,
    "height": number|null,
    "respiratory_rate": number|null,
    "spo2": number|null,
    "bmi": number|null
  },
  "medications": [
    { "medication_name": string, "dose": string, "route": string, "frequency": string }
  ],
  "problems": [
    { "problem_name": string, "icd10_code": string, "status": "active"|"resolved"|"chronic" }
  ],
  "labs": [
    { "test_name": string, "cpt_code": string|null }
  ],
  "imaging": [
    { "study_type": string, "body_part": string }
  ],
  "ros": {
    "Constitutional": string|null,
    "Cardiovascular": string|null,
    "Respiratory": string|null,
    "Gastrointestinal": string|null,
    "Musculoskeletal": string|null,
    "Neurological": string|null,
    "Psychiatric": string|null
  },
  "physical_exam": {
    "General": string|null,
    "Cardiovascular": string|null,
    "Respiratory": string|null,
    "Abdomen": string|null,
    "Extremities": string|null,
    "Neurological": string|null
  }
}

Rules:
- Only extract information explicitly stated in the transcript
- For ICD-10 codes, use the most specific appropriate code
- For vitals, weight is in pounds and height is in inches unless clearly stated otherwise
- Return null for fields not mentioned in the transcript`;

  const patientCtx = patient
    ? `Patient: ${patient.first_name} ${patient.last_name}, DOB: ${patient.dob}, Sex: ${patient.sex}`
    : '';

  const userMsg = `${patientCtx ? patientCtx + '\n\n' : ''}Transcript:\n${transcript}`;

  try {
    const raw = await callClaude(system, userMsg);
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate and sanitize: strip dangerous fields that could mutate database state
    validateExtractionResponse(parsed);

    // Normalize nulls to expected types
    const extracted = {
      vitals: parsed.vitals || {},
      medications: parsed.medications || [],
      problems: parsed.problems || [],
      labs: parsed.labs || [],
      imaging: parsed.imaging || [],
      ros: parsed.ros || {},
      physical_exam: parsed.physical_exam || {}
    };

    // Add extraction summary
    const counts = {
      vitals_fields: Object.values(extracted.vitals).filter(v => v !== null && v !== undefined).length,
      medications: Array.isArray(extracted.medications) ? extracted.medications.length : 0,
      problems: Array.isArray(extracted.problems) ? extracted.problems.length : 0,
      lab_orders: Array.isArray(extracted.labs) ? extracted.labs.length : 0,
      imaging_orders: Array.isArray(extracted.imaging) ? extracted.imaging.length : 0,
      ros_items: Object.values(extracted.ros).filter(v => v !== null && v !== undefined).length,
      exam_items: Object.values(extracted.physical_exam).filter(v => v !== null && v !== undefined).length
    };

    const totalFields = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      extracted,
      extraction_summary: {
        total_fields: totalFields,
        counts
      }
    };
  } catch (err) {
    // Fallback to pattern matching if Claude fails
    console.error('[AI] Claude extraction failed, falling back to pattern matching:', err.message);
    const extracted = {
      vitals: extractVitals(transcript),
      medications: extractMedications(transcript),
      problems: extractProblems(transcript),
      labs: extractLabOrders(transcript),
      imaging: extractImagingOrders(transcript),
      ros: extractROS(transcript),
      physical_exam: extractPhysicalExam(transcript)
    };

    const counts = {
      vitals_fields: Object.values(extracted.vitals).filter(v => v !== null && v !== undefined).length,
      medications: Array.isArray(extracted.medications) ? extracted.medications.length : 0,
      problems: Array.isArray(extracted.problems) ? extracted.problems.length : 0,
      lab_orders: Array.isArray(extracted.labs) ? extracted.labs.length : 0,
      imaging_orders: Array.isArray(extracted.imaging) ? extracted.imaging.length : 0,
      ros_items: Object.values(extracted.ros).filter(v => v !== null && v !== undefined).length,
      exam_items: Object.values(extracted.physical_exam).filter(v => v !== null && v !== undefined).length
    };

    const totalFields = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      extracted,
      extraction_summary: {
        total_fields: totalFields,
        counts
      }
    };
  }
}

// ==========================================
// SOAP NOTE GENERATION (Enhanced)
// ==========================================

async function generateSOAPNote(transcript, patient, vitals) {
  if (isClaudeEnabled()) {
    return _claudeGenerateSOAPNote(transcript, patient, vitals);
  }
  return _mockGenerateSOAPNote(transcript, patient, vitals);
}

async function _claudeGenerateSOAPNote(transcript, patient, vitals) {
  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';
  const age = patient && patient.dob ? calculateAge(patient.dob) : 'Unknown';
  const sex = patient ? patient.sex : '';

  const vitalsText = vitals && Object.keys(vitals).length > 0
    ? Object.entries(vitals)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join(', ')
    : 'Not recorded';

  const system = `You are a clinical documentation AI assisting a physician in a primary care setting.
Generate a complete, professional SOAP note from the encounter transcript provided.

Format the note exactly as follows (use plain text, no markdown):

PATIENT: [name, age, sex]
DATE: [today's date]

SUBJECTIVE:
[Chief complaint and HPI in narrative form. Include duration, severity, associated symptoms, and relevant history.]

REVIEW OF SYSTEMS:
[Systems reviewed, noting positive and negative findings]

OBJECTIVE:
Vitals: [list all available vitals]
Physical Exam: [organized by system — General, HEENT, Cardiovascular, Respiratory, Abdomen, Extremities, Neurological as applicable]

ASSESSMENT:
[Numbered problem list with ICD-10 codes where applicable]

PLAN:
[Numbered list corresponding to each problem — medications, labs, imaging, referrals, follow-up, patient education]

Rules:
- Use standard medical abbreviations
- Be concise but clinically complete
- Only document what is stated or clearly implied in the transcript
- Do not fabricate findings or orders not mentioned
- Include ICD-10 codes for diagnoses in parentheses`;

  const userMsg = `Patient: ${patientName}, Age: ${age}, Sex: ${sex}
Vitals recorded: ${vitalsText}
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Encounter Transcript:
${transcript}`;

  try {
    return await callClaude(system, userMsg, 'claude-sonnet-4-6');
  } catch (err) {
    console.error('[AI] Claude SOAP generation failed, falling back to pattern matching:', err.message);
    return _mockGenerateSOAPNote(transcript, patient, vitals);
  }
}

function _mockGenerateSOAPNote(transcript, patient, vitals) {
  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';
  const age = patient && patient.dob ? calculateAge(patient.dob) : 'Unknown';
  const sex = patient ? patient.sex : '';

  const problems = extractProblems(transcript);
  const meds = extractMedications(transcript);
  const labs = extractLabOrders(transcript);
  const imaging = extractImagingOrders(transcript);
  const ros = extractROS(transcript);
  const pe = extractPhysicalExam(transcript);

  // Build vitals string
  const vitalsLines = [];
  if (vitals) {
    if (vitals.systolic_bp && vitals.diastolic_bp) vitalsLines.push(`  BP: ${vitals.systolic_bp}/${vitals.diastolic_bp} mmHg`);
    if (vitals.heart_rate) vitalsLines.push(`  HR: ${vitals.heart_rate} bpm`);
    if (vitals.temperature) vitalsLines.push(`  Temp: ${vitals.temperature}°F`);
    if (vitals.respiratory_rate) vitalsLines.push(`  RR: ${vitals.respiratory_rate}/min`);
    if (vitals.spo2) vitalsLines.push(`  SpO2: ${vitals.spo2}%`);
    if (vitals.weight) vitalsLines.push(`  Weight: ${vitals.weight} lbs`);
    if (vitals.height) vitalsLines.push(`  Height: ${vitals.height} in`);
    if (vitals.weight && vitals.height) {
      const bmi = Math.round((vitals.weight / (vitals.height * vitals.height)) * 703 * 10) / 10;
      vitalsLines.push(`  BMI: ${bmi}`);
    }
  }

  // Build ROS
  const rosLines = [];
  if (Object.keys(ros).length > 0) {
    for (const [category, findings] of Object.entries(ros)) {
      const parts = [];
      if (findings.positive.length > 0) parts.push(`Positive: ${findings.positive.join(', ')}`);
      if (findings.negative.length > 0) parts.push(`Negative: ${findings.negative.join(', ')}`);
      rosLines.push(`  ${category}: ${parts.join('. ')}`);
    }
  }

  // Build PE
  const peLines = [];
  if (Object.keys(pe).length > 0) {
    for (const [system, findings] of Object.entries(pe)) {
      peLines.push(`  ${system}: ${findings}`);
    }
  }

  // Build assessment
  const assessmentLines = [];
  if (problems.length > 0) {
    problems.forEach((p, i) => {
      assessmentLines.push(`${i + 1}. ${p.name} (${p.code})`);
    });
  }
  // Include patient's existing problems if available
  if (patient?.problems?.length > 0 && problems.length === 0) {
    patient.problems.filter(p => p.status === 'active' || p.status === 'chronic').forEach((p, i) => {
      assessmentLines.push(`${i + 1}. ${p.problem_name || p.name} (${p.icd10_code || 'N/A'})`);
    });
  }

  // Build plan
  const planSections = [];
  if (meds.length > 0) {
    planSections.push('Medications:');
    meds.forEach(m => planSections.push(`  - ${m.name} ${m.dose} ${m.route} ${m.frequency}`));
  }
  if (labs.length > 0) {
    planSections.push('\nLaboratory:');
    labs.forEach(l => planSections.push(`  - ${l.name} (CPT: ${l.cpt})`));
  }
  if (imaging.length > 0) {
    planSections.push('\nImaging:');
    imaging.forEach(img => planSections.push(`  - ${img.study_type}: ${img.body_part}`));
  }
  planSections.push('\nFollow-up:');
  planSections.push('  - Follow-up as discussed with patient');
  planSections.push('  - Return to clinic PRN for worsening symptoms');

  const note = `SUBJECTIVE:
Patient: ${patientName}, ${age}yo ${sex}
${extractSubjectiveFromTranscript(transcript)}
${rosLines.length > 0 ? '\nReview of Systems:\n' + rosLines.join('\n') : ''}

OBJECTIVE:
Vitals:
${vitalsLines.length > 0 ? vitalsLines.join('\n') : '  Not recorded'}

Physical Examination:
${peLines.length > 0 ? peLines.join('\n') : '  General: Appears well, in no acute distress\n  HEENT: Normocephalic, atraumatic\n  Cardiovascular: Regular rate and rhythm, no murmurs\n  Respiratory: Clear to auscultation bilaterally\n  Abdomen: Soft, non-tender, non-distended\n  Extremities: No edema'}

ASSESSMENT:
${assessmentLines.length > 0 ? assessmentLines.join('\n') : 'See clinical notes'}

PLAN:
${planSections.join('\n')}`;

  return Promise.resolve(note);
}

function extractSubjectiveFromTranscript(transcript) {
  const lines = transcript.split('\n').filter(l => l.trim());
  const patientStatements = [];
  const chiefComplaints = [];

  for (const line of lines) {
    const patientMatch = line.match(/^(?:Patient|Pt)\s*:\s*(.+)/i);
    if (patientMatch) {
      patientStatements.push(patientMatch[1].trim());
    }
  }

  const ccPatterns = [
    /(?:(?:chief\s*complaint|cc|reason\s*for\s*visit)\s*(?:is|:)\s*)(.{10,80})/i,
    /(?:here\s*(?:for|about|because\s*of))\s+(.{5,80})/i,
    /(?:blood\s*sugars?\s*(?:have\s*been|are|running)\s*(?:high|low|elevated))/i,
    /(?:pain\s*in|hurts?\s*(?:my)?)\s+(\w+(?:\s+\w+)?)/i,
    /(?:not\s*(?:feeling|doing)\s*(?:well|great|good))/i,
    /(?:having\s*(?:trouble|problems?|difficulty))\s+(?:with\s+)?(\w+(?:\s+\w+)?)/i,
    /(?:shortness\s*of\s*breath|SOB)/i,
    /(?:chest\s*pain)/i,
    /(?:headache|cough|fever|fatigue|dizzy|dizziness|nausea|swelling)/i,
    /(?:follow.up|follow\s*up|routine\s*(?:visit|check))/i,
  ];

  for (const pattern of ccPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      chiefComplaints.push(match[1] || match[0]);
    }
  }

  const parts = [];
  if (chiefComplaints.length > 0) {
    parts.push(`Chief Complaint: ${chiefComplaints[0]}`);
  }
  if (patientStatements.length > 0) {
    parts.push(`\nHPI: ${patientStatements.slice(0, 5).join('. ')}.`);
  }

  // Look for symptom duration
  const durationMatch = transcript.match(/(?:for\s*(?:the\s*(?:past|last)\s*)?)(\d+\s*(?:days?|weeks?|months?|years?))/i);
  if (durationMatch) {
    parts.push(`Duration: ${durationMatch[1]}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'See transcript for details.';
}

function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// ==========================================
// RXNORM-ENHANCED MEDICATION LOOKUP
// ==========================================

/**
 * Look up a medication using RxNorm API first, falling back to COMMON_MEDICATIONS.
 * Returns enriched drug data including RxCUI for canonical identification.
 *
 * @param {string} drugName - Drug name (brand or generic)
 * @returns {Promise<{rxcui?: string, name: string, genericName?: string, doses?: string[], route?: string, freq?: string, indication?: string}>}
 */
async function lookupMedication(drugName) {
  if (!drugName) return null;
  const key = drugName.toLowerCase().trim();

  // Check local knowledge first (instant, no network)
  const localAlias = MEDICATION_ALIASES[key];
  const localData = localAlias ? COMMON_MEDICATIONS[localAlias] : COMMON_MEDICATIONS[key];

  // Try RxNorm for canonical identification
  try {
    const rxnorm = require('./pharma/rxnorm-service');
    const enriched = await rxnorm.resolveAndEnrich(drugName);
    if (enriched) {
      return {
        rxcui: enriched.rxcui,
        name: enriched.name,
        genericName: enriched.genericName,
        brandNames: enriched.brandNames,
        // Merge local dosing knowledge if available
        doses: localData?.doses || [],
        route: localData?.route || 'PO',
        freq: localData?.freq || 'daily',
        indication: localData?.indication || ''
      };
    }
  } catch (err) {
    // RxNorm unavailable — fall back to local data
  }

  // Fallback to local COMMON_MEDICATIONS
  if (localData) {
    return { name: drugName, ...localData };
  }

  return { name: drugName };
}

module.exports = {
  getMode,
  isClaudeEnabled,
  extractVitals,
  extractMedications,
  extractProblems,
  extractLabOrders,
  extractImagingOrders,
  extractROS,
  extractPhysicalExam,
  extractClinicalData,
  generateSOAPNote,
  lookupMedication,
  COMMON_MEDICATIONS
};
