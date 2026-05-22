// Design tokens for pbxscape. Every screen and component should pull colors,
// spacing, type sizes, etc. from here so we keep visual consistency and can
// retheme the whole app from one file.

export const colors = {
  // Backgrounds
  bg: '#ffffff',
  bgMuted: '#f8fafc',     // page bg / subtle sections
  bgElevated: '#ffffff',  // cards on muted bg
  // Text
  text: '#0f172a',
  textMuted: '#475569',
  textSubtle: '#64748b',
  // Borders
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  borderFocus: '#16a34a',  // pickleball green
  // Primary (action) - pickleball green for the sport theme
  primary: '#16a34a',
  primaryHover: '#15803d',
  primaryText: '#ffffff',
  primarySoft: '#dcfce7',
  primarySoftText: '#166534',
  // Secondary / neutral action
  secondary: '#f1f5f9',
  secondaryText: '#0f172a',
  // Destructive
  destructive: '#dc2626',
  destructiveSoft: '#fef2f2',
  destructiveSoftText: '#991b1b',
  // Status colors (for pills / badges) - solid color, used at 15% for bg
  statusDraft: '#94a3b8',
  statusOpen: '#3b82f6',
  statusLocked: '#f59e0b',
  statusRunning: '#16a34a',
  statusComplete: '#64748b',
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
} as const;

// Note: cast to TextStyle['fontWeight'] at use site, or import as-is - the
// string literals are valid RN fontWeight values.
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const shadows = {
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHover: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
} as const;

// Tracking constants (letter spacing) for uppercase labels.
export const tracking = {
  caps: 1.2,
  capsLoose: 2,
} as const;
