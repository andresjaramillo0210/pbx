// Public Court Board view — read-only court-operator dashboard for players
// and spectators arriving via URL/QR code. Mirrors the admin court-board
// layout (3-col grid of court cards, per-court match queue with
// up-next/blocked/done coloring, standings beside/below) but with all
// admin-only behavior stripped: no tap-to-score navigation, no admin
// route navigation, no auto-promotion side effects.
//
// Lives under `_views/` so Expo Router treats it as a private file (not
// auto-routed). The public route `./court-board.tsx` thin-wraps this.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import Card from '../../../../../../../src/components/Card';
import EmptyState from '../../../../../../../src/components/EmptyState';
import ErrorBanner from '../../../../../../../src/components/ErrorBanner';
import ScreenContainer from '../../../../../../../src/components/ScreenContainer';
import Section from '../../../../../../../src/components/Section';
import StatusPill from '../../../../../../../src/components/StatusPill';
import { supabase } from '../../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../../../src/theme';

// Westminster brand orange — used as a logo accent and to mark live courts.
const BRAND_ORANGE = '#f97316';

// --- Types (kept in sync with the admin equivalent) ---------------------

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

type MatchStatus = 'pending' | 'scheduled' | 'in_progress' | 'reported' | 'voided' | 'forfeit';
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
  status: MatchStatus;
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

type SponsorSize = 'large' | 'medium' | 'small';
type Sponsor = {
  id: string;
  image_url: string;
  size: SponsorSize;
  display_order: number;
};
type DivisionCourtRow = {
  court_id: string;
  display_order: number;
  courts: { id: string; name: string } | null;
};

// --- Helpers ------------------------------------------------------------

function labelDivision(type: DivisionType, level: DivisionLevel, gender: DivisionGender | null) {
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

// Short round prefix for the per-court match list.
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

function sortCourtQueue(a: Match, b: Match) {
  const ar = a.bracket_round ?? -1;
  const br = b.bracket_round ?? -1;
  if (ar !== br) return ar - br;
  const arn = a.round_number ?? -1;
  const brn = b.round_number ?? -1;
  if (arn !== brn) return arn - brn;
  const as = a.bracket_slot ?? -1;
  const bs = b.bracket_slot ?? -1;
  return as - bs;
}

// --- Standings ---------------------------------------------------------

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
    { wins: number; losses: number; gamesWon: number; gamesLost: number; pointsFor: number; pointsAgainst: number }
  >();
  const teamIds = filterTeamIds ? Array.from(filterTeamIds) : Array.from(teamsById.keys());
  for (const tid of teamIds) {
    stats.set(tid, { wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0 });
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
  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.team_name.localeCompare(b.team_name);
  });
  standings.forEach((s, i) => {
    s.rank = i + 1;
  });
  return standings;
}

// --- Main component ----------------------------------------------------

