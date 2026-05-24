// Public Stadium Scoreboard view — broadcast / TV-feed aesthetic for
// spectators and players following a division from URL/QR. Three banded
// sections: LIVE (chunky cards, matches in progress), NEXT UP (the matches
// most likely to play next), JUST FINISHED (last few reported matches),
// plus STANDINGS at the bottom.
//
// READ-ONLY: mirrors the admin scoreboard but every Pressable/admin nav
// has been stripped. Cards are plain Views.
//
// Lives under `_views/` so Expo Router treats it as a private file (not
// auto-routed). The public route `./scoreboard.tsx` thin-wraps this.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
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

// Westminster brand orange — accent for the venue logo glow + "next up"
// callouts so spectators can spot what's about to start.
const BRAND_ORANGE = '#f97316';

// --- Types -------------------------------------------------------------

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
type DivisionCourtRow = {
  court_id: string;
  display_order: number;
  courts: { id: string; name: string } | null;
};

// --- Helpers -----------------------------------------------------------

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

function shortRoundLabel(m: Match, bracketRounds: number[]): string {
  if (m.stage === 'bracket' && m.bracket_round != null && bracketRounds.length > 0) {
    const maxRound = bracketRounds[bracketRounds.length - 1];
    const fromFinal = maxRound - m.bracket_round;
    if (fromFinal === 0) return 'Final';
    if (fromFinal === 1) return 'Semifinal';
    if (fromFinal === 2) return 'Quarterfinal';
    if (fromFinal === 3) return 'Round of 16';
    if (fromFinal === 4) return 'Round of 32';
    return `Bracket R${m.bracket_round}`;
  }
  if (m.round_number != null) return `Round ${m.round_number}`;
  return '';
}

