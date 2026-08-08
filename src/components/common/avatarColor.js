// ── Measured Canon avatar palette ────────────────────────────────────────
// Brand-harmonious deterministic initials-avatar tones. NO purple / indigo /
// rose / random rainbow — only navy, slate, deep-teal, and muted-gold so the
// patient avatars cohere with the rest of the rebrand.
//
// Each entry is a Tailwind background class + a readable on-color text class.
// The hash is stable per name (same name → same tone) and logic-preserving:
// it returns presentation classes only.
//
// Usage (page agents):
//   import { avatarTone, getInitials } from '../components/common/avatarColor';
//   const { bg, text } = avatarTone(fullName);
//   <span className={`${bg} ${text} ...`}>{getInitials(first, last)}</span>
//
// If a single uniform navy is preferred instead of the harmonious set, pass
// { single: true } → always returns the navy tone.

export const AVATAR_TONES = [
  { bg: 'bg-navy-600', text: 'text-white' },   // authority navy
  { bg: 'bg-slate-500', text: 'text-white' },  // brand slate
  { bg: 'bg-teal-700', text: 'text-white' },   // deep teal (harmonizes with navy)
  { bg: 'bg-gold-600', text: 'text-white' },   // muted gold (used sparingly via hash)
];

// The single navy tone, for callers that prefer one uniform avatar color.
export const AVATAR_NAVY = AVATAR_TONES[0];

export function getInitials(first, last) {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
}

export function avatarTone(name, { single = false } = {}) {
  if (single) return AVATAR_NAVY;
  let hash = 0;
  for (const ch of (name || '')) {
    hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
