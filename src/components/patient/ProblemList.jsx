import React from 'react';

export default function ProblemList({ problems = [], compact = false }) {
  const all = problems.filter(p => p.status === 'active' || p.status === 'chronic');
  if (all.length === 0) return <p className="text-sm italic text-slate-400">No active problems</p>;

  return (
    <ul className="space-y-1.5">
      {all.map((p, i) => (
        <li key={p.id || p.problem_name || i} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${p.status === 'chronic' ? 'bg-gold-500' : 'bg-navy-500'}`} />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-navy-700">{p.problem_name}</span>
            {!compact && p.icd10_code && <span className="ml-1 font-mono text-xs text-slate-400">({p.icd10_code})</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
