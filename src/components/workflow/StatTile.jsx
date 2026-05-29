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
// This is the reference KPI surface (matches the AuditPage stat cards): a large
// Source-Serif tabular number, a generously sized soft tinted icon chip, layered
// depth, and an optional `sublabel` caption beneath the metric label.
//
// Logic-preserving: presentation only. Pass a lucide-react icon component as
// `icon`; the page owns the value + label + which tone maps to which state.
const TONES = {
  slate: {
    value: 'text-slate-700',
    chipBg: 'bg-slate-50',
    chipText: 'text-slate-500',
    chipRing: 'ring-slate-100',
    wash: 'from-slate-100/50',
  },
  navy: {
    value: 'text-navy-700',
    chipBg: 'bg-navy-50',
    chipText: 'text-navy-600',
    chipRing: 'ring-navy-100',
    wash: 'from-navy-100/50',
  },
  gold: {
    value: 'text-gold-700',
    chipBg: 'bg-gold-50',
    chipText: 'text-gold-600',
    chipRing: 'ring-gold-200',
    wash: 'from-gold-100/60',
  },
  success: {
    value: 'text-success-700',
    chipBg: 'bg-success-50',
    chipText: 'text-success-600',
    chipRing: 'ring-success-100',
    wash: 'from-success-100/50',
  },
  danger: {
    value: 'text-danger-700',
    chipBg: 'bg-danger-50',
    chipText: 'text-danger-600',
    chipRing: 'ring-danger-100',
    wash: 'from-danger-100/50',
  },
};

export default function StatTile({ icon: Icon, label, value = 0, tone = 'navy', sublabel, className = '' }) {
  const t = TONES[tone] || TONES.navy;
  return (
    <div
      className={`mc-stat-card group relative overflow-hidden rounded-2xl border border-slate-100 bg-offWhite-100 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-mc-xl ${className}`}
    >
      {/* layered depth: faint top-edge sheen + a soft tinted corner wash that
          carries the tone color without shouting */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" aria-hidden="true" />
      <span className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br to-transparent opacity-60 blur-xl ${t.wash}`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`font-display text-4xl font-semibold leading-none tabular-nums sm:text-5xl ${t.value}`}>
            {value}
          </div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {label}
          </div>
          {sublabel && (
            <div className="mt-0.5 text-xs text-slate-400">{sublabel}</div>
          )}
        </div>
        {Icon && (
          <span
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ${t.chipBg} ${t.chipText} ${t.chipRing} shadow-sm transition-transform duration-200 group-hover:scale-105`}
            aria-hidden="true"
          >
            <Icon size={24} strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  );
}
