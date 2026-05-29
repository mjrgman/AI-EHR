import React, { useState } from 'react';
import TouchButton from '../common/TouchButton';
import Badge from '../common/Badge';

const ICONS = { vital_alert: '\uD83D\uDC93', lab_order: '\uD83D\uDD2C', allergy_alert: '\u26A0\uFE0F', interaction_alert: '\uD83D\uDC8A', differential_diagnosis: '\uD83D\uDD0D', preventive_care: '\uD83D\uDEE1\uFE0F', medication: '\uD83D\uDC8A', imaging_order: '\uD83D\uDCF7', referral: '\uD83D\uDCCB' };

export default function CDSSuggestionCard({ suggestion, onAccept, onReject }) {
  const [acting, setActing] = useState(null);
  const icon = ICONS[suggestion.suggestion_type] || '\uD83D\uDCA1';
  const isUrgent = suggestion.category === 'urgent';

  async function doAccept() { setActing('a'); try { await onAccept(suggestion.id); } finally { setActing(null); } }
  async function doReject() { setActing('r'); try { await onReject(suggestion.id); } finally { setActing(null); } }

  if (suggestion.status === 'accepted') {
    return (
      <div className="border-l-4 border-l-success-500 bg-success-50/60 rounded-r-xl p-3 opacity-70">
        <div className="flex items-center gap-2 text-sm">
          <span>\u2705</span>
          <span className="font-medium text-success-800 line-through">{suggestion.title}</span>
          <Badge variant="success">Accepted</Badge>
        </div>
      </div>
    );
  }
  if (suggestion.status === 'rejected') return null;

  return (
    <div className={`border-l-4 rounded-r-xl p-3 transition-all ${isUrgent ? 'border-l-danger-500 bg-danger-50/60' : 'border-l-navy-500 bg-offWhite-100'} shadow-mc`}>
      <div className="flex items-start gap-2">
        <span className="text-lg mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm text-navy-700">{suggestion.title}</h4>
            {isUrgent && <Badge variant="urgent">Urgent</Badge>}
            {suggestion.source === 'provider_learning' && <Badge variant="purple">Your Pattern</Badge>}
          </div>
          <p className="text-xs text-slate-600 mt-1">{suggestion.description}</p>
          {suggestion.rationale && <p className="text-xs text-slate-400 mt-0.5 italic">{suggestion.rationale}</p>}
        </div>
      </div>
      <div className="flex gap-2 mt-3 ml-7">
        <TouchButton size="sm" variant="success" onClick={doAccept} loading={acting === 'a'} disabled={!!acting}>Accept</TouchButton>
        <TouchButton size="sm" variant="danger" onClick={doReject} loading={acting === 'r'} disabled={!!acting}>Skip</TouchButton>
      </div>
    </div>
  );
}
