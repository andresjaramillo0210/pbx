import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../../../../../../src/components/Button';
import ErrorBanner from '../../../../../../../../src/components/ErrorBanner';
import Input from '../../../../../../../../src/components/Input';
import ScreenContainer from '../../../../../../../../src/components/ScreenContainer';
import { notifyAlert, notifyConfirm } from '../../../../../../../../src/lib/notify';
import { supabase } from '../../../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../../../../../../../src/theme';

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';

type PlayerRow = { id: string; full_name: string };

// Canonical team name derivation: singles → just the one name; doubles/mixed →
// alphabetically sorted, slash-separated. See memory:project_pbxscape_team_naming.
function canonicalTeamName(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return names.slice().sort((a, b) => a.localeCompare(b)).join(' / ');
}

export default function EditTeam() {
  const { id, divisionId, teamId } = useLocalSearchParams<{
    id: string;
    divisionId: string;
    teamId: string;
  }>();
  const router = useRouter();

  const [divisionType, setDivisionType] = useState<DivisionType | null>(null);
  const [divisionStatus, setDivisionStatus] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string>('');
  const [withdrawnAt, setWithdrawnAt] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tournamentMismatch, setTournamentMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!divisionId || !teamId) return;
    let cancelled = false;
    (async () => {
      const dRes = await supabase
        .from('divisions')
        .select('type, tournament_id, status')
        .eq('id', divisionId)
        .maybeSingle();
      if (cancelled) return;
      if (dRes.error) {
        setLoadError(dRes.error.message);
        setLoading(false);
        return;
      }
      const drow = dRes.data as { type: DivisionType; tournament_id: string; status: string } | null;
      if (!drow) {
        setLoadError('Division not found.');
        setLoading(false);
        return;
      }
      if (drow.tournament_id !== id) {
        setTournamentMismatch(true);
        setLoadError('Division does not belong to this tournament. Navigate back and retry.');
        setLoading(false);
        return;
      }
      setDivisionType(drow.type);
      setDivisionStatus(drow.status);

      const tRes = await supabase
        .from('teams')
        .select('id, name, division_id, withdrawn_at')
        .eq('id', teamId)
        .maybeSingle();
      if (cancelled) return;
      if (tRes.error) {
        setLoadError(tRes.error.message);
        setLoading(false);
        return;
      }
      const trow = tRes.data as { id: string; name: string; division_id: string; withdrawn_at: string | null } | null;
      if (!trow) {
        setLoadError('Team not found.');
        setLoading(false);
        return;
      }
      if (trow.division_id !== divisionId) {
        setLoadError('Team does not belong to this division.');
        setLoading(false);
        return;
      }
      setTeamName(trow.name);
      setWithdrawnAt(trow.withdrawn_at);

      // Load players through team_players join.
      const tpRes = await supabase
        .from('team_players')
        .select('player_id, players:player_id (id, full_name)')
        .eq('team_id', teamId);
      if (cancelled) return;
      if (tpRes.error) {
        setLoadError(tpRes.error.message);
        setLoading(false);
        return;
      }
      const rows = (tpRes.data as unknown as {
        player_id: string;
        players: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
      }[] | null) ?? [];
      const playerList: PlayerRow[] = rows
        .map((r) => {
          const p = Array.isArray(r.players) ? r.players[0] : r.players;
          return p ? { id: p.id, full_name: p.full_name } : null;
        })
        .filter((p): p is PlayerRow => p !== null);

      // Stable order: alphabetical by full_name, so player 1 / player 2 inputs
      // line up with the canonical team name's ordering for doubles.
      playerList.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setPlayers(playerList);
      setPlayer1(playerList[0]?.full_name ?? '');
      setPlayer2(playerList[1]?.full_name ?? '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [divisionId, id, teamId]);

  const needsTwoPlayers = divisionType === 'doubles' || divisionType === 'mixed_doubles';

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);

    if (tournamentMismatch) {
      busyRef.current = false;
      setBusy(false);
      notifyAlert('Cannot save team', 'Division does not belong to this tournament. Navigate back and retry.');
      return;
    }
    if (!id || !divisionId || !teamId || !divisionType) {
      busyRef.current = false;
      setBusy(false);
      return;
    }

    const p1 = player1.trim();
    if (p1.length === 0) {
      busyRef.current = false;
      setBusy(false);
      notifyAlert('Player name required', 'Enter at least one player name.');
      return;
    }
    const p2 = player2.trim();
    if (needsTwoPlayers && p2.length === 0) {
      busyRef.current = false;
      setBusy(false);
      notifyAlert('Second player required', 'This division requires two players per team.');
      return;
    }

    const newNames = needsTwoPlayers ? [p1, p2] : [p1];

    // We expect existing players to match by index (player1 → players[0], etc).
    // If a row is missing (data drift) we skip its update; the team name save
    // still proceeds. Sequential awaits keep the error reporting simple.
    for (let i = 0; i < newNames.length; i++) {
      const player = players[i];
      const newName = newNames[i];
      if (!player) continue;
      if (player.full_name === newName) continue;
      const { error: pErr } = await supabase
        .from('players')
        .update({ full_name: newName })
        .eq('id', player.id);
      if (pErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not update player: ${pErr.message}`);
        notifyAlert('Could not update player', pErr.message);
        return;
      }
    }

    const newTeamName = canonicalTeamName(newNames);
    if (newTeamName !== teamName) {
      const { error: tErr } = await supabase
        .from('teams')
        .update({ name: newTeamName })
        .eq('id', teamId);
      if (tErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not update team: ${tErr.message}`);
        notifyAlert('Could not update team', tErr.message);
        return;
      }
    }

    busyRef.current = false;
    setBusy(false);
    router.back();
  }

  // Walk the next_match_id chain from a freshly-voided match. For each
  // downstream match we previously fed into, clear the slot we filled (if it
  // still holds this team) and void the downstream match too if it had
  // advanced based on this slot. Capped at 10 levels to avoid runaway loops.
  async function cascadeClearAdvancement(
    matchId: string,
    teamId: string,
  ): Promise<string | null> {
    let cursorId: string | null = matchId;
    let safetyDepth = 0;
    while (cursorId && safetyDepth < 10) {
      safetyDepth += 1;
      const { data: cur, error: curErr } = await supabase
        .from('matches')
        .select('id, next_match_id, next_match_slot')
        .eq('id', cursorId)
        .maybeSingle();
      if (curErr) return curErr.message;
      if (!cur) return null;
      const nextId = (cur as { next_match_id: string | null }).next_match_id;
      const nextSlot = (cur as { next_match_slot: 'a' | 'b' | null }).next_match_slot;
      if (!nextId || !nextSlot) return null;

      const { data: next, error: nextErr } = await supabase
        .from('matches')
        .select('id, team_a_id, team_b_id, status')
        .eq('id', nextId)
        .maybeSingle();
      if (nextErr) return nextErr.message;
      if (!next) return null;
      const nrow = next as {
        id: string;
        team_a_id: string | null;
        team_b_id: string | null;
        status: 'pending' | 'scheduled' | 'in_progress' | 'reported' | 'voided' | 'forfeit';
      };
      const slotField = nextSlot === 'a' ? 'team_a_id' : 'team_b_id';
      const slotValue = nextSlot === 'a' ? nrow.team_a_id : nrow.team_b_id;
      if (slotValue !== teamId) {
        // Slot was already filled by someone else (e.g. opponent advanced
        // because this team forfeited). Nothing to clear.
        return null;
      }
      // Clear the slot first.
      const { error: clearErr } = await supabase
        .from('matches')
        .update({ [slotField]: null })
        .eq('id', nrow.id);
      if (clearErr) return clearErr.message;

      // If this downstream match was already future-state, void it too and
      // keep walking. Prior reported/forfeit results are preserved per spec.
      if (nrow.status === 'pending' || nrow.status === 'scheduled' || nrow.status === 'in_progress') {
        const { error: voidErr } = await supabase
          .from('matches')
          .update({ status: 'voided' })
          .eq('id', nrow.id);
        if (voidErr) return voidErr.message;
        cursorId = nrow.id;
      } else {
        // Reported or forfeit — stop here. We've already cleared the slot
        // pointer but we don't void a played match.
        return null;
      }
    }
    return null;
  }

  async function performDrop() {
    if (busyRef.current) return;
    if (!teamId || !divisionId) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);

    const isOpen = divisionStatus === 'open';

    if (isOpen) {
      // Hard-delete path: gather player ids first, drop links, drop team,
      // then prune orphan players (those with no remaining team_players rows).
      const playerIds = players.map((p) => p.id);

      const { error: tpErr } = await supabase
        .from('team_players')
        .delete()
        .eq('team_id', teamId);
      if (tpErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not delete team links: ${tpErr.message}`);
        notifyAlert('Drop failed', tpErr.message);
        return;
      }

      const { error: tErr } = await supabase.from('teams').delete().eq('id', teamId);
      if (tErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not delete team: ${tErr.message}`);
        notifyAlert('Drop failed', tErr.message);
        return;
      }

      if (playerIds.length > 0) {
        const { data: stillLinked, error: linkErr } = await supabase
          .from('team_players')
          .select('player_id')
          .in('player_id', playerIds);
        if (linkErr) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not check player references: ${linkErr.message}`);
          notifyAlert('Cleanup failed', linkErr.message);
          return;
        }
        const linkedSet = new Set(
          ((stillLinked as { player_id: string }[] | null) ?? []).map((r) => r.player_id),
        );
        const orphanIds = playerIds.filter((pid) => !linkedSet.has(pid));
        if (orphanIds.length > 0) {
          const { error: pdErr } = await supabase.from('players').delete().in('id', orphanIds);
          if (pdErr) {
            // Non-fatal — the team is gone, the orphan players are just dead
            // weight. Surface the message so admins can clean up if needed.
            setSubmitError(`Team removed, but couldn't delete orphan players: ${pdErr.message}`);
            notifyAlert('Cleanup warning', pdErr.message);
          }
        }
      }

      busyRef.current = false;
      setBusy(false);
      router.back();
      return;
    }

    // Locked or later — soft-delete and process future matches.
    const { error: wErr } = await supabase
      .from('teams')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('id', teamId);
    if (wErr) {
      busyRef.current = false;
      setBusy(false);
      setSubmitError(`Could not withdraw team: ${wErr.message}`);
      notifyAlert('Withdraw failed', wErr.message);
      return;
    }

    // Need game_to for default-score forfeits below.
    const { data: divRow, error: divErr } = await supabase
      .from('divisions')
      .select('game_to')
      .eq('id', divisionId)
      .maybeSingle();
    if (divErr) {
      busyRef.current = false;
      setBusy(false);
      setSubmitError(`Could not load division rules: ${divErr.message}`);
      notifyAlert('Withdraw partial', divErr.message);
      return;
    }
    const gameTo = (divRow as { game_to: number } | null)?.game_to ?? 11;

    // Audit row author for forfeit score_events below.
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id ?? null;

    // Find every future match this team is in. We need `stage` to decide
    // between bracket-auto-advance vs. plain void (pool / round-robin).
    const { data: futureMatches, error: mErr } = await supabase
      .from('matches')
      .select('id, stage, team_a_id, team_b_id, status, next_match_id, next_match_slot')
      .eq('division_id', divisionId)
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .in('status', ['pending', 'scheduled', 'in_progress']);
    if (mErr) {
      busyRef.current = false;
      setBusy(false);
      setSubmitError(`Could not load matches: ${mErr.message}`);
      notifyAlert('Withdraw partial', `Team marked withdrawn, but matches couldn't be voided: ${mErr.message}`);
      return;
    }

    type FutureMatch = {
      id: string;
      stage: 'round_robin' | 'pool' | 'bracket';
      team_a_id: string | null;
      team_b_id: string | null;
      status: string;
      next_match_id: string | null;
      next_match_slot: 'a' | 'b' | null;
    };
    const futureList = (futureMatches as FutureMatch[] | null) ?? [];

    for (const m of futureList) {
      const bothSet = !!m.team_a_id && !!m.team_b_id;
      const survivorId =
        m.team_a_id && m.team_a_id !== teamId
          ? m.team_a_id
          : m.team_b_id && m.team_b_id !== teamId
            ? m.team_b_id
            : null;

      // Single-elim / bracket with BOTH opponents set: forfeit-advance the
      // surviving opponent so the bracket doesn't get stuck. Pool / RR keep
      // their existing void semantics (they don't auto-advance anyone).
      if (m.stage === 'bracket' && bothSet && survivorId) {
        // 1. Default score game row: survivor reaches game_to, withdrawn team 0.
        const survivorIsA = survivorId === m.team_a_id;
        const score_a = survivorIsA ? gameTo : 0;
        const score_b = survivorIsA ? 0 : gameTo;

        // Clear any existing match_games (defensive — in_progress matches
        // could have partial games entered).
        const delGames = await supabase
          .from('match_games')
          .delete()
          .eq('match_id', m.id);
        if (delGames.error) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not clear match games: ${delGames.error.message}`);
          notifyAlert('Withdraw partial', delGames.error.message);
          return;
        }

        const insGame = await supabase.from('match_games').insert({
          match_id: m.id,
          game_number: 1,
          score_a,
          score_b,
        });
        if (insGame.error) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not insert default-score game: ${insGame.error.message}`);
          notifyAlert('Withdraw partial', insGame.error.message);
          return;
        }

        // 2. Audit event: forfeit + default_score, with the withdrawn team id.
        const evtIns = await supabase.from('score_events').insert({
          match_id: m.id,
          entered_by: userId,
          payload: {
            games: [{ n: 1, a: score_a, b: score_b }],
            winner_team_id: survivorId,
            forfeit: true,
            default_score: true,
            reason: 'team_withdrawn',
            withdrawn_team_id: teamId,
          },
        });
        if (evtIns.error) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not record forfeit event: ${evtIns.error.message}`);
          notifyAlert('Withdraw partial', evtIns.error.message);
          return;
        }

        // 3. Mark the match `forfeit` with the survivor as winner.
        const { error: fErr } = await supabase
          .from('matches')
          .update({
            status: 'forfeit',
            winner_team_id: survivorId,
            ended_at: new Date().toISOString(),
          })
          .eq('id', m.id);
        if (fErr) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not mark match forfeit: ${fErr.message}`);
          notifyAlert('Withdraw partial', fErr.message);
          return;
        }

        // 4. Advance the survivor downstream. Mirrors propagateOrCascade's
        //    first-fill branch: if the parent slot is null OR already holds
        //    the withdrawn team (placeholder from a prior round they had
        //    won), set it to the survivor.
        if (m.next_match_id && m.next_match_slot) {
          const dnRes = await supabase
            .from('matches')
            .select('id, team_a_id, team_b_id, status')
            .eq('id', m.next_match_id)
            .maybeSingle();
          if (dnRes.error) {
            busyRef.current = false;
            setBusy(false);
            setSubmitError(`Could not load downstream match: ${dnRes.error.message}`);
            notifyAlert('Withdraw partial', dnRes.error.message);
            return;
          }
          const dn = dnRes.data as {
            id: string;
            team_a_id: string | null;
            team_b_id: string | null;
            status: string;
          } | null;
          if (dn) {
            const slotCol = m.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';
            const currentSlot =
              m.next_match_slot === 'a' ? dn.team_a_id : dn.team_b_id;
            // Fill if empty OR if the slot is already the withdrawn team
            // (they had advanced via a prior round). The survivor takes
            // their place either way.
            if (currentSlot === null || currentSlot === teamId) {
              const { error: updDnErr } = await supabase
                .from('matches')
                .update({ [slotCol]: survivorId })
                .eq('id', dn.id);
              if (updDnErr) {
                busyRef.current = false;
                setBusy(false);
                setSubmitError(`Could not advance survivor: ${updDnErr.message}`);
                notifyAlert('Withdraw partial', updDnErr.message);
                return;
              }
            }
            // If currentSlot holds some OTHER team, the downstream match
            // already advanced from a different source — leave it alone.
          }
        }
        continue;
      }

      // Bracket match with only ONE slot set (the other side awaiting an
      // upstream winner): void this match but write the present team into
      // the downstream slot so the bracket isn't broken.
      if (m.stage === 'bracket' && !bothSet) {
        const presentId =
          m.team_a_id && m.team_a_id !== teamId
            ? m.team_a_id
            : m.team_b_id && m.team_b_id !== teamId
              ? m.team_b_id
              : null;

        const { error: vErr } = await supabase
          .from('matches')
          .update({ status: 'voided' })
          .eq('id', m.id);
        if (vErr) {
          busyRef.current = false;
          setBusy(false);
          setSubmitError(`Could not void match: ${vErr.message}`);
          notifyAlert('Withdraw partial', vErr.message);
          return;
        }

        if (presentId && m.next_match_id && m.next_match_slot) {
          const dnRes = await supabase
            .from('matches')
            .select('id, team_a_id, team_b_id')
            .eq('id', m.next_match_id)
            .maybeSingle();
          if (dnRes.error) {
            busyRef.current = false;
            setBusy(false);
            setSubmitError(`Could not load downstream match: ${dnRes.error.message}`);
            notifyAlert('Withdraw partial', dnRes.error.message);
            return;
          }
          const dn = dnRes.data as {
            id: string;
            team_a_id: string | null;
            team_b_id: string | null;
          } | null;
          if (dn) {
            const slotCol = m.next_match_slot === 'a' ? 'team_a_id' : 'team_b_id';
            const currentSlot =
              m.next_match_slot === 'a' ? dn.team_a_id : dn.team_b_id;
            if (currentSlot === null || currentSlot === teamId) {
              const { error: updDnErr } = await supabase
                .from('matches')
                .update({ [slotCol]: presentId })
                .eq('id', dn.id);
              if (updDnErr) {
                busyRef.current = false;
                setBusy(false);
                setSubmitError(`Could not promote present team: ${updDnErr.message}`);
                notifyAlert('Withdraw partial', updDnErr.message);
                return;
              }
            }
          }
        }
        continue;
      }

      // Pool / round-robin: keep the original void-only behavior — these
      // formats don't have an "advance the survivor" concept. The voided
      // match is excluded from standings; promotion (if pool_to_bracket)
      // now treats voided as terminal so play moves on.
      const { error: vErr } = await supabase
        .from('matches')
        .update({ status: 'voided' })
        .eq('id', m.id);
      if (vErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not void match: ${vErr.message}`);
        notifyAlert('Withdraw partial', vErr.message);
        return;
      }
      const cascadeErr = await cascadeClearAdvancement(m.id, teamId);
      if (cascadeErr) {
        busyRef.current = false;
        setBusy(false);
        setSubmitError(`Could not cascade-void downstream matches: ${cascadeErr}`);
        notifyAlert('Withdraw partial', cascadeErr);
        return;
      }
    }

    busyRef.current = false;
    setBusy(false);
    router.back();
  }

  function confirmDrop() {
    if (!teamName) return;
    const isOpen = divisionStatus === 'open';
    if (isOpen) {
      notifyConfirm(
        `Drop team ${teamName}?`,
        'This permanently removes the team and its players. Cannot be undone.',
        () => {
          void performDrop();
        },
        { confirmLabel: 'Drop', destructive: true },
      );
    } else {
      notifyConfirm(
        `Withdraw team ${teamName}?`,
        'Future matches involving them will be voided. Prior results stay.',
        () => {
          void performDrop();
        },
        { confirmLabel: 'Withdraw', destructive: true },
      );
    }
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
        <View style={styles.center}>
          <ErrorBanner error={loadError} onDismiss={() => setLoadError(null)} />
          {!loadError && <Text>Team not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }
  if (!divisionType) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text>Division not found.</Text></View>
      </ScreenContainer>
    );
  }

  const isOpen = divisionStatus === 'open';
  const dropLabel = isOpen ? 'Drop team' : 'Withdraw team';
  const subtitle = needsTwoPlayers
    ? 'Doubles team — edit either player.'
    : 'Singles entry — edit the player name.';

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <ErrorBanner error={submitError} onDismiss={() => setSubmitError(null)} />

      <View style={styles.heading}>
        <Text style={styles.title}>Edit team</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {withdrawnAt && (
          <Text style={styles.withdrawnNote}>
            This team is already withdrawn. Editing names will still update the
            displayed team name but won&apos;t un-void any matches.
          </Text>
        )}
      </View>

      <View style={styles.form}>
        <Input
          label={needsTwoPlayers ? 'Player 1' : 'Player name'}
          value={player1}
          onChangeText={setPlayer1}
          placeholder="Alex Smith"
          autoCapitalize="words"
          autoCorrect={false}
        />

        {needsTwoPlayers && (
          <Input
            label="Player 2"
            value={player2}
            onChangeText={setPlayer2}
            placeholder="Sam Jones"
            autoCapitalize="words"
            autoCorrect={false}
          />
        )}
      </View>

      <Button onPress={submit} loading={busy} size="lg" style={styles.submit}>
        Save changes
      </Button>

      {!withdrawnAt && (
        <View style={styles.dropZone}>
          <Text style={styles.dropHint}>
            {isOpen
              ? 'Drop removes the team and its players. Available while registration is open.'
              : 'Withdraw soft-deletes the team. Future matches get voided; prior results stay (USAPA convention).'}
          </Text>
          <Button
            variant="destructive"
            size="md"
            onPress={confirmDrop}
            disabled={busy}
          >
            {dropLabel}
          </Button>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  heading: { gap: spacing.xs },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted },
  withdrawnNote: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  form: { gap: spacing.md },
  submit: { marginTop: spacing.md },
  dropZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  dropHint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
