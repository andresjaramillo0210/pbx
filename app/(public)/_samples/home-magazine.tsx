// Variant 4: Magazine
//
// Editorial / publication layout in the spirit of The Athletic or NYT.
// A full-width hero band with an eyebrow + oversized headline (no real
// image asset yet, so the hero is a gradient on web and a primary-soft
// fallback on native). Below: a two-column "About" + featured tournament
// arrangement, then a horizontal rule and a recent-tournaments strip.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ErrorBanner from '../../../src/components/ErrorBanner';
import StatusPill from '../../../src/components/StatusPill';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../src/theme';

type Row = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
};

function formatDateRange(starts: string | null, ends: string | null): string {
  if (!starts && !ends) return 'Date TBD';
  if (starts && ends && starts !== ends) return `${starts} – ${ends}`;
  return (starts ?? ends) as string;
}

// CSS gradient stand-in for the hero "image". Derived from theme tokens:
// primary -> primaryHover -> text (deep) for a moody, editorial feel.
// On native (no linear-gradient), fall back to a flat primary-soft band so the
// layout still reads as a hero region.
const heroBackgroundStyle: ViewStyle =
  Platform.OS === 'web'
    ? // RN web accepts unknown style strings and forwards to CSS.
      // Cast through unknown to keep the typings happy.
      (({
        backgroundImage: `linear-gradient(135deg, ${colors.primaryHover} 0%, ${colors.primary} 45%, ${colors.text} 100%)`,
      } as unknown) as ViewStyle)
    : { backgroundColor: colors.primary };

