import React from 'react';

// Audit-grade lab list: refined row rhythm with a quiet danger wash + danger
// lead-edge on abnormal rows (mirrors the AuditPage flagged-row treatment),
// a semantic result value (danger on abnormal, navy on normal) with a
// directional arrow, and a tracked units caption. Presentation only.
export default function LabResults({ labs = [], limit = 10 }) {
  if (labs.length === 0) return <p className="text-sm italic text-slate-500">No lab results</p>;
  return (
    <div className="-mx-1 space-y-0.5">
      {labs.slice(0, limit).map((lab, i) => {
        const isAbnormal = lab.abnormal_flag && lab.abnormal_flag !== 'normal';
        const arrow = lab.abnormal_flag === 'high' ? ' ↑' : lab.abnormal_flag === 'low' ? ' ↓' : isAbnormal ? ' !' : '';
        return (
          <div
            key={lab.id || lab.test_name + '-' + i}
            className={`relative flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
              isAbnormal
                ? 'bg-danger-50/60 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-danger-400 before:opacity-70 hover:bg-danger-50'
                : 'hover:bg-ivory-200/70'
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{lab.test_name}</span>
            <span className={`ml-2 font-semibold tabular-nums ${isAbnormal ? 'text-danger-700' : 'text-navy-700'}`}>
              {lab.result_value}{arrow}
            </span>
            <span className="ml-1 text-xs text-slate-500">{lab.units}</span>
          </div>
        );
      })}
    </div>
  );
}
