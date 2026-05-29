import React from 'react';

export default function LabResults({ labs = [], limit = 10 }) {
  if (labs.length === 0) return <p className="text-sm italic text-slate-400">No lab results</p>;
  return (
    <div className="space-y-1">
      {labs.slice(0, limit).map((lab, i) => {
        const isAbnormal = lab.abnormal_flag && lab.abnormal_flag !== 'normal';
        return (
          <div key={lab.id || lab.test_name + '-' + i} className={`flex items-center justify-between rounded px-2 py-1 text-sm ${isAbnormal ? 'bg-danger-50' : ''}`}>
            <span className="flex-1 truncate font-medium text-slate-600">{lab.test_name}</span>
            <span className={`ml-2 font-bold ${isAbnormal ? 'text-danger-700' : 'text-navy-700'}`}>
              {lab.result_value}{isAbnormal && (lab.abnormal_flag === 'high' ? ' \u2191' : lab.abnormal_flag === 'low' ? ' \u2193' : ' !')}
            </span>
            <span className="ml-1 text-xs text-slate-400">{lab.units}</span>
          </div>
        );
      })}
    </div>
  );
}
