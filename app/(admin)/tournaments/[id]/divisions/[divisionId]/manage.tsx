import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { notifyAlert, notifyConfirm } from '../../../../../../src/lib/notify';
import Button from '../../../../../../src/components/Button';
import Card from '../../../../../../src/components/Card';
import EmptyState from '../../../../../../src/components/EmptyState';
import ErrorBanner from '../../../../../../src/components/ErrorBanner';
import ScreenContainer from '../../../../../../src/components/ScreenContainer';
import Section from '../../../../../../src/components/Section';
import StatusPill from '../../../../../../src/components/StatusPill';
import {
  promoteToBracketIfReady,
  reassignCourts as reassignCourtsOp,
  regenerateMatches as regenerateMatchesOp,
  reportMatch as reportMatchOp,
} from '../../../../../../src/lib/divisionOps';
import { supabase } from '../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../../src/theme';

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';
type DivisionLevel = 'beginner' | 'intermediate' | 'advanced';
type DivisionFormat = 'round_robin' | 'pool_to_bracket' | 'single_elimination';

type DivisionGender = 'mens' | 'womens';

type Division = {
  id: string;
  tournament_id: string;
  type: DivisionType;
  level: DivisionLevel;
  gender: DivisionGender | null;
  format: DivisionFormat | null;
  status: string;
  best_of: number;
  game_to: number;
  win_by: number;
  num_pools: number | null;
  teams_advance: number | null;
};

type Team = { id: string; name: string; withdrawn_at: string | null };

type Match = {
  id: string;
  stage: 'round_robin' | 'pool' | 'bracket';
  pool_id: string | null;
  round_number: number | null;
  bracket_round: number | null;
  bracket_slot: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  court_id: string | null;
  status: 'pending' | 'scheduled' | 'in_progress' | 'reported' | 'voided' | 'forfeit';
  winner_team_id: string | null;
};

type MatchGame = {
  match_id: string;
  game_number: number;
  score_a: number;
  score_b: number;
};

type Pool = { id: string; name: string };
type PoolTeam = { pool_id: string; team_id: string };

type Court = { id: string; name: string };
type DivisionCourtRow = { court_id: string; display_order: number; courts: { id: string; name: string } | null };

