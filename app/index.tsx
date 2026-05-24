import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../src/components/Button';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../src/theme';

// Westminster Pickleball Xscape brand orange. Used on the home hero for
// the eyebrow text, the primary CTA, and the accent glow. Kept inline here
// — it's a brand color tied to this venue, not a global theme token.
const BRAND_ORANGE = '#f97316';
const BRAND_ORANGE_HOVER = '#ea580c';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View pointerEvents="none" style={[styles.glow, styles.glowOrange]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBlue]} />

      <View style={styles.hero}>
        <Image
          source={require('../assets/logo.avif')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Westminster Pickleball Xscape logo"
        />
        <Text style={styles.eyebrow}>Pickleball tournament management</Text>
        <Text style={styles.title}>pbxscape</Text>
        <Text style={styles.subtitle}>Pickleball tournaments, live.</Text>
        <Text style={styles.venue}>Westminster Pickleball Xscape</Text>
      </View>
      <View style={styles.actions}>
        <Button
          variant="primary"
          size="lg"
          onPress={() => router.push('/(public)/tournaments')}
          style={[styles.actionButton, styles.brandButton]}
          textStyle={styles.brandButtonText}
        >
          Browse tournaments
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    overflow: 'hidden',
  },
  // Background accent blobs. Large, very low contrast — they wash the corners
  // without competing with the hero. Orange glow matches the venue brand.
  glow: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: radii.pill,
    opacity: 0.18,
  },
  glowOrange: {
    backgroundColor: BRAND_ORANGE,
    top: -220,
    right: -180,
  },
  glowBlue: {
    backgroundColor: colors.statusOpen,
    bottom: -260,
    left: -200,
    opacity: 0.12,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 520,
  },
  logo: {
    width: 160,
    height: 160,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: BRAND_ORANGE,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -1.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.xl,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    marginTop: spacing.xs,
  },
  venue: {
    fontSize: fontSize.sm,
    color: colors.textSubtle,
    marginTop: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  actions: {
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  actionButton: { width: '100%' },
  brandButton: { backgroundColor: BRAND_ORANGE },
  brandButtonText: { color: '#ffffff' },
});
