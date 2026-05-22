import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Button from '../../../../../../../../src/components/Button';
import Card from '../../../../../../../../src/components/Card';
import ErrorBanner from '../../../../../../../../src/components/ErrorBanner';
import Input from '../../../../../../../../src/components/Input';
import ScreenContainer from '../../../../../../../../src/components/ScreenContainer';
import StatusPill from '../../../../../../../../src/components/StatusPill';
import { confirmAsync, notifyAlert, notifyConfirm } from '../../../../../../../../src/lib/notify';
import { supabase } from '../../../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../../../../src/theme';

// Limits how deep cascade-revert can walk before bailing. Real brackets never
// reach 10 rounds (2^10 = 1024 teams). Catches accidental cycles.
const CASCADE_MAX_DEPTH = 10;

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';
type DivisionLevel = 'beginner' | 'intermediate' | 'advanced';

type Division = {
  id: string;
  tournament_id: string;
  type: DivisionType;
  level: DivisionLevel;
  best_of: number;
  game_to: number;
  win_by: number;
};

type Team = { id: string; name: string };

type MatchStatus = 'pending' | 'scheduled' | 'in_progress' | 'reported' | 'voided' | 'forfeit';
type MatchStage = 'round_robin' | 'pool' | 'bracket';

type Match = {
  id: string;
  division_id: string;
  stage: MatchStage;
  pool_id: string | null;
  round_number: number | null;
  bracket_round: number | null;
  bracket_slot: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  court_id: string | null;
  status: MatchStatus;
  winner_team_id: string | null;
  next_match_id: string | null;
  next_match_slot: 'a' | 'b' | null;
};

type MatchGame = {
  match_id: string;
  game_number: number;
  score_a: number;
  score_b: number;
};

type ScoreEvent = { id: string };

