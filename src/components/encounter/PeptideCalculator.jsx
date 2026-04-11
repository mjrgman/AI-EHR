import React, { useState, useMemo } from 'react';
import { calculateU100Units } from '../../utils/peptide-math.mjs';

/**
 * PeptideCalculator — converts a peptide dose in mg at a given concentration
 * (mg/mL) into the corresponding volume and U-100 insulin-syringe units.
 *
 * Math lives in `src/utils/peptide-math.js` (pure, unit-tested). This component
 * is deliberately dumb: it parses the input strings, delegates to the util,
 * and renders either the result or the error. No local computation.
 *
 * Why this exists: peptide-dosing errors are the most common operator mistake
 * in compounded-peptide protocols — confusing mL volume with U-100 unit marks
 * on an insulin syringe has turned half-doses into 50x overdoses. Showing both
 * numbers side-by-side at the point of prescribing is the smallest, highest-
 * leverage safety feature we can ship.
 */
export default function PeptideCalculator() {
  const [doseMg, setDoseMg] = useState('');
  const [concentrationMgPerMl, setConcentrationMgPerMl] = useState('');

  const result = useMemo(() => {
    // Empty inputs = "not calculated yet", not an error state
    if (doseMg === '' || concentrationMgPerMl === '') {
      return null;
    }
    const d = parseFloat(doseMg);
    const c = parseFloat(concentrationMgPerMl);
    return calculateU100Units(d, c);
  }, [doseMg, concentrationMgPerMl]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Converts a peptide dose into volume and U-100 insulin-syringe units.
        Always double-check every compounded-peptide order against the
        manufacturer&apos;s reconstitution sheet.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Dose (mg)
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={doseMg}
            onChange={(e) => setDoseMg(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="2.4"
            aria-label="Dose in milligrams"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Concentration (mg/mL)
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={concentrationMgPerMl}
            onChange={(e) => setConcentrationMgPerMl(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="2.68"
            aria-label="Concentration in milligrams per milliliter"
          />
        </label>
      </div>

      {/* Pristine (no input yet) */}
      {result === null && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 text-center">
          Enter dose and concentration to see volume and U-100 units.
        </div>
      )}

      {/* Success */}
      {result && result.ok && (
        <div
          className="bg-green-50 border border-green-200 rounded-lg p-3"
          data-testid="peptide-result-ok"
        >
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Volume</div>
              <div className="text-xl font-bold text-green-700">
                {result.volumeMl.toFixed(3)} mL
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">U-100 units</div>
              <div className="text-xl font-bold text-green-700">
                {result.units.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {result && result.ok === false && (
        <div
          className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
          data-testid="peptide-result-error"
        >
          <span className="font-semibold">Invalid input:</span> {result.error}
        </div>
      )}
    </div>
  );
}