export default function HomeMagazine() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('tournaments')
        .select('id, name, starts_on, ends_on, status')
        .neq('status', 'draft')
        .order('starts_on', { ascending: false, nullsFirst: false })
        .limit(6);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as Row[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const wide = width >= 820;
  const featured = rows && rows.length > 0 ? rows[0] : null;
  // Recent strip: tournaments after the featured one, up to 5.
  const strip = rows ? rows.slice(1, 6) : [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingBottom: insets.bottom + spacing.xxl,
      }}
    >
      {/* HERO BAND */}
      <View
        style={[
          styles.hero,
          heroBackgroundStyle,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: spacing.xxxl },
        ]}
      >
        <View style={styles.heroInner}>
          <Text style={styles.eyebrow}>WESTMINSTER PICKLEBALL XSCAPE</Text>
          <Text
            style={[
              styles.heroHeadline,
              wide
                ? { fontSize: 64, lineHeight: 64 * 1.02 }
                : { fontSize: 44, lineHeight: 44 * 1.05 },
            ]}
          >
            Where the local game lives.
          </Text>
          <Text style={styles.heroSub}>
            Tournaments, brackets, and live results from the courts of pbxscape.
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {/* TWO-COLUMN: ABOUT + FEATURED TOURNAMENT */}
        <View style={[styles.columns, wide ? styles.columnsRow : styles.columnsStack]}>
          <View style={[styles.col, wide ? styles.colLeftWide : styles.colFull]}>
            <Text style={styles.kicker}>About the venue</Text>
            <Text style={styles.lede}>
              A home for the Westminster pickleball community — leagues, drop-in,
              clinics, and the tournaments you find here.
            </Text>
            <Text style={styles.body1}>
              pbxscape runs the brackets so players can focus on play and spectators
              can follow along from anywhere. Scan a court QR, open a draw, watch the
              scores update.
            </Text>
            <Text style={styles.body1}>
              Every match, every division, every round — published the moment it lands.
            </Text>
          </View>

          <View style={[styles.col, wide ? styles.colRightWide : styles.colFull]}>
            <Text style={styles.kicker}>Featured tournament</Text>
            {rows === null ? (
              <View style={styles.featuredLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : featured ? (
              <Card
                onPress={() =>
                  router.push({
                    pathname: '/(public)/t/[id]',
                    params: { id: featured.id },
                  })
                }
                accessibilityLabel={`Open tournament ${featured.name}`}
                style={styles.featuredCard}
              >
                <StatusPill status={featured.status} />
                <Text style={styles.featuredTitle} numberOfLines={3}>
                  {featured.name}
                </Text>
                <Text style={styles.featuredMeta}>
                  {formatDateRange(featured.starts_on, featured.ends_on)}
                </Text>
                <Text style={styles.featuredCta}>Read the draw →</Text>
              </Card>
            ) : (
              <EmptyState
                title="No featured tournament"
                message="Check back when the next event is published."
              />
            )}
          </View>
        </View>

        <View style={styles.rule} />

        {/* RECENT STRIP */}
        <View style={styles.stripHead}>
          <Text style={styles.kicker}>The schedule</Text>
          <Pressable
            onPress={() => router.push('/(public)/tournaments')}
            accessibilityRole="link"
            accessibilityLabel="Browse all tournaments"
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
              styles.linkBtn,
              hovered && styles.linkBtnHover,
              pressed && styles.linkBtnPressed,
            ]}
          >
            <Text style={styles.linkText}>All tournaments →</Text>
          </Pressable>
        </View>

        {rows === null ? (
          <View style={styles.featuredLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : strip.length === 0 && !featured ? (
          <EmptyState
            title="Nothing here yet"
            message="No tournaments have been published. Check back soon."
          />
        ) : strip.length === 0 ? null : (
          <View style={styles.stripList}>
            {strip.map((t, idx) => (
              <Pressable
                key={t.id}
                onPress={() =>
                  router.push({
                    pathname: '/(public)/t/[id]',
                    params: { id: t.id },
                  })
                }
                accessibilityRole="link"
                accessibilityLabel={`Open tournament ${t.name}`}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  styles.stripRow,
                  idx === 0 && styles.stripRowFirst,
                  hovered && styles.stripRowHover,
                  pressed && styles.stripRowPressed,
                ]}
              >
                <Text style={styles.stripNum}>{String(idx + 1).padStart(2, '0')}</Text>
                <View style={styles.stripBody}>
                  <Text style={styles.stripTitle} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={styles.stripMeta}>
                    {formatDateRange(t.starts_on, t.ends_on)}
                  </Text>
                </View>
                <View style={styles.stripPill}>
                  <StatusPill status={t.status} />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hero: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInner: {
    width: '100%',
    maxWidth: 980,
    gap: spacing.lg,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    color: colors.primaryText,
    opacity: 0.85,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
    textTransform: 'uppercase',
  },
  heroHeadline: {
    color: colors.primaryText,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: -1.2,
  },
  heroSub: {
    color: colors.primaryText,
    opacity: 0.9,
    fontSize: fontSize.lg,
    maxWidth: 560,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
  },
  body: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.xl,
  },
  columns: {
    gap: spacing.xxl,
  },
  columnsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  columnsStack: { flexDirection: 'column' },
  col: {
    minWidth: 0,
    gap: spacing.md,
  },
  colLeftWide: { flexBasis: '58%', flexGrow: 1, flexShrink: 1 },
  colRightWide: { flexBasis: '38%', flexGrow: 1, flexShrink: 1 },
  colFull: { width: '100%' },
  kicker: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  lede: {
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    letterSpacing: -0.3,
    lineHeight: fontSize.xl * 1.3,
  },
  body1: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    lineHeight: fontSize.md * 1.55,
  },
  featuredLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredCard: {
    gap: spacing.sm,
    minHeight: 200,
  },
  featuredTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.4,
    marginTop: spacing.xs,
  },
  featuredMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  featuredCta: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginTop: spacing.sm,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  stripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  linkBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkBtnHover: { backgroundColor: colors.secondary },
  linkBtnPressed: { backgroundColor: colors.border, opacity: 0.9 },
  linkText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  stripList: {
    gap: 0,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stripRowFirst: {
    borderTopWidth: 0,
  },
  stripRowHover: {
    backgroundColor: colors.bgMuted,
  },
  stripRowPressed: {
    backgroundColor: colors.secondary,
    opacity: 0.95,
  },
  stripNum: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
    width: 36,
  },
  stripBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  stripTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  stripMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  stripPill: {
    flexShrink: 0,
  },
});