function labelType(t: string) {
  if (t === 'singles') return 'Singles';
  if (t === 'doubles') return 'Doubles';
  if (t === 'mixed_doubles') return 'Mixed doubles';
  return t;
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function stageLabel(m: Match): string {
  if (m.stage === 'bracket') return `Bracket round ${m.bracket_round ?? '?'}`;
  if (m.stage === 'pool') return `Pool play`;
  if (m.stage === 'round_robin') return `Round-robin round ${m.round_number ?? '?'}`;
  return m.stage;
}

type ForfeitTeam = 'a' | 'b';
type ForfeitMode = 'default_score' | 'void';

export default function MatchScore() {
  const { id, divisionId, matchId } = useLocalSearchParams<{
    id: string;
    divisionId: string;
    matchId: string;
  }>();
  const router = useRouter();

  const [division, setDivision] = useState<Division | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [teamA, setTeamA] = useState<Team | null>(null);
  const [teamB, setTeamB] = useState<Team | null>(null);
  const [existingGames, setExistingGames] = useState<MatchGame[]>([]);
  const [existingEvents, setExistingEvents] = useState<ScoreEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Score inputs — one pair per game (up to division.best_of, but only show
  // game 3 when 1 & 2 split).
  const [scoreA, setScoreA] = useState<string[]>(['', '', '', '', '']);
  const [scoreB, setScoreB] = useState<string[]>(['', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Forfeit picker state.
  const [forfeitOpen, setForfeitOpen] = useState(false);
  const [forfeitTeam, setForfeitTeam] = useState<ForfeitTeam | null>(null);
  const [forfeitMode, setForfeitMode] = useState<ForfeitMode | null>(null);

  const load = useCallback(async () => {
    if (!id || !divisionId || !matchId) return;
    setError(null);
    setLoading(true);

    const dRes = await supabase
      .from('divisions')
      .select('id, tournament_id, type, level, best_of, game_to, win_by')
      .eq('id', divisionId)
      .maybeSingle();
    if (dRes.error) {
      setError(dRes.error.message);
      setLoading(false);
      return;
    }
    const div = dRes.data as Division | null;
    if (!div || div.tournament_id !== id) {
      setError('Division does not belong to this tournament.');
      setLoading(false);
      return;
    }
    setDivision(div);

    const mRes = await supabase
      .from('matches')
      .select(
        'id, division_id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id, next_match_id, next_match_slot',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (mRes.error) {
      setError(mRes.error.message);
      setLoading(false);
      return;
    }
    const m = mRes.data as Match | null;
    if (!m || m.division_id !== divisionId) {
      setError('Match does not belong to this division.');
      setLoading(false);
      return;
    }
    setMatch(m);

    const teamIds = [m.team_a_id, m.team_b_id].filter((x): x is string => !!x);
    if (teamIds.length > 0) {
      const tRes = await supabase.from('teams').select('id, name').in('id', teamIds);
      if (tRes.error) {
        setError(tRes.error.message);
        setLoading(false);
        return;
      }
      const teams = (tRes.data as Team[]) ?? [];
      setTeamA(m.team_a_id ? teams.find((t) => t.id === m.team_a_id) ?? null : null);
      setTeamB(m.team_b_id ? teams.find((t) => t.id === m.team_b_id) ?? null : null);
    } else {
      setTeamA(null);
      setTeamB(null);
    }

    const gRes = await supabase
      .from('match_games')
      .select('match_id, game_number, score_a, score_b')
      .eq('match_id', matchId)
      .order('game_number', { ascending: true });
    if (gRes.error) {
      setError(gRes.error.message);
      setLoading(false);
      return;
    }
    const games = (gRes.data as MatchGame[]) ?? [];
    setExistingGames(games);

    const eRes = await supabase
      .from('score_events')
      .select('id')
      .eq('match_id', matchId)
      .limit(1);
    if (eRes.error) {
      setError(eRes.error.message);
      setLoading(false);
      return;
    }
    setExistingEvents((eRes.data as ScoreEvent[]) ?? []);

    // Pre-fill inputs from existing games (so admin can correct a score).
    const a = ['', '', '', '', ''];
    const b = ['', '', '', '', ''];
    for (const g of games) {
      const idx = g.game_number - 1;
      if (idx >= 0 && idx < 5) {
        a[idx] = String(g.score_a);
        b[idx] = String(g.score_b);
      }
    }
    setScoreA(a);
    setScoreB(b);

    setLoading(false);
  }, [id, divisionId, matchId]);

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

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (!division || !match) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {!error && <Text>Match not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }

  const teamAName = teamA?.name ?? 'TBD';
  const teamBName = teamB?.name ?? 'TBD';
  const isBracketPending =
    match.stage === 'bracket' && (match.team_a_id === null || match.team_b_id === null);
  const showResetButton = existingEvents.length > 0;

  // For best_of=3, only show game 3 when games 1 & 2 are split. For
  // best_of=1, only game 1. For best_of=5, always show games 1 and 2; show
  // game 3 always; show games 4 & 5 when prior games leave the series open.
  function visibleGames(): number {
    const bo = division!.best_of;
    if (bo === 1) return 1;
    const a = scoreA;
    const b = scoreB;
    const winnerOf = (i: number): 'a' | 'b' | null => {
      const av = parseInt(a[i], 10);
      const bv = parseInt(b[i], 10);
      if (!isFinite(av) || !isFinite(bv)) return null;
      if (av === bv) return null;
      return av > bv ? 'a' : 'b';
    };
    if (bo === 3) {
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
    if (!division || !match) return;
    if (isBracketPending) {
      notifyAlert('Cannot enter score', 'This bracket match is waiting for upstream winners.');
      return;
    }
    if (!match.team_a_id || !match.team_b_id) {
      notifyAlert('Cannot enter score', 'Match has no opponents to score.');
      return;
    }

    // Parse + validate.
    const games: { n: number; a: number; b: number }[] = [];
    for (let i = 0; i < numGamesVisible; i++) {
      const aStr = scoreA[i].trim();
      const bStr = scoreB[i].trim();
      if (aStr === '' || bStr === '') {
        const msg = `Game ${i + 1}: both scores are required.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      const av = Number(aStr);
      const bv = Number(bStr);
      if (!Number.isInteger(av) || !Number.isInteger(bv) || av < 0 || bv < 0) {
        const msg = `Game ${i + 1}: scores must be non-negative integers.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      games.push({ n: i + 1, a: av, b: bv });
    }

    if (games.length === 0) {
      const msg = 'Enter at least one game score.';
      setError(msg);
      notifyAlert('Invalid score', msg);
      return;
    }

    // Validate each game ends correctly: winner must reach >= game_to AND be
    // ahead by >= win_by. (The "determining" game is the last one entered.)
    let aWins = 0;
    let bWins = 0;
    for (const g of games) {
      if (g.a === g.b) {
        const msg = `Game ${g.n}: a game cannot end tied.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      const hi = Math.max(g.a, g.b);
      const lo = Math.min(g.a, g.b);
      if (hi < division.game_to) {
        const msg = `Game ${g.n}: winner must reach at least ${division.game_to}.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      if (hi - lo < division.win_by) {
        const msg = `Game ${g.n}: must win by ${division.win_by} (got ${hi}-${lo}).`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      if (g.a > g.b) aWins++;
      else bWins++;
    }

    // Best-of validation: exactly one team must reach the required wins.
    const required = Math.ceil(division.best_of / 2);
    if (division.best_of === 1) {
      if (aWins + bWins !== 1) {
        const msg = 'Best-of-1: enter exactly one game.';
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
    } else {
      if (aWins < required && bWins < required) {
        const msg = `Best-of-${division.best_of}: one team must win ${required} games.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
      if (aWins >= required && bWins >= required) {
        const msg = `Best-of-${division.best_of}: only one team should reach ${required} game wins.`;
        setError(msg);
        notifyAlert('Invalid score', msg);
        return;
      }
    }

    const winnerTeamId = aWins > bWins ? match.team_a_id : match.team_b_id;
    setError(null);

    busyRef.current = true;
    setBusy(true);

    const err = await persistScoreEntry({
      match,
      games,
      winnerTeamId,
      forfeit: false,
    });
    if (err) {
      busyRef.current = false;
      setBusy(false);
      setError(err);
      notifyAlert('Could not save score', err);
      return;
    }

    // Bracket propagation / cascade revert.
    const propErr = await propagateOrCascade(match, winnerTeamId);
    busyRef.current = false;
    setBusy(false);
    if (propErr === 'CANCELLED') {
      // Admin declined the cascade-revert prompt. Score itself was saved,
      // but we should reload so they see the current state.
      await load();
      return;
    }
    if (propErr) {
      setError(propErr);
      notifyAlert('Could not advance bracket', propErr);
      await load();
      return;
    }
    router.back();
  }

  function onForfeitTapped() {
    if (isBracketPending) {
      notifyAlert('Cannot forfeit', 'This bracket match is waiting for upstream winners.');
      return;
    }
    if (!match || !match.team_a_id || !match.team_b_id) {
      notifyAlert('Cannot forfeit', 'Match has no opponents.');
      return;
    }
    setForfeitOpen(true);
    setForfeitTeam(null);
    setForfeitMode(null);
  }

  async function confirmForfeit() {
    if (busyRef.current) return;
    if (!division || !match || !forfeitTeam || !forfeitMode) return;
    if (!match.team_a_id || !match.team_b_id) return;

    const winnerTeamId = forfeitTeam === 'a' ? match.team_b_id : match.team_a_id;
    const winnerName = forfeitTeam === 'a' ? teamBName : teamAName;
    const loserName = forfeitTeam === 'a' ? teamAName : teamBName;

    notifyConfirm(
      'Confirm forfeit',
      forfeitMode === 'default_score'
        ? `Record default-score win (${division.game_to}-0) for ${winnerName}. ${loserName} forfeits.`
        : `Void the match. Neither team gets a result. ${loserName} forfeits.`,
      () => {
        void doForfeit(winnerTeamId);
      },
      { confirmLabel: 'Forfeit', destructive: true },
    );
  }

  async function doForfeit(winnerTeamId: string) {
    if (busyRef.current) return;
    if (!division || !match || !forfeitMode) return;

    busyRef.current = true;
    setBusy(true);

    if (forfeitMode === 'default_score') {
      const aWins = winnerTeamId === match.team_a_id;
      const game = { n: 1, a: aWins ? division.game_to : 0, b: aWins ? 0 : division.game_to };
      const err = await persistScoreEntry({
        match,
        games: [game],
        winnerTeamId,
        forfeit: true,
        defaultScore: true,
        statusOverride: 'forfeit',
      });
      if (err) {
        busyRef.current = false;
        setBusy(false);
        setError(err);
        notifyAlert('Could not save forfeit', err);
        return;
      }
      // Forfeit with default-score-win does advance the bracket.
      const propErr = await propagateOrCascade(match, winnerTeamId);
      busyRef.current = false;
      setBusy(false);
      if (propErr === 'CANCELLED') {
        await load();
        return;
      }
      if (propErr) {
        setError(propErr);
        notifyAlert('Could not advance bracket', propErr);
        await load();
        return;
      }
      router.back();
      return;
    }

    // Void mode: no match_games, status='voided'. Downstream cascade-voids.
    const err = await persistVoid({ match });
    if (err) {
      busyRef.current = false;
      setBusy(false);
      setError(err);
      notifyAlert('Could not void match', err);
      return;
    }
    const cascadeErr = await cascadeVoidDownstream(match);
    busyRef.current = false;
    setBusy(false);
    if (cascadeErr === 'CANCELLED') {
      await load();
      return;
    }
    if (cascadeErr) {
      setError(cascadeErr);
      notifyAlert('Could not cascade void', cascadeErr);
      await load();
      return;
    }
    router.back();
  }

  async function onReset() {
    if (busyRef.current) return;
    if (!match) return;

    notifyConfirm(
      'Reset score?',
      'This clears the entered score and reverts the match to pending. Any downstream bracket matches that depend on this winner will need to be reset or rescored.',
      () => {
        void doReset();
      },
      { confirmLabel: 'Reset', destructive: true },
    );
  }

  async function doReset() {
    if (busyRef.current) return;
    if (!match) return;
    busyRef.current = true;
    setBusy(true);

    // Cascade-revert downstream first (which may prompt).
    const cascadeErr = await cascadeRevertOnReset(match);
    if (cascadeErr === 'CANCELLED') {
      busyRef.current = false;
      setBusy(false);
      await load();
      return;
    }
    if (cascadeErr) {
      busyRef.current = false;
      setBusy(false);
      setError(cascadeErr);
      notifyAlert('Could not reset', cascadeErr);
      return;
    }

    // Delete match_games and reset match row.
    const delGames = await supabase.from('match_games').delete().eq('match_id', match.id);
    if (delGames.error) {
      busyRef.current = false;
      setBusy(false);
      setError(delGames.error.message);
      notifyAlert('Could not reset', delGames.error.message);
      return;
    }

    const newStatus: MatchStatus = match.court_id ? 'scheduled' : 'pending';
    const upd = await supabase
      .from('matches')
      .update({ winner_team_id: null, ended_at: null, status: newStatus })
      .eq('id', match.id);
    if (upd.error) {
      busyRef.current = false;
      setBusy(false);
      setError(upd.error.message);
      notifyAlert('Could not reset', upd.error.message);
      return;
    }

    // Audit row for the reset itself.
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id ?? null;
    await supabase.from('score_events').insert({
      match_id: match.id,
      entered_by: userId,
      payload: { reset: true },
      note: 'Score reset to pending',
    });

    busyRef.current = false;
    setBusy(false);
    router.back();
  }

  return (
    <ScreenContainer>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Card>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>
            {labelType(division.type)} · {cap(division.level)}
          </Text>
          <Text style={styles.title}>
            {teamAName} <Text style={styles.titleVs}>vs</Text> {teamBName}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{stageLabel(match)}</Text>
            <StatusPill status={match.status} />
          </View>
          <Text style={styles.metaSubtle}>
            Best of {division.best_of} · {division.game_to} win by {division.win_by}
          </Text>
        </View>
      </Card>

      {isBracketPending ? (
        <Card>
          <Text style={styles.waitingTitle}>Waiting for upstream match</Text>
          <Text style={styles.waitingBody}>
            This bracket match needs the winner of an earlier round before scores can be entered.
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.gamesBlock}>
              {Array.from({ length: numGamesVisible }).map((_, i) => (
                <View key={i} style={styles.gameRow}>
                  <Text style={styles.gameLabel}>Game {i + 1}</Text>
                  <View style={styles.scoreInputs}>
                    <Input
                      containerStyle={styles.scoreInput}
                      label={teamAName}
                      value={scoreA[i]}
                      onChangeText={(v) => updateScoreA(i, v)}
                      keyboardType="number-pad"
                      placeholder="0"
                      maxLength={3}
                    />
                    <Input
                      containerStyle={styles.scoreInput}
                      label={teamBName}
                      value={scoreB[i]}
                      onChangeText={(v) => updateScoreB(i, v)}
                      keyboardType="number-pad"
                      placeholder="0"
                      maxLength={3}
                    />
                  </View>
                </View>
              ))}
            </View>

            <Button onPress={onSave} loading={busy} size="lg" style={styles.saveBtn}>
              Save score
            </Button>
          </Card>

          {forfeitOpen ? (
            <Card>
              <Text style={styles.forfeitTitle}>Forfeit</Text>
              <Text style={styles.forfeitStep}>Which team forfeited?</Text>
              <View style={styles.forfeitRow}>
                <Pressable
                  onPress={() => setForfeitTeam('a')}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.forfeitChoice,
                    forfeitTeam === 'a' && styles.forfeitChoiceActive,
                    hovered && styles.forfeitChoiceHover,
                    pressed && styles.forfeitChoicePressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.forfeitChoiceText,
                      forfeitTeam === 'a' && styles.forfeitChoiceTextActive,
                    ]}
                  >
                    {teamAName}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setForfeitTeam('b')}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.forfeitChoice,
                    forfeitTeam === 'b' && styles.forfeitChoiceActive,
                    hovered && styles.forfeitChoiceHover,
                    pressed && styles.forfeitChoicePressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.forfeitChoiceText,
                      forfeitTeam === 'b' && styles.forfeitChoiceTextActive,
                    ]}
                  >
                    {teamBName}
                  </Text>
                </Pressable>
              </View>

              {forfeitTeam !== null && (
                <>
                  <Text style={styles.forfeitStep}>Outcome?</Text>
                  <View style={styles.forfeitModeCol}>
                    <Pressable
                      onPress={() => setForfeitMode('default_score')}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.forfeitModeChoice,
                        forfeitMode === 'default_score' && styles.forfeitChoiceActive,
                        hovered && styles.forfeitChoiceHover,
                        pressed && styles.forfeitChoicePressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.forfeitChoiceText,
                          forfeitMode === 'default_score' && styles.forfeitChoiceTextActive,
                        ]}
                      >
                        Record default-score win for{' '}
                        {forfeitTeam === 'a' ? teamBName : teamAName} ({division.game_to}-0)
                      </Text>
                      <Text style={styles.forfeitModeHelp}>
                        USAPA convention. Counts toward standings.
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setForfeitMode('void')}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.forfeitModeChoice,
                        forfeitMode === 'void' && styles.forfeitChoiceActive,
                        hovered && styles.forfeitChoiceHover,
                        pressed && styles.forfeitChoicePressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.forfeitChoiceText,
                          forfeitMode === 'void' && styles.forfeitChoiceTextActive,
                        ]}
                      >
                        Void the match
                      </Text>
                      <Text style={styles.forfeitModeHelp}>
                        DUPR convention. Match removed from standings.
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}

              <View style={styles.forfeitActions}>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setForfeitOpen(false);
                    setForfeitTeam(null);
                    setForfeitMode(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onPress={confirmForfeit}
                  disabled={forfeitTeam === null || forfeitMode === null}
                  loading={busy}
                >
                  Confirm forfeit
                </Button>
              </View>
            </Card>
          ) : (
            <View style={styles.lowerActions}>
              <Button variant="ghost" onPress={onForfeitTapped} disabled={busy}>
                Forfeit
              </Button>
              {showResetButton && (
                <Button variant="destructive" onPress={onReset} disabled={busy}>
                  Reset score
                </Button>
              )}
            </View>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

// ----------------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------------

async function persistScoreEntry(args: {
  match: Match;
  games: { n: number; a: number; b: number }[];
  winnerTeamId: string;
  forfeit: boolean;
  defaultScore?: boolean;
  statusOverride?: MatchStatus;
}): Promise<string | null> {
  const { match, games, winnerTeamId, forfeit, defaultScore, statusOverride } = args;
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data.user?.id ?? null;

  const payload: Record<string, unknown> = {
    games: games.map((g) => ({ n: g.n, a: g.a, b: g.b })),
    winner_team_id: winnerTeamId,
    forfeit,
  };
  if (defaultScore) payload.default_score = true;

  const evtRes = await supabase.from('score_events').insert({
    match_id: match.id,
    entered_by: userId,
    payload,
  });
  if (evtRes.error) return evtRes.error.message;

  const delGames = await supabase.from('match_games').delete().eq('match_id', match.id);
  if (delGames.error) return delGames.error.message;

  const rows = games.map((g) => ({
    match_id: match.id,
    game_number: g.n,
    score_a: g.a,
    score_b: g.b,
  }));
  if (rows.length > 0) {
    const insGames = await supabase.from('match_games').insert(rows);
    if (insGames.error) return insGames.error.message;
  }

  const newStatus: MatchStatus = statusOverride ?? 'reported';
  const upd = await supabase
    .from('matches')
    .update({
      winner_team_id: winnerTeamId,
      status: newStatus,
      ended_at: new Date().toISOString(),
    })
    .eq('id', match.id);
  if (upd.error) return upd.error.message;
  return null;
}

async function persistVoid(args: { match: Match }): Promise<string | null> {
  const { match } = args;
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data.user?.id ?? null;

  const evtRes = await supabase.from('score_events').insert({
    match_id: match.id,
    entered_by: userId,
    payload: { forfeit: true, voided: true },
  });
  if (evtRes.error) return evtRes.error.message;

  // Clear any existing match_games (e.g. if re-scoring as void).
  const delGames = await supabase.from('match_games').delete().eq('match_id', match.id);
  if (delGames.error) return delGames.error.message;

  const upd = await supabase
    .from('matches')
    .update({
      winner_team_id: null,
      status: 'voided',
      ended_at: new Date().toISOString(),
    })
    .eq('id', match.id);
  if (upd.error) return upd.error.message;
  return null;
}

// ----------------------------------------------------------------------------
// Bracket propagation
// ----------------------------------------------------------------------------

// Walks next_match_id chain. If the immediate downstream slot is empty, fills
// it with newWinnerId. If the downstream match was already reported with the
// previous winner of THIS match, cascade-revert it (with admin confirm).
// Returns 'CANCELLED' if admin declined, an error string on failure, or null
// on success / no-op.
async function propagateOrCascade(
  match: Match,
  newWinnerId: string,
): Promise<string | null | 'CANCELLED'> {
  if (!match.next_match_id || !match.next_match_slot) return null;

  // Fetch downstream.
  const dnRes = await supabase
    .from('matches')
    .select(
      'id, division_id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id, next_match_id, next_match_slot',
    )
    .eq('id', match.next_match_id)
    .maybeSingle();
  if (dnRes.error) return dnRes.error.message;
  const dn = dnRes.data as Match | null;
  if (!dn) return null;

  const slotCol = match.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';
  const currentSlot = match.next_match_slot === 'a' ? dn.team_a_id : dn.team_b_id;

  if (currentSlot === null) {
    // First-time set — just write.
    const upd = await supabase
      .from('matches')
      .update({ [slotCol]: newWinnerId })
      .eq('id', dn.id);
    if (upd.error) return upd.error.message;
    return null;
  }

  if (currentSlot === newWinnerId) {
    // No-op: same team still advancing.
    return null;
  }

  // Slot was previously filled with a different team. This is a re-score.
  // If the downstream match is already reported, we need admin confirmation
  // to void it. Otherwise we can silently rewrite the slot.
  if (dn.status === 'reported' || dn.status === 'forfeit') {
    const confirmed = await confirmAsync(
      'Downstream match has a score',
      `The next bracket match already has a result with the old winner. Resetting this score will void that downstream match (and any further matches that depended on it). Continue?`,
      { confirmLabel: 'Void downstream', destructive: true },
    );
    if (!confirmed) return 'CANCELLED';
    // Void downstream + cascade.
    const voidErr = await persistVoid({ match: dn });
    if (voidErr) return voidErr;
    // Now clear downstream's slot to the NEW winner, since after the
    // cascade voids it, the slot will hold the new winner if/when the
    // admin re-scores. Actually: persistVoid clears winner_team_id but
    // leaves team_a_id / team_b_id. Set the slot to newWinner so the
    // admin can re-enter scores cleanly.
    const upd2 = await supabase
      .from('matches')
      .update({ [slotCol]: newWinnerId })
      .eq('id', dn.id);
    if (upd2.error) return upd2.error.message;
    // Cascade further down.
    const further = await cascadeVoidDownstream(dn, 1);
    if (further === 'CANCELLED') return 'CANCELLED';
    if (further) return further;
    return null;
  }

  // Downstream not yet reported: silently rewrite the slot.
  const upd = await supabase
    .from('matches')
    .update({ [slotCol]: newWinnerId })
    .eq('id', dn.id);
  if (upd.error) return upd.error.message;
  return null;
}

// Cascade-revert when admin RESETS a reported match. Walks downstream and
// voids/clears each, with confirmation for already-reported downstream.
async function cascadeRevertOnReset(
  match: Match,
  depth: number = 0,
): Promise<string | null | 'CANCELLED'> {
  if (depth > CASCADE_MAX_DEPTH) {
    notifyAlert(
      'Cascade depth exceeded',
      `Refusing to walk more than ${CASCADE_MAX_DEPTH} levels of downstream matches. Check for a cycle.`,
    );
    return 'CANCELLED';
  }
  if (!match.next_match_id || !match.next_match_slot) return null;

  const dnRes = await supabase
    .from('matches')
    .select(
      'id, division_id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id, next_match_id, next_match_slot',
    )
    .eq('id', match.next_match_id)
    .maybeSingle();
  if (dnRes.error) return dnRes.error.message;
  const dn = dnRes.data as Match | null;
  if (!dn) return null;

  const slotCol = match.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';
  const currentSlot = match.next_match_slot === 'a' ? dn.team_a_id : dn.team_b_id;

  // If downstream slot was never filled with our winner, nothing to do.
  if (currentSlot === null) return null;

  if (dn.status === 'reported' || dn.status === 'forfeit') {
    const confirmed = await confirmAsync(
      'Downstream match has a score',
      `Match further down the bracket is already reported. Resetting this match will void it. Continue?`,
      { confirmLabel: 'Void downstream', destructive: true },
    );
    if (!confirmed) return 'CANCELLED';

    const voidErr = await persistVoid({ match: dn });
    if (voidErr) return voidErr;
    // Clear the slot we filled.
    const upd = await supabase
      .from('matches')
      .update({ [slotCol]: null })
      .eq('id', dn.id);
    if (upd.error) return upd.error.message;

    const further = await cascadeRevertOnReset(dn, depth + 1);
    if (further === 'CANCELLED') return 'CANCELLED';
    if (further) return further;
    return null;
  }

  // Downstream not reported: just null out the slot.
  const upd = await supabase
    .from('matches')
    .update({ [slotCol]: null })
    .eq('id', dn.id);
  if (upd.error) return upd.error.message;
  return null;
}

// Cascade-void: when a match is voided, downstream loses its winner-slot too.
async function cascadeVoidDownstream(
  match: Match,
  depth: number = 0,
): Promise<string | null | 'CANCELLED'> {
  if (depth > CASCADE_MAX_DEPTH) {
    notifyAlert(
      'Cascade depth exceeded',
      `Refusing to walk more than ${CASCADE_MAX_DEPTH} levels of downstream matches. Check for a cycle.`,
    );
    return 'CANCELLED';
  }
  if (!match.next_match_id || !match.next_match_slot) return null;

  const dnRes = await supabase
    .from('matches')
    .select(
      'id, division_id, stage, pool_id, round_number, bracket_round, bracket_slot, team_a_id, team_b_id, court_id, status, winner_team_id, next_match_id, next_match_slot',
    )
    .eq('id', match.next_match_id)
    .maybeSingle();
  if (dnRes.error) return dnRes.error.message;
  const dn = dnRes.data as Match | null;
  if (!dn) return null;

  const slotCol = match.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';

  if (dn.status === 'reported' || dn.status === 'forfeit') {
    const confirmed = await confirmAsync(
      'Downstream match has a score',
      `A further match downstream is already reported. Voiding this one will void it too. Continue?`,
      { confirmLabel: 'Void downstream', destructive: true },
    );
    if (!confirmed) return 'CANCELLED';

    const voidErr = await persistVoid({ match: dn });
    if (voidErr) return voidErr;
    const upd = await supabase
      .from('matches')
      .update({ [slotCol]: null })
      .eq('id', dn.id);
    if (upd.error) return upd.error.message;

    const further = await cascadeVoidDownstream(dn, depth + 1);
    if (further === 'CANCELLED') return 'CANCELLED';
    if (further) return further;
    return null;
  }

  // Not reported: just clear the slot.
  const upd = await supabase
    .from('matches')
    .update({ [slotCol]: null })
    .eq('id', dn.id);
  if (upd.error) return upd.error.message;
  return null;
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  headerBlock: { gap: spacing.sm },
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
  titleVs: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  meta: { fontSize: fontSize.base, color: colors.textMuted },
  metaSubtle: { fontSize: fontSize.sm, color: colors.textSubtle },
  waitingTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
    marginBottom: spacing.sm,
  },
  waitingBody: { fontSize: fontSize.base, color: colors.textMuted },
  gamesBlock: { gap: spacing.lg },
  gameRow: { gap: spacing.sm },
  gameLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  scoreInputs: { flexDirection: 'row', gap: spacing.md },
  scoreInput: { flex: 1 },
  saveBtn: { marginTop: spacing.lg },
  lowerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  forfeitTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
    marginBottom: spacing.md,
  },
  forfeitStep: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  forfeitRow: { flexDirection: 'row', gap: spacing.sm },
  forfeitModeCol: { gap: spacing.sm },
  forfeitChoice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  forfeitModeChoice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    gap: spacing.xs,
  },
  forfeitChoiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  forfeitChoiceHover: {
    borderColor: colors.borderStrong,
  },
  forfeitChoicePressed: {
    opacity: 0.95,
  },
  forfeitChoiceText: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  forfeitChoiceTextActive: {
    color: colors.primarySoftText,
  },
  forfeitModeHelp: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.regular as TextStyle['fontWeight'],
  },
  forfeitActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
