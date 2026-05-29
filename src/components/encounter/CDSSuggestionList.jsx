import React from 'react';
import { Sparkles } from 'lucide-react';
import CDSSuggestionCard from './CDSSuggestionCard';

export default function CDSSuggestionList({ suggestions = [], onAccept, onReject }) {
  const pending = suggestions.filter(s => s.status === 'pending');
  const accepted = suggestions.filter(s => s.status === 'accepted');

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-2xl bg-navy-50 text-navy-400 shadow-mc">
          <Sparkles size={22} />
        </span>
        <p className="text-sm text-slate-500">No suggestions yet. Record vitals or start documentation to trigger CDS.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pending.map(s => <CDSSuggestionCard key={s.id} suggestion={s} onAccept={onAccept} onReject={onReject} />)}
      {accepted.length > 0 && pending.length > 0 && (
        <div className="border-t border-slate-100 pt-2 mt-3">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Accepted</p>
        </div>
      )}
      {accepted.map(s => <CDSSuggestionCard key={s.id} suggestion={s} onAccept={onAccept} onReject={onReject} />)}
    </div>
  );
}
