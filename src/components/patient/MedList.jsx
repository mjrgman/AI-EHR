import React from 'react';

// Audit-grade medication list: refined row rhythm (.mc-row hover wash + gold
// lead-edge), a quiet navy med-marker, and dose/route/frequency as a tracked
// secondary line. Presentation only.
export default function MedList({ medications = [], compact = false }) {
  const active = medications.filter(m => m.status === 'active');
  if (active.length === 0) return <p className="text-sm italic text-slate-400">No active medications</p>;

  return (
    <ul className="-mx-1 space-y-0.5">
      {active.map((m, i) => {
        const detail = [m.dose, m.route, m.frequency].filter(Boolean).join(' · ');
        return (
          <li key={m.id || m.medication_name || i} className="mc-row flex items-start gap-2.5 text-sm">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-navy-400 ring-2 ring-navy-100" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-navy-700">{m.medication_name}</span>
              {!compact && detail && <span className="ml-1.5 text-xs text-slate-500">{detail}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
