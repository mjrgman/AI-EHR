import React, { useState } from 'react';
import {
  HeartPulse, FlaskConical, AlertTriangle, Pill, Search,
  ShieldCheck, Camera, ClipboardList, Lightbulb, CheckCircle2,
} from 'lucide-react';
import TouchButton from '../common/TouchButton';
import Badge from '../common/Badge';

// Measured Canon: lucide line icons replace the former emoji glyphs. Each
// suggestion type maps to a refined icon; the wrapper tints it on the brand
// axis (danger for urgent, navy otherwise) so color carries the signal.
const ICONS = {
  vital_alert: HeartPulse,
  lab_order: FlaskConical,
  allergy_alert: AlertTriangle,
  interaction_alert: Pill,
  differential_diagnosis: Search,
  preventive_care: ShieldCheck,
  medication: Pill,
  imaging_order: Camera,
  referral: ClipboardList,
};

export default function CDSSuggestionCard({ suggestion, onAccept, onReject }) {
  const [acting, setActing] = useState(null);
  const Icon = ICONS[suggestion.suggestion_type] || Lightbulb;
  const isUrgent = suggestion.category === 'urgent';

  async function doAccept() { setActing('a'); try { await onAccept(suggestion.id); } finally { setActing(null); } }
  async function doReject() { setActing('r'); try { await onReject(suggestion.id); } finally { setActing(null); } }

  if (suggestion.status === 'accepted') {
    return (
      <div className="border-l-4 border-l-success-500 bg-success-50/60 rounded-r-xl p-3 opacity-70 shadow-mc">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={16} className="text-success-600 flex-shrink-0" />
          <span className="font-medium text-success-800 line-through">{suggestion.title}</span>
          <Badge variant="success">Accepted</Badge>
        </div>
      </div>
    );
  }
  if (suggestion.status === 'rejected') return null;

  return (
    <div className={`border-l-4 rounded-r-xl p-3 transition-all duration-200 hover:-translate-y-px ${isUrgent ? 'border-l-danger-500 bg-danger-50/60' : 'border-l-navy-500 bg-offWhite-100'} shadow-mc hover:shadow-mc-lg`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 flex-shrink-0 grid place-items-center w-7 h-7 rounded-lg ${isUrgent ? 'bg-danger-100 text-danger-600' : 'bg-navy-50 text-navy-600'}`}>
          <Icon size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm text-navy-700">{suggestion.title}</h4>
            {isUrgent && <Badge variant="urgent">Urgent</Badge>}
            {suggestion.source === 'provider_learning' && <Badge variant="primary">Your Pattern</Badge>}
          </div>
          <p className="text-xs text-slate-600 mt-1">{suggestion.description}</p>
          {suggestion.rationale && <p className="text-xs text-slate-400 mt-0.5 italic">{suggestion.rationale}</p>}
        </div>
      </div>
      <div className="flex gap-2 mt-3 ml-[38px]">
        <TouchButton size="sm" variant="success" onClick={doAccept} loading={acting === 'a'} disabled={!!acting}>Accept</TouchButton>
        <TouchButton size="sm" variant="danger" onClick={doReject} loading={acting === 'r'} disabled={!!acting}>Skip</TouchButton>
      </div>
    </div>
  );
}
