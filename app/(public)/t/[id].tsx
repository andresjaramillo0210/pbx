// Public tournament page — the TV-friendly venue court board. Shows every
// physical court that any in-progress division uses, with the queue of
// matches on that court across ALL running divisions. Updates live via
// Supabase Realtime so the TV refreshes itself when an admin reports a score.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ErrorBanner from '../../../src/components/ErrorBanner';
import ScreenContainer from '../../../src/components/ScreenContainer';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../src/theme';

const BRAND_ORANGE = '#f97316';

type Tournament = { id: string; name: string; starts_on: string | null };

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';
type DivisionLevel = 'beginner' | 'intermediate' | 'advanced';
type DivisionGender = 'mens' | 'womens';
type DivisionFormat = 'round_robin' | 'pool_to_bracket' | 'single_elimination';

type Division = {
  id: string;
  type: DivisionType;
  level: DivisionLevel;
  gender: DivisionGender | null;
  format: DivisionFormat | null;
  status: string;
  show_points_details: boolean;
};

type Team = { id: string; name: string; division_id: string; withdrawn_at: string | null };

type Match = {
  id: string;
  division_id: string;
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

type MatchGame = { match_id: string; game_number: number; score_a: number; score_b: number };

type Court = { id: string; name: string };

type Pool = { id: string; division_id: string; name: string };
type PoolTeam = { pool_id: string; team_id: string };

type SponsorSize = 'large' | 'medium' | 'small';
type Sponsor = {
  id: string;
  division_id: string;
  image_url: string;
  size: SponsorSize;
  display_order: number;
};

function labelDivision(type: DivisionType, level: DivisionLevel, gender: DivisionGender | null): string {
  const typeLabel = type === 'singles' ? 'Singles' : type === 'doubles' ? 'Doubles' : 'Mixed Doubles';
  const prefix = type === 'mixed_doubles' ? '' : gender === 'mens' ? "Men's " : gender === 'womens' ? "Women's " : '';
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  return `${prefix}${typeLabel} · ${levelLabel}`;
}

export default function TournamentView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [allDivisions, setAllDivisions] = useState<Division[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [gamesByMatch, setGamesByMatch] = useState<Record<string, MatchGame[]>>({});
  const [courts, setCourts] = useState<Court[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [tRes, dRes] = await Promise.all([
      supabase.from('tournaments').select('id, name, starts_on').eq('id', id).maybeSingle(),
      supabase
        .from('divisions')
        .select('id, type, level, gender, format, status, show_points_details')
        .eq('tournament_id', id),
    ]);
    if (tRes.error) {
      setError(tRes.error.message);
      setLoading(false);
      return;
    }
    setTournament((tRes.data as Tournament) ?? null);
    const allDivs = (dRes.data as Division[]) ?? [];
    setAllDivisions(allDivs);

    const running = allDivs.filter((d) => d.status === 'running');
    const runningIds = running.map((d) => d.id);
    const allDivIds = allDivs.map((d) => d.id);

    // Sponsors load for ALL divisions, not just running — so the TV still
    // shows the venue's sponsors during pre-game / between divisions.
    if (allDivIds.length > 0) {
      const { data: spData } = await supabase
        .from('sponsors')
        .select('id, division_id, image_url, size, display_order')
        .in('division_id', allDivIds)
        .order('display_order', { ascending: true });
      setSponsors((spData as Sponsor[]) ?? []);
    } else {
      setSponsors([]);
    }

    if (runningIds.length === 0) {
      setMatches([]);
      setTeams([]);
      setGamesByMatch({});
      setCourts([]);
      setPools([]);
      setPoolTeams([]);
      setLoading(false);
      return;
    }

    const [matchesRes, teamsRes, dcRes, poolsRes] = await Promise.all([
      supabase
        .from('matches')
        .select(
          'id, division_id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id',
        )
        .in('division_id', runningIds),
      supabase.from('teams').select('id, name, division_id, withdrawn_at').in('division_id', runningIds),
      supabase
        .from('division_courts')
        .select('court_id, courts(id, name)')
        .in('division_id', runningIds),
      supabase
        .from('pools')
        .select('id, division_id, name')
        .in('division_id', runningIds)
        .order('name', { ascending: true }),
    ]);
    const mList = (matchesRes.data as Match[]) ?? [];
    setMatches(mList);
    setTeams((teamsRes.data as Team[]) ?? []);
    const poolList = (poolsRes.data as Pool[]) ?? [];
    setPools(poolList);

    // pool_teams comes in a separate query (depends on the pool IDs we just
    // loaded). Empty array if no pools exist for any running division.
    if (poolList.length > 0) {
      const { data: ptData } = await supabase
        .from('pool_teams')
        .select('pool_id, team_id')
        .in('pool_id', poolList.map((p) => p.id));
      setPoolTeams((ptData as PoolTeam[]) ?? []);
    } else {
      setPoolTeams([]);
    }

    // Collect distinct courts used by any running division.
    const seenCourts = new Map<string, Court>();
    for (const row of (dcRes.data as unknown as Array<{ courts: { id: string; name: string } | { id: string; name: string }[] | null }>) ?? []) {
      // Supabase returns the joined `courts` shape as either an object or an
      // array depending on relationship cardinality. Coalesce to a single Court.
      const raw = row.courts;
      const c: Court | null = Array.isArray(raw) ? raw[0] ?? null : raw;
      if (c && !seenCourts.has(c.id)) seenCourts.set(c.id, c);
    }
    setCourts(Array.from(seenCourts.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));

    if (mList.length > 0 && mList.some((m) => m.status === 'reported' || m.status === 'forfeit')) {
      const gRes = await supabase
        .from('match_games')
        .select('match_id, game_number, score_a, score_b')
        .in('match_id', mList.map((m) => m.id));
      const grouped: Record<string, MatchGame[]> = {};
      for (const g of (gRes.data as MatchGame[]) ?? []) {
        if (!grouped[g.match_id]) grouped[g.match_id] = [];
        grouped[g.match_id].push(g);
      }
      for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => a.game_number - b.game_number);
      setGamesByMatch(grouped);
    } else {
      setGamesByMatch({});
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  // Realtime: refetch on any score/match/team/division change in this tournament.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`tournament:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'divisions', filter: `tournament_id=eq.${id}` },
        () => { void load(); },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_games' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => { void load(); })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, load]);

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </ScreenContainer>
    );
  }
  if (!tournament) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <Text style={styles.bodyText}>Tournament not found.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const runningDivisions = allDivisions.filter((d) => d.status === 'running');
  const divsById = new Map(allDivisions.map((d) => [d.id, d]));
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  // bracketRoundsByDiv: distinct ascending bracket_round values per division,
  // used to label bracket matches (F / SF / QF / R16…).
  const bracketRoundsByDiv = new Map<string, number[]>();
  for (const m of matches) {
    if (m.stage !== 'bracket' || m.bracket_round == null) continue;
    const list = bracketRoundsByDiv.get(m.division_id) ?? [];
    if (!list.includes(m.bracket_round)) list.push(m.bracket_round);
    bracketRoundsByDiv.set(m.division_id, list);
  }
  for (const arr of bracketRoundsByDiv.values()) arr.sort((a, b) => a - b);

  // Group matches by court (excluding voided, since they're effectively
  // removed from the schedule).
  const matchesByCourt = new Map<string, Match[]>();
  for (const m of matches) {
    if (m.status === 'voided') continue;
    if (!m.court_id) continue;
    // Bracket placeholders with no teams yet (both null) are not actionable
    // to spectators — hide them until at least one slot is filled in.
    if (m.team_a_id === null && m.team_b_id === null) continue;
    if (!matchesByCourt.has(m.court_id)) matchesByCourt.set(m.court_id, []);
    matchesByCourt.get(m.court_id)!.push(m);
  }
  const statusRank = (m: Match): number => {
    if (m.status === 'in_progress') return 0;
    if (m.status === 'pending' || m.status === 'scheduled') return 1;
    return 2;
  };
  for (const arr of matchesByCourt.values()) {
    arr.sort((a, b) => {
      const r = statusRank(a) - statusRank(b);
      if (r !== 0) return r;
      const ar = a.round_number ?? a.bracket_round ?? 0;
      const br = b.round_number ?? b.bracket_round ?? 0;
      return ar - br;
    });
  }

  const isWide = width >= 1024;
  const gridColumns = isWide ? 3 : width >= 640 ? 2 : 1;

  return (
    <ScreenContainer maxWidth={1400}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <View style={styles.topBar}>
        <View style={styles.topBarTextCol}>
          <Text style={styles.topBarTitle} numberOfLines={2}>
            {tournament.name}
          </Text>
          <Text style={styles.topBarMeta}>
            {runningDivisions.length === 0
              ? 'No divisions in progress'
              : `${runningDivisions.length} ${runningDivisions.length === 1 ? 'division' : 'divisions'} in progress · ${courts.length} ${courts.length === 1 ? 'court' : 'courts'}`}
          </Text>
        </View>
        <Image
          source={require('../../../assets/logo.avif')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Westminster Pickleball Xscape logo"
        />
      </View>

      {runningDivisions.length === 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <EmptyState
            title="No divisions in progress"
            message="Pick a division below to view its schedule."
          />
          <View style={styles.divisionList}>
            {allDivisions.map((d) => (
              <Card
                key={d.id}
                onPress={() =>
                  router.push({
                    pathname: '/t/[id]/divisions/[divisionId]' as never,
                    params: { id, divisionId: d.id },
                  })
                }
                accessibilityLabel={`View ${labelDivision(d.type, d.level, d.gender)}`}
              >
                <Text style={styles.divisionListTitle}>
                  {labelDivision(d.type, d.level, d.gender)}
                </Text>
                <Text style={styles.divisionListMeta}>{statusLabel(d.status)}</Text>
              </Card>
            ))}
          </View>
        </View>
      ) : (
        <>
          {/* Court grid */}
          <View
            style={[
              styles.courtGrid,
              gridColumns === 2 && styles.courtGrid2,
              gridColumns === 3 && styles.courtGrid3,
            ]}
          >
            {courts.map((c) => (
              <View
                key={c.id}
                style={[
                  styles.courtCol,
                  gridColumns === 2 && styles.courtCol2,
                  gridColumns === 3 && styles.courtCol3,
                ]}
              >
                <CourtCard
                  court={c}
                  matches={matchesByCourt.get(c.id) ?? []}
                  divsById={divsById}
                  bracketRoundsByDiv={bracketRoundsByDiv}
                  teamsById={teamsById}
                  gamesByMatch={gamesByMatch}
                />
              </View>
            ))}
          </View>

          {/* Per-division standings — split by pool when format is pool-to-bracket. */}
          <View style={styles.standingsStack}>
            {runningDivisions.map((d) => {
              const divTeams = teams.filter((t) => t.division_id === d.id);
              const divMatches = matches.filter((m) => m.division_id === d.id);
              const divPools = pools.filter((p) => p.division_id === d.id);

              if (d.format === 'pool_to_bracket' && divPools.length > 0) {
                return (
                  <View key={d.id} style={styles.standingsBlock}>
                    <Text style={styles.standingsTitle}>
                      {labelDivision(d.type, d.level, d.gender)} · Standings
                    </Text>
                    {divPools.map((p) => {
                      const teamIdsInPool = new Set(
                        poolTeams.filter((pt) => pt.pool_id === p.id).map((pt) => pt.team_id),
                      );
                      const poolStanding = computeStandings(
                        divMatches.filter((m) => m.stage === 'pool'),
                        gamesByMatch,
                        divTeams,
                        teamIdsInPool,
                      );
                      return (
                        <View key={p.id} style={styles.poolBlock}>
                          <Text style={styles.poolTitle}>{p.name}</Text>
                          <StandingsTable standings={poolStanding} showPoints={d.show_points_details} />
                        </View>
                      );
                    })}
                  </View>
                );
              }

              const standings = computeStandings(divMatches, gamesByMatch, divTeams);
              if (standings.length === 0) return null;
              return (
                <View key={d.id} style={styles.standingsBlock}>
                  <Text style={styles.standingsTitle}>
                    {labelDivision(d.type, d.level, d.gender)} · Standings
                  </Text>
                  <StandingsTable standings={standings} showPoints={d.show_points_details} />
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

function statusLabel(status: string): string {
  if (status === 'open') return 'Not started';
  if (status === 'running') return 'In progress';
  if (status === 'complete') return 'Completed';
  return status;
}

// --- Sponsor band ------------------------------------------------------
// Renders sponsor logos under the court grid. Layout is dynamic: LARGE
// sponsors get a full-width row each; MEDIUM are paired two-per-row; SMALL
// flow as a logo strip (four per row on wide, fewer on narrow).

function SponsorBand({ sponsors }: { sponsors: Sponsor[] }) {
  if (sponsors.length === 0) return null;
  const large = sponsors.filter((s) => s.size === 'large');
  const medium = sponsors.filter((s) => s.size === 'medium');
  const small = sponsors.filter((s) => s.size === 'small');

  return (
    <View style={styles.sponsorBand}>
      {large.map((s) => (
        <View key={s.id} style={styles.sponsorLargeRow}>
          <Image source={{ uri: s.image_url }} style={styles.sponsorLargeImg} resizeMode="contain" />
        </View>
      ))}
      {medium.length > 0 && (
        <View style={styles.sponsorMediumRow}>
          {medium.map((s) => (
            <View key={s.id} style={styles.sponsorMediumCell}>
              <Image source={{ uri: s.image_url }} style={styles.sponsorMediumImg} resizeMode="contain" />
            </View>
          ))}
        </View>
      )}
      {small.length > 0 && (
        <View style={styles.sponsorSmallRow}>
          {small.map((s) => (
            <View key={s.id} style={styles.sponsorSmallCell}>
              <Image source={{ uri: s.image_url }} style={styles.sponsorSmallImg} resizeMode="contain" />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// --- Court card --------------------------------------------------------

function CourtCard({
  court,
  matches,
  divsById,
  bracketRoundsByDiv,
  teamsById,
  gamesByMatch,
}: {
  court: Court;
  matches: Match[];
  divsById: Map<string, Division>;
  bracketRoundsByDiv: Map<string, number[]>;
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
}) {
  const liveMatch = matches.find((m) => m.status === 'in_progress');
  const upNextIdx = matches.findIndex(
    (m) => m.status === 'pending' || m.status === 'scheduled' || m.status === 'in_progress',
  );
  const hasUpNext = upNextIdx !== -1 && !liveMatch;
  const totalPlayable = matches.filter((m) => m.status !== 'voided').length;
  const doneCount = matches.filter((m) => m.status === 'reported' || m.status === 'forfeit').length;
  const allDone = totalPlayable > 0 && doneCount === totalPlayable;

  return (
    <Card
      style={[
        liveMatch && styles.courtCardLive,
        hasUpNext && styles.courtCardUpNext,
        allDone && styles.courtCardDone,
      ]}
    >
      <View style={styles.courtHeaderRow}>
        <View style={styles.courtHeaderLeft}>
          <Text style={[styles.courtName, allDone && styles.courtNameMuted]}>{court.name}</Text>
          {liveMatch ? (
            <View style={styles.pillLive}>
              <Text style={styles.pillLiveDot}>●</Text>
              <Text style={styles.pillLiveText}>LIVE</Text>
            </View>
          ) : hasUpNext ? (
            <View style={styles.pillUpNext}>
              <Text style={styles.pillUpNextText}>UP NEXT</Text>
            </View>
          ) : allDone ? (
            <View style={styles.pillDone}>
              <Text style={styles.pillDoneText}>DONE</Text>
            </View>
          ) : null}
        </View>
        {totalPlayable > 0 && (
          <Text style={styles.courtProgress}>{doneCount}/{totalPlayable}</Text>
        )}
      </View>
      {matches.length === 0 ? (
        <Text style={styles.courtEmpty}>No matches</Text>
      ) : (
        <View style={styles.queueList}>
          {matches.map((m, i) => {
            const isLive = m.status === 'in_progress';
            const isUpNext = i === upNextIdx && !isLive;
            const tone: 'live' | 'upnext' | 'blocked' | 'done' =
              isLive ? 'live' :
              isUpNext ? 'upnext' :
              m.status === 'pending' || m.status === 'scheduled' ? 'blocked' : 'done';
            const div = divsById.get(m.division_id);
            const divLabel = div ? labelDivision(div.type, div.level, div.gender) : '';
            const bracketRounds = bracketRoundsByDiv.get(m.division_id) ?? [];
            return (
              <MatchRow
                key={m.id}
                match={m}
                divLabel={divLabel}
                bracketRounds={bracketRounds}
                teamsById={teamsById}
                gamesByMatch={gamesByMatch}
                tone={tone}
              />
            );
          })}
        </View>
      )}
    </Card>
  );
}

// --- Match row ---------------------------------------------------------

type RowTone = 'live' | 'upnext' | 'blocked' | 'done';

function shortRoundLabel(m: Match, bracketRounds: number[]): string {
  if (m.stage === 'bracket' && m.bracket_round != null && bracketRounds.length > 0) {
    const maxRound = bracketRounds[bracketRounds.length - 1];
    const fromFinal = maxRound - m.bracket_round;
    if (fromFinal === 0) return 'F';
    if (fromFinal === 1) return 'SF';
    if (fromFinal === 2) return 'QF';
    if (fromFinal === 3) return 'R16';
    if (fromFinal === 4) return 'R32';
    return `B${m.bracket_round}`;
  }
  if (m.round_number != null) return `R${m.round_number}`;
  if (m.bracket_round != null) return `B${m.bracket_round}`;
  return '—';
}

function MatchRow({
  match,
  divLabel,
  bracketRounds,
  teamsById,
  gamesByMatch,
  tone,
}: {
  match: Match;
  divLabel: string;
  bracketRounds: number[];
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
  tone: RowTone;
}) {
  const aName = match.team_a_id ? teamsById.get(match.team_a_id)?.name ?? 'TBD' : 'TBD';
  const bName = match.team_b_id ? teamsById.get(match.team_b_id)?.name ?? 'TBD' : 'TBD';
  const games = gamesByMatch[match.id] ?? [];
  const isStrike = match.status === 'reported' || match.status === 'forfeit' || match.status === 'voided';
  const scoreText =
    (match.status === 'reported' || match.status === 'forfeit') && games.length > 0
      ? games.map((g) => `${g.score_a}-${g.score_b}`).join(' / ')
      : null;

  return (
    <View
      style={[
        styles.rowBase,
        tone === 'live' && styles.rowLive,
        tone === 'upnext' && styles.rowUpNext,
        tone === 'blocked' && styles.rowBlocked,
        tone === 'done' && styles.rowDone,
      ]}
    >
      <View style={styles.rowTopLine}>
        <Text style={[styles.roundChip, tone === 'upnext' && styles.roundChipUpNext]}>
          {shortRoundLabel(match, bracketRounds)}
        </Text>
        <Text style={styles.divChip} numberOfLines={1}>{divLabel}</Text>
        {tone === 'live' && <Text style={styles.liveBadge}>LIVE</Text>}
        {tone === 'upnext' && <Text style={styles.upNextBadge}>Up next</Text>}
        {tone === 'done' && (match.status === 'reported' || match.status === 'forfeit') && (
          <Text style={styles.doneBadge}>Done</Text>
        )}
      </View>
      <Text style={[styles.rowTeams, isStrike && styles.rowTeamsStrike]} numberOfLines={1}>
        {aName} <Text style={styles.rowVs}>vs</Text> {bName}
      </Text>
      {scoreText && <Text style={styles.rowScore}>{scoreText}</Text>}
    </View>
  );
}

// --- Standings ---------------------------------------------------------

type Standing = {
  rank: number;
  team_id: string;
  team_name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  withdrawn: boolean;
};

function computeStandings(
  matches: Match[],
  gamesByMatch: Record<string, MatchGame[]>,
  teams: Team[],
  teamIdsFilter?: Set<string>,
): Standing[] {
  const stats = new Map<string, Omit<Standing, 'rank'>>();
  for (const t of teams) {
    if (teamIdsFilter && !teamIdsFilter.has(t.id)) continue;
    stats.set(t.id, {
      team_id: t.id,
      team_name: t.name,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      withdrawn: t.withdrawn_at !== null,
    });
  }
  for (const m of matches) {
    if (m.status !== 'reported' && m.status !== 'forfeit') continue;
    if (!m.team_a_id || !m.team_b_id) continue;
    const a = stats.get(m.team_a_id);
    const b = stats.get(m.team_b_id);
    if (!a || !b) continue;
    if (m.winner_team_id === m.team_a_id) { a.wins++; b.losses++; }
    else if (m.winner_team_id === m.team_b_id) { b.wins++; a.losses++; }
    const games = gamesByMatch[m.id] ?? [];
    for (const g of games) {
      a.pointsFor += g.score_a;
      a.pointsAgainst += g.score_b;
      b.pointsFor += g.score_b;
      b.pointsAgainst += g.score_a;
    }
  }
  const arr = Array.from(stats.values()).map((s) => ({
    ...s,
    pointDiff: s.pointsFor - s.pointsAgainst,
  }));
  arr.sort((a, b) => {
    if (a.withdrawn !== b.withdrawn) return a.withdrawn ? 1 : -1;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return a.team_name.localeCompare(b.team_name);
  });
  return arr.map((s, i) => ({ ...s, rank: i + 1 }));
}

function StandingsTable({ standings, showPoints }: { standings: Standing[]; showPoints: boolean }) {
  return (
    <Card flat>
      <View style={styles.stHeaderRow}>
        <Text style={[styles.stHead, styles.stRankCol]}>#</Text>
        <Text style={[styles.stHead, styles.stTeamCol]}>Team</Text>
        <Text style={[styles.stHead, styles.stStatCol]}>W</Text>
        <Text style={[styles.stHead, styles.stStatCol]}>L</Text>
        {showPoints && (
          <>
            <Text style={[styles.stHead, styles.stStatCol]}>PF</Text>
            <Text style={[styles.stHead, styles.stStatCol]}>PA</Text>
            <Text style={[styles.stHead, styles.stStatCol]}>PD</Text>
          </>
        )}
      </View>
      {standings.map((s) => (
        <View key={s.team_id} style={styles.stRow}>
          <Text style={[styles.stCell, styles.stRankCol]}>{s.rank}</Text>
          <Text style={[styles.stCell, styles.stTeamCol, s.withdrawn && styles.stTeamWithdrawn]} numberOfLines={1}>
            {s.team_name}
          </Text>
          <Text style={[styles.stCell, styles.stStatCol, styles.stWins]}>{s.wins}</Text>
          <Text style={[styles.stCell, styles.stStatCol]}>{s.losses}</Text>
          {showPoints && (
            <>
              <Text style={[styles.stCell, styles.stStatCol]}>{s.pointsFor}</Text>
              <Text style={[styles.stCell, styles.stStatCol]}>{s.pointsAgainst}</Text>
              <Text style={[styles.stCell, styles.stStatCol, s.pointDiff > 0 && styles.stDiffPos, s.pointDiff < 0 && styles.stDiffNeg]}>
                {s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}
              </Text>
            </>
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  bodyText: { color: colors.text, fontSize: fontSize.base },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  topBarTextCol: { flex: 1, gap: spacing.xs },
  topBarTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  topBarMeta: { color: colors.textMuted, fontSize: fontSize.sm },
  logo: { width: 80, height: 40 },

  divisionList: { gap: spacing.md, marginTop: spacing.md },
  divisionListTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  divisionListMeta: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },

  // Court grid
  courtGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.sm) },
  courtGrid2: {},
  courtGrid3: {},
  courtCol: { paddingHorizontal: spacing.sm, marginBottom: spacing.md, width: '100%' },
  courtCol2: { width: '50%' },
  courtCol3: { width: '33.3333%' },

  // Court card state
  courtCardLive: { borderColor: colors.live, borderTopWidth: 3, borderTopColor: colors.live },
  courtCardUpNext: { borderColor: BRAND_ORANGE, borderTopWidth: 3, borderTopColor: BRAND_ORANGE },
  courtCardDone: { opacity: 0.7 },
  courtHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  courtHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  courtName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.2,
  },
  courtNameMuted: { color: colors.textMuted },
  courtProgress: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    fontVariant: ['tabular-nums'],
  },
  courtEmpty: { color: colors.textSubtle, fontSize: fontSize.sm, fontStyle: 'italic' },
  queueList: { gap: spacing.sm },

  pillLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.liveSoft,
  },
  pillLiveDot: { color: colors.live, fontSize: fontSize.xs },
  pillLiveText: {
    color: colors.liveSoftText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  pillUpNext: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: BRAND_ORANGE,
  },
  pillUpNextText: {
    color: BRAND_ORANGE,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  pillDone: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.bgMuted,
  },
  pillDoneText: {
    color: colors.textSubtle,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },

  // Row tones
  rowBase: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 4,
  },
  rowUpNext: {
    borderColor: BRAND_ORANGE,
    borderLeftWidth: 4,
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
  },
  rowLive: {
    borderColor: colors.live,
    borderLeftWidth: 4,
    backgroundColor: colors.liveSoft,
  },
  rowBlocked: { backgroundColor: colors.bgMuted, borderColor: colors.border },
  rowDone: { backgroundColor: colors.bg, borderColor: colors.border },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divChip: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
    flexShrink: 1,
  },
  roundChip: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
    minWidth: 28,
  },
  roundChipUpNext: { color: BRAND_ORANGE },
  liveBadge: {
    color: colors.liveSoftText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  upNextBadge: {
    color: BRAND_ORANGE,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
  },
  doneBadge: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
  },
  rowTeams: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.semibold as TextStyle['fontWeight'] },
  rowTeamsStrike: { textDecorationLine: 'line-through', color: colors.textSubtle },
  rowVs: { color: colors.textSubtle, fontWeight: fontWeight.regular as TextStyle['fontWeight'] },
  rowScore: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.bold as TextStyle['fontWeight'], fontVariant: ['tabular-nums'] },

  // Sponsor band
  sponsorBand: { gap: spacing.md, marginTop: spacing.lg },
  sponsorLargeRow: {
    width: '100%',
    minHeight: 96,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sponsorLargeImg: { width: '100%', height: 80 },
  sponsorMediumRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -(spacing.sm),
  },
  sponsorMediumCell: {
    width: '50%',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  sponsorMediumImg: {
    width: '100%',
    height: 64,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  sponsorSmallRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -(spacing.xs),
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sponsorSmallCell: {
    flexGrow: 1,
    flexBasis: 120,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sponsorSmallImg: { width: '100%', height: '100%' },

  // Standings
  standingsStack: { gap: spacing.lg, marginTop: spacing.lg },
  standingsBlock: { gap: spacing.sm },
  poolBlock: { gap: spacing.xs, marginTop: spacing.sm },
  poolTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  standingsTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  stHeaderRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stHead: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  stRow: { flexDirection: 'row', paddingVertical: spacing.xs, alignItems: 'center' },
  stCell: { fontSize: fontSize.sm, color: colors.text },
  stRankCol: { width: 28, textAlign: 'center' },
  stTeamCol: { flex: 1, paddingHorizontal: spacing.sm },
  stTeamWithdrawn: { color: colors.textSubtle, textDecorationLine: 'line-through' },
  stStatCol: { width: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stWins: { fontWeight: fontWeight.semibold as TextStyle['fontWeight'] },
  stDiffPos: { color: colors.liveSoftText },
  stDiffNeg: { color: colors.destructiveSoftText },
});
