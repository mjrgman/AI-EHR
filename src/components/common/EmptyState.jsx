import React from 'react';
import { Inbox } from 'lucide-react';

// `icon` accepts any node. Default is an on-brand lucide Inbox in a soft chip.
// Callers may still pass a custom node (e.g. another lucide icon).
export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center mc-reveal">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ivory-200 text-slate-400 ring-1 ring-slate-100">
        {icon || <Inbox size={26} strokeWidth={1.75} aria-hidden="true" />}
      </span>
      <h3 className="font-display text-lg font-semibold text-navy-700">{title}</h3>
      {message && <p className="text-sm text-slate-500 mt-1 max-w-md">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
