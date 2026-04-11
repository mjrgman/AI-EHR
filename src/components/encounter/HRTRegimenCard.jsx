import React from 'react';
import Badge from '../common/Badge';

/**
 * HRTRegimenCard — displays one active HRT or peptide therapy for the patient.
 *
 * Accepts a `regimen` prop with the shape planned for the `hrt_regimens` table
 * (Phase 3c migration). Rendered inline so downstream work can swap in real
 * data without changing this component.
 *
 *   { id, therapy_type, medication_name, dose, route, frequency,
 *     started_at, last_adjusted_at, next_lab_due_at, status }
 *
 * Safety note: overdue monitoring labs are highlighted in red because the
 * highest-leverage guardrail on testosterone / GLP-1 titration is enforcing
 * the lab-before-adjust rule from Endocrine Society / ADA guidance.
 */
function formatDate(isoString) {
  if (!isoString) return '\u2014';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString();
}

function isOverdue(isoString) {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

export default function HRTRegimenCard({ regimen }) {
  if (!regimen) return null;

  const overdue = isOverdue(regimen.next_lab_due_at);
  const statusVariant = regimen.status === 'active' ? 'success'
    : regimen.status === 'paused' ? 'warning'
    : 'info';

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-gray-900 truncate">
            {regimen.medication_name || 'Unknown medication'}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {regimen.therapy_type && <span>{regimen.therapy_type} &middot; </span>}
            {regimen.dose || '?'} {regimen.route || ''}
            {regimen.frequency && <span> &middot; {regimen.frequency}</span>}
          </div>
        </div>
        {regimen.status && (
          <Badge variant={statusVariant}>{regimen.status}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <div className="text-gray-400 uppercase tracking-wide">Last adjusted</div>
          <div className="text-gray-700 font-medium">
            {formatDate(regimen.last_adjusted_at)}
          </div>
        </div>
        <div>
          <div className="text-gray-400 uppercase tracking-wide">Next labs due</div>
          <div className={`font-medium ${overdue ? 'text-red-600' : 'text-gray-700'}`}>
            {formatDate(regimen.next_lab_due_at)}
            {overdue && <span className="ml-1" aria-label="overdue">!</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
