import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Badge from '../common/Badge';

export default function AllergyBadges({ allergies = [] }) {
  if (allergies.length === 0) return <p className="text-sm italic text-slate-400">No known allergies</p>;
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
