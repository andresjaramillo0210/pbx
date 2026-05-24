// Variant 1: Minimal Hero
//
// Apple-style premium minimalism. Massive brand wordmark vertically centered
// with a single subtitle and venue line. One primary CTA. Ample negative space
// scales the typography up on wider viewports.
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../../../src/components/Button';
import { colors, fontSize, fontWeight, spacing, tracking } from '../../../src/theme';

export default function HomeMinimal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Scale the wordmark with viewport width: 56 on tiny phones up to ~88 on
  // tablets / desktop web. Keep it tasteful.
  const wordmarkSize = Math.min(88, Math.max(56, Math.round(width * 0.13)));
  const subtitleSize = width >= 600 ? fontSize.xl : fontSize.lg;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.hero}>
          <Text
            style={[
              styles.wordmark,
              { fontSize: wordmarkSize, lineHeight: wordmarkSize * 1.02 },
            ]}
            accessibilityRole="header"
          >
            pbxscape
          </Text>
          <Text style={[styles.subtitle, { fontSize: subtitleSize }]}>
            Pickleball tournaments, live.
          </Text>
          <Text style={styles.venue}>Westminster Pickleball Xscape</Text>
        </View>

        <View style={styles.actions}>
          <Button
            variant="primary"
            size="lg"
            onPress={() => router.push('/(public)/tournaments')}
            style={styles.cta}
            accessibilityLabel="Browse tournaments"
          >
            Browse tournaments →
          </Button>
        </View>
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
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxxl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
  },
  wordmark: {
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    // Tight letterspacing for the premium-minimal feel.
    letterSpacing: -2,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
    marginTop: spacing.xs,
  },
  venue: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    marginTop: spacing.lg,
  },
  actions: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'stretch',
  },
  cta: {
    width: '100%',
  },
});
