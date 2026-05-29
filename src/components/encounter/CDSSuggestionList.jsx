import React from 'react';
import CDSSuggestionCard from './CDSSuggestionCard';

export default function CDSSuggestionList({ suggestions = [], onAccept, onReject }) {
  const pending = suggestions.filter(s => s.status === 'pending');
  const accepted = suggestions.filter(s => s.status === 'accepted');

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-6 text-slate-400">
        <p className="text-2xl mb-1">&#x1F916;</p>
        <p className="text-sm">No suggestions yet. Record vitals or start documentation to trigger CDS.</p>
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
