import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../../../../src/components/Button';
import EmptyState from '../../../../../../src/components/EmptyState';
import ErrorBanner from '../../../../../../src/components/ErrorBanner';
import ScreenContainer from '../../../../../../src/components/ScreenContainer';
import { previewFormats, type FormatOption } from '../../../../../../src/lib/formatPreview';
import { generatePoolToBracket, generateRoundRobin, generateSingleElimination, type GenerationResult, type MatchPayload } from '../../../../../../src/lib/generateMatches';
import { notifyAlert, notifyConfirm } from '../../../../../../src/lib/notify';
import { supabase } from '../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, shadows, spacing, tracking } from '../../../../../../src/theme';

type Division = {
  id: string;
  tournament_id: string;
  type: 'singles' | 'doubles' | 'mixed_doubles';
  level: 'beginner' | 'intermediate' | 'advanced';
  gender: 'mens' | 'womens' | null;
  format: 'round_robin' | 'pool_to_bracket' | 'single_elimination' | null;
  status: string;
  best_of: number;
  num_pools: number | null;
  teams_advance: number | null;
};

type Team = { id: string; name: string; seed: number | null };

type Court = { id: string; name: string };

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

function formatTitle(opt: FormatOption): string {
  if (opt.format === 'round_robin') return 'Round robin';
  if (opt.format === 'single_elimination') return 'Single elimination';
  return 'Pool play → bracket';
}

function formatDescription(opt: FormatOption): string {
  if (opt.format === 'round_robin') return 'Every team plays every other team once.';
  if (opt.format === 'single_elimination') return 'One loss and you’re out. Top seeds may get byes.';
  return 'Pool round-robin, then top finishers cross over into a bracket.';
}

