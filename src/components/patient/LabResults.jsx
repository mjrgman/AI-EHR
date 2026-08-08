import React from 'react';

// Audit-grade lab list: refined row rhythm with a quiet danger wash + danger
// lead-edge on abnormal rows (mirrors the AuditPage flagged-row treatment),
// a semantic result value (danger on abnormal, navy on normal) with a
// directional arrow, units caption, collection/result date, and reference range.
// Presentation only.

function formatLabDate(dateStr) {
  if (!dateStr) return null;
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00` : dateStr;
    return new Date(normalized).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

export default function LabResults({ labs = [], limit = 10 }) {
  if (labs.length === 0) return <p className="text-sm italic text-slate-500">No lab results</p>;
  return (
    <div className="-mx-1 space-y-0.5">
      {labs.slice(0, limit).map((lab, i) => {
        const isAbnormal = lab.abnormal_flag && lab.abnormal_flag !== 'normal';
        const arrow = lab.abnormal_flag === 'high' ? ' ↑' : lab.abnormal_flag === 'low' ? ' ↓' : isAbnormal ? ' !' : '';
        // Prefer collected_date; fall back to result_date
        const dateLabel = formatLabDate(lab.collected_date || lab.result_date);
        const refRange = lab.reference_range || lab.refRange || null;
        return (
          <div
            key={lab.id || lab.test_name + '-' + i}
            className={`relative flex flex-col gap-0.5 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
              isAbnormal
                ? 'bg-danger-50/60 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-danger-400 before:opacity-70 hover:bg-danger-50'
                : 'hover:bg-ivory-200/70'
            }`}
          >
            {/* Top row: name + value + units */}
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{lab.test_name}</span>
              <span className={`ml-2 font-semibold tabular-nums ${isAbnormal ? 'text-danger-700' : 'text-navy-700'}`}>
                {lab.result_value}{arrow}
              </span>
              <span className="ml-1 text-xs text-slate-500">{lab.units}</span>
            </div>
            {/* Bottom row: reference range + collected date */}
            {(refRange || dateLabel) && (
              <div className="flex items-center gap-3 text-xs text-slate-400">
                {refRange && (
                  <span title="Reference range">Ref: {refRange}</span>
                )}
                {dateLabel && (
                  <span title="Collected / resulted date">{dateLabel}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
