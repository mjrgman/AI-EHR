import React from 'react';

export default function EmptyState({ icon = '📋', title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center mc-reveal">
      <span className="text-4xl mb-3 opacity-80">{icon}</span>
      <h3 className="font-display text-lg font-semibold text-navy-700">{title}</h3>
      {message && <p className="text-sm text-slate-500 mt-1 max-w-md">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
