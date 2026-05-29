import React from 'react';

// Measured Canon badge variants. NOTE: `danger` deliberately keeps Tailwind
// `bg-red-*`/`text-red-*` classes (deep shades tuned toward brand danger
// #a1322a) — a unit test asserts the danger variant matches /bg-red-/ + /text-red-/.
const VARIANTS = {
  primary: 'bg-navy-50 text-navy-700 border border-navy-100',
  urgent: 'bg-red-100 text-red-800 border border-red-200',
  danger: 'bg-red-100 text-red-800 border border-red-200',
  routine: 'bg-navy-50 text-navy-700 border border-navy-100',
  success: 'bg-success-50 text-success-700 border border-success-100',
  warning: 'bg-gold-50 text-gold-700 border border-gold-200',
  info: 'bg-ivory-200 text-slate-600 border border-slate-100',
  neutral: 'bg-ivory-200 text-slate-600 border border-slate-100',
  purple: 'bg-slate-50 text-slate-700 border border-slate-100',
};

export default function Badge({ children, variant = 'info', className = '', dot }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${VARIANTS[variant] || VARIANTS.info} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full bg-current`} />}
      {children}
    </span>
  );
}
