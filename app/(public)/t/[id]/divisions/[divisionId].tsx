import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Card from '../../../../../src/components/Card';
import EmptyState from '../../../../../src/components/EmptyState';
import ErrorBanner from '../../../../../src/components/ErrorBanner';
import ScreenContainer from '../../../../../src/components/ScreenContainer';
import Section from '../../../../../src/components/Section';
import StatusPill from '../../../../../src/components/StatusPill';
import { supabase } from '../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../src/theme';

// Public-facing division viewer: read-only standings + schedule. RLS gives
// anonymous users SELECT on non-draft tournaments and their children, so this
// works without auth. All UI from the admin equivalent that mutates state
// (scoring inputs, edit buttons, drill-in team rows) is intentionally absent.

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
  show_points_details: boolean;
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
type DivisionCourtRow = { court_id: string; courts: { id: string; name: string } | null };

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

// --- Standings computation (copied from admin division detail) -----------

type Standing = {
  rank: number;
  team_id: string;
  team_name: string;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  withdrawn: boolean;
};

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
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return 'Final';
  if (fromFinal === 1) return 'Semifinal';
  if (fromFinal === 2) return 'Quarterfinal';
  if (fromFinal === 3) return 'Round of 16';
  if (fromFinal === 4) return 'Round of 32';
  return `Round ${round} of ${totalRounds}`;
}

// --- Screen --------------------------------------------------------------

