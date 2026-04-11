/**
 * Peptide dose-to-syringe math — pure functions.
 *
 * Used by src/components/encounter/PeptideCalculator.jsx (Phase 3a).
 *
 * This file uses the `.mjs` extension so both Vite (browser ESM) and Node
 * (CJS-default project, via dynamic `await import(...)` from run-tests.js)
 * load it as ES modules without a dual build. A plain `.js` CommonJS file
 * was tried first and failed: Vite serves source files unwrapped, so the
 * browser choked on `module.exports`.
 *
 * Math contract:
 *   volumeMl = doseMg / concentrationMgPerMl
 *   units    = volumeMl * 100   (U-100 insulin syringe: 100 units = 1 mL)
 *
 * Shape: every function returns { ok: true, ...values } on success or
 * { ok: false, error } on invalid input. Never throws — the caller should
 * render r.error directly when ok is false. Matches the never-throw parser
 * contract established in Phase 2a (server/integrations/labcorp/parser.js).
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Convert a peptide dose in mg at a given concentration (mg/mL) into the
 * corresponding volume and U-100 insulin-syringe unit count.
 *
 * @param {number} doseMg                  — dose in milligrams (>= 0)
 * @param {number} concentrationMgPerMl    — reconstituted concentration (> 0)
 * @returns {{ok: true, volumeMl: number, units: number}
 *         | {ok: false, error: string}}
 */
export function calculateU100Units(doseMg, concentrationMgPerMl) {
  if (!isFiniteNumber(doseMg)) {
    return { ok: false, error: 'dose must be a finite number' };
  }
  if (doseMg < 0) {
    return { ok: false, error: 'dose must be zero or positive' };
  }
  if (!isFiniteNumber(concentrationMgPerMl)) {
    return { ok: false, error: 'concentration must be a finite number' };
  }
  if (concentrationMgPerMl <= 0) {
    return { ok: false, error: 'concentration must be greater than zero' };
  }

  const volumeMl = doseMg / concentrationMgPerMl;
  const units = volumeMl * 100;

  return { ok: true, volumeMl, units };
}
