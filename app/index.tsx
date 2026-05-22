import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../src/components/Button';
import { colors, fontSize, fontWeight, spacing, tracking } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Pickleball tournament management</Text>
        <Text style={styles.title}>pbxscape</Text>
        <Text style={styles.subtitle}>Pickleball tournaments, live.</Text>
        <Text style={styles.venue}>Westminster Pickleball Xscape</Text>
      </View>
      <View style={styles.actions}>
        <Button
          variant="primary"
          size="lg"
          onPress={() => router.push('/(admin)/login')}
          style={styles.actionButton}
        >
          Admin sign in
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onPress={() => router.push('/(public)/tournaments')}
          style={styles.actionButton}
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
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 480,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    textAlign: 'center',
  },
  venue: {
    fontSize: fontSize.sm,
    color: colors.textSubtle,
    marginTop: spacing.xs,
  },
  actions: {
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  actionButton: { width: '100%' },
});
