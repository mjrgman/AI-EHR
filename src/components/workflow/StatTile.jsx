import React from 'react';

// ── Measured Canon KPI tile ──────────────────────────────────────────────
// Premium, crafted dashboard stat: a large Source-Serif number, a slate
// uppercase label, and ONE meaningful lucide icon tinted by clinical state.
// No arbitrary accent dots — the icon (in a soft tinted chip) carries meaning.
//
// `tone` selects an on-brand state color:
//   slate   waiting / neutral metadata
//   navy    in-flight authority (default)
//   gold    the single attention/active beat (use at most once per row)
//   success positive / complete (signed, compliant)
//   danger  critical / alarm
//
// Logic-preserving: presentation only. Pass a lucide-react icon component as
// `icon`; the page owns the value + label + which tone maps to which state.
const TONES = {
  slate: {
    value: 'text-slate-700',
    chipBg: 'bg-slate-50',
    chipText: 'text-slate-500',
    chipRing: 'ring-slate-100',
  },
  navy: {
    value: 'text-navy-700',
    chipBg: 'bg-navy-50',
    chipText: 'text-navy-600',
    chipRing: 'ring-navy-100',
  },
  gold: {
    value: 'text-gold-700',
    chipBg: 'bg-gold-50',
    chipText: 'text-gold-600',
    chipRing: 'ring-gold-200',
  },
  success: {
    value: 'text-success-700',
    chipBg: 'bg-success-50',
    chipText: 'text-success-600',
    chipRing: 'ring-success-100',
  },
  danger: {
    value: 'text-danger-700',
    chipBg: 'bg-danger-50',
    chipText: 'text-danger-600',
    chipRing: 'ring-danger-100',
  },
};

export default function StatTile({ icon: Icon, label, value = 0, tone = 'navy', className = '' }) {
  const t = TONES[tone] || TONES.navy;
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-100 bg-offWhite-100 p-4 shadow-mc transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-mc-lg ${className}`}
    >
      {/* soft layered depth: a faint top-edge sheen + tinted corner wash */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-display text-4xl font-semibold leading-none tabular-nums ${t.value}`}>
            {value}
          </div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            {label}
          </div>
        </div>
        {Icon && (
          <span
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${t.chipBg} ${t.chipText} ${t.chipRing} transition-transform duration-200 group-hover:scale-105`}
            aria-hidden="true"
          >
            <Icon size={20} strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  );
}
