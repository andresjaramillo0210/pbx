// Variant 2: Featured Tournaments
//
// Content-forward homepage in the ESPN / PPA mold. Compact brand mark up top,
// then the three most recent non-draft tournaments as tappable cards (a row
// on wide viewports, a vertical stack on phones). A "Browse all" link sits
// under the previews for the catch-all path.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

export default function HomeFeatured() {
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
        .limit(3);
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

  // Two columns at >= 720, three at >= 1024, else single column.
  const columns = width >= 1024 ? 3 : width >= 720 ? 2 : 1;

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
          <Text style={styles.venue}>Westminster Pickleball Xscape</Text>
        </View>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Live & upcoming</Text>
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
            <Text style={styles.linkText}>Browse all →</Text>
          </Pressable>
        </View>

        {rows === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            message="No tournaments have been published. Check back soon."
          />
        ) : (
          <View
            style={[
              styles.grid,
              columns === 1 && styles.gridSingle,
            ]}
          >
            {rows.map((t) => (
              <View
                key={t.id}
                style={[
                  styles.gridItem,
                  columns === 1
                    ? styles.itemFull
                    : columns === 2
                      ? styles.itemHalf
                      : styles.itemThird,
                ]}
              >
                <Card
                  onPress={() =>
                    router.push({ pathname: '/(public)/t/[id]', params: { id: t.id } })
                  }
                  accessibilityLabel={`Open tournament ${t.name}`}
                  style={styles.card}
                >
                  <View style={styles.cardTop}>
                    <StatusPill status={t.status} />
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {t.name}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {formatDateRange(t.starts_on, t.ends_on)}
                  </Text>
                  <Text style={styles.cardCta}>View tournament →</Text>
                </Card>
              </View>
            ))}
          </View>
        )}
      </View>
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
    maxWidth: 1100,
    alignSelf: 'center',
    gap: spacing.xl,
  },
  brandRow: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
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
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.2,
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
  loading: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  gridSingle: {
    flexDirection: 'column',
  },
  gridItem: {
    minWidth: 0,
  },
  itemFull: { width: '100%' },
  itemHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  itemThird: { flexBasis: '31%', flexGrow: 1, minWidth: 260 },
  card: {
    gap: spacing.sm,
    minHeight: 168,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: spacing.xs,
  },
  cardMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  cardCta: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginTop: spacing.sm,
  },
});
