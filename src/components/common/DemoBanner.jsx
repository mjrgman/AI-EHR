import React from 'react';

// ── Synthetic-data safety label — single source of truth ──────────────────
// Every entry surface (app shell, clinician login, patient portal) renders
// this so no screen can silently drift out of compliance with the demo
// boundary. Kept deliberately tiny and dependency-free.
// (Claude 4.8 UX maxout lane 11 — synthetic-data boundary + safety labels.)
export const DEMO_LABEL = 'Synthetic EHR Demo · No PHI · Not for clinical use';

export default function DemoBanner({ variant = 'strip', className = '' }) {
  if (variant === 'inline') {
    return (
      <p
        role="note"
        aria-label={DEMO_LABEL}
        className={`inline-flex items-center gap-2 text-xs font-semibold text-gold-700 ${className}`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
        {DEMO_LABEL}
      </p>
    );
  }

  // Full-width strip. Callers add positioning (e.g. sticky) via className.
  return (
    <div
      role="note"
      aria-label={DEMO_LABEL}
      className={`flex items-center justify-center gap-2 border-b border-gold-200 bg-gold-50 px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-gold-800 shadow-mc ${className}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
      {DEMO_LABEL}
    </div>
  );
}
