import React from 'react';

export default function MedList({ medications = [], compact = false }) {
  const active = medications.filter(m => m.status === 'active');
  if (active.length === 0) return <p className="text-sm italic text-slate-400">No active medications</p>;

  return (
    <ul className="space-y-1.5">
      {active.map((m, i) => (
        <li key={m.id || m.medication_name || i} className="text-sm">
          <span className="font-medium text-navy-700">{m.medication_name}</span>
          {!compact && <span className="ml-1 text-slate-500">{m.dose} {m.route} {m.frequency}</span>}
        </li>
      ))}
    </ul>
  );
}
