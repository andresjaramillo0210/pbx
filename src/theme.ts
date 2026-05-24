// Design tokens for pbxscape. Every screen and component should pull colors,
// spacing, type sizes, etc. from here so we keep visual consistency and can
// retheme the whole app from one file.
//
// Dark mode palette — clean Discord/Linear-style dark, pickleball green
// accent. Tuned for high contrast: primary text on bg sits well above the
// WCAG AAA threshold (>=7:1).

export const colors = {
  // Backgrounds — deepest at the bottom of the stack, lifting to elevated
  // surfaces as you nest. bg is page-level; bgMuted reads as a subtle wash
  // for sections; bgElevated is the raised card surface that "pops" forward.
  bg: '#0b1220',           // deepest background (page)
  bgMuted: '#111a2e',      // section bg / subtle wash
  bgElevated: '#1a2540',   // raised card surface
  // Text — soft near-white avoids the harsh #fff glow on dark surfaces.
  text: '#e6edf7',         // primary
  textMuted: '#9aa6b8',    // secondary
  textSubtle: '#6b7686',   // tertiary / caption
  // Borders — hairline by default, stronger when you need emphasis.
  border: '#1f2a44',
  borderStrong: '#2a3754',
  borderFocus: '#f97316',  // Westminster brand orange focus ring
  // Primary (action) — Westminster brand orange. Used for CTAs, focus, chips.
  primary: '#f97316',
  primaryHover: '#ea580c',
  primaryText: '#1a0e02',  // near-black so the bright orange CTA reads as a button, not a glow
  primaryPressed: '#c2410c',
  // Soft variants — dark-tinted orange wash for chips, selected states, etc.
  primarySoft: '#2e1707',
  primarySoftText: '#fdba74',
  // Live (in-progress) — green is reserved for "match is being played right
  // now". Distinct from `primary` so the brand color doesn't get confused with
  // a state indicator. Used by LIVE pills, live court accents, broadcast cards.
  live: '#22c55e',
  liveSoft: '#0f2a1a',
  liveSoftText: '#86efac',
  // Secondary / neutral action.
  secondary: '#1f2a44',
  secondaryText: '#e6edf7',
  secondaryHover: '#2a3754',
  // Destructive.
  destructive: '#ef4444',
  destructiveHover: '#dc2626',
  destructiveSoft: '#2a1414',
  destructiveSoftText: '#fca5a5',
  // Status hues (used by StatusPill as solid color references). Tuned to be
  // visible on dark — bright enough to read, not so saturated they vibrate.
  statusDraft: '#475569',
  statusOpen: '#60a5fa',
  statusLocked: '#fbbf24',
  statusRunning: '#22c55e',
  statusComplete: '#94a3b8',
  // Soft amber wash for inline warnings / "needs attention" cards. Matches
  // the StatusPill amber tint so the language is consistent.
  warningSoft: '#2e1f0a',
  warningSoftText: '#fbbf24',
  // Overlay scrim (modals).
  scrim: 'rgba(2, 6, 16, 0.65)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 36,
  hero: 56,
} as const;

// Note: cast to TextStyle['fontWeight'] at use site, or import as-is - the
// string literals are valid RN fontWeight values.
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '800',
} as const;

// Card shadows on dark surfaces. We use a deeper black with higher opacity so
// elevation reads against the dark backdrop (light shadows disappear).
export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHover: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// Tracking constants (letter spacing) for uppercase labels.
export const tracking = {
  caps: 1.2,
  capsLoose: 2,
} as const;
