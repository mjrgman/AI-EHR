import React from 'react';

// Refined vitals chips: each metric is a small layered tile with a tracked
// slate label, a Source-Serif tabular value, and a danger treatment (wash +
// ring + up-arrow) when out of range. Presentation only.
function VitalItem({ label, value, unit, alert }) {
  if (value === null || value === undefined) return null;
  return (
    <div
      className={`rounded-xl px-3 py-2.5 text-center transition-colors duration-150 ${
        alert ? 'bg-danger-50 ring-1 ring-danger-200' : 'bg-ivory-200 ring-1 ring-slate-100'
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</div>
      <div className={`font-display text-xl font-semibold leading-tight tabular-nums ${alert ? 'text-danger-700' : 'text-navy-700'}`}>
        {value}{alert && <span className="ml-0.5 text-sm text-danger-600">&uarr;</span>}
      </div>
      {unit && <div className="text-[10px] text-slate-500">{unit}</div>}
    </div>
  );
}

export default function VitalsDisplay({ vitals }) {
  if (!vitals || Object.keys(vitals).length === 0) return <p className="text-sm italic text-slate-500">No vitals recorded</p>;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {(vitals.systolic_bp || vitals.diastolic_bp) && <VitalItem label="BP" value={`${vitals.systolic_bp || '?'}/${vitals.diastolic_bp || '?'}`} unit="mmHg" alert={vitals.systolic_bp >= 140 || vitals.diastolic_bp >= 90} />}
      <VitalItem label="HR" value={vitals.heart_rate} unit="bpm" alert={vitals.heart_rate > 100 || (vitals.heart_rate && vitals.heart_rate < 50)} />
      <VitalItem label="Temp" value={vitals.temperature} unit="°F" alert={vitals.temperature > 100.4} />
      <VitalItem label="Weight" value={vitals.weight} unit="lbs" />
      {vitals.spo2 && <VitalItem label="SpO2" value={vitals.spo2} unit="%" alert={vitals.spo2 < 92} />}
      {vitals.respiratory_rate && <VitalItem label="RR" value={vitals.respiratory_rate} unit="/min" alert={vitals.respiratory_rate < 10 || vitals.respiratory_rate > 20} />}
    </div>
  );
}