export default function PublicCourtBoardView() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const { width } = useWindowDimensions();
  const router = useRouter();

  const [division, setDivision] = useState<Division | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [gamesByMatch, setGamesByMatch] = useState<Record<string, MatchGame[]>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [divisionCourts, setDivisionCourts] = useState<Court[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !divisionId) return;
    setError(null);

    // NOTE: No admin-side `promoteToBracketIfReady` call. Public viewers
    // are read-only and must not trigger server-side state changes.

    const dRes = await supabase
      .from('divisions')
      .select(
        'id, tournament_id, type, level, gender, format, status, best_of, game_to, win_by, show_points_details',
      )
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

    const [teamsRes, matchesRes, poolsRes, dcRes, spRes] = await Promise.all([
      supabase.from('teams').select('id, name, withdrawn_at').eq('division_id', divisionId),
      supabase
        .from('matches')
        .select(
          'id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id',
        )
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
        .from('sponsors')
        .select('id, image_url, size, display_order')
        .eq('division_id', divisionId)
        .order('display_order', { ascending: true }),
    ]);

    if (teamsRes.error) setError(teamsRes.error.message);
    setTeams((teamsRes.data as Team[]) ?? []);

    setSponsors((spRes.data as Sponsor[]) ?? []);

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

    if (poolList.length > 0) {
      const ptRes = await supabase
        .from('pool_teams')
        .select('pool_id, team_id')
        .in(
          'pool_id',
          poolList.map((p) => p.id),
        );
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
        .in(
          'match_id',
          mList.map((m) => m.id),
        );
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
      (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  // Live updates: TV-friendly auto-refresh on any match/score/team change.
  useEffect(() => {
    if (!divisionId) return;
    const channel = supabase
      .channel(`court-board:${divisionId}:${Date.now()}-${Math.random()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `division_id=eq.${divisionId}` },
        () => { void load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_games' },
        () => { void load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `division_id=eq.${divisionId}` },
        () => { void load(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sponsors', filter: `division_id=eq.${divisionId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [divisionId, load]);

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </ScreenContainer>
    );
  }
  if (!division) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {!error && <Text style={styles.bodyText}>Division not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }

  // Responsive breakpoint thresholds. >=1024 = 3-col grid + side standings;
  // >=640 = 2-col grid stacked over standings; <640 = single column.
  const isWide = width >= 1024;
  const isMid = width >= 640 && width < 1024;
  const gridColumns = isWide ? 3 : isMid ? 2 : 1;

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const bracketRounds = Array.from(
    new Set(
      matches.filter((m) => m.stage === 'bracket' && m.bracket_round != null).map((m) => m.bracket_round!),
    ),
  ).sort((a, b) => a - b);

  // Bucket matches by court id (with an "unscheduled" bucket for null).
  const matchesByCourt = new Map<string, Match[]>();
  const unscheduled: Match[] = [];
  for (const m of matches) {
    // Hide bracket placeholders that don't have any team filled in yet.
    if (m.team_a_id === null && m.team_b_id === null) continue;
    if (!m.court_id) {
      unscheduled.push(m);
      continue;
    }
    if (!matchesByCourt.has(m.court_id)) matchesByCourt.set(m.court_id, []);
    matchesByCourt.get(m.court_id)!.push(m);
  }
  for (const arr of matchesByCourt.values()) arr.sort(sortCourtQueue);
  unscheduled.sort(sortCourtQueue);

  // Format-aware standings panel.
  function renderStandings() {
    if (division?.format === 'round_robin') {
      const standings = computeStandings(matches, gamesByMatch, teamsById);
      return <StandingsTable standings={standings} showPoints={division.show_points_details} />;
    }
    if (division?.format === 'pool_to_bracket' && pools.length > 0) {
      return (
        <View style={styles.poolStack}>
          {pools.map((p) => {
            const teamIdsInPool = new Set(poolTeams.filter((pt) => pt.pool_id === p.id).map((pt) => pt.team_id));
            const standings = computeStandings(
              matches.filter((m) => m.stage === 'pool'),
              gamesByMatch,
              teamsById,
              teamIdsInPool,
            );
            return (
              <Card key={p.id}>
                <Text style={styles.poolTitle}>{p.name}</Text>
                <View style={{ marginTop: spacing.sm }}>
                  <StandingsTable standings={standings} showPoints={division.show_points_details} compact />
                </View>
              </Card>
            );
          })}
        </View>
      );
    }
    return null;
  }

  const standingsContent = renderStandings();
  const showStandings = standingsContent !== null;

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push({
        pathname: '/t/[id]',
        params: { id: division.tournament_id },
      });
    }
  };

  return (
    <ScreenContainer maxWidth={1400}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Back link to the tournament's division list. */}
      <Pressable
        onPress={goBack}
        accessibilityRole="link"
        accessibilityLabel="Back to tournament"
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
          styles.backLink,
          (hovered || pressed) && styles.backLinkHover,
        ]}
      >
        <Text style={styles.backLinkText}>← Tournament</Text>
      </Pressable>

      {/* View picker: Court board (active) / Scoreboard. */}
      <View style={styles.viewPicker}>
        <View style={[styles.viewTab, styles.viewTabActive]}>
          <Text style={[styles.viewTabText, styles.viewTabTextActive]}>Court board</Text>
        </View>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/t/[id]/divisions/[divisionId]/scoreboard',
              params: { id: division.tournament_id, divisionId: division.id },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Switch to Scoreboard view"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.viewTab,
            (hovered || pressed) && styles.viewTabHover,
          ]}
        >
          <Text style={styles.viewTabText}>Scoreboard</Text>
        </Pressable>
      </View>

      {/* Top bar: title left, brand logo right with brand-orange glow. */}
      <View style={styles.topBar}>
        <View style={styles.topBarTextCol}>
          <Text style={styles.topBarTitle} numberOfLines={2}>
            {labelDivision(division.type, division.level, division.gender)}
          </Text>
          <View style={styles.topBarMetaRow}>
            <StatusPill status={division.status} />
            <Text style={styles.topBarMeta}>
              {teams.length} {teams.length === 1 ? 'team' : 'teams'} · {divisionCourts.length}{' '}
              {divisionCourts.length === 1 ? 'court' : 'courts'}
            </Text>
          </View>
        </View>
        <View style={styles.logoWrap}>
          <Image
            source={require('../../../../../../../assets/logo.avif')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Westminster Pickleball Xscape logo"
          />
        </View>
      </View>

      {/* Court grid above, standings below. */}
      <View style={styles.gridShell}>
        <View style={styles.gridSide}>
          {divisionCourts.length === 0 ? (
            <EmptyState
              title="No courts assigned"
              message="Courts will appear here once the bracket is set up."
            />
          ) : (
            <View
              style={[
                styles.courtGrid,
                gridColumns === 1 && styles.courtGrid1,
                gridColumns === 2 && styles.courtGrid2,
                gridColumns === 3 && styles.courtGrid3,
              ]}
            >
              {divisionCourts.map((c) => (
                <View
                  key={c.id}
                  style={[
                    styles.courtCol,
                    gridColumns === 1 && styles.courtCol1,
                    gridColumns === 2 && styles.courtCol2,
                    gridColumns === 3 && styles.courtCol3,
                  ]}
                >
                  <CourtCard
                    court={c}
                    matches={matchesByCourt.get(c.id) ?? []}
                    teamsById={teamsById}
                    gamesByMatch={gamesByMatch}
                    bracketRounds={bracketRounds}
                  />
                </View>
              ))}
              {unscheduled.length > 0 && (
                <View
                  style={[
                    styles.courtCol,
                    gridColumns === 1 && styles.courtCol1,
                    gridColumns === 2 && styles.courtCol2,
                    gridColumns === 3 && styles.courtCol3,
                  ]}
                >
                  <UnscheduledCard
                    matches={unscheduled}
                    teamsById={teamsById}
                    gamesByMatch={gamesByMatch}
                    bracketRounds={bracketRounds}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        <SponsorBand sponsors={sponsors} />

        {showStandings && (
          <View style={[styles.gridSide, styles.standingsBlock]}>
            <Text style={styles.standingsTitle}>STANDINGS</Text>
            {standingsContent}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

// --- Court card --------------------------------------------------------

function CourtCard({
  court,
  matches,
  teamsById,
  gamesByMatch,
  bracketRounds,
}: {
  court: Court;
  matches: Match[];
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
  bracketRounds: number[];
}) {
  // Find the first un-reported match in this court's queue — that's the
  // "Up next" slot. Anything after it (still un-reported) is "blocked".
  const upNextIdx = matches.findIndex(
    (m) => m.status === 'pending' || m.status === 'scheduled' || m.status === 'in_progress',
  );

  const liveMatch = matches.find((m) => m.status === 'in_progress');
  const hasUpNext = upNextIdx !== -1 && !liveMatch;
  const totalPlayable = matches.filter(
    (m) => m.status !== 'voided',
  ).length;
  const doneCount = matches.filter(
    (m) => m.status === 'reported' || m.status === 'forfeit',
  ).length;
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
            <View style={styles.courtPillLive}>
              <Text style={styles.courtPillLiveDot}>●</Text>
              <Text style={styles.courtPillLiveText}>LIVE</Text>
            </View>
          ) : hasUpNext ? (
            <View style={styles.courtPillUpNext}>
              <Text style={styles.courtPillUpNextText}>UP NEXT</Text>
            </View>
          ) : allDone ? (
            <View style={styles.courtPillDone}>
              <Text style={styles.courtPillDoneText}>DONE</Text>
            </View>
          ) : null}
        </View>
        {totalPlayable > 0 && (
          <Text style={styles.courtProgress}>
            {doneCount}/{totalPlayable}
          </Text>
        )}
      </View>
      {matches.length === 0 ? (
        <Text style={styles.courtEmpty}>No matches on this court</Text>
      ) : (
        <View style={styles.queueList}>
          {matches.map((m, i) => {
            const isUpNext = i === upNextIdx && m.status !== 'in_progress';
            const isLive = m.status === 'in_progress';
            const isBlocked =
              !isLive && !isUpNext && (m.status === 'pending' || m.status === 'scheduled');
            return (
              <MatchRow
                key={m.id}
                match={m}
                teamsById={teamsById}
                gamesByMatch={gamesByMatch}
                bracketRounds={bracketRounds}
                tone={isLive ? 'live' : isUpNext ? 'upnext' : isBlocked ? 'blocked' : 'done'}
              />
            );
          })}
        </View>
      )}
    </Card>
  );
}

function UnscheduledCard({
  matches,
  teamsById,
  gamesByMatch,
  bracketRounds,
}: {
  matches: Match[];
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
  bracketRounds: number[];
}) {
  return (
    <Card>
      <View style={styles.courtHeaderRow}>
        <Text style={[styles.courtName, styles.courtNameMuted]}>Unscheduled</Text>
      </View>
      <View style={styles.queueList}>
        {matches.map((m) => (
          <MatchRow
            key={m.id}
            match={m}
            teamsById={teamsById}
            gamesByMatch={gamesByMatch}
            bracketRounds={bracketRounds}
            tone="blocked"
          />
        ))}
      </View>
    </Card>
  );
}

// --- Match row inside a court card -------------------------------------
// READ-ONLY: rendered as a plain View — no Pressable, no nav.

type RowTone = 'live' | 'upnext' | 'blocked' | 'done';

function MatchRow({
  match,
  teamsById,
  gamesByMatch,
  bracketRounds,
  tone,
}: {
  match: Match;
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
  bracketRounds: number[];
  tone: RowTone;
}) {
  const teamA = match.team_a_id ? teamsById.get(match.team_a_id) ?? null : null;
  const teamB = match.team_b_id ? teamsById.get(match.team_b_id) ?? null : null;
  const aName = teamA?.name ?? 'TBD';
  const bName = teamB?.name ?? 'TBD';
  const games = gamesByMatch[match.id] ?? [];
  const isVoided = match.status === 'voided';
  const isStrike =
    match.status === 'reported' || match.status === 'forfeit' || isVoided;

  // Compact score string for reported matches: "11-7 / 11-9".
  const scoreText =
    (match.status === 'reported' || match.status === 'forfeit') && games.length > 0
      ? games.map((g) => `${g.score_a}-${g.score_b}`).join(' / ')
      : null;

  const roundShort = shortRoundLabel(match, bracketRounds);

  const containerStyles = [
    styles.rowBase,
    tone === 'upnext' && styles.rowUpNext,
    tone === 'live' && styles.rowLive,
    tone === 'blocked' && styles.rowBlocked,
    tone === 'done' && styles.rowDone,
  ];

  const textColor =
    tone === 'live' || tone === 'upnext'
      ? colors.text
      : tone === 'done' || isVoided
        ? colors.textSubtle
        : colors.textMuted;

  return (
    <View
      style={containerStyles}
      accessibilityLabel={`${aName} vs ${bName}`}
    >
      <View style={styles.rowTopLine}>
        <Text style={[styles.roundChip, tone === 'upnext' && styles.roundChipUpNext]}>
          {roundShort}
        </Text>
        {tone === 'live' && <Text style={styles.liveBadge}>LIVE</Text>}
        {tone === 'upnext' && <Text style={styles.upNextBadge}>Up next</Text>}
        {tone === 'done' && (match.status === 'reported' || match.status === 'forfeit') && (
          <Text style={styles.doneBadge}>Done</Text>
        )}
        {isVoided && <Text style={styles.voidBadge}>Voided</Text>}
      </View>
      <Text
        style={[
          styles.rowTeams,
          isStrike && styles.rowTeamsStrike,
          { color: textColor },
        ]}
        numberOfLines={1}
      >
        {aName} <Text style={styles.rowVs}>vs</Text> {bName}
      </Text>
      {scoreText && (
        <Text style={styles.rowScore} numberOfLines={1}>
          {scoreText}
        </Text>
      )}
    </View>
  );
}

// --- Sponsor band ------------------------------------------------------
// Renders sponsor logos between the court grid and the standings. Dynamic:
// LARGE = full-width banner per row; MEDIUM = two per row; SMALL = wrapping
// logo strip.

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

// --- Standings table (compact, theme-only) -----------------------------

function StandingsTable({
  standings,
  showPoints,
  compact,
}: {
  standings: Standing[];
  showPoints: boolean;
  compact?: boolean;
}) {
  if (standings.length === 0) {
    return (
      <Card flat>
        <Text style={styles.standingsEmpty}>No standings yet.</Text>
      </Card>
    );
  }
  return (
    <Card flat>
      <View style={styles.standingsHeaderRow}>
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
        <View key={s.team_id} style={styles.standingsRow}>
          <Text style={[styles.stCell, styles.stRankCol, s.rank === 1 && s.wins > 0 && styles.stRankLeader]}>
            {s.rank}
          </Text>
          <Text style={[styles.stCell, styles.stTeamCol, s.withdrawn && styles.stTeamWithdrawn]} numberOfLines={1}>
            {s.team_name}
          </Text>
          <Text style={[styles.stCell, styles.stStatCol, styles.stWins]}>{s.wins}</Text>
          <Text style={[styles.stCell, styles.stStatCol]}>{s.losses}</Text>
          {showPoints && (
            <>
              <Text style={[styles.stCell, styles.stStatCol]}>{s.pointsFor}</Text>
              <Text style={[styles.stCell, styles.stStatCol]}>{s.pointsAgainst}</Text>
              <Text
                style={[
                  styles.stCell,
                  styles.stStatCol,
                  s.pointDiff > 0 && styles.stDiffPos,
                  s.pointDiff < 0 && styles.stDiffNeg,
                ]}
              >
                {s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}
              </Text>
            </>
          )}
        </View>
      ))}
    </Card>
  );
}

// --- Styles ------------------------------------------------------------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bodyText: { color: colors.text, fontSize: fontSize.base },

  // Back link to the tournament page (sits above the picker).
  backLink: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  backLinkHover: { backgroundColor: colors.bgElevated },
  backLinkText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },

  // Segmented view picker
  viewPicker: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.lg,
    alignSelf: 'flex-start',
  },
  viewTab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  viewTabHover: { backgroundColor: colors.bgElevated },
  viewTabActive: { backgroundColor: colors.bgElevated },
  viewTabText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  viewTabTextActive: { color: colors.text },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  topBarTextCol: { flex: 1, gap: spacing.sm },
  topBarTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  topBarMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  topBarMeta: { color: colors.textMuted, fontSize: fontSize.sm },
  logoWrap: {},
  logo: { width: 80, height: 40 },

  // Grid shell — standings stack directly below the court grid.
  gridShell: { flexDirection: 'column' },
  gridShellWide: { flexDirection: 'row', alignItems: 'flex-start' },
  standingsBlock: { gap: spacing.sm, marginTop: spacing.md },

  // Sponsor band — between the court grid and the standings.
  sponsorBand: { gap: spacing.lg, marginTop: spacing.lg, alignItems: 'center' },
  sponsorLargeRow: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  sponsorLargeImg: { width: '100%', maxWidth: 720, height: 96 },
  sponsorMediumRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xl,
    width: '100%',
  },
  sponsorMediumCell: { flexShrink: 0 },
  sponsorMediumImg: { width: 200, height: 64 },
  sponsorSmallRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
    width: '100%',
  },
  sponsorSmallCell: { flexShrink: 0 },
  sponsorSmallImg: { width: 120, height: 40 },
  standingsTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  gridSide: { flex: 1 },
  gridSideMain: { flex: 3, marginRight: spacing.lg },
  gridSideStandings: { flex: 2, maxWidth: 420 },

  // Court grid (responsive columns)
  courtGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.sm) },
  courtGrid1: {},
  courtGrid2: {},
  courtGrid3: {},
  courtCol: { paddingHorizontal: spacing.sm, marginBottom: spacing.md },
  courtCol1: { width: '100%' },
  courtCol2: { width: '50%' },
  courtCol3: { width: '33.3333%' },

  // Court card
  courtHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  // Court card state accents
  courtCardLive: { borderColor: colors.live, borderTopWidth: 3, borderTopColor: colors.live },
  courtCardUpNext: { borderColor: BRAND_ORANGE, borderTopWidth: 3, borderTopColor: BRAND_ORANGE },
  courtCardDone: { opacity: 0.7 },
  courtHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  courtProgress: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    fontVariant: ['tabular-nums'],
  },
  courtPillLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.liveSoft,
  },
  courtPillLiveDot: { color: colors.live, fontSize: fontSize.xs },
  courtPillLiveText: {
    color: colors.liveSoftText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  courtPillUpNext: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: BRAND_ORANGE,
  },
  courtPillUpNextText: {
    color: BRAND_ORANGE,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  courtPillDone: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.bgMuted,
  },
  courtPillDoneText: {
    color: colors.textSubtle,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },

  courtName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.2,
  },
  courtNameMuted: { color: colors.textMuted },
  courtEmpty: { color: colors.textSubtle, fontSize: fontSize.sm, fontStyle: 'italic' },

  // Queue list (matches inside a court card)
  queueList: { gap: spacing.sm },

  // Row tones — "up next" gets the brand-orange accent so spectators can
  // spot what's about to start at a glance, distinct from the green-toned
  // live row.
  rowBase: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgMuted,
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
  rowBlocked: {
    backgroundColor: colors.bgMuted,
    borderColor: colors.border,
  },
  rowDone: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },

  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
    textTransform: 'uppercase',
  },
  doneBadge: {
    color: colors.textSubtle,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
    textTransform: 'uppercase',
  },
  voidBadge: {
    color: colors.textSubtle,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
    textTransform: 'uppercase',
  },

  rowTeams: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  rowTeamsStrike: { textDecorationLine: 'line-through' },
  rowVs: { color: colors.textSubtle, fontWeight: fontWeight.regular as TextStyle['fontWeight'] },
  rowScore: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  // Standings card
  poolStack: { gap: spacing.md },
  poolTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  standingsEmpty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  standingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stHead: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  stCell: { fontSize: fontSize.sm, color: colors.text },
  stRankCol: { width: 28, textAlign: 'center' },
  stRankLeader: {},
  stTeamCol: { flex: 1, paddingHorizontal: spacing.sm },
  stTeamWithdrawn: { color: colors.textSubtle, textDecorationLine: 'line-through' },
  stStatCol: { width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  stWins: { fontWeight: fontWeight.semibold as TextStyle['fontWeight'] },
  stDiffPos: { color: colors.liveSoftText },
  stDiffNeg: { color: colors.destructiveSoftText },
});
