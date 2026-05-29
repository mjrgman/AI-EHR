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
// Filled variants carry a tinted depth shadow (mc-btn-* in index.css) so the
// color reads confident and dimensional, never washed. The success variant in
// particular is a SOLID #3f7a52-family green (success-600 base / 700 hover)
// with a colored elevation — it must read as the decisive action it is.
//
// DISABLED is unmistakably inert: opacity-45 + saturate-50, the colored
// elevation/sheen stripped (shadow-none + `.mc-btn-fill:disabled` in index.css),
// no hover/press motion, cursor-not-allowed. A disabled Review & Sign button can
// never be mistaken for a washed-but-active one.
const VARIANTS = {
  primary: 'mc-btn-fill mc-btn-navy bg-navy-600 text-white hover:bg-navy-700 active:bg-navy-800 focus:ring-navy-500',
  success: 'mc-btn-fill mc-btn-success bg-success-600 text-white hover:bg-success-700 active:bg-success-800 focus:ring-success-600',
  danger: 'bg-red-50 text-danger-700 border border-danger-200 hover:bg-red-100 active:bg-red-200 focus:ring-danger-500',
  warning: 'bg-gold-50 text-gold-700 border border-gold-200 hover:bg-gold-100 active:bg-gold-200 focus:ring-gold-500',
  secondary: 'bg-offWhite-100 text-slate-700 border border-slate-300 shadow-mc hover:bg-ivory-200 hover:border-slate-400 hover:shadow-mc-lg active:bg-ivory-300 active:shadow-mc focus:ring-slate-400',
  ghost: 'bg-transparent text-slate-600 hover:bg-ivory-200 active:bg-ivory-300 focus:ring-slate-400',
  // hero — the single gold call-to-action. Use sparingly (one per view).
  hero: 'mc-btn-fill mc-btn-gold bg-gold-500 text-white hover:bg-gold-600 active:bg-gold-700 focus:ring-gold-500',
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
        disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none
        disabled:saturate-50 disabled:hover:scale-100 disabled:active:scale-100
        disabled:hover:shadow-none disabled:pointer-events-none
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
