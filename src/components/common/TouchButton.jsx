import React from 'react';

// ── Measured Canon button variants — disciplined semantics ──
//  primary    NAVY filled — the default confident call-to-action (New Visit,
//             +Add Rx, +Add Lab, Add New Patient, Create Patient).
//  success    RICH brand-success #3f7a52 filled — ONLY positive/complete states
//             (Review & Sign, confirm-signed). Never a generic primary action.
//  danger     RED — KEEP a `red` class (a unit test asserts /red/). Destructive.
//  secondary  ivory/slate OUTLINE — companion to a primary (Cancel-adjacent).
//  ghost      transparent TERTIARY — low-emphasis (Cancel, dismiss).
//  hero       GOLD — the single reserved accent. At most one per view.
//  warning    gold-tinted soft — advisory, non-destructive caution.
const VARIANTS = {
  primary: 'bg-navy-600 text-white shadow-mc hover:bg-navy-700 hover:shadow-mc-lg active:bg-navy-800 focus:ring-navy-500',
  success: 'bg-success-500 text-white shadow-mc hover:bg-success-600 hover:shadow-mc-lg active:bg-success-700 focus:ring-success-500',
  danger: 'bg-red-50 text-danger-700 border border-danger-200 hover:bg-red-100 active:bg-red-200 focus:ring-danger-500',
  warning: 'bg-gold-50 text-gold-700 border border-gold-200 hover:bg-gold-100 active:bg-gold-200 focus:ring-gold-500',
  secondary: 'bg-offWhite-100 text-slate-700 border border-slate-300 shadow-mc hover:bg-ivory-200 hover:border-slate-400 active:bg-ivory-300 focus:ring-slate-400',
  ghost: 'bg-transparent text-slate-600 hover:bg-ivory-200 active:bg-ivory-300 focus:ring-slate-400',
  // hero — the single gold call-to-action. Use sparingly (one per view).
  hero: 'bg-gold-500 text-white shadow-mc hover:bg-gold-600 hover:shadow-mc-lg active:bg-gold-700 focus:ring-gold-500',
};

const SIZES = {
  sm: 'min-h-[36px] px-3 py-1.5 text-sm rounded-lg',
  md: 'min-h-[48px] px-4 py-3 rounded-xl',
  lg: 'min-h-[56px] px-6 py-4 text-lg rounded-xl',
};

export default function TouchButton({
  children, variant = 'primary', size = 'md',
  icon, disabled, loading, className = '', ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2 font-semibold
        transition-all duration-150 active:scale-95 select-none
        focus:outline-none focus:ring-2 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${VARIANTS[variant]} ${SIZES[size]} ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
      ) : icon ? (
        <span className="text-lg">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
