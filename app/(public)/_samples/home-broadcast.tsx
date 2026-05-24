// Variant 3: Broadcast
//
// Sports-scoreboard energy. A big LIVE indicator with a pulsing dot when a
// tournament is currently `in_progress`. The active live tournament is
// promoted into a hero card (with division count + matches-in-progress).
// Below that, a "Recent" strip of smaller cards, and a strong uppercase CTA.
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ErrorBanner from '../../../src/components/ErrorBanner';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../src/theme';

type Row = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
};

type LiveStats = {
  divisionCount: number;
  matchesInProgress: number;
};

function formatDateRange(starts: string | null, ends: string | null): string {
  if (!starts && !ends) return 'Date TBD';
  if (starts && ends && starts !== ends) return `${starts} – ${ends}`;
  return (starts ?? ends) as string;
}

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.dot, { opacity }]} />;
}

export default function HomeBroadcast() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [live, setLive] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [liveStats, setLiveStats] = useState<Record<string, LiveStats>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [liveRes, recentRes] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, name, starts_on, ends_on, status')
          .eq('status', 'in_progress')
          .order('starts_on', { ascending: false, nullsFirst: false }),
        supabase
          .from('tournaments')
          .select('id, name, starts_on, ends_on, status')
          .neq('status', 'draft')
          .neq('status', 'in_progress')
          .order('starts_on', { ascending: false, nullsFirst: false })
          .limit(4),
      ]);
      if (cancelled) return;
      if (liveRes.error || recentRes.error) {
        setError((liveRes.error ?? recentRes.error)?.message ?? 'Failed to load');
        setLive([]);
        setRecent([]);
        return;
      }
      const liveRows = (liveRes.data ?? []) as Row[];
      setLive(liveRows);
      setRecent((recentRes.data ?? []) as Row[]);

      // For each live tournament fetch division count and live-match count.
      if (liveRows.length > 0) {
        const stats: Record<string, LiveStats> = {};
        await Promise.all(
          liveRows.map(async (t) => {
            const { data: divs } = await supabase
              .from('divisions')
              .select('id')
              .eq('tournament_id', t.id);
            const divIds = ((divs ?? []) as { id: string }[]).map((d) => d.id);
            let matchesInProgress = 0;
            if (divIds.length > 0) {
              const { count } = await supabase
                .from('matches')
                .select('id', { count: 'exact', head: true })
                .in('division_id', divIds)
                .eq('status', 'in_progress');
              matchesInProgress = count ?? 0;
            }
            stats[t.id] = {
              divisionCount: divIds.length,
              matchesInProgress,
            };
          }),
        );
        if (!cancelled) setLiveStats(stats);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = live === null || recent === null;
  const hasLive = (live?.length ?? 0) > 0;
  const recentColumns = width >= 900 ? 2 : 1;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.brandRow}>
          <Text style={styles.wordmark}>pbxscape</Text>
          <View style={styles.brandRight}>
            {hasLive ? (
              <View style={styles.liveBadge}>
                <PulseDot />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            ) : (
              <View style={styles.offAirBadge}>
                <View style={styles.offAirDot} />
                <Text style={styles.offAirText}>OFF AIR</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.venue}>Westminster Pickleball Xscape</Text>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {hasLive && live ? (
              <View style={styles.liveSection}>
                <Text style={styles.sectionLabel}>On the courts now</Text>
                {live.map((t) => {
                  const stats = liveStats[t.id];
                  return (
                    <Card
                      key={t.id}
                      onPress={() =>
                        router.push({ pathname: '/(public)/t/[id]', params: { id: t.id } })
                      }
                      accessibilityLabel={`Open live tournament ${t.name}`}
                      style={styles.liveCard}
                    >
                      <View style={styles.liveCardTop}>
                        <View style={styles.liveInlineBadge}>
                          <PulseDot />
                          <Text style={styles.liveInlineText}>LIVE NOW</Text>
                        </View>
                        <Text style={styles.liveDate}>
                          {formatDateRange(t.starts_on, t.ends_on)}
                        </Text>
                      </View>
                      <Text style={styles.liveTitle} numberOfLines={2}>
                        {t.name}
                      </Text>
                      <View style={styles.statRow}>
                        <Stat
                          value={stats ? String(stats.divisionCount) : '–'}
                          label="Divisions"
                        />
                        <View style={styles.statDivider} />
                        <Stat
                          value={stats ? String(stats.matchesInProgress) : '–'}
                          label="Matches live"
                          accent
                        />
                      </View>
                      <Text style={styles.liveCta}>TAP TO WATCH →</Text>
                    </Card>
                  );
                })}
              </View>
            ) : (
              <View style={styles.noLiveBlock}>
                <Text style={styles.sectionLabel}>No live tournaments</Text>
                <Text style={styles.noLiveMsg}>
                  Nothing on the courts right now. Check the schedule below.
                </Text>
              </View>
            )}

            <View style={styles.recentBlock}>
              <Text style={styles.sectionLabel}>Recent</Text>
              {recent && recent.length > 0 ? (
                <View
                  style={[
                    styles.recentGrid,
                    recentColumns === 1 && styles.recentGridSingle,
                  ]}
                >
                  {recent.map((t) => (
                    <View
                      key={t.id}
                      style={[
                        styles.recentItem,
                        recentColumns === 1 ? styles.itemFull : styles.itemHalf,
                      ]}
                    >
                      <Card
                        onPress={() =>
                          router.push({
                            pathname: '/(public)/t/[id]',
                            params: { id: t.id },
                          })
                        }
                        accessibilityLabel={`Open tournament ${t.name}`}
                        style={styles.recentCard}
                      >
                        <Text style={styles.recentTitle} numberOfLines={1}>
                          {t.name}
                        </Text>
                        <Text style={styles.recentMeta}>
                          {formatDateRange(t.starts_on, t.ends_on)}
                        </Text>
                      </Card>
                    </View>
                  ))}
                </View>
              ) : !hasLive ? (
                <EmptyState
                  title="Nothing scheduled"
                  message="No tournaments have been published yet."
                />
              ) : null}
            </View>

            <Pressable
              onPress={() => router.push('/(public)/tournaments')}
              accessibilityRole="button"
              accessibilityLabel="Browse all tournaments"
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                styles.browseBtn,
                hovered && styles.browseBtnHover,
                pressed && styles.browseBtnPressed,
              ]}
            >
              <Text style={styles.browseBtnText}>BROWSE ALL TOURNAMENTS →</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.lg,
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 1000,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brandRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.8,
  },
  venue: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    marginTop: -spacing.sm,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.destructive,
  },
  liveBadgeText: {
    color: colors.primaryText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  offAirBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offAirDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.textSubtle,
  },
  offAirText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryText,
  },
  loading: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveSection: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  liveCard: {
    gap: spacing.md,
    borderColor: colors.borderStrong,
  },
  liveCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  liveInlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.destructive,
  },
  liveInlineText: {
    color: colors.primaryText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  liveDate: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  liveTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.4,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  statBlock: {
    gap: 2,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.5,
  },
  statValueAccent: {
    color: colors.primary,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  liveCta: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginTop: spacing.xs,
  },
  noLiveBlock: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  noLiveMsg: {
    fontSize: fontSize.base,
    color: colors.textMuted,
  },
  recentBlock: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  recentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  recentGridSingle: {
    flexDirection: 'column',
  },
  recentItem: {
    minWidth: 0,
  },
  itemFull: { width: '100%' },
  itemHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 260 },
  recentCard: {
    gap: spacing.xs,
  },
  recentTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  recentMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  browseBtn: {
    marginTop: spacing.md,
    minHeight: 56,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  browseBtnHover: { backgroundColor: colors.primaryHover },
  browseBtnPressed: { backgroundColor: colors.primaryHover, opacity: 0.92 },
  browseBtnText: {
    color: colors.primaryText,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
});