function matchOrder(a: Match, b: Match) {
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

// --- Component ---------------------------------------------------------

export default function PublicScoreboardView() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const { width } = useWindowDimensions();
  const router = useRouter();

  const [division, setDivision] = useState<Division | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [gamesByMatch, setGamesByMatch] = useState<Record<string, MatchGame[]>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [courtsById, setCourtsById] = useState<Map<string, Court>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !divisionId) return;
    setError(null);

    // No `promoteToBracketIfReady` — public viewers must not mutate state.

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

    const [teamsRes, matchesRes, poolsRes, dcRes] = await Promise.all([
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
    const cMap = new Map<string, Court>();
    for (const row of dcRows) {
      if (row.courts) cMap.set(row.courts.id, { id: row.courts.id, name: row.courts.name });
    }
    setCourtsById(cMap);

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

  // Live updates: refetch whenever the admin reports a score, withdraws a
  // team, reassigns a court, etc. The TV-style scoreboard needs to update
  // hands-off so spectators see the new state without anyone touching it.
  useEffect(() => {
    if (!divisionId) return;
    const channel = supabase
      .channel(`scoreboard:${divisionId}`)
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

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const isWide = width >= 900;
  const bracketRounds = Array.from(
    new Set(
      matches.filter((m) => m.stage === 'bracket' && m.bracket_round != null).map((m) => m.bracket_round!),
    ),
  ).sort((a, b) => a - b);

  // --- Section buckets -------------------------------------------------
  const live = matches
    .filter((m) => m.status === 'in_progress' && m.team_a_id && m.team_b_id)
    .sort(matchOrder);

  const justReportedCourtIds = new Set(
    matches
      .filter((m) => m.status === 'reported' || m.status === 'forfeit')
      .map((m) => m.court_id)
      .filter((cid): cid is string => cid !== null),
  );
  const liveCourtIds = new Set(
    matches
      .filter((m) => m.status === 'in_progress')
      .map((m) => m.court_id)
      .filter((cid): cid is string => cid !== null),
  );
  const nextUpAll = matches
    .filter(
      (m) => (m.status === 'pending' || m.status === 'scheduled') && m.team_a_id && m.team_b_id,
    )
    .sort((a, b) => {
      const aFree =
        a.court_id && justReportedCourtIds.has(a.court_id) && !liveCourtIds.has(a.court_id) ? 0 : 1;
      const bFree =
        b.court_id && justReportedCourtIds.has(b.court_id) && !liveCourtIds.has(b.court_id) ? 0 : 1;
      if (aFree !== bFree) return aFree - bFree;
      const aHas = a.court_id ? 0 : 1;
      const bHas = b.court_id ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return matchOrder(a, b);
    });
  const nextUp = nextUpAll.slice(0, 5);

  function renderStandings() {
    if (division?.format === 'round_robin') {
      const standings = computeStandings(matches, gamesByMatch, teamsById);
      return <StandingsTable standings={standings} showPoints={division.show_points_details} />;
    }
    if (division?.format === 'pool_to_bracket' && pools.length > 0) {
      return (
        <View style={[styles.poolGrid, isWide && styles.poolGridWide]}>
          {pools.map((p) => {
            const teamIdsInPool = new Set(poolTeams.filter((pt) => pt.pool_id === p.id).map((pt) => pt.team_id));
            const standings = computeStandings(
              matches.filter((m) => m.stage === 'pool'),
              gamesByMatch,
              teamsById,
              teamIdsInPool,
            );
            return (
              <View key={p.id} style={[styles.poolCol, isWide && styles.poolColWide]}>
                <Card flat>
                  <Text style={styles.poolTitle}>{p.name}</Text>
                  <View style={{ marginTop: spacing.sm }}>
                    <StandingsTable
                      standings={standings}
                      showPoints={division.show_points_details}
                      compact
                    />
                  </View>
                </Card>
              </View>
            );
          })}
        </View>
      );
    }
    return null;
  }

  const standingsContent = renderStandings();

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

      {/* View picker: Court board / Scoreboard (active). */}
      <View style={styles.viewPicker}>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/t/[id]/divisions/[divisionId]/court-board',
              params: { id: division.tournament_id, divisionId: division.id },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Switch to Court board view"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.viewTab,
            (hovered || pressed) && styles.viewTabHover,
          ]}
        >
          <Text style={styles.viewTabText}>Court board</Text>
        </Pressable>
        <View style={[styles.viewTab, styles.viewTabActive]}>
          <Text style={[styles.viewTabText, styles.viewTabTextActive]}>Scoreboard</Text>
        </View>
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarTextCol}>
          <Text style={styles.topBarTitle} numberOfLines={2}>
            {labelDivision(division.type, division.level, division.gender)}
          </Text>
          <View style={styles.topBarMetaRow}>
            <StatusPill status={division.status} />
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

      {/* LIVE — only renders when there are matches in progress. */}
      {live.length > 0 && (
        <Section title="Live">
          <View style={styles.liveGrid}>
            {live.map((m) => (
              <View key={m.id} style={[styles.liveCell, isWide && live.length > 1 && styles.liveCellWide]}>
                <BroadcastCard
                  match={m}
                  teamsById={teamsById}
                  gamesByMatch={gamesByMatch}
                  courtsById={courtsById}
                  bracketRounds={bracketRounds}
                  bestOf={division.best_of}
                  size="large"
                />
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* NEXT UP — horizontal scroll on phone; row of cards on web */}
      <Section title="Next up">
        {nextUp.length === 0 ? (
          <Card flat>
            <Text style={styles.bandEmpty}>No matches queued</Text>
          </Card>
        ) : isWide ? (
          <View style={styles.upNextRow}>
            {nextUp.map((m) => (
              <View key={m.id} style={styles.upNextCellWide}>
                <BroadcastCard
                  match={m}
                  teamsById={teamsById}
                  gamesByMatch={gamesByMatch}
                  courtsById={courtsById}
                  bracketRounds={bracketRounds}
                  bestOf={division.best_of}
                  size="medium"
                  variant="upnext"
                />
              </View>
            ))}
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.upNextScroll}
          >
            {nextUp.map((m) => (
              <View key={m.id} style={styles.upNextCellNarrow}>
                <BroadcastCard
                  match={m}
                  teamsById={teamsById}
                  gamesByMatch={gamesByMatch}
                  courtsById={courtsById}
                  bracketRounds={bracketRounds}
                  bestOf={division.best_of}
                  size="medium"
                  variant="upnext"
                />
              </View>
            ))}
          </ScrollView>
        )}
      </Section>

      {/* STANDINGS */}
      {standingsContent && <Section title="Standings">{standingsContent}</Section>}

      {!standingsContent && division.format === 'single_elimination' && (
        <Section title="Standings">
          <EmptyState title="Single elimination" message="Standings aren't shown for knockout brackets." />
        </Section>
      )}
    </ScreenContainer>
  );
}

// --- Broadcast-style match card (READ-ONLY) ----------------------------

function BroadcastCard({
  match,
  teamsById,
  gamesByMatch,
  courtsById,
  bracketRounds,
  bestOf,
  size,
  done,
  variant,
}: {
  match: Match;
  teamsById: Map<string, Team>;
  gamesByMatch: Record<string, MatchGame[]>;
  courtsById: Map<string, Court>;
  bracketRounds: number[];
  bestOf: number;
  size: 'large' | 'medium';
  done?: boolean;
  // "upnext" gives the card a brand-orange top accent so spectators can
  // visually distinguish queued matches from completed ones.
  variant?: 'upnext';
}) {
  const teamA = match.team_a_id ? teamsById.get(match.team_a_id) ?? null : null;
  const teamB = match.team_b_id ? teamsById.get(match.team_b_id) ?? null : null;
  const aName = teamA?.name ?? 'TBD';
  const bName = teamB?.name ?? 'TBD';
  const aWon = match.winner_team_id !== null && match.winner_team_id === match.team_a_id;
  const bWon = match.winner_team_id !== null && match.winner_team_id === match.team_b_id;
  const games = gamesByMatch[match.id] ?? [];
  const courtName = match.court_id ? courtsById.get(match.court_id)?.name ?? null : null;
  const roundTxt = shortRoundLabel(match, bracketRounds);
  const isLive = match.status === 'in_progress';
  const isVoided = match.status === 'voided';
  const isReported = match.status === 'reported' || match.status === 'forfeit';

  type Cell = { kind: 'score'; a: string; b: string } | { kind: 'empty' };
  let cells: Cell[];
  if (isVoided) {
    cells = [{ kind: 'empty' }];
  } else if (isReported && games.length > 0) {
    cells = games.map((g) => ({ kind: 'score', a: String(g.score_a), b: String(g.score_b) }));
  } else if (isLive && games.length > 0) {
    cells = games.map((g) => ({ kind: 'score', a: String(g.score_a), b: String(g.score_b) }));
    while (cells.length < bestOf) cells.push({ kind: 'empty' });
  } else {
    cells = Array.from({ length: bestOf }, () => ({ kind: 'empty' as const }));
  }

  const isLarge = size === 'large';
  const teamFontSize = isLarge ? fontSize.xl : fontSize.md;
  const scoreFontSize = isLarge ? fontSize.xxl : fontSize.lg;
  const scoreColWidth = isLarge ? 56 : 36;

  return (
    <Card
      flat
      accessibilityLabel={`${aName} vs ${bName}`}
      style={[
        styles.broadcastCard,
        isLive && styles.broadcastLive,
        variant === 'upnext' && styles.broadcastUpNext,
        done && styles.broadcastDone,
      ]}
    >
      {/* Header strip: court + LIVE / round label */}
      <View style={styles.broadcastHeader}>
        <View style={styles.broadcastHeaderLeft}>
          {courtName && <Text style={styles.broadcastCourt}>{courtName}</Text>}
          {roundTxt && (
            <Text style={styles.broadcastRound}>
              {courtName ? '· ' : ''}
              {roundTxt}
            </Text>
          )}
        </View>
        <View style={styles.broadcastHeaderRight}>
          {isLive ? (
            <View style={styles.liveBadgePill}>
              <Text style={styles.liveBadgeDot}>●</Text>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          ) : variant === 'upnext' ? (
            <View style={styles.upNextPill}>
              <Text style={styles.upNextPillText}>UP NEXT</Text>
            </View>
          ) : (
            <StatusPill status={match.status} />
          )}
        </View>
      </View>

      {/* Stacked team rows (broadcast scoreboard pattern) */}
      <View style={styles.broadcastStack}>
        <View style={styles.broadcastRow}>
          <Text
            style={[
              styles.broadcastTeam,
              { fontSize: teamFontSize },
              aWon && styles.broadcastTeamWinner,
              done && !aWon && styles.broadcastTeamMutedLoser,
            ]}
            numberOfLines={1}
          >
            {aName}
          </Text>
          {cells.map((c, i) =>
            c.kind === 'score' ? (
              <Text
                key={`a-${i}`}
                style={[
                  styles.broadcastScore,
                  { fontSize: scoreFontSize, width: scoreColWidth },
                  aWon && styles.broadcastScoreWinner,
                ]}
                numberOfLines={1}
              >
                {c.a}
              </Text>
            ) : (
              <View key={`a-${i}`} style={[styles.broadcastScoreEmpty, { width: scoreColWidth }]} />
            ),
          )}
        </View>
        <View style={styles.broadcastRow}>
          <Text
            style={[
              styles.broadcastTeam,
              { fontSize: teamFontSize },
              bWon && styles.broadcastTeamWinner,
              done && !bWon && styles.broadcastTeamMutedLoser,
            ]}
            numberOfLines={1}
          >
            {bName}
          </Text>
          {cells.map((c, i) =>
            c.kind === 'score' ? (
              <Text
                key={`b-${i}`}
                style={[
                  styles.broadcastScore,
                  { fontSize: scoreFontSize, width: scoreColWidth },
                  bWon && styles.broadcastScoreWinner,
                ]}
                numberOfLines={1}
              >
                {c.b}
              </Text>
            ) : (
              <View key={`b-${i}`} style={[styles.broadcastScoreEmpty, { width: scoreColWidth }]} />
            ),
          )}
        </View>
      </View>
    </Card>
  );
}

// --- Standings table ---------------------------------------------------

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
      <View>
        <Text style={styles.standingsEmpty}>No standings yet.</Text>
      </View>
    );
  }
  return (
    <View>
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
    </View>
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

  // Live grid: 2 columns on wide screens when there are multiple lives.
  liveGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.sm) },
  liveCell: { paddingHorizontal: spacing.sm, marginBottom: spacing.md, width: '100%' },
  liveCellWide: { width: '50%' },

  // Up next row of cards (web) / horizontal scroll (narrow)
  upNextRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.sm) },
  upNextCellWide: { paddingHorizontal: spacing.sm, marginBottom: spacing.md, width: '33.3333%' },
  upNextScroll: { gap: spacing.md, paddingRight: spacing.md },
  upNextCellNarrow: { width: 280 },

  finishedStack: { gap: spacing.md },

  bandEmpty: { color: colors.textMuted, fontSize: fontSize.sm, fontStyle: 'italic' },

  // Broadcast card
  broadcastCard: {
    gap: spacing.md,
    borderColor: colors.borderStrong,
  },
  broadcastLive: {
    borderColor: colors.live,
    borderTopWidth: 3,
    backgroundColor: colors.bgElevated,
  },
  broadcastUpNext: {
    borderColor: BRAND_ORANGE,
    borderTopWidth: 3,
  },
  broadcastDone: {
    opacity: 0.92,
    backgroundColor: colors.bgMuted,
  },

  broadcastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  broadcastHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  broadcastHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  broadcastCourt: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  broadcastRound: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },

  liveBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.liveSoft,
  },
  liveBadgeDot: { color: colors.live, fontSize: fontSize.xs },
  liveBadgeText: {
    color: colors.liveSoftText,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },
  // Brand-orange "UP NEXT" pill, mirrors the live pill shape for visual
  // rhythm but uses the orange palette so it reads as queued / soon.
  upNextPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: BRAND_ORANGE,
  },
  upNextPillText: {
    color: BRAND_ORANGE,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.black as TextStyle['fontWeight'],
    letterSpacing: tracking.capsLoose,
  },

  broadcastStack: { gap: spacing.sm },
  broadcastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  broadcastTeam: {
    flex: 1,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  broadcastTeamWinner: {
    color: colors.liveSoftText,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  broadcastTeamMutedLoser: { color: colors.textMuted },
  broadcastScore: {
    color: colors.text,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  broadcastScoreWinner: { color: colors.liveSoftText },
  broadcastScoreEmpty: {
    height: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    opacity: 0.5,
    alignSelf: 'flex-end',
    marginBottom: 6,
  },

  // Standings
  poolGrid: { flexDirection: 'column', gap: spacing.md },
  poolGridWide: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.sm), gap: 0 },
  poolCol: {},
  poolColWide: { width: '50%', paddingHorizontal: spacing.sm, marginBottom: spacing.md },
  poolTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  standingsEmpty: { color: colors.textMuted, fontSize: fontSize.sm, fontStyle: 'italic' },
  stHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stRow: {
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