export default function GenerateMatches() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const router = useRouter();

  const [division, setDivision] = useState<Division | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignedCourts, setAssignedCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [tournamentMismatch, setTournamentMismatch] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingFormat, setGeneratingFormat] = useState<string | null>(null);
  const generatingRef = useRef(false);

  const load = useCallback(async () => {
    if (!divisionId || !id) return;
    setLoadError(null);
    const dRes = await supabase
      .from('divisions')
      .select('id, tournament_id, type, level, gender, format, status, best_of, num_pools, teams_advance')
      .eq('id', divisionId)
      .maybeSingle();
    if (dRes.error) {
      setLoadError(dRes.error.message);
      setLoading(false);
      return;
    }
    const d = dRes.data as Division | null;
    if (!d) {
      setLoadError('Division not found.');
      setLoading(false);
      return;
    }
    if (d.tournament_id !== id) {
      setTournamentMismatch(true);
      setLoadError('Division does not belong to this tournament. Go back and retry.');
      setLoading(false);
      return;
    }
    setDivision(d);

    const [tRes, dcRes] = await Promise.all([
      supabase
        .from('teams')
        .select('id, name, seed')
        .eq('division_id', divisionId)
        .is('withdrawn_at', null),
      supabase
        .from('division_courts')
        .select('court_id, display_order, courts:court_id (id, name)')
        .eq('division_id', divisionId)
        .order('display_order', { ascending: true }),
    ]);
    if (tRes.error) {
      setLoadError(tRes.error.message);
    } else {
      const list = (tRes.data as Team[]) ?? [];
      list.sort((a, b) => {
        const sa = a.seed === null ? Number.POSITIVE_INFINITY : a.seed;
        const sb = b.seed === null ? Number.POSITIVE_INFINITY : b.seed;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      });
      setTeams(list);
    }
    if (dcRes.error) {
      setLoadError(dcRes.error.message);
    } else {
      const rows = (dcRes.data as unknown as { courts: { id: string; name: string } | { id: string; name: string }[] | null }[] | null) ?? [];
      const courtList: Court[] = rows
        .map((row) => {
          const c = Array.isArray(row.courts) ? row.courts[0] : row.courts;
          return c ? { id: c.id, name: c.name } : null;
        })
        .filter((c): c is Court => c !== null);
      setAssignedCourts(courtList);
    }
    setLoading(false);
  }, [divisionId, id]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  async function persistGeneration(
    chosen: FormatOption,
    result: GenerationResult,
  ): Promise<string | null> {
    if (!division) return 'No division loaded.';

    // division_courts rows already exist (picked on the division detail screen
    // before navigating here). The match generator received those court ids.

    const poolIdMap = new Map<string, string>();
    if (result.pools && result.pools.length > 0) {
      const poolRows = result.pools.map((p) => ({
        division_id: division.id,
        name: p.name,
      }));
      const { data: insertedPools, error: poolErr } = await supabase
        .from('pools')
        .insert(poolRows)
        .select('id, name');
      if (poolErr || !insertedPools) {
        return poolErr?.message ?? 'Could not create pools.';
      }
      const insertedRows = insertedPools as { id: string; name: string }[];
      for (const p of result.pools) {
        const real = insertedRows.find((r) => r.name === p.name);
        if (!real) return `Inserted pool row missing for ${p.name}.`;
        poolIdMap.set(p.localId, real.id);
      }

      const poolTeamRows: { pool_id: string; team_id: string }[] = [];
      for (const p of result.pools) {
        const realPoolId = poolIdMap.get(p.localId);
        if (!realPoolId) continue;
        for (const tid of p.team_ids) {
          poolTeamRows.push({ pool_id: realPoolId, team_id: tid });
        }
      }
      if (poolTeamRows.length > 0) {
        const { error: ptErr } = await supabase.from('pool_teams').insert(poolTeamRows);
        if (ptErr) return ptErr.message;
      }
    }

    if (result.matches.length > 0) {
      const noPointerMatches = result.matches.filter((m) => m.stage !== 'bracket');
      const bracketMatches = result.matches.filter((m) => m.stage === 'bracket');

      if (noPointerMatches.length > 0) {
        const rows = noPointerMatches.map((m) => toInsertRow(m, poolIdMap, new Map()));
        const { error: mErr } = await supabase.from('matches').insert(rows);
        if (mErr) return mErr.message;
      }

      const bracketLocalToReal = new Map<string, string>();
      const roundsDesc = Array.from(
        new Set(bracketMatches.map((m) => m.bracket_round ?? 0))
      ).sort((a, b) => b - a);

      for (const round of roundsDesc) {
        const inRound = bracketMatches.filter((m) => (m.bracket_round ?? 0) === round);
        const rows = inRound.map((m) => toInsertRow(m, poolIdMap, bracketLocalToReal));
        const { data: inserted, error: bErr } = await supabase
          .from('matches')
          .insert(rows)
          .select('id, bracket_round, bracket_slot');
        if (bErr || !inserted) return bErr?.message ?? 'Could not create bracket matches.';
        const insertedRows = inserted as { id: string; bracket_round: number; bracket_slot: number }[];
        for (const m of inRound) {
          const real = insertedRows.find(
            (r) => r.bracket_round === m.bracket_round && r.bracket_slot === m.bracket_slot,
          );
          if (!real) return `Inserted bracket row missing for round=${m.bracket_round} slot=${m.bracket_slot}.`;
          bracketLocalToReal.set(m.localId, real.id);
        }
      }
    }

    const divUpdate: Record<string, unknown> = {
      format: chosen.format,
      status: 'locked',
    };
    if (chosen.format === 'pool_to_bracket') {
      divUpdate.num_pools = chosen.pools.count;
      divUpdate.teams_advance = chosen.pools.advance;
    }
    const { error: dErr } = await supabase
      .from('divisions')
      .update(divUpdate)
      .eq('id', division.id);
    if (dErr) return dErr.message;

    return null;
  }

  async function doGenerate(chosen: FormatOption) {
    if (generatingRef.current) return;
    if (!division) return;
    const orderedCourtIds = assignedCourts.map((c) => c.id);
    if (orderedCourtIds.length === 0) {
      const msg = 'Assign at least one court to this division on the division screen first.';
      setPersistError(msg);
      notifyAlert('No courts assigned', msg);
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    setGeneratingFormat(chosen.format);
    setPersistError(null);

    const teamIds = teams.map((t) => t.id);
    let result: GenerationResult;
    if (chosen.format === 'round_robin') {
      result = generateRoundRobin(division.id, teamIds, orderedCourtIds);
    } else if (chosen.format === 'single_elimination') {
      result = generateSingleElimination(division.id, teamIds, orderedCourtIds);
    } else {
      result = generatePoolToBracket(division.id, teamIds, chosen.pools, orderedCourtIds);
    }

    const err = await persistGeneration(chosen, result);
    generatingRef.current = false;
    setGenerating(false);
    setGeneratingFormat(null);
    if (err) {
      console.warn('[generate] failed:', err);
      setPersistError(err);
      notifyAlert('Could not generate matches', err);
      return;
    }
    router.back();
  }

  function confirmGenerate(chosen: FormatOption) {
    notifyConfirm(
      'Generate matches?',
      `Lock this division with ${formatTitle(chosen).toLowerCase()}? You can still edit or withdraw teams after locking — but adding a new team will require regenerating matches.`,
      () => doGenerate(chosen),
      { confirmLabel: 'Generate' },
    );
  }

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }
  if (loadError) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text style={styles.error}>{loadError}</Text></View>
      </ScreenContainer>
    );
  }
  if (tournamentMismatch) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text style={styles.error}>Division does not belong to this tournament.</Text></View>
      </ScreenContainer>
    );
  }
  if (!division) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text>Division not found.</Text></View>
      </ScreenContainer>
    );
  }

  const alreadyGenerated = division.status !== 'open' || division.format !== null;

  if (alreadyGenerated) {
    return (
      <ScreenContainer>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>Division</Text>
          <Text style={styles.title}>
            {labelDivision(division.type, division.level, division.gender)}
          </Text>
          <Text style={styles.subtitle}>
            Matches already generated. Status: {division.status}. Format: {division.format ?? 'n/a'}.
          </Text>
        </View>
        <Link
          href={{ pathname: '/(admin)/tournaments/[id]', params: { id: division.tournament_id } }}
          asChild
        >
          <Button variant="secondary">View tournament</Button>
        </Link>
        <Text style={styles.warning}>
          Regenerating would delete existing matches — out of scope for v1.
        </Text>
      </ScreenContainer>
    );
  }

  if (teams.length < 2) {
    return (
      <ScreenContainer>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>Division</Text>
          <Text style={styles.title}>
            {labelDivision(division.type, division.level, division.gender)}
          </Text>
        </View>
        <EmptyState
          title="Need more teams"
          message={`At least 2 teams are required to generate matches. Currently ${teams.length}.`}
        />
      </ScreenContainer>
    );
  }

  const options = previewFormats(teams.length);
  const noCourtsPicked = assignedCourts.length === 0;

  if (noCourtsPicked) {
    return (
      <ScreenContainer>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>Division</Text>
          <Text style={styles.title}>
            {labelDivision(division.type, division.level, division.gender)}
          </Text>
        </View>
        <EmptyState
          title="No courts assigned yet"
          message="Pick which courts this division will use on the division screen, then come back."
          action={
            <Button variant="secondary" onPress={() => router.back()}>
              Back to division
            </Button>
          }
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ErrorBanner error={persistError} onDismiss={() => setPersistError(null)} />

      <View style={styles.heading}>
        <Text style={styles.eyebrow}>Division</Text>
        <Text style={styles.title}>
          {labelDivision(division.type, division.level, division.gender)}
        </Text>
        <Text style={styles.subtitle}>
          {teams.length} teams · {assignedCourts.length} {assignedCourts.length === 1 ? 'court' : 'courts'} ({assignedCourts.map((c) => c.name).join(', ')}). Pick a format below — math is computed against your actual count.
        </Text>
      </View>

      <View style={styles.cardList}>
        {options.map((opt) => {
          const isBusy = generating && generatingFormat === opt.format;
          const disabled = generating;
          return (
            <Pressable
              key={opt.format}
              disabled={disabled}
              onPress={() => confirmGenerate(opt)}
              accessibilityRole="button"
              accessibilityLabel={`Generate ${formatTitle(opt)}`}
              accessibilityState={{ disabled }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.formatCard,
                hovered && !disabled && styles.formatCardHover,
                pressed && !disabled && styles.formatCardPressed,
                generating && !isBusy && styles.formatCardDimmed,
              ]}
            >
              <View style={styles.formatHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formatTitle}>{formatTitle(opt)}</Text>
                  <Text style={styles.formatDesc}>{formatDescription(opt)}</Text>
                </View>
                {isBusy && <ActivityIndicator color={colors.primary} />}
              </View>
              <View style={styles.chipRow}>
                {opt.format === 'round_robin' && (
                  <>
                    <StatChip label="Games / team" value={String(opt.gamesPerTeam)} tone="primary" />
                    <StatChip label="Total matches" value={String(opt.totalMatches)} />
                    <StatChip label="Rounds" value={String(opt.rounds)} />
                    {opt.hasByes && <StatChip label="Byes" value="1 / round" tone="warning" />}
                  </>
                )}
                {opt.format === 'single_elimination' && (
                  <>
                    <StatChip
                      label="Games / team"
                      value={
                        opt.gamesPerTeamMin === opt.gamesPerTeamMax
                          ? String(opt.gamesPerTeamMin)
                          : `${opt.gamesPerTeamMin}–${opt.gamesPerTeamMax}`
                      }
                      tone="primary"
                    />
                    <StatChip label="Total matches" value={String(opt.totalMatches)} />
                    <StatChip label="Rounds" value={String(opt.rounds)} />
                    {opt.byes > 0 && <StatChip label="Byes" value={String(opt.byes)} tone="warning" />}
                  </>
                )}
                {opt.format === 'pool_to_bracket' && (
                  <>
                    <StatChip
                      label="Pools"
                      value={`${opt.pools.count} (${opt.pools.sizes.join('/')})`}
                      tone="primary"
                    />
                    <StatChip
                      label="Pool games / team"
                      value={
                        opt.poolGamesPerTeamMin === opt.poolGamesPerTeamMax
                          ? String(opt.poolGamesPerTeamMin)
                          : `${opt.poolGamesPerTeamMin}–${opt.poolGamesPerTeamMax}`
                      }
                    />
                    <StatChip label="Advance / pool" value={String(opt.pools.advance)} />
                    <StatChip label="Bracket matches" value={String(opt.bracketMatches)} />
                    <StatChip label="Total matches" value={String(opt.totalMatches)} />
                  </>
                )}
              </View>
              <View style={styles.formatCta}>
                <Text style={styles.formatCtaText}>
                  {isBusy ? 'Generating…' : `Use ${formatTitle(opt).toLowerCase()} →`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScreenContainer>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone?: 'primary' | 'warning' }) {
  const bg = tone === 'primary' ? colors.primarySoft : tone === 'warning' ? '#fef3c7' : colors.bgMuted;
  const fg = tone === 'primary' ? colors.primarySoftText : tone === 'warning' ? '#92400e' : colors.text;
  const labelColor = tone === 'primary' ? colors.primarySoftText : tone === 'warning' ? '#92400e' : colors.textMuted;
  return (
    <View style={[styles.statChip, { backgroundColor: bg }]}>
      <Text style={[styles.statValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

// Convert a generated MatchPayload into a Supabase insert row, resolving any
// local pool_id / next_match_id references through the supplied maps.
function toInsertRow(
  m: MatchPayload & { localId: string },
  poolIdMap: Map<string, string>,
  bracketLocalToReal: Map<string, string>,
): Record<string, unknown> {
  let poolId: string | null = m.pool_id;
  if (poolId !== null && poolIdMap.has(poolId)) {
    poolId = poolIdMap.get(poolId)!;
  }
  let nextId: string | null = m.next_match_id;
  if (nextId !== null && bracketLocalToReal.has(nextId)) {
    nextId = bracketLocalToReal.get(nextId)!;
  } else if (nextId !== null && !bracketLocalToReal.has(nextId)) {
    console.warn('[generate] unresolved next_match_id', nextId);
    nextId = null;
  }
  return {
    division_id: m.division_id,
    stage: m.stage,
    pool_id: poolId,
    round_number: m.round_number,
    bracket_round: m.bracket_round,
    bracket_slot: m.bracket_slot,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    court_id: m.court_id,
    status: m.status,
    next_match_id: nextId,
    next_match_slot: m.next_match_slot,
  };
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  error: { color: colors.destructive },
  warning: { color: '#92400e', fontSize: fontSize.sm, marginTop: spacing.sm },
  heading: { gap: spacing.xs, paddingTop: spacing.sm },
  eyebrow: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted, marginTop: spacing.xs },
  courtSection: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  courtHelper: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  courtList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  courtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    minHeight: 44,
  },
  courtRowHover: {
    borderColor: colors.borderStrong,
  },
  courtRowPressed: {
    opacity: 0.92,
  },
  courtRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  courtName: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  courtNameSelected: {
    color: colors.primarySoftText,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  courtCheck: {
    fontSize: fontSize.md,
    color: colors.textSubtle,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    minWidth: 18,
    textAlign: 'right',
  },
  courtCheckSelected: {
    color: colors.primary,
  },
  courtCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  formatWarning: {
    fontSize: fontSize.sm,
    color: '#92400e',
    marginTop: spacing.md,
  },
  cardList: { gap: spacing.lg, marginTop: spacing.md },
  formatCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.xl,
    backgroundColor: colors.bgElevated,
    gap: spacing.md,
    ...shadows.card,
  },
  formatCardHover: {
    borderColor: colors.primary,
    ...shadows.cardHover,
  },
  formatCardPressed: {
    borderColor: colors.primary,
    opacity: 0.95,
  },
  formatCardDimmed: {
    opacity: 0.55,
  },
  formatHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  formatTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.2,
  },
  formatDesc: {
    fontSize: fontSize.base,
    color: colors.textMuted,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statChip: {
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 96,
  },
  statValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  statLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
    marginTop: 2,
  },
  formatCta: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  formatCtaText: {
    fontSize: fontSize.base,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  formatCtaTextDisabled: {
    color: colors.textSubtle,
  },
});