// Build the on-screen division label: gender + type + level.
// Mixed doubles has no gender prefix (it is its own category).
function labelDivision(
  type: DivisionType,
  level: DivisionLevel,
  gender: DivisionGender | null,
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
function labelFormat(f: DivisionFormat | null) {
  if (f === 'round_robin') return 'Round robin';
  if (f === 'pool_to_bracket') return 'Pool play → bracket';
  if (f === 'single_elimination') return 'Single elimination';
  return null;
}

// For single-elim: name rounds working backward from the final.
// If totalRounds is the count of rounds in the bracket, round R has label based
// on its distance from the final. The highest round number is the final.
type Standing = {
  rank: number;
  team_id: string;
  team_name: string;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  // Per-game point totals across all reported matches.
  // pointsFor = sum of this team's score in each game; pointsAgainst = sum of
  // opponent scores; pointDiff = PF - PA. Cascading tiebreaker after wins.
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  withdrawn: boolean;
};

// Compute standings from reported (or forfeit) matches.
// Optionally filter to a subset of team ids (for per-pool standings).
function computeStandings(
  matches: Match[],
  gamesByMatch: Record<string, MatchGame[]>,
  teamsById: Map<string, Team>,
  filterTeamIds?: Set<string>,
): Standing[] {
  const stats = new Map<
    string,
    {
      wins: number;
      losses: number;
      gamesWon: number;
      gamesLost: number;
      pointsFor: number;
      pointsAgainst: number;
    }
  >();

  const teamIds = filterTeamIds
    ? Array.from(filterTeamIds)
    : Array.from(teamsById.keys());
  for (const tid of teamIds) {
    stats.set(tid, {
      wins: 0,
      losses: 0,
      gamesWon: 0,
      gamesLost: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  for (const m of matches) {
    if (!m.team_a_id || !m.team_b_id || !m.winner_team_id) continue;
    if (filterTeamIds && (!filterTeamIds.has(m.team_a_id) || !filterTeamIds.has(m.team_b_id))) continue;
    if (m.status !== 'reported' && m.status !== 'forfeit') continue;
    const a = stats.get(m.team_a_id);
    const b = stats.get(m.team_b_id);
    if (!a || !b) continue;
    const games = gamesByMatch[m.id] ?? [];
    let aGames = 0;
    let bGames = 0;
    for (const g of games) {
      if (g.score_a > g.score_b) aGames += 1;
      else if (g.score_b > g.score_a) bGames += 1;
      // Each game's score_a goes to team_a's PF (and team_b's PA), and vice versa.
      a.pointsFor += g.score_a;
      a.pointsAgainst += g.score_b;
      b.pointsFor += g.score_b;
      b.pointsAgainst += g.score_a;
    }
    a.gamesWon += aGames;
    a.gamesLost += bGames;
    b.gamesWon += bGames;
    b.gamesLost += aGames;
    if (m.winner_team_id === m.team_a_id) {
      a.wins += 1;
      b.losses += 1;
    } else if (m.winner_team_id === m.team_b_id) {
      b.wins += 1;
      a.losses += 1;
    }
  }

  const standings: Standing[] = Array.from(stats.entries()).map(([teamId, s]) => ({
    rank: 0,
    team_id: teamId,
    team_name: teamsById.get(teamId)?.name ?? '?',
    wins: s.wins,
    losses: s.losses,
    gamesWon: s.gamesWon,
    gamesLost: s.gamesLost,
    pointsFor: s.pointsFor,
    pointsAgainst: s.pointsAgainst,
    pointDiff: s.pointsFor - s.pointsAgainst,
    withdrawn: teamsById.get(teamId)?.withdrawn_at != null,
  }));

  // Tie-break cascade: wins desc, pointDiff desc, pointsFor desc, team name asc.
  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.team_name.localeCompare(b.team_name);
  });
  standings.forEach((s, i) => { s.rank = i + 1; });
  return standings;
}

function bracketRoundLabel(round: number, totalRounds: number, maxRound: number): string {
  const fromFinal = maxRound - round; // 0 = final, 1 = semi, ...
  if (fromFinal === 0) return 'Final';
  if (fromFinal === 1) return 'Semifinal';
  if (fromFinal === 2) return 'Quarterfinal';
  if (fromFinal === 3) return 'Round of 16';
  if (fromFinal === 4) return 'Round of 32';
  // Fallback for very deep brackets.
  return `Round ${round} of ${totalRounds}`;
}

export default function DivisionDetail() {
  const { id, divisionId, focus } = useLocalSearchParams<{ id: string; divisionId: string; focus?: string }>();
  const scoreFocus = focus === 'score';
  const teamsFocus = focus === 'teams';
  const courtsFocus = focus === 'courts';
  const router = useRouter();

  const [division, setDivision] = useState<Division | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [gamesByMatch, setGamesByMatch] = useState<Record<string, MatchGame[]>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [divisionCourts, setDivisionCourts] = useState<Court[]>([]);
  const [courtsById, setCourtsById] = useState<Map<string, Court>>(new Map());
  const [allCourts, setAllCourts] = useState<Court[]>([]);
  const [savingCourt, setSavingCourt] = useState<string | null>(null);
  const savingCourtRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which match (if any) is currently expanded inline for score entry.
  // Only one can be expanded at a time to keep the page compact.
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !divisionId) return;
    setError(null);

    // For pool→bracket: if pool play is done but the bracket still has TBD
    // slots, populate it now. Idempotent and a no-op for other formats.
    await promoteToBracketIfReady(divisionId);

    const dRes = await supabase
      .from('divisions')
      .select('id, tournament_id, type, level, gender, format, status, best_of, game_to, win_by, num_pools, teams_advance')
      .eq('id', divisionId)
      .maybeSingle();
    if (dRes.error) {
      setError(dRes.error.message);
      setLoading(false);
      return;
    }
    const div = dRes.data as Division | null;
    if (!div) {
      setError('Division not found.');
      setLoading(false);
      return;
    }
    if (div.tournament_id !== id) {
      setError('Division does not belong to this tournament.');
      setLoading(false);
      return;
    }
    setDivision(div);

    const [teamsRes, matchesRes, poolsRes, dcRes, allCourtsRes] = await Promise.all([
      supabase
        .from('teams')
        .select('id, name, withdrawn_at')
        .eq('division_id', divisionId),
      supabase
        .from('matches')
        .select('id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id')
        .eq('division_id', divisionId)
        .order('bracket_round', { ascending: true, nullsFirst: true })
        .order('round_number', { ascending: true, nullsFirst: true })
        .order('bracket_slot', { ascending: true, nullsFirst: true }),
      div.format === 'pool_to_bracket'
        ? supabase.from('pools').select('id, name').eq('division_id', divisionId).order('name')
        : Promise.resolve({ data: [] as Pool[], error: null } as const),
      supabase
        .from('division_courts')
        .select('court_id, display_order, courts:court_id (id, name)')
        .eq('division_id', divisionId)
        .order('display_order', { ascending: true }),
      supabase
        .from('courts')
        .select('id, name')
        .is('archived_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true }),
    ]);

    if (teamsRes.error) setError(teamsRes.error.message);
    setTeams((teamsRes.data as Team[]) ?? []);

    if (matchesRes.error) setError(matchesRes.error.message);
    const mList = (matchesRes.data as Match[]) ?? [];
    setMatches(mList);

    if (poolsRes.error) setError(poolsRes.error.message);
    const poolList = (poolsRes.data as Pool[]) ?? [];
    setPools(poolList);

    if (dcRes.error) setError(dcRes.error.message);
    const dcRows = (dcRes.data as DivisionCourtRow[] | null) ?? [];
    const courtList: Court[] = dcRows
      .map((row) => (row.courts ? { id: row.courts.id, name: row.courts.name } : null))
      .filter((c): c is Court => c !== null);
    setDivisionCourts(courtList);
    setCourtsById(new Map(courtList.map((c) => [c.id, c])));

    if (allCourtsRes.error) setError(allCourtsRes.error.message);
    setAllCourts((allCourtsRes.data as Court[]) ?? []);

    // Fetch pool_teams only when there are pools.
    if (poolList.length > 0) {
      const ptRes = await supabase
        .from('pool_teams')
        .select('pool_id, team_id')
        .in('pool_id', poolList.map((p) => p.id));
      if (ptRes.error) setError(ptRes.error.message);
      setPoolTeams((ptRes.data as PoolTeam[]) ?? []);
    } else {
      setPoolTeams([]);
    }

    // Fetch match_games only if at least one match is reported.
    const hasReported = mList.some((m) => m.status === 'reported');
    if (hasReported) {
      const gRes = await supabase
        .from('match_games')
        .select('match_id, game_number, score_a, score_b')
        .in('match_id', mList.map((m) => m.id));
      if (gRes.error) setError(gRes.error.message);
      const grouped: Record<string, MatchGame[]> = {};
      for (const g of (gRes.data as MatchGame[]) ?? []) {
        if (!grouped[g.match_id]) grouped[g.match_id] = [];
        grouped[g.match_id].push(g);
      }
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => a.game_number - b.game_number);
      }
      setGamesByMatch(grouped);
    } else {
      setGamesByMatch({});
    }

    setLoading(false);
  }, [id, divisionId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => { if (!cancelled) await load(); })();
      return () => { cancelled = true; };
    }, [load]),
  );

  // Double-tap guard shared by both Operations buttons. Both ops are
  // destructive enough that we don't want concurrent calls overlapping.
  const opBusyRef = useRef(false);

  async function reassignCourts() {
    if (!division || !division.format) return;
    if (matches.length === 0) {
      notifyAlert('No matches', 'There are no matches to reassign.');
      return;
    }
    if (divisionCourts.length === 0) {
      notifyAlert('No courts', 'Pick at least one court above first.');
      return;
    }
    if (opBusyRef.current) return;
    opBusyRef.current = true;
    const result = await reassignCourtsOp(division.id);
    opBusyRef.current = false;
    if (!result.ok) {
      setError(`Reassign failed: ${result.error}`);
      notifyAlert('Reassign failed', result.error);
      return;
    }
    await load();
    if (result.updated === 0) {
      notifyAlert('No changes', 'Court assignments already match the current set.');
    } else {
      notifyAlert(
        'Courts reassigned',
        `${result.updated} match${result.updated === 1 ? '' : 'es'} updated.`,
      );
    }
  }

  async function regenerateMatches() {
    if (!division) return;
    notifyConfirm(
      'Regenerate matches?',
      'All matches and scores for this division will be deleted. You’ll pick a format again from scratch. This cannot be undone.',
      async () => {
        if (opBusyRef.current) return;
        opBusyRef.current = true;
        const result = await regenerateMatchesOp(division.id);
        opBusyRef.current = false;
        if (!result.ok) {
          setError(`Regenerate failed: ${result.error}`);
          notifyAlert('Regenerate failed', result.error);
          return;
        }
        await load();
      },
      { confirmLabel: 'Regenerate', destructive: true },
    );
  }

  async function toggleCourt(court: Court) {
    if (!division) return;
    if (savingCourtRef.current) return;
    savingCourtRef.current = true;
    setSavingCourt(court.id);
    const isSelected = divisionCourts.some((c) => c.id === court.id);
    if (isSelected) {
      const { error: err } = await supabase
        .from('division_courts')
        .delete()
        .eq('division_id', division.id)
        .eq('court_id', court.id);
      savingCourtRef.current = false;
      setSavingCourt(null);
      if (err) {
        setError(`Could not remove court: ${err.message}`);
        return;
      }
      setDivisionCourts((prev) => prev.filter((c) => c.id !== court.id));
    } else {
      const nextOrder = divisionCourts.length;
      const { error: err } = await supabase
        .from('division_courts')
        .insert({ division_id: division.id, court_id: court.id, display_order: nextOrder });
      savingCourtRef.current = false;
      setSavingCourt(null);
      if (err) {
        setError(`Could not add court: ${err.message}`);
        return;
      }
      setDivisionCourts((prev) => [...prev, court]);
      setCourtsById((prev) => new Map(prev).set(court.id, court));
    }
  }

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }
  if (!division) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {!error && <Text>Division not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }

  const teamCount = teams.length;
  const activeTeamCount = teams.filter((t) => !t.withdrawn_at).length;
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const format = division.format;
  const showMatches = division.status !== 'open' && !teamsFocus && !courtsFocus;
  const isOpen = division.status === 'open';
  const courtsAssigned = divisionCourts.length;
  const canGenerate = isOpen && activeTeamCount >= 2 && courtsAssigned >= 1;
  const formatText = labelFormat(format);
  const selectedCourtIds = new Set(divisionCourts.map((c) => c.id));

  return (
    <ScreenContainer>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Card>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={styles.title} numberOfLines={2}>
              {labelDivision(division.type, division.level, division.gender)}
            </Text>
            <View style={styles.pillRow}>
              <StatusPill status={division.status} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit division"
                onPress={() =>
                  router.push({
                    pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]/edit',
                    params: { id: division.tournament_id, divisionId: division.id },
                  })
                }
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.editIconBtn,
                  hovered && styles.editIconBtnHover,
                  pressed && styles.editIconBtnPressed,
                ]}
              >
                <Feather name="edit-2" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.meta}>
              {teamCount} {teamCount === 1 ? 'team' : 'teams'} · Best of {division.best_of},{' '}
              {division.game_to} win by {division.win_by}
            </Text>
            {formatText && <Text style={styles.metaSubtle}>{formatText}</Text>}
            {!isOpen && divisionCourts.length > 0 && (
              <View style={styles.courtChipRow}>
                {divisionCourts.map((c) => (
                  <View key={c.id} style={styles.courtChip}>
                    <Text style={styles.courtChipText}>{c.name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {isOpen && (
          <View style={styles.headerActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={() =>
                router.push({
                  pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]/teams/new',
                  params: { id: division.tournament_id, divisionId: division.id },
                })
              }
            >
              Add team
            </Button>
          </View>
        )}
      </Card>

      {((!scoreFocus && !teamsFocus) || courtsFocus) && (
      <Section
        title="Courts"
        action={
          allCourts.length > 0 ? (
            <Text style={styles.countLabel}>{courtsAssigned} / {allCourts.length}</Text>
          ) : null
        }
      >
        {allCourts.length === 0 ? (
          <EmptyState
            title="No courts yet"
            message="Add courts in Admin → Courts first, then come back."
            action={
              <Button
                variant="secondary"
                size="sm"
                onPress={() => router.push('/(admin)/courts')}
              >
                Manage courts
              </Button>
            }
          />
        ) : (
          <>
            <Text style={styles.courtsHelper}>
              {isOpen
                ? 'Pick which courts this division will use. Matches will rotate through them.'
                : 'Add or remove courts, then tap Reassign courts below to redistribute existing matches.'}
            </Text>
            <View style={styles.courtPickerList}>
              {allCourts.map((c) => {
                const selected = selectedCourtIds.has(c.id);
                const saving = savingCourt === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => toggleCourt(c)}
                    disabled={saving}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: saving }}
                    accessibilityLabel={`Toggle ${c.name}`}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.courtToggle,
                      selected && styles.courtToggleSelected,
                      hovered && !selected && styles.courtToggleHover,
                      pressed && styles.courtTogglePressed,
                      saving && styles.courtToggleDimmed,
                    ]}
                  >
                    <Text style={[styles.courtToggleText, selected && styles.courtToggleTextSelected]}>
                      {c.name}
                    </Text>
                    {selected ? (
                      <Feather name="check" size={16} color={colors.primary} />
                    ) : (
                      <View style={styles.courtCheckBlank} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </Section>
      )}

      {!scoreFocus && !courtsFocus && (
      <Section
        title={!isOpen && format === 'round_robin' ? 'Standings' : 'Teams'}
        action={<Text style={styles.countLabel}>{teamCount}</Text>}
      >
        {teams.length === 0 ? (
          <EmptyState
            title="No teams yet"
            message={isOpen ? 'Add a team to get started.' : 'This division has no teams.'}
          />
        ) : !isOpen && format === 'round_robin' ? (
          <StandingsTable
            standings={computeStandings(matches, gamesByMatch, teamsById)}
            onRowPress={(teamId) =>
              router.push({
                pathname:
                  '/(admin)/tournaments/[id]/divisions/[divisionId]/teams/[teamId]/edit',
                params: { id: division.tournament_id, divisionId: division.id, teamId },
              })
            }
          />
        ) : (
          <View style={styles.teamGrid}>
            {teams.map((t) => {
              const withdrawn = t.withdrawn_at != null;
              return (
                <View key={t.id} style={styles.teamGridCell}>
                  <Card
                    flat
                    onPress={() =>
                      router.push({
                        pathname:
                          '/(admin)/tournaments/[id]/divisions/[divisionId]/teams/[teamId]/edit',
                        params: {
                          id: division.tournament_id,
                          divisionId: division.id,
                          teamId: t.id,
                        },
                      })
                    }
                    accessibilityLabel={`Edit team ${t.name}`}
                  >
                    <View style={styles.teamCardRow}>
                      <Text style={[styles.teamName, withdrawn && styles.teamNameWithdrawn]} numberOfLines={2}>
                        {t.name}
                      </Text>
                      {withdrawn && (
                        <View style={styles.withdrawnPill}>
                          <Text style={styles.withdrawnPillText}>Withdrawn</Text>
                        </View>
                      )}
                    </View>
                  </Card>
                </View>
              );
            })}
          </View>
        )}
      </Section>
      )}

      {!scoreFocus && !teamsFocus && !courtsFocus && isOpen && (
        <Section title="Lock and generate">
          <Card flat>
            <Text style={styles.generateBlurb}>
              When all teams have registered and you’ve picked the courts, lock the
              division and the system will build the schedule. You can still edit or
              withdraw teams afterwards — adding a new team will require regenerating
              matches.
            </Text>
            <View style={styles.generateActionRow}>
              <Button
                size="lg"
                disabled={!canGenerate}
                onPress={() =>
                  router.push({
                    pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]/generate',
                    params: { id: division.tournament_id, divisionId: division.id },
                  })
                }
              >
                Generate matches
              </Button>
            </View>
            {!canGenerate && (
              <Text style={styles.generateHint}>
                {activeTeamCount < 2
                  ? `Add ${2 - activeTeamCount} more team${2 - activeTeamCount === 1 ? '' : 's'} first.`
                  : courtsAssigned === 0
                    ? 'Pick at least one court above first.'
                    : ''}
              </Text>
            )}
          </Card>
        </Section>
      )}

      {!scoreFocus && !teamsFocus && !courtsFocus && !isOpen && matches.length > 0 && (
        <Section title="Operations">
          <Card flat>
            <Text style={styles.opsBlurb}>
              Reassign courts redistributes existing matches across your current
              court selection (e.g. you added a 5th court). Regenerate wipes all
              matches and scores and lets you pick a format from scratch.
            </Text>
            <View style={styles.opsRow}>
              <Button
                variant="secondary"
                size="md"
                disabled={courtsAssigned === 0}
                onPress={reassignCourts}
              >
                Reassign courts
              </Button>
              <Button
                variant="destructive"
                size="md"
                onPress={regenerateMatches}
              >
                Regenerate matches
              </Button>
            </View>
          </Card>
        </Section>
      )}

      {showMatches && (
        <Section title="Matches">
          {matches.length === 0 ? (
            <EmptyState title="No matches generated yet" />
          ) : (
            (() => {
              const goToScore = (matchId: string) =>
                router.push({
                  pathname:
                    '/(admin)/tournaments/[id]/divisions/[divisionId]/matches/[matchId]/score',
                  params: { id: division.tournament_id, divisionId: division.id, matchId },
                });
              const goToTeam = (teamId: string) =>
                router.push({
                  pathname:
                    '/(admin)/tournaments/[id]/divisions/[divisionId]/teams/[teamId]/edit',
                  params: { id: division.tournament_id, divisionId: division.id, teamId },
                });
              // Tapping a pending match expands it inline; tapping a
              // reported/forfeit/voided match opens the full score screen
              // (which has the edit / reset / cascade tools).
              const onMatchPress = (m: Match) => {
                const isDone =
                  m.status === 'reported' || m.status === 'forfeit' || m.status === 'voided';
                if (isDone) {
                  goToScore(m.id);
                  return;
                }
                setExpandedMatchId((prev) => (prev === m.id ? null : m.id));
              };
              const cardProps = {
                teamsById,
                courtsById,
                gamesByMatch,
                allMatches: matches,
                expandedMatchId,
                onMatchPress,
                onCollapse: () => setExpandedMatchId(null),
                onSaved: async () => {
                  setExpandedMatchId(null);
                  await load();
                },
                onOpenFullScreen: goToScore,
                bestOf: division.best_of,
                gameTo: division.game_to,
                winBy: division.win_by,
              };

              return format === 'round_robin' ? (
                <RoundRobinMatches matches={matches} {...cardProps} />
              ) : format === 'single_elimination' ? (
                <BracketMatches
                  matches={matches.filter((m) => m.stage === 'bracket')}
                  {...cardProps}
                />
              ) : format === 'pool_to_bracket' ? (
                <PoolToBracketMatches
                  matches={matches}
                  pools={pools}
                  poolTeams={poolTeams}
                  onTeamPress={goToTeam}
                  {...cardProps}
                />
              ) : (
                <EmptyState title="No matches generated yet" />
              );
            })()
          )}
        </Section>
      )}

      {(scoreFocus || teamsFocus || courtsFocus) && (
        <View style={styles.focusFooter}>
          <Button
            size="lg"
            onPress={() => {
              if (router.canGoBack && router.canGoBack()) {
                router.back();
              } else {
                router.replace({
                  pathname: '/(admin)/tournaments/[id]',
                  params: { id: division.tournament_id },
                });
              }
            }}
          >
            Done
          </Button>
        </View>
      )}
    </ScreenContainer>
  );
}

// --- Standings table ---------------------------------------------------

function StandingsTable({
  standings,
  compact,
  onRowPress,
}: {
  standings: Standing[];
  compact?: boolean;
  onRowPress?: (teamId: string) => void;
}) {
  if (standings.length === 0) {
    return (
      <View style={[styles.standingsCard, compact && styles.standingsCardCompact]}>
        <Text style={styles.standingsEmpty}>No standings yet.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.standingsCard, compact && styles.standingsCardCompact]}>
      <View style={styles.standingsHeaderRow}>
        <Text style={[styles.standingsHeaderText, styles.standingsRankCol]}>#</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsTeamCol]}>Team</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>W</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>L</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PF</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PA</Text>
        <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PD</Text>
      </View>
      {standings.map((s, i) => {
        const inner = (
          <>
            <Text style={[styles.standingsCell, styles.standingsRankCol, styles.standingsRankText, s.rank === 1 && s.wins > 0 && styles.standingsRankTextLeader]}>
              {s.rank}
            </Text>
            <View style={[styles.standingsTeamCol, styles.standingsTeamCell]}>
              <Text
                style={[styles.standingsTeamText, s.withdrawn && styles.standingsTeamTextWithdrawn]}
                numberOfLines={1}
              >
                {s.team_name}
              </Text>
              {s.withdrawn && (
                <View style={styles.withdrawnPill}>
                  <Text style={styles.withdrawnPillText}>Withdrawn</Text>
                </View>
              )}
            </View>
            <Text style={[styles.standingsCell, styles.standingsStatCol, styles.standingsStatText, styles.standingsWinsText]}>{s.wins}</Text>
            <Text style={[styles.standingsCell, styles.standingsStatCol, styles.standingsStatText]}>{s.losses}</Text>
            <Text style={[styles.standingsCell, styles.standingsStatCol, styles.standingsStatText]}>{s.pointsFor}</Text>
            <Text style={[styles.standingsCell, styles.standingsStatCol, styles.standingsStatText]}>{s.pointsAgainst}</Text>
            <Text
              style={[
                styles.standingsCell,
                styles.standingsStatCol,
                styles.standingsStatText,
                s.pointDiff > 0 && styles.standingsDiffPositive,
                s.pointDiff < 0 && styles.standingsDiffNegative,
              ]}
            >
              {s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}
            </Text>
          </>
        );
        if (onRowPress) {
          return (
            <Pressable
              key={s.team_id}
              onPress={() => onRowPress(s.team_id)}
              accessibilityRole="button"
              accessibilityLabel={`Edit team ${s.team_name}`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.standingsRow,
                i === 0 && styles.standingsRowFirst,
                styles.standingsRowTappable,
                hovered && styles.standingsRowHover,
                pressed && styles.standingsRowPressed,
              ]}
            >
              {inner}
            </Pressable>
          );
        }
        return (
          <View
            key={s.team_id}
            style={[
              styles.standingsRow,
              i === 0 && styles.standingsRowFirst,
            ]}
          >
            {inner}
          </View>
        );
      })}
    </View>
  );
}

// Shared prop bundle for the match-list renderers below. Each renderer
// passes these straight through to MatchCard so inline-score state lives
// in the parent (DivisionDetail) and the cards stay stateless aside from
// their own input strings.
type MatchListProps = {
  teamsById: Map<string, Team>;
  courtsById: Map<string, Court>;
  gamesByMatch: Record<string, MatchGame[]>;
  // All matches in the division — used to compute per-match readiness
  // ("Waiting on Court 3" when a shared player is still on another court).
  allMatches: Match[];
  expandedMatchId: string | null;
  onMatchPress: (match: Match) => void;
  onCollapse: () => void;
  onSaved: () => Promise<void> | void;
  onOpenFullScreen: (matchId: string) => void;
  bestOf: number;
  gameTo: number;
  winBy: number;
};

// Compute a context-aware label override for a pending match's status pill.
// Returns null when the default status label is fine (e.g. the match is ready
// to play, or it's already reported/voided/etc.).
//
// A pending match is "blocked" if either of its teams is also on another
// unreported earlier-round match (because that player is still playing).
// We then show "Waiting on <CourtName>" using the blocking match's court.
function readinessLabel(
  match: Match,
  allMatches: Match[],
  courtsById: Map<string, Court>,
): string | null {
  if (match.status !== 'pending' && match.status !== 'scheduled') return null;
  if (!match.team_a_id || !match.team_b_id) return null;
  const myRound = match.round_number ?? match.bracket_round ?? 0;

  let earliestBlocker: Match | null = null;
  let earliestBlockerRound = Number.POSITIVE_INFINITY;
  for (const other of allMatches) {
    if (other.id === match.id) continue;
    if (other.status === 'reported' || other.status === 'forfeit' || other.status === 'voided') continue;
    if (!other.team_a_id || !other.team_b_id) continue;
    const otherRound = other.round_number ?? other.bracket_round ?? 0;
    if (otherRound >= myRound) continue; // only earlier rounds block
    const sharesTeam =
      other.team_a_id === match.team_a_id ||
      other.team_b_id === match.team_a_id ||
      other.team_a_id === match.team_b_id ||
      other.team_b_id === match.team_b_id;
    if (!sharesTeam) continue;
    // Prefer an in_progress blocker over a pending one; otherwise earliest round.
    if (other.status === 'in_progress' && earliestBlocker?.status !== 'in_progress') {
      earliestBlocker = other;
      earliestBlockerRound = otherRound;
      continue;
    }
    if (otherRound < earliestBlockerRound) {
      earliestBlocker = other;
      earliestBlockerRound = otherRound;
    }
  }

  if (!earliestBlocker) return null;
  return 'Not started';
}

// --- Round robin --------------------------------------------------------

function RoundRobinMatches({
  matches,
  ...rest
}: { matches: Match[] } & MatchListProps) {
  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    const r = m.round_number ?? 0;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push(m);
  }
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  // For BYE detection: every active (non-withdrawn) team in the division is
  // the candidate pool. A team not in any match this round is on a bye.
  const allActiveTeams = Array.from(rest.teamsById.values()).filter((t) => !t.withdrawn_at);
  return (
    <View style={styles.groupList}>
      {rounds.map((r) => {
        const roundMatches = byRound.get(r)!;
        const playingIds = new Set<string>();
        for (const m of roundMatches) {
          if (m.team_a_id) playingIds.add(m.team_a_id);
          if (m.team_b_id) playingIds.add(m.team_b_id);
        }
        const byes = allActiveTeams.filter((t) => !playingIds.has(t.id));
        return (
          <View key={r} style={styles.roundGroup}>
            <View style={styles.roundHeader}>
              <Text style={styles.roundLabel}>Round {r}</Text>
              <Text style={styles.roundCount}>
                {roundMatches.length} {roundMatches.length === 1 ? 'match' : 'matches'}
                {byes.length > 0 ? ` · ${byes.length} bye` : ''}
              </Text>
            </View>
            <View style={styles.roundMatches}>
              {roundMatches.map((m) => (
                <MatchCard key={m.id} match={m} {...rest} />
              ))}
              {byes.map((t) => (
                <ByeCard key={`bye-${r}-${t.id}`} team={t} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Simple non-interactive card shown when a team sits out a round in a
// round-robin / pool stage with an odd team count.
function ByeCard({ team }: { team: Team }) {
  return (
    <View style={styles.byeCard}>
      <Text style={styles.byeLabel}>Bye</Text>
      <Text style={styles.byeTeam} numberOfLines={1}>{team.name}</Text>
    </View>
  );
}

// --- Single elimination bracket ----------------------------------------

function BracketMatches({
  matches,
  ...rest
}: { matches: Match[] } & MatchListProps) {
  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    const r = m.bracket_round ?? 0;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push(m);
  }
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  const maxRound = rounds.length > 0 ? rounds[rounds.length - 1] : 0;
  return (
    <View style={styles.groupList}>
      {rounds.map((r) => {
        const roundMatches = byRound.get(r)!;
        const label = bracketRoundLabel(r, rounds.length, maxRound);
        return (
          <View key={r} style={styles.roundGroup}>
            <View style={styles.roundHeader}>
              <Text style={styles.roundLabel}>{label}</Text>
              <Text style={styles.roundCount}>
                {roundMatches.length} {roundMatches.length === 1 ? 'match' : 'matches'}
              </Text>
            </View>
            <View style={styles.roundMatches}>
              {roundMatches.map((m) => (
                <MatchCard key={m.id} match={m} {...rest} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// --- Pool play → bracket -----------------------------------------------

function PoolToBracketMatches({
  matches,
  allMatchesForStandings,
  pools,
  poolTeams,
  onTeamPress,
  ...rest
}: {
  matches: Match[];
  allMatchesForStandings?: Match[];
  pools: Pool[];
  poolTeams: PoolTeam[];
  onTeamPress?: (teamId: string) => void;
} & MatchListProps) {
  const { teamsById, gamesByMatch } = rest;
  const poolMatches = matches.filter((m) => m.stage === 'pool');
  const bracketMatches = matches.filter((m) => m.stage === 'bracket');
  // Pool standings always reflect the full reported history regardless of
  // which bucket is being rendered. Fall back to `matches` if the caller
  // didn't pass the full set.
  const standingsSource = (allMatchesForStandings ?? matches).filter((m) => m.stage === 'pool');
  return (
    <View style={styles.groupList}>
      <View style={styles.subSection}>
        <Text style={styles.subSectionLabel}>Pools</Text>
        {pools.length === 0 ? (
          <EmptyState title="No pools" />
        ) : (
          pools.map((p) => {
            const teamIdsInPool = new Set(
              poolTeams.filter((pt) => pt.pool_id === p.id).map((pt) => pt.team_id),
            );
            const matchesInPool = poolMatches.filter((m) => m.pool_id === p.id);
            const standingsMatchesInPool = standingsSource.filter((m) => m.pool_id === p.id);
            const poolStandings = computeStandings(
              standingsMatchesInPool,
              gamesByMatch,
              teamsById,
              teamIdsInPool,
            );
            return (
              <Card key={p.id}>
                <Text style={styles.poolTitle}>{p.name}</Text>
                {poolStandings.length > 0 && (
                  <View style={styles.poolStandings}>
                    <StandingsTable standings={poolStandings} compact onRowPress={onTeamPress} />
                  </View>
                )}
                {matchesInPool.length > 0 && (() => {
                  const byRound = new Map<number, Match[]>();
                  for (const m of matchesInPool) {
                    const rk = m.round_number ?? 0;
                    if (!byRound.has(rk)) byRound.set(rk, []);
                    byRound.get(rk)!.push(m);
                  }
                  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
                  return (
                    <View style={styles.poolMatches}>
                      <Text style={styles.poolMatchesLabel}>Matches</Text>
                      {rounds.map((r) => {
                        const list = byRound.get(r)!;
                        // Detect any team in this pool that's NOT in a match
                        // this round — they're on a bye.
                        const playingIds = new Set<string>();
                        for (const m of list) {
                          if (m.team_a_id) playingIds.add(m.team_a_id);
                          if (m.team_b_id) playingIds.add(m.team_b_id);
                        }
                        const byes: Team[] = Array.from(teamIdsInPool)
                          .filter((tid) => !playingIds.has(tid))
                          .map((tid) => teamsById.get(tid))
                          .filter((t): t is Team => !!t && !t.withdrawn_at);
                        return (
                          <View key={r} style={styles.poolRoundGroup}>
                            <View style={styles.poolRoundHeader}>
                              <Text style={styles.poolRoundLabel}>Round {r}</Text>
                              <Text style={styles.poolRoundCount}>
                                {list.length} {list.length === 1 ? 'match' : 'matches'}
                                {byes.length > 0 ? ` · ${byes.length} bye` : ''}
                              </Text>
                            </View>
                            <View style={styles.poolRoundMatches}>
                              {list.map((m) => (
                                <MatchCard key={m.id} match={m} compact {...rest} />
                              ))}
                              {byes.map((t) => (
                                <ByeCard key={`bye-${r}-${t.id}`} team={t} />
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </Card>
            );
          })
        )}
      </View>

      {bracketMatches.length > 0 && (
        <View style={styles.subSection}>
          <Text style={styles.subSectionLabel}>Bracket</Text>
          <BracketMatches matches={bracketMatches} {...rest} />
        </View>
      )}
    </View>
  );
}

// --- Match card ---------------------------------------------------------

function MatchCard({
  match,
  teamsById,
  courtsById,
  gamesByMatch,
  allMatches,
  compact,
  expandedMatchId,
  onMatchPress,
  onCollapse,
  onSaved,
  onOpenFullScreen,
  bestOf,
  gameTo,
  winBy,
}: {
  match: Match;
  compact?: boolean;
} & MatchListProps) {
  const isNotStarted = readinessLabel(match, allMatches, courtsById) === 'Not started';
  const displayStatus = isNotStarted ? 'not_started' : match.status;
  const games = gamesByMatch[match.id];
  const courtName = match.court_id ? courtsById.get(match.court_id)?.name ?? null : null;
  const teamA = match.team_a_id ? teamsById.get(match.team_a_id) ?? null : null;
  const teamB = match.team_b_id ? teamsById.get(match.team_b_id) ?? null : null;
  const isBye =
    (match.team_a_id !== null && match.team_b_id === null) ||
    (match.team_a_id === null && match.team_b_id !== null);
  const isReported = match.status === 'reported' && games && games.length > 0;
  const isForfeit = match.status === 'forfeit';
  const isAwaitingOpponents =
    match.stage === 'bracket' && match.team_a_id === null && match.team_b_id === null;
  const aWon = match.winner_team_id !== null && match.winner_team_id === match.team_a_id;
  const bWon = match.winner_team_id !== null && match.winner_team_id === match.team_b_id;

  const isDone = isReported || isForfeit;
  const isExpanded = expandedMatchId === match.id;
  const containerStyle = [
    compact && styles.matchCardCompact,
    isAwaitingOpponents && styles.matchCardDimmed,
    isDone && styles.matchCardDone,
    match.status === 'voided' && styles.matchCardVoided,
    isExpanded && styles.matchCardExpanded,
  ];

  const trailing = (
    <View style={styles.matchTrail}>
      {courtName && <Text style={styles.matchCourt}>{courtName}</Text>}
      <StatusPill status={displayStatus} />
    </View>
  );

  if (isBye) {
    const present = teamA ?? teamB;
    return (
      <Card flat style={containerStyle}>
        <View style={styles.matchRow}>
          <Text style={styles.matchTeam}>
            {present?.name ?? 'TBD'} · BYE
          </Text>
          {trailing}
        </View>
      </Card>
    );
  }

  if (isAwaitingOpponents) {
    return (
      <Card flat style={containerStyle}>
        <View style={styles.matchRow}>
          <Text style={styles.matchTeamSubtle}>Awaiting opponents</Text>
          {trailing}
        </View>
      </Card>
    );
  }

  const teamAName = teamA?.name ?? 'TBD';
  const teamBName = teamB?.name ?? 'TBD';

  // PPA / broadcast-style stacked rows: each team gets its own line with right-
  // aligned per-game score columns. For reported/forfeit we show the played
  // count (not best_of). For pending matches we show `best_of` empty
  // placeholder cells so the scoreboard reads as "waiting to fill in" rather
  // than a blank space. Voided shows a single placeholder cell.
  const isVoided = match.status === 'voided';
  type Cell = { kind: 'score'; a: string; b: string } | { kind: 'empty' };
  let cells: Cell[];
  if (isVoided) {
    cells = [{ kind: 'empty' }];
  } else if ((isReported || isForfeit) && games && games.length > 0) {
    cells = games.map((g) => ({ kind: 'score', a: String(g.score_a), b: String(g.score_b) }));
  } else {
    // Pending / scheduled / in_progress: empty boxes, one per max game.
    cells = Array.from({ length: bestOf }, () => ({ kind: 'empty' as const }));
  }

  // Serve indicator: a small primary-color dot rendered inline at the start of
  // Team A's name. Lives inside the same single-line <Text> as the name so it
  // can't push the row taller and break baseline alignment with Team B. Only
  // shown for actively-live statuses (not reported / forfeit / voided).
  const showServeDot =
    match.status === 'pending' ||
    match.status === 'scheduled' ||
    match.status === 'in_progress';

  return (
    <Card flat style={containerStyle} onPress={isExpanded ? undefined : () => onMatchPress(match)}>
      {/* Stacked team rows first (broadcast scoreboard), then a quiet footer
          caption with court name + status. Caption above felt heavy. */}
      <View style={styles.matchStackRows}>
        <View style={styles.matchStackRow}>
          <View style={styles.matchServeCol}>
            {showServeDot ? (
              <Text style={styles.matchServeDot} accessibilityLabel="Serves first">•</Text>
            ) : null}
          </View>
          <Text
            style={[styles.matchTeam, aWon && styles.matchTeamWinner]}
            numberOfLines={1}
          >
            {teamAName}
          </Text>
          {cells.map((c, i) =>
            c.kind === 'score' ? (
              <Text
                key={`a-${i}`}
                style={[styles.matchScoreCol, aWon && styles.matchScoreColWinner]}
                numberOfLines={1}
              >
                {c.a}
              </Text>
            ) : (
              <View key={`a-${i}`} style={styles.matchScoreColEmpty} />
            ),
          )}
        </View>
        <View style={styles.matchStackRow}>
          <View style={styles.matchServeCol} />
          <Text
            style={[styles.matchTeam, bWon && styles.matchTeamWinner]}
            numberOfLines={1}
          >
            {teamBName}
          </Text>
          {cells.map((c, i) =>
            c.kind === 'score' ? (
              <Text
                key={`b-${i}`}
                style={[styles.matchScoreCol, bWon && styles.matchScoreColWinner]}
                numberOfLines={1}
              >
                {c.b}
              </Text>
            ) : (
              <View key={`b-${i}`} style={styles.matchScoreColEmpty} />
            ),
          )}
        </View>
      </View>
      <View style={styles.matchCaptionRow}>
        {courtName && <Text style={styles.matchCourt}>{courtName}</Text>}
        <StatusPill status={displayStatus} />
      </View>
      {isExpanded && (
        <View
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
        >
          <InlineScoreEntry
            matchId={match.id}
            teamAName={teamAName}
            teamBName={teamBName}
            bestOf={bestOf}
            gameTo={gameTo}
            winBy={winBy}
            onCancel={onCollapse}
            onSaved={onSaved}
            onOpenFullScreen={() => onOpenFullScreen(match.id)}
          />
        </View>
      )}
    </Card>
  );
}

// --- Inline score entry --------------------------------------------------

// Compact in-place score entry rendered below a pending MatchCard. Handles
// validation in-memory, then delegates persistence to `reportMatch` in
// `src/lib/divisionOps.ts`. Forfeit, reset, and cascade-revert cases are
// out of scope here — admin can tap "More options" to fall back to the
// full score screen.
function InlineScoreEntry({
  matchId,
  teamAName,
  teamBName,
  bestOf,
  gameTo,
  winBy,
  onCancel,
  onSaved,
  onOpenFullScreen,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  bestOf: number;
  gameTo: number;
  winBy: number;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
  onOpenFullScreen: () => void;
}) {
  // Up to 5 slots so we never resize; visible count is computed below.
  const [scoreA, setScoreA] = useState<string[]>(['', '', '', '', '']);
  const [scoreB, setScoreB] = useState<string[]>(['', '', '', '', '']);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // How many game rows to render — same logic as the full score screen so
  // game 3 only appears for bo3 when games 1 & 2 are split.
  function visibleGames(): number {
    if (bestOf === 1) return 1;
    const winnerOf = (i: number): 'a' | 'b' | null => {
      const av = parseInt(scoreA[i], 10);
      const bv = parseInt(scoreB[i], 10);
      if (!isFinite(av) || !isFinite(bv)) return null;
      if (av === bv) return null;
      return av > bv ? 'a' : 'b';
    };
    if (bestOf === 3) {
      const g1 = winnerOf(0);
      const g2 = winnerOf(1);
      if (g1 && g2 && g1 !== g2) return 3;
      return 2;
    }
    // best_of = 5
    let aw = 0;
    let bw = 0;
    let shown = 0;
    for (let i = 0; i < 5; i++) {
      shown = i + 1;
      const w = winnerOf(i);
      if (w === 'a') aw++;
      else if (w === 'b') bw++;
      if (aw === 3 || bw === 3) break;
    }
    return Math.max(shown, 3);
  }

  const numGamesVisible = visibleGames();

  function updateScoreA(i: number, v: string) {
    const next = [...scoreA];
    next[i] = v;
    setScoreA(next);
  }
  function updateScoreB(i: number, v: string) {
    const next = [...scoreB];
    next[i] = v;
    setScoreB(next);
  }

  async function onSave() {
    if (busyRef.current) return;
    setInlineError(null);

    // Parse + collect entered games. We only submit games the admin has
    // actually filled in (both sides non-empty). reportMatch enforces the
    // best-of and game-rule validations centrally.
    const games: { score_a: number; score_b: number }[] = [];
    for (let i = 0; i < numGamesVisible; i++) {
      const aStr = scoreA[i].trim();
      const bStr = scoreB[i].trim();
      if (aStr === '' && bStr === '') continue;
      if (aStr === '' || bStr === '') {
        setInlineError(`Game ${i + 1}: both scores are required.`);
        return;
      }
      const av = Number(aStr);
      const bv = Number(bStr);
      if (!Number.isInteger(av) || !Number.isInteger(bv) || av < 0 || bv < 0) {
        setInlineError(`Game ${i + 1}: scores must be non-negative integers.`);
        return;
      }
      games.push({ score_a: av, score_b: bv });
    }

    if (games.length === 0) {
      setInlineError('Enter at least one game score.');
      return;
    }

    busyRef.current = true;
    setBusy(true);
    const result = await reportMatchOp({ matchId, games });
    busyRef.current = false;
    setBusy(false);
    if (!result.ok) {
      setInlineError(result.error);
      return;
    }
    await onSaved();
  }

  return (
    <View style={styles.inlineWrap}>
      <View style={styles.inlineDivider} />
      <View style={styles.inlineGames}>
        {Array.from({ length: numGamesVisible }).map((_, i) => (
          <View key={i} style={styles.inlineGameRow}>
            <Text style={styles.inlineGameLabel}>Game {i + 1}</Text>
            <View style={styles.inlineScoreInputs}>
              <View style={styles.inlineScoreSide}>
                <Text style={styles.inlineTeamLabel} numberOfLines={1}>
                  {teamAName}
                </Text>
                <TextInput
                  value={scoreA[i]}
                  onChangeText={(v) => updateScoreA(i, v)}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  maxLength={3}
                  style={styles.inlineScoreInput}
                  accessibilityLabel={`Game ${i + 1} score for ${teamAName}`}
                />
              </View>
              <Text style={styles.inlineDash}>–</Text>
              <View style={styles.inlineScoreSide}>
                <Text style={styles.inlineTeamLabel} numberOfLines={1}>
                  {teamBName}
                </Text>
                <TextInput
                  value={scoreB[i]}
                  onChangeText={(v) => updateScoreB(i, v)}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  maxLength={3}
                  style={styles.inlineScoreInput}
                  accessibilityLabel={`Game ${i + 1} score for ${teamBName}`}
                />
              </View>
            </View>
          </View>
        ))}
      </View>
      {inlineError && (
        <Text style={styles.inlineError} accessibilityLiveRegion="polite">
          {inlineError}
        </Text>
      )}
      <View style={styles.inlineActionsRow}>
        <Button variant="ghost" size="sm" onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onPress={onSave} loading={busy}>
          Save score
        </Button>
      </View>
      {/*
        Escape hatch: a never-played match still needs a forfeit path (admin
        can't fudge a 0-0 score — it would fail validation). Subtle right-
        aligned link that jumps to the full score screen, which owns the
        forfeit picker. Discoverable but unobtrusive.
      */}
      <View style={styles.inlineMoreRow}>
        <Pressable
          onPress={onOpenFullScreen}
          disabled={busy}
          accessibilityRole="link"
          accessibilityLabel="Open full score screen for forfeit or more options"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.inlineMoreLink,
            hovered && styles.inlineMoreLinkHover,
            pressed && styles.inlineMoreLinkPressed,
          ]}
        >
          <Text style={styles.inlineMoreLinkText}>Forfeit or more options</Text>
          <Feather name="arrow-right" size={12} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editIconBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 28,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
  },
  editIconBtnHover: {
    backgroundColor: colors.secondary,
  },
  editIconBtnPressed: {
    backgroundColor: colors.border,
    opacity: 0.92,
  },
  meta: { fontSize: fontSize.base, color: colors.textMuted },
  metaSubtle: { fontSize: fontSize.sm, color: colors.textSubtle },
  courtChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  courtChip: {
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  courtChipText: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  matchTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  matchCourt: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  generateHint: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  generateBlurb: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  generateActionRow: {
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  opsBlurb: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  opsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  focusFooter: {
    marginTop: spacing.xl,
    alignItems: 'stretch',
  },
  courtsHelper: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  courtPickerList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  courtToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    minHeight: 44,
    flexBasis: '32%',
    minWidth: 110,
    flexGrow: 1,
  },
  courtToggleHover: {
    backgroundColor: colors.bgMuted,
  },
  courtTogglePressed: {
    opacity: 0.7,
  },
  courtToggleDimmed: {
    opacity: 0.5,
  },
  courtToggleSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  courtToggleText: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  courtToggleTextSelected: {
    color: colors.primarySoftText,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  courtCheckBlank: {
    width: 16,
    height: 16,
  },
  countLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  teamName: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    flexShrink: 1,
  },
  teamNameWithdrawn: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  teamCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  withdrawnPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  withdrawnPillText: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  teamGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  teamGridCell: {
    flexBasis: '49%',
    minWidth: 160,
    flexGrow: 1,
  },
  // Pending header above the active matches list.
  matchGroupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  matchGroupHeaderText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  matchGroupHeaderCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  // Collapsible Reported toggle below the pending section.
  reportedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.md,
    minHeight: 44,
    marginTop: spacing.lg,
  },
  reportedToggleHover: {
    backgroundColor: colors.secondary,
  },
  reportedTogglePressed: {
    opacity: 0.7,
  },
  reportedToggleText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  reportedBody: {
    marginTop: spacing.md,
  },
  // Match tabs: pill-shape segmented control mirroring the division form.
  matchTabRow: {
    flexDirection: 'row',
    backgroundColor: colors.secondary,
    borderRadius: radii.pill,
    padding: 4,
    gap: 4,
  },
  matchTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
  },
  matchTabHover: {
    backgroundColor: colors.border,
  },
  matchTabActive: {
    backgroundColor: colors.primary,
  },
  matchTabText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  matchTabTextActive: {
    color: colors.primaryText,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  groupList: { gap: spacing.xl },
  roundGroup: { gap: spacing.sm },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  roundHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  // Compact round number — small slate eyebrow next to the label, no chip.
  roundNumber: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  roundLabel: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  roundCount: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
  },
  roundMatches: { gap: spacing.xs },
  eyebrow: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  subSection: { gap: spacing.md },
  subSectionLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  poolTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  poolTeams: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  poolTeamRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bgMuted,
  },
  poolTeamName: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  poolStandings: {
    marginTop: spacing.md,
  },
  poolMatches: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  poolMatchesLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginBottom: spacing.sm,
  },
  poolRoundGroup: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  poolRoundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    marginBottom: spacing.xs,
  },
  poolRoundLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  poolRoundCount: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  poolRoundMatches: { gap: spacing.xs },
  // Standings table -------------------------------------------------------
  standingsCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  standingsCardCompact: {
    borderColor: colors.border,
  },
  standingsHeaderRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  standingsHeaderText: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  standingsRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 44,
  },
  standingsRowFirst: {
    borderTopWidth: 0,
  },
  standingsRowTappable: {
    // No extra styling needed beyond Pressable feedback below.
  },
  standingsRowHover: {
    backgroundColor: colors.bgMuted,
  },
  standingsRowPressed: {
    backgroundColor: colors.bgMuted,
    opacity: 0.85,
  },
  standingsCell: {
    fontSize: fontSize.base,
    color: colors.text,
  },
  standingsRankCol: {
    width: 28,
    textAlign: 'left',
  },
  standingsTeamCol: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  standingsStatCol: {
    width: 42,
    textAlign: 'center',
  },
  // PF/PA/PD can run to 3 digits; use sm font to fit comfortably on phones.
  standingsStatText: {
    fontSize: fontSize.sm,
  },
  standingsRankText: {
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  standingsRankTextLeader: {
    color: colors.primary,
  },
  standingsTeamText: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    flexShrink: 1,
  },
  standingsTeamTextWithdrawn: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  standingsTeamCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  standingsWinsText: {
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  standingsDiffPositive: {
    color: colors.primary,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  standingsDiffNegative: {
    color: colors.destructive,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  standingsEmpty: {
    padding: spacing.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  matchCardCompact: {
    padding: spacing.md,
  },
  matchCardDimmed: {
    opacity: 0.55,
  },
  // Done matches stand out with a soft green tint and a green left border
  // so you can scan a list and instantly see what's complete.
  matchCardDone: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  matchCardVoided: {
    backgroundColor: colors.bgMuted,
    opacity: 0.7,
  },
  matchTeamSubtle: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.textMuted,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
    fontStyle: 'italic',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  matchTeam: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  matchTeamWinner: {
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  // Serve indicator. Lives in its own fixed-width column on Team A's row so
  // the team name and Team B's name start at the same x-offset — names line
  // up vertically regardless of whether the dot is rendered.
  matchServeDot: {
    color: colors.primary,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    fontSize: fontSize.base,
    lineHeight: fontSize.base + 4,
  },
  matchServeCol: {
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // PPA / broadcast-style stacked rows. Two rows (Team A, Team B) share the
  // same column layout: [serve dot col][team name flex 1][game col × N].
  matchStackRows: {
    gap: spacing.xs,
  },
  matchStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 24,
  },
  // Fixed-width per-game score column, right-aligned. Width is generous
  // enough for two-digit scores (e.g. "11") at base font size.
  matchScoreCol: {
    width: 36,
    textAlign: 'right',
    fontSize: fontSize.base,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  matchScoreColWinner: {
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  // BYE card — shown in a round when a team sits out (odd team count).
  // Less visual weight than a match card; reads as informational.
  byeCard: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  byeLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    minWidth: 32,
  },
  byeTeam: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  // Empty score-cell placeholder for matches that haven't been played yet.
  // Same footprint as a real score column so the layout doesn't shift on save.
  matchScoreColEmpty: {
    width: 36,
    height: 18,
    borderRadius: radii.sm,
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  // Caption row above the matchup. Right-aligned, subdued — sits like a
  // broadcast scoreboard header above the team rows.
  matchCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Highlight the expanded card subtly so it stands apart from siblings
  // and the inline editor reads as part of it.
  matchCardExpanded: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgMuted,
  },
  inlineWrap: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  inlineDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  inlineGames: {
    gap: spacing.md,
  },
  inlineGameRow: {
    gap: spacing.xs,
  },
  inlineGameLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  inlineScoreInputs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  inlineScoreSide: {
    flex: 1,
    gap: spacing.xs,
    maxWidth: 160,
  },
  inlineTeamLabel: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  inlineScoreInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.md,
    minHeight: 44,
    width: 72,
    backgroundColor: colors.bg,
    color: colors.text,
    textAlign: 'center',
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  inlineDash: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    paddingBottom: 10,
  },
  inlineError: {
    fontSize: fontSize.sm,
    color: colors.destructive,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  inlineActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inlineMoreRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  inlineMoreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  inlineMoreLinkHover: {
    backgroundColor: colors.bg,
  },
  inlineMoreLinkPressed: {
    opacity: 0.7,
  },
  inlineMoreLinkText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
});
