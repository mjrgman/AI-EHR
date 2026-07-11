'use strict';

/**
 * Plain-language patient-education generator.
 *
 * The visit flow produced no patient-education content anywhere in offline/mock
 * mode — a gap for high-stakes new diagnoses (e.g. new-onset diabetes). This
 * module returns condition-specific, plain-language education keyed off the
 * patient's problem list (ICD-10 prefix or problem-name keywords), with a
 * generic fallback so every visit can hand the patient something usable.
 */

// Each template: what it is, how to care for it, and when to seek help — written
// at a plain-reading level, no jargon.
const TEMPLATES = [
  {
    key: 'diabetes',
    match: (p) => /^E1[013]/.test(p.icd10_code || '') || /diabet/i.test(p.problem_name || ''),
    title: 'Managing Your Diabetes',
    summary: 'Diabetes means there is too much sugar (glucose) in your blood. Over time, high blood sugar can harm your eyes, kidneys, nerves, and heart. The good news is that daily habits and medication keep it under control.',
    selfCare: [
      'Take your diabetes medicine exactly as prescribed, even on days you feel fine.',
      'Aim for balanced meals; limit sugary drinks, juice, and large portions of bread, rice, and pasta.',
      'Move your body most days — even a 15-30 minute walk helps lower blood sugar.',
      'If you were given a glucose meter, check your sugar as directed and write the numbers down.',
    ],
    warning: [
      'Shakiness, sweating, confusion, or a very low reading (low blood sugar) — eat or drink 15g of fast sugar (juice, glucose tabs) and recheck in 15 minutes.',
      'Very high readings with thirst, frequent urination, nausea, or fruity-smelling breath — call the office the same day.',
    ],
  },
  {
    key: 'hypertension',
    match: (p) => /^I1[0-6]/.test(p.icd10_code || '') || /hypertens|high blood pressure/i.test(p.problem_name || ''),
    title: 'Managing Your High Blood Pressure',
    summary: 'High blood pressure (hypertension) usually has no symptoms, but over time it strains your heart and blood vessels and raises the risk of stroke and heart attack. Keeping it in a healthy range protects you.',
    selfCare: [
      'Take your blood-pressure medicine every day, even when you feel well.',
      'Lower the salt in your diet — cook fresh, and check labels for sodium.',
      'Stay active, keep a healthy weight, and limit alcohol.',
      'If you have a home blood-pressure cuff, check and log your readings.',
    ],
    warning: [
      'A reading above 180/120, or a severe headache, chest pain, trouble speaking, or vision changes — seek emergency care right away.',
    ],
  },
  {
    key: 'ckd',
    match: (p) => /^N18/.test(p.icd10_code || '') || /kidney|renal/i.test(p.problem_name || ''),
    title: 'Taking Care of Your Kidneys',
    summary: 'Your kidneys filter waste from your blood. Chronic kidney disease means they are working less well than they should. Protecting them slows any further decline.',
    selfCare: [
      'Keep your blood pressure and blood sugar in the ranges your care team gave you.',
      'Ask before taking over-the-counter pain relievers like ibuprofen or naproxen — they can harm the kidneys.',
      'Stay hydrated with water, and follow any diet advice about salt, potassium, or protein.',
      'Keep your lab appointments so we can watch your kidney numbers.',
    ],
    warning: [
      'Much less urine than usual, swelling in your legs or face, or shortness of breath — call the office.',
    ],
  },
  {
    key: 'uri_sinusitis',
    match: (p) => /^J0[0-6]/.test(p.icd10_code || '') || /sinus|upper respiratory|pharyngitis|cold/i.test(p.problem_name || ''),
    title: 'Recovering from a Sinus / Upper-Respiratory Infection',
    summary: 'Most sinus and upper-respiratory infections are caused by viruses and get better on their own in 7-10 days. Antibiotics do not help viral infections and can cause side effects, so we often treat the symptoms first.',
    selfCare: [
      'Rest and drink plenty of fluids.',
      'Use saline nasal spray or rinses and a warm compress for sinus pressure.',
      'Over-the-counter acetaminophen or ibuprofen can ease pain and fever (if safe for you).',
    ],
    warning: [
      'Symptoms lasting more than 10 days, getting worse after starting to improve, a fever above 102°F, severe facial pain, or swelling around the eye — contact the office.',
    ],
  },
  {
    key: 'hyperlipidemia',
    match: (p) => /^E78/.test(p.icd10_code || '') || /lipid|cholesterol/i.test(p.problem_name || ''),
    title: 'Managing Your Cholesterol',
    summary: 'High cholesterol can build up in your arteries and raise the risk of heart attack and stroke. Diet, activity, and sometimes medication (like a statin) keep it in a healthy range.',
    selfCare: [
      'Take your cholesterol medicine as prescribed.',
      'Favor vegetables, whole grains, and lean proteins; limit fried and processed foods.',
      'Stay active and avoid tobacco.',
    ],
    warning: [
      'New muscle pain or weakness after starting a statin — let the office know.',
    ],
  },
];

const GENERIC = {
  title: 'About Your Visit Today',
  summary: 'Here is a summary of what to do after today’s visit. Follow the plan your care team gave you and reach out with any questions.',
  selfCare: [
    'Take any new or changed medications exactly as directed.',
    'Complete any labs, imaging, or referrals that were ordered.',
    'Keep your follow-up appointment.',
  ],
  warning: [
    'If you develop severe or worsening symptoms, contact the office. For chest pain, trouble breathing, or any life-threatening emergency, call 911.',
  ],
};

function educationForProblem(problem) {
  const t = TEMPLATES.find((tpl) => tpl.match(problem));
  if (!t) return null;
  return {
    condition: problem.problem_name || t.title,
    icd10_code: problem.icd10_code || null,
    title: t.title,
    summary: t.summary,
    what_you_can_do: t.selfCare,
    when_to_seek_help: t.warning,
  };
}

/**
 * Build patient education from a problem list. Always returns at least the
 * generic handout so no visit ends with nothing for the patient.
 */
function buildEducation(problems = [], chiefComplaint = '') {
  const sections = [];
  const seen = new Set();

  // Lead with the reason-for-visit condition when the chief complaint maps to a
  // template — so a sinusitis visit isn't handed only chronic-disease handouts.
  if (chiefComplaint) {
    const ccEdu = educationForProblem({ problem_name: String(chiefComplaint), icd10_code: '' });
    if (ccEdu) {
      seen.add(ccEdu.title);
      sections.push(ccEdu);
    }
  }

  for (const p of problems || []) {
    const edu = educationForProblem(p);
    if (edu && !seen.has(edu.title)) {
      seen.add(edu.title);
      sections.push(edu);
    }
  }
  if (sections.length === 0) {
    sections.push({
      condition: 'General',
      icd10_code: null,
      title: GENERIC.title,
      summary: GENERIC.summary,
      what_you_can_do: GENERIC.selfCare,
      when_to_seek_help: GENERIC.warning,
    });
  }
  return {
    reading_level: 'plain-language',
    emergency_note: 'For chest pain, trouble breathing, one-sided weakness, or any life-threatening emergency, call 911.',
    sections,
  };
}

module.exports = { buildEducation, educationForProblem };
