import React from 'react';

// Audit-grade clinical list: refined row rhythm with a quiet hover wash and a
// gold lead-edge on hover (.mc-row), a semantic status dot (chronic = gold beat,
// active = navy), and a tracked status caption. Presentation only.
export default function ProblemList({ problems = [], compact = false }) {
  const all = problems.filter(p => p.status === 'active' || p.status === 'chronic');
  if (all.length === 0) return <p className="text-sm italic text-slate-500">No active problems</p>;

  return (
    <ul className="-mx-1 space-y-0.5">
      {all.map((p, i) => (
        <li key={p.id || p.problem_name || i} className="mc-row flex items-start gap-2.5 text-sm">
          <span
            className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ring-2 ${p.status === 'chronic' ? 'bg-gold-500 ring-gold-100' : 'bg-navy-500 ring-navy-100'}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-navy-700">{p.problem_name}</span>
            {!compact && p.icd10_code && <span className="ml-1.5 font-mono text-xs text-slate-500">({p.icd10_code})</span>}
          </div>
          {!compact && p.status === 'chronic' && (
            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-600">Chronic</span>
          )}
        </li>
      ))}
    </ul>
  );
}