export default function PublicDivisionView() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const [division, setDivision] = useState<Division | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [gamesByMatch, setGamesByMatch] = useState<Record<string, MatchGame[]>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [divisionCourts, setDivisionCourts] = useState<Court[]>([]);
  const [courtsById, setCourtsById] = useState<Map<string, Court>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !divisionId) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setLoading(true);

      const dRes = await supabase
        .from('divisions')
        .select('id, tournament_id, type, level, gender, format, status, best_of, game_to, win_by, show_points_details')
        .eq('id', divisionId)
        .maybeSingle();
      if (cancelled) return;

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

      const [teamsRes, matchesRes, poolsRes, dcRes] = await Promise.all([
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
          .select('court_id, courts:court_id (id, name)')
          .eq('division_id', divisionId)
          .order('display_order', { ascending: true }),
      ]);
      if (cancelled) return;

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

      if (poolList.length > 0) {
        const ptRes = await supabase
          .from('pool_teams')
          .select('pool_id, team_id')
          .in('pool_id', poolList.map((p) => p.id));
        if (cancelled) return;
        if (ptRes.error) setError(ptRes.error.message);
        setPoolTeams((ptRes.data as PoolTeam[]) ?? []);
      } else {
        setPoolTeams([]);
      }

      const hasReported = mList.some((m) => m.status === 'reported');
      if (hasReported) {
        const gRes = await supabase
          .from('match_games')
          .select('match_id, game_number, score_a, score_b')
          .in('match_id', mList.map((m) => m.id));
        if (cancelled) return;
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
    })();

    return () => {
      cancelled = true;
    };
  }, [id, divisionId]);

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
          {!error && <Text style={styles.notFound}>Division not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }

  const teamCount = teams.length;
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const format = division.format;
  const isOpen = division.status === 'open';
  const formatText = labelFormat(format);
  const showPoints = division.show_points_details;

  return (
    <ScreenContainer>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Card>
        <Text style={styles.title} numberOfLines={2}>
          {labelDivision(division.type, division.level, division.gender)}
        </Text>
        <View style={styles.pillRow}>
          <StatusPill status={division.status} />
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
      </Card>

      {isOpen ? (
        <>
          <Section
            title="Teams"
            action={<Text style={styles.countLabel}>{teamCount}</Text>}
          >
            {teams.length === 0 ? (
              <EmptyState
                title="No teams yet"
                message="Check back when registration opens."
              />
            ) : (
              <View style={styles.teamGrid}>
                {teams.map((t) => {
                  const withdrawn = t.withdrawn_at != null;
                  return (
                    <View key={t.id} style={styles.teamGridCell}>
                      <Card flat>
                        <View style={styles.teamCardRow}>
                          <Text
                            style={[styles.teamName, withdrawn && styles.teamNameWithdrawn]}
                            numberOfLines={2}
                          >
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
          <Section title="Schedule">
            <EmptyState title="Matches haven't been scheduled yet" />
          </Section>
        </>
      ) : (
        <>
          {format === 'round_robin' && (
            <Section
              title="Standings"
              action={<Text style={styles.countLabel}>{teamCount}</Text>}
            >
              {teams.length === 0 ? (
                <EmptyState title="No teams" />
              ) : (
                <StandingsTable
                  standings={computeStandings(matches, gamesByMatch, teamsById)}
                  showPoints={showPoints}
                />
              )}
            </Section>
          )}

          {(format === 'single_elimination' || format === 'pool_to_bracket') && teams.length > 0 && (
            <Section
              title="Teams"
              action={<Text style={styles.countLabel}>{teamCount}</Text>}
            >
              <View style={styles.teamGrid}>
                {teams.map((t) => {
                  const withdrawn = t.withdrawn_at != null;
                  return (
                    <View key={t.id} style={styles.teamGridCell}>
                      <Card flat>
                        <View style={styles.teamCardRow}>
                          <Text
                            style={[styles.teamName, withdrawn && styles.teamNameWithdrawn]}
                            numberOfLines={2}
                          >
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
            </Section>
          )}

          <Section title="Schedule">
            {matches.length === 0 ? (
              <EmptyState title="No matches generated yet" />
            ) : format === 'round_robin' ? (
              <RoundRobinMatches
                matches={matches}
                allMatches={matches}
                teamsById={teamsById}
                courtsById={courtsById}
                gamesByMatch={gamesByMatch}
                bestOf={division.best_of}
              />
            ) : format === 'single_elimination' ? (
              <BracketMatches
                matches={matches.filter((m) => m.stage === 'bracket')}
                allMatches={matches}
                teamsById={teamsById}
                courtsById={courtsById}
                gamesByMatch={gamesByMatch}
                bestOf={division.best_of}
              />
            ) : format === 'pool_to_bracket' ? (
              <PoolToBracketMatches
                matches={matches}
                allMatches={matches}
                pools={pools}
                poolTeams={poolTeams}
                teamsById={teamsById}
                courtsById={courtsById}
                gamesByMatch={gamesByMatch}
                showPoints={showPoints}
                bestOf={division.best_of}
              />
            ) : (
              <EmptyState title="No matches generated yet" />
            )}
          </Section>
        </>
      )}
    </ScreenContainer>
  );
}

// --- Standings table -----------------------------------------------------

type StandingsProps = {
  standings: Standing[];
  compact?: boolean;
  showPoints: boolean;
};

function StandingsTable({ standings, compact, showPoints }: StandingsProps) {
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
        {showPoints && (
          <>
            <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PF</Text>
            <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PA</Text>
            <Text style={[styles.standingsHeaderText, styles.standingsStatCol]}>PD</Text>
          </>
        )}
      </View>
      {standings.map((s, i) => (
        <View
          key={s.team_id}
          style={[
            styles.standingsRow,
            i === 0 && styles.standingsRowFirst,
          ]}
        >
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
          {showPoints && (
            <>
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
          )}
        </View>
      ))}
    </View>
  );
}

// --- Match list renderers (read-only) -----------------------------------

type MatchListProps = {
  teamsById: Map<string, Team>;
  courtsById: Map<string, Court>;
  gamesByMatch: Record<string, MatchGame[]>;
  // All matches in the division — used to compute "Waiting on Court X" labels.
  allMatches: Match[];
  // Best-of value for the division. Used to render the right number of
  // placeholder score cells on unreported matches.
  bestOf: number;
};

// Context-aware status label: pending matches blocked by a shared player on
// another (earlier-round) match show "Waiting on <CourtName>".
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
    if (otherRound >= myRound) continue;
    const sharesTeam =
      other.team_a_id === match.team_a_id ||
      other.team_b_id === match.team_a_id ||
      other.team_a_id === match.team_b_id ||
      other.team_b_id === match.team_b_id;
    if (!sharesTeam) continue;
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

function ByeCard({ team }: { team: Team }) {
  return (
    <View style={styles.byeCard}>
      <Text style={styles.byeLabel}>Bye</Text>
      <Text style={styles.byeTeam} numberOfLines={1}>{team.name}</Text>
    </View>
  );
}

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

function PoolToBracketMatches({
  matches,
  pools,
  poolTeams,
  showPoints,
  ...rest
}: {
  matches: Match[];
  pools: Pool[];
  poolTeams: PoolTeam[];
  showPoints: boolean;
} & MatchListProps) {
  const { teamsById, gamesByMatch } = rest;
  const poolMatches = matches.filter((m) => m.stage === 'pool');
  const bracketMatches = matches.filter((m) => m.stage === 'bracket');
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
            const standingsMatchesInPool = poolMatches.filter((m) => m.pool_id === p.id);
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
                    <StandingsTable standings={poolStandings} compact showPoints={showPoints} />
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

// --- Match card (read-only) ---------------------------------------------

function MatchCard({
  match,
  teamsById,
  courtsById,
  gamesByMatch,
  allMatches,
  bestOf,
  compact,
}: {
  match: Match;
  compact?: boolean;
} & MatchListProps) {
  const games = gamesByMatch[match.id];
  const isNotStarted = readinessLabel(match, allMatches, courtsById) === 'Not started';
  const displayStatus = isNotStarted ? 'not_started' : match.status;
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
  const containerStyle = [
    compact && styles.matchCardCompact,
    isAwaitingOpponents && styles.matchCardDimmed,
    isDone && styles.matchCardDone,
    match.status === 'voided' && styles.matchCardVoided,
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
  // aligned per-game score columns. We render exactly `games.length` columns
  // for reported/forfeit (the played count, not best_of), and zero columns
  // when pending so the card stays tidy. Voided shows a single dash column.
  const isVoided = match.status === 'voided';
  type Cell = { kind: 'score'; a: string; b: string } | { kind: 'empty' };
  let cells: Cell[];
  if (isVoided) {
    cells = [{ kind: 'empty' }];
  } else if ((isReported || isForfeit) && games && games.length > 0) {
    cells = games.map((g) => ({ kind: 'score', a: String(g.score_a), b: String(g.score_b) }));
  } else {
    cells = Array.from({ length: bestOf }, () => ({ kind: 'empty' as const }));
  }

  // Serve indicator: shown only for actively-live statuses.
  const showServeDot =
    match.status === 'pending' ||
    match.status === 'scheduled' ||
    match.status === 'in_progress';

  return (
    <Card flat style={containerStyle}>
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
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  notFound: { fontSize: fontSize.base, color: colors.textMuted },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  meta: { fontSize: fontSize.base, color: colors.textMuted, marginTop: spacing.sm },
  metaSubtle: { fontSize: fontSize.sm, color: colors.textSubtle, marginTop: spacing.xs },
  courtChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
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
  // Match groupings ------------------------------------------------------
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
  // Standings table ------------------------------------------------------
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
  // Match cards ----------------------------------------------------------
  matchCardCompact: {
    padding: spacing.md,
  },
  matchCardDimmed: {
    opacity: 0.55,
  },
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
  // the team name and Team B's name start at the same x-offset.
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
  // Fixed-width per-game score column, right-aligned.
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
  // BYE card — shown when a team sits out a round (odd team count).
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
  // Empty placeholder cell for unreported games. Same footprint as a real
  // score column so the layout doesn't shift on save.
  matchScoreColEmpty: {
    width: 36,
    height: 18,
    borderRadius: radii.sm,
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  // Caption row below the matchup. Right-aligned, subdued — quiet footer.
  matchCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
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
});
