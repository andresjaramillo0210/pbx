import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ScreenContainer from '../../../src/components/ScreenContainer';
import Section from '../../../src/components/Section';
import StatusPill from '../../../src/components/StatusPill';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../src/theme';

type Tournament = { id: string; name: string; starts_on: string | null };
type Division = {
  id: string;
  type: 'singles' | 'doubles' | 'mixed_doubles';
  level: 'beginner' | 'intermediate' | 'advanced';
  gender: 'mens' | 'womens' | null;
  format: string | null;
  status: string;
};

export default function TournamentView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [t, d] = await Promise.all([
        supabase.from('tournaments').select('id, name, starts_on').eq('id', id).maybeSingle(),
        supabase.from('divisions').select('id, type, level, gender, format, status').eq('tournament_id', id),
      ]);
      setTournament((t.data as Tournament) ?? null);
      const divs = (d.data as Division[]) ?? [];
      setDivisions(divs);

      if (divs.length > 0) {
        const counts: Record<string, number> = {};
        await Promise.all(
          divs.map(async (div) => {
            const { count } = await supabase
              .from('matches')
              .select('id', { count: 'exact', head: true })
              .eq('division_id', div.id);
            counts[div.id] = count ?? 0;
          }),
        );
        setMatchCounts(counts);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }
  if (!tournament) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text>Tournament not found.</Text></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Card>
        <Text style={styles.title}>{tournament.name}</Text>
        <Text style={styles.meta}>{tournament.starts_on ?? 'TBD'}</Text>
      </Card>

      <Section title="Divisions">
        {divisions.length === 0 ? (
          <EmptyState
            title="No divisions yet"
            message="Check back when registration opens."
          />
        ) : (
          divisions.map((d) => {
            const count = matchCounts[d.id] ?? 0;
            const formatLabel = labelFormat(d.format);
            const divLabel = labelDivision(d.type, d.level, d.gender);
            return (
              <Card
                key={d.id}
                onPress={() =>
                  router.push({
                    pathname: '/(public)/t/[id]/divisions/[divisionId]/index' as never,
                    params: { id, divisionId: d.id },
                  })
                }
                accessibilityLabel={`View ${divLabel}`}
              >
                <View style={styles.divHeader}>
                  <Text style={styles.divTitle} numberOfLines={1}>
                    {divLabel}
                  </Text>
                  <StatusPill status={d.status} />
                </View>
                <View style={styles.divFooter}>
                  <View style={styles.chipRow}>
                    <Chip label={formatLabel} />
                    {d.format != null && count > 0 && (
                      <Chip label={`${count} matches`} />
                    )}
                  </View>
                  <Text style={styles.viewCue}>View →</Text>
                </View>
              </Card>
            );
          })
        )}
      </Section>
    </ScreenContainer>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

// Build the on-screen division label: gender + type + level.
// Mixed doubles has no gender prefix (it is its own category).
function labelDivision(
  type: 'singles' | 'doubles' | 'mixed_doubles',
  level: 'beginner' | 'intermediate' | 'advanced',
  gender: 'mens' | 'womens' | null,
): string {
  const typeLabel =
    type === 'singles' ? 'Singles' : type === 'doubles' ? 'Doubles' : 'Mixed Doubles';
  const prefix =
    type === 'mixed_doubles'
      ? ''
      : gender === 'mens'
        ? "Men's "
        : gender === 'womens'
          ? "Women's "
          : '';
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  return `${prefix}${typeLabel} · ${levelLabel}`;
}
function labelFormat(f: string | null) {
  if (f === 'round_robin') return 'Round robin';
  if (f === 'pool_to_bracket') return 'Pool → bracket';
  if (f === 'single_elimination') return 'Single elimination';
  return 'Registration open';
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  meta: { fontSize: fontSize.base, color: colors.textMuted, marginTop: spacing.xs },
  divHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  divTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  divFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    flexShrink: 1,
  },
  viewCue: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    flexShrink: 0,
  },
  chip: {
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  chipText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
    textTransform: 'uppercase',
  },
});
