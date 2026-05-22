import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import Button from '../../../../../../../src/components/Button';
import Card from '../../../../../../../src/components/Card';
import ErrorBanner from '../../../../../../../src/components/ErrorBanner';
import Input from '../../../../../../../src/components/Input';
import ScreenContainer from '../../../../../../../src/components/ScreenContainer';
import { notifyAlert } from '../../../../../../../src/lib/notify';
import { supabase } from '../../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../../../src/theme';

// Bulk-add team form. Same logic as step 3 of the division-creation wizard:
// "Save & add another" stays on the form and accumulates a chip row;
// "Save & done" returns to the division detail. No wizard chrome here — this
// is the standalone path used from the "Add team" button on division detail.

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';

type AddedTeam = { id: string; name: string; playerIds: string[] };

// Normalize whitespace inside a player name: collapse runs of whitespace to a
// single space and trim ends.
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// Canonical team name: doubles is alphabetically-sorted "P1 / P2"; singles is
// the single player name.
function canonicalTeamName(names: string[]): string {
  if (names.length === 1) return names[0];
  return names.slice().sort((a, b) => a.localeCompare(b)).join(' / ');
}

export default function NewTeam() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const router = useRouter();

  const [divisionType, setDivisionType] = useState<DivisionType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tournamentMismatch, setTournamentMismatch] = useState(false);

  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [addedTeams, setAddedTeams] = useState<AddedTeam[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [removingTeamId, setRemovingTeamId] = useState<string | null>(null);
  const removingRef = useRef(false);

  const player1Ref = useRef<TextInput>(null);
  const player2Ref = useRef<TextInput>(null);

  useEffect(() => {
    if (!divisionId) return;
    (async () => {
      const { data, error } = await supabase
        .from('divisions')
        .select('type, tournament_id')
        .eq('id', divisionId)
        .maybeSingle();
      if (error) {
        setLoadError(error.message);
      } else if (!data) {
        setLoadError('Division not found.');
      } else {
        const row = data as { type: DivisionType; tournament_id: string };
        if (row.tournament_id !== id) {
          setTournamentMismatch(true);
          setLoadError('Division does not belong to this tournament. Navigate back and retry.');
        } else {
          setDivisionType(row.type ?? null);
        }
      }
      setLoading(false);
    })();
  }, [divisionId, id]);

  const needsTwoPlayers = divisionType === 'doubles' || divisionType === 'mixed_doubles';

  async function persistCurrentTeam(): Promise<boolean> {
    if (tournamentMismatch) {
      const msg = 'Division does not belong to this tournament. Navigate back and retry.';
      setErrorMsg(msg);
      notifyAlert('Cannot create team', msg);
      return false;
    }
    if (!id || !divisionId || !divisionType) return false;

    const p1 = normalizeName(player1);
    const p2 = normalizeName(player2);

    if (p1.length === 0) {
      const msg = 'Enter at least one player name.';
      setErrorMsg(msg);
      notifyAlert('Player name required', msg);
      return false;
    }
    if (needsTwoPlayers && p2.length === 0) {
      const msg = 'This division requires two players per team.';
      setErrorMsg(msg);
      notifyAlert('Second player required', msg);
      return false;
    }

    const playerNames = needsTwoPlayers ? [p1, p2] : [p1];
    const teamName = canonicalTeamName(playerNames);

    // Client-side dedupe: catch the typo case BEFORE the DB unique index
    // produces a cryptic error.
    const candidate = teamName.toLocaleLowerCase().trim();
    const dup = addedTeams.some((t) => t.name.toLocaleLowerCase().trim() === candidate);
    if (dup) {
      const msg = 'Team already added.';
      setErrorMsg(msg);
      notifyAlert('Duplicate team', msg);
      return false;
    }

    const playerRows = playerNames.map((full_name) => ({ tournament_id: id, full_name }));
    const { data: playerData, error: playerErr } = await supabase
      .from('players')
      .insert(playerRows)
      .select('id');
    if (playerErr || !playerData) {
      const m = playerErr?.message ?? 'Unknown error';
      setErrorMsg(`Could not create player: ${m}`);
      notifyAlert('Could not create player', m);
      return false;
    }
    const insertedPlayerIds = (playerData as { id: string }[]).map((p) => p.id);

    const { data: teamRow, error: teamErr } = await supabase
      .from('teams')
      .insert({ division_id: divisionId, name: teamName })
      .select('id')
      .single();
    if (teamErr || !teamRow) {
      const m = teamErr?.message ?? 'Unknown error';
      // Team insert failed — clean up the just-inserted player rows so they
      // don't accumulate on retry.
      await supabase.from('players').delete().in('id', insertedPlayerIds);
      setErrorMsg(`Could not create team: ${m}`);
      notifyAlert('Could not create team', m);
      return false;
    }
    const teamId = (teamRow as { id: string }).id;

    const teamPlayerRows = insertedPlayerIds.map((pid) => ({ team_id: teamId, player_id: pid }));
    const { error: tpErr } = await supabase.from('team_players').insert(teamPlayerRows);
    if (tpErr) {
      // Link insert failed — roll back the team and the players.
      await supabase.from('teams').delete().eq('id', teamId);
      await supabase.from('players').delete().in('id', insertedPlayerIds);
      setErrorMsg(`Could not link player to team: ${tpErr.message}`);
      notifyAlert('Could not link player to team', tpErr.message);
      return false;
    }

    setAddedTeams((prev) => [...prev, { id: teamId, name: teamName, playerIds: insertedPlayerIds }]);
    setPlayer1('');
    setPlayer2('');
    return true;
  }

  async function saveAndAddAnother(): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    const ok = await persistCurrentTeam();
    busyRef.current = false;
    setBusy(false);
    if (ok) {
      // Keep the keyboard up; cursor back to Player 1.
      player1Ref.current?.focus();
    }
    return ok;
  }

  async function saveAndDone() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    const hasInput = player1.trim().length > 0 || player2.trim().length > 0;
    let ok = true;
    if (hasInput) {
      ok = await persistCurrentTeam();
    }
    busyRef.current = false;
    setBusy(false);
    if (ok) router.back();
  }

  async function removeAddedTeam(team: AddedTeam) {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemovingTeamId(team.id);
    const { error: err } = await supabase.from('teams').delete().eq('id', team.id);
    if (err) {
      removingRef.current = false;
      setRemovingTeamId(null);
      setErrorMsg(`Could not remove team: ${err.message}`);
      notifyAlert('Could not remove team', err.message);
      return;
    }
    if (team.playerIds.length > 0) {
      // Best-effort cleanup of the player rows we created with this team.
      await supabase.from('players').delete().in('id', team.playerIds);
    }
    removingRef.current = false;
    setRemovingTeamId(null);
    setAddedTeams((prev) => prev.filter((t) => t.id !== team.id));
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

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>Add teams</Text>
        <Text style={styles.subtitle}>
          {needsTwoPlayers
            ? 'Doubles team — enter both players for each team.'
            : 'Singles entry — enter the player for each team.'}
        </Text>
      </View>

      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />

      <Card>
        {addedTeams.length > 0 && (
          <View style={styles.addedSection}>
            <Text style={styles.addedHeader}>Added this session</Text>
            <View style={styles.chipRow}>
              {addedTeams.map((t) => {
                const removing = removingTeamId === t.id;
                return (
                  <View key={t.id} style={[styles.chip, removing && styles.chipDimmed]}>
                    <Text style={styles.chipText} numberOfLines={1}>{t.name}</Text>
                    <Pressable
                      onPress={() => removeAddedTeam(t)}
                      disabled={removing}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${t.name}`}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.chipClose,
                        (pressed || hovered) && styles.chipCloseHover,
                      ]}
                    >
                      <Feather name="x" size={14} color={colors.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.form}>
          <Input
            ref={player1Ref}
            label={needsTwoPlayers ? 'Player 1' : 'Player name'}
            value={player1}
            onChangeText={setPlayer1}
            placeholder="Alex Smith"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType={needsTwoPlayers ? 'next' : 'done'}
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (needsTwoPlayers) {
                player2Ref.current?.focus();
              } else {
                void saveAndAddAnother();
              }
            }}
          />
          {needsTwoPlayers && (
            <Input
              ref={player2Ref}
              label="Player 2"
              value={player2}
              onChangeText={setPlayer2}
              placeholder="Sam Jones"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                void saveAndAddAnother();
              }}
            />
          )}
        </View>
      </Card>

      <View style={styles.actions}>
        <Button onPress={() => { void saveAndAddAnother(); }} loading={busy} size="lg">
          Save & add another
        </Button>
        <Button variant="secondary" onPress={saveAndDone} disabled={busy}>
          Save & done
        </Button>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  heading: { gap: spacing.xs },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted },
  form: { gap: spacing.md },
  actions: { gap: spacing.sm },

  // Added-teams chip row
  addedSection: { gap: spacing.sm, marginBottom: spacing.md },
  addedHeader: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgMuted,
    maxWidth: 260,
  },
  chipDimmed: { opacity: 0.5 },
  chipText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    flexShrink: 1,
  },
  chipClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCloseHover: { backgroundColor: colors.border },
});
