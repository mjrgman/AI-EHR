import React from 'react';

function VitalItem({ label, value, unit, alert }) {
  if (value === null || value === undefined) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${alert ? 'bg-danger-50 ring-1 ring-danger-200' : 'bg-ivory-200'}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${alert ? 'text-danger-700' : 'text-navy-700'}`}>{value}{alert && <span className="ml-0.5 text-sm text-danger-500">&uarr;</span>}</div>
      {unit && <div className="text-xs text-slate-400">{unit}</div>}
    </div>
  );
}

export default function VitalsDisplay({ vitals }) {
  if (!vitals || Object.keys(vitals).length === 0) return <p className="text-sm text-gray-400 italic">No vitals recorded</p>;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {(vitals.systolic_bp || vitals.diastolic_bp) && <VitalItem label="BP" value={`${vitals.systolic_bp || '?'}/${vitals.diastolic_bp || '?'}`} unit="mmHg" alert={vitals.systolic_bp >= 140 || vitals.diastolic_bp >= 90} />}
      <VitalItem label="HR" value={vitals.heart_rate} unit="bpm" alert={vitals.heart_rate > 100 || (vitals.heart_rate && vitals.heart_rate < 50)} />
      <VitalItem label="Temp" value={vitals.temperature} unit="°F" alert={vitals.temperature > 100.4} />
      <VitalItem label="Weight" value={vitals.weight} unit="lbs" />
      {vitals.spo2 && <VitalItem label="SpO2" value={vitals.spo2} unit="%" alert={vitals.spo2 < 92} />}
      {vitals.respiratory_rate && <VitalItem label="RR" value={vitals.respiratory_rate} unit="/min" />}
    </div>
  );
}
