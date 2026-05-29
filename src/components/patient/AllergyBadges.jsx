import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';

// Allergies are the chart's loudest safety signal — they carry the danger
// variant unconditionally, each with an alert icon. The empty state reads as a
// reassuring (not alarming) success-tinted "no known allergies". Presentation only.
export default function AllergyBadges({ allergies = [] }) {
  if (allergies.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm italic text-slate-400">
        <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" className="text-success-500" />
        No known allergies
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {allergies.map((a, i) => (
        <Badge key={a.id || a.allergen || i} variant="danger" className="font-semibold">
          <AlertTriangle size={12} strokeWidth={2.5} className="flex-shrink-0" aria-hidden="true" />
          {a.allergen}{a.reaction ? ` (${a.reaction})` : ''}
        </Badge>
      ))}
    </div>
  );
}
