import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import Button from '../../../../../src/components/Button';
import Card from '../../../../../src/components/Card';
import ErrorBanner from '../../../../../src/components/ErrorBanner';
import Input from '../../../../../src/components/Input';
import ScreenContainer from '../../../../../src/components/ScreenContainer';
import { notifyAlert, notifyConfirm } from '../../../../../src/lib/notify';
import { supabase } from '../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../src/theme';

// 3-step wizard for division creation.
// Step 1 (Settings) is held in component state only — no DB write yet, so an
// abandoned wizard never orphans a division row (and never blocks recreating
// the same division via the unique constraint).
// Step 2 (Courts) creates the division row + division_courts rows atomically
// at the end of the step. If court inserts fail after the division was
// created, we clean up the division row.
// Step 3 (Teams) lets the admin bulk-add teams; "Save & done" returns.
// Going back to a previous step keeps the existing division and just updates
// in place on the next "Next" press.

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';
type DivisionLevel = 'beginner' | 'intermediate' | 'advanced';
type DivisionGender = 'mens' | 'womens';

type Court = { id: string; name: string };

type AddedTeam = { id: string; name: string; playerIds: string[] };

type WizardStep = 1 | 2 | 3;

const TYPE_OPTIONS: { value: DivisionType; label: string }[] = [
  { value: 'singles', label: 'Singles' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'mixed_doubles', label: 'Mixed' },
];
const GENDER_OPTIONS: { value: DivisionGender; label: string }[] = [
  { value: 'mens', label: "Men's" },
  { value: 'womens', label: "Women's" },
];
const LEVEL_OPTIONS: { value: DivisionLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];
const BEST_OF_OPTIONS: { value: 1 | 3; label: string }[] = [
  { value: 1, label: 'Best of 1' },
  { value: 3, label: 'Best of 3' },
];

const STEP_TITLES: Record<WizardStep, string> = {
  1: 'Settings',
  2: 'Courts',
  3: 'Teams',
};

// How many players a team needs for a given division type.
function playersPerTeam(t: DivisionType): 1 | 2 {
  return t === 'singles' ? 1 : 2;
}

// Normalize whitespace inside a player name: collapse runs of whitespace to a
// single space and trim ends.
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// Canonical team name: doubles is alphabetically-sorted "P1 / P2"; singles is
// the single player name. Used for both insert and dedupe comparison.
function canonicalTeamName(names: string[]): string {
  if (names.length === 1) return names[0];
  return names.slice().sort((a, b) => a.localeCompare(b)).join(' / ');
}

export default function NewDivisionWizard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [step, setStep] = useState<WizardStep>(1);
  // Furthest step the admin has reached — controls whether step pills are
  // tappable for back-navigation.
  const [maxReached, setMaxReached] = useState<WizardStep>(1);

  // The id of the inserted division row (filled at end of step 2).
  const [divisionId, setDivisionId] = useState<string | null>(null);

  // Step 1 state
  const [type, setType] = useState<DivisionType>('doubles');
  const [gender, setGender] = useState<DivisionGender>('mens');
  const [level, setLevel] = useState<DivisionLevel>('intermediate');
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [gameTo, setGameTo] = useState('11');
  const [winBy, setWinBy] = useState('2');
  const [showPointsDetails, setShowPointsDetails] = useState(true);
  // The type that's actually been persisted to the DB (or last reached step 2
  // with). Used to detect singles<->doubles swaps that invalidate added teams.
  const [originalType, setOriginalType] = useState<DivisionType | null>(null);

  // Step 2 state
  const [allCourts, setAllCourts] = useState<Court[]>([]);
  const [courtsLoading, setCourtsLoading] = useState(false);
  const [courtsLoadError, setCourtsLoadError] = useState<string | null>(null);
  // Court ids the admin has picked. Not persisted until they hit Next.
  const [pickedCourtIds, setPickedCourtIds] = useState<Set<string>>(new Set());
  // Snapshot of court ids that were persisted on the last "Next" — used to
  // diff on subsequent saves when the user backs up and resubmits.
  const [persistedCourtIds, setPersistedCourtIds] = useState<Set<string>>(new Set());

  // Step 3 state — added teams (this session only). Useful for the chip row
  // and for letting the admin remove a mistyped team.
  const [addedTeams, setAddedTeams] = useState<AddedTeam[]>([]);
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [removingTeamId, setRemovingTeamId] = useState<string | null>(null);
  const removingRef = useRef(false);

  // Lazy-load the courts list when we reach step 2.
  useEffect(() => {
    if (step !== 2) return;
    if (allCourts.length > 0) return;
    let cancelled = false;
    setCourtsLoading(true);
    setCourtsLoadError(null);
    (async () => {
      const { data, error } = await supabase
        .from('courts')
        .select('id, name')
        .is('archived_at', null)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
      if (cancelled) return;
      if (error) {
        setCourtsLoadError(error.message);
        setCourtsLoading(false);
        return;
      }
      setAllCourts((data ?? []) as Court[]);
      setCourtsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [step, allCourts.length]);

  const needsTwoPlayers = type === 'doubles' || type === 'mixed_doubles';

  function goToStep(target: WizardStep) {
    // Tapping a pill: allow back-navigation only to a step already reached.
    if (target > maxReached) return;
    if (target === step) return;
    setErrorMsg(null);
    setStep(target);
  }

  // STEP 1: validate, then advance. No DB write — division is created at end
  // of step 2.
  async function submitStep1() {
    if (busyRef.current) return;
    if (!id) {
      notifyAlert('Missing tournament', 'Could not find tournament id in route.');
      return;
    }

    const gameToNum = parseInt(gameTo, 10);
    const winByNum = parseInt(winBy, 10);
    if (!Number.isFinite(gameToNum) || gameToNum < 1) {
      const msg = 'Enter a positive number (default 11).';
      setErrorMsg(msg);
      notifyAlert('Invalid game_to', msg);
      return;
    }
    if (!Number.isFinite(winByNum) || winByNum < 1) {
      const msg = 'Enter a positive number (default 2).';
      setErrorMsg(msg);
      notifyAlert('Invalid win_by', msg);
      return;
    }
    if (winByNum >= gameToNum) {
      const msg = 'Win by must be less than Game to.';
      setErrorMsg(msg);
      notifyAlert('Invalid scoring', msg);
      return;
    }

    // If the admin already advanced past step 1 once and is now changing the
    // type in a way that's incompatible with already-added teams, confirm
    // before we drop those teams.
    if (
      originalType &&
      addedTeams.length > 0 &&
      playersPerTeam(type) !== playersPerTeam(originalType)
    ) {
      const prevType = originalType; // snapshot for revert
      notifyConfirm(
        'Change division type?',
        'Changing type will require re-adding the existing teams. Continue?',
        () => {
          void confirmTypeChangeAndAdvance(prevType);
        },
        {
          confirmLabel: 'Continue',
          destructive: true,
          onCancel: () => {
            // Revert the type field back to what was last persisted.
            setType(prevType);
          },
        },
      );
      return;
    }

    setErrorMsg(null);
    setMaxReached((m) => (m < 2 ? 2 : m));
    setStep(2);
  }

  // Cascade-delete already-added teams (and their player rows) because the
  // admin confirmed a type swap, then advance to step 2.
  async function confirmTypeChangeAndAdvance(_prevType: DivisionType) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);

    const teamIds = addedTeams.map((t) => t.id);
    const playerIds = addedTeams.flatMap((t) => t.playerIds);

    if (teamIds.length > 0) {
      const { error: tErr } = await supabase.from('teams').delete().in('id', teamIds);
      if (tErr) {
        busyRef.current = false;
        setBusy(false);
        setErrorMsg(`Could not clear existing teams: ${tErr.message}`);
        notifyAlert('Could not clear existing teams', tErr.message);
        return;
      }
    }
    if (playerIds.length > 0) {
      // Best-effort — orphan players are harmless but we clean them up too.
      await supabase.from('players').delete().in('id', playerIds);
    }

    setAddedTeams([]);
    busyRef.current = false;
    setBusy(false);
    setMaxReached((m) => (m < 2 ? 2 : m));
    setStep(2);
  }

  // STEP 2: create the division (if not yet) and persist division_courts rows.
  async function submitStep2() {
    if (busyRef.current) return;
    if (!id) {
      notifyAlert('Missing tournament', 'Could not find tournament id in route.');
      return;
    }
    if (pickedCourtIds.size === 0) {
      const msg = 'Select at least one court.';
      setErrorMsg(msg);
      notifyAlert('No courts selected', msg);
      return;
    }

    const gameToNum = parseInt(gameTo, 10);
    const winByNum = parseInt(winBy, 10);

    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);

    const payload = {
      tournament_id: id,
      type,
      gender: type === 'mixed_doubles' ? null : gender,
      level,
      best_of: bestOf,
      game_to: gameToNum,
      win_by: winByNum,
      show_points_details: showPointsDetails,
    };

    // Create-or-update the division row first. We treat this as the
    // "transactional anchor" — court inserts that fail will roll it back.
    let currentDivisionId = divisionId;
    let justCreatedDivision = false;
    if (currentDivisionId) {
      const { error: err } = await supabase
        .from('divisions')
        .update(payload)
        .eq('id', currentDivisionId);
      if (err) {
        busyRef.current = false;
        setBusy(false);
        setErrorMsg(`Could not save settings: ${err.message}`);
        notifyAlert('Could not save settings', err.message);
        return;
      }
    } else {
      const { data, error: err } = await supabase
        .from('divisions')
        .insert(payload)
        .select('id')
        .single();
      if (err || !data) {
        const m = err?.message ?? 'Unknown error';
        busyRef.current = false;
        setBusy(false);
        setErrorMsg(`Could not create division: ${m}`);
        notifyAlert('Could not create division', m);
        return;
      }
      currentDivisionId = (data as { id: string }).id;
      justCreatedDivision = true;
    }

    // Diff against last-persisted set: insert newly picked, delete unpicked.
    const toInsert = Array.from(pickedCourtIds).filter((cid) => !persistedCourtIds.has(cid));
    const toDelete = Array.from(persistedCourtIds).filter((cid) => !pickedCourtIds.has(cid));

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('division_courts')
        .delete()
        .eq('division_id', currentDivisionId)
        .in('court_id', toDelete);
      if (delErr) {
        // If this is the first persist of a brand-new division and court ops
        // failed, roll the division back so we don't leave an orphan row.
        if (justCreatedDivision) {
          await supabase.from('divisions').delete().eq('id', currentDivisionId);
        }
        busyRef.current = false;
        setBusy(false);
        setErrorMsg(`Could not remove courts: ${delErr.message}`);
        notifyAlert('Could not remove courts', delErr.message);
        return;
      }
    }
    if (toInsert.length > 0) {
      // Display order: keep already-persisted rows at their previous orders
      // (we left them alone) and append new ones at the end.
      const baseOrder = persistedCourtIds.size - toDelete.length;
      const rows = toInsert.map((court_id, idx) => ({
        division_id: currentDivisionId,
        court_id,
        display_order: baseOrder + idx,
      }));
      const { error: insErr } = await supabase.from('division_courts').insert(rows);
      if (insErr) {
        // Roll back the division if we just created it — otherwise the unique
        // constraint would block recreating it on the next attempt.
        if (justCreatedDivision) {
          await supabase.from('divisions').delete().eq('id', currentDivisionId);
        }
        busyRef.current = false;
        setBusy(false);
        setErrorMsg(`Could not add courts: ${insErr.message}`);
        notifyAlert('Could not add courts', insErr.message);
        return;
      }
    }

    busyRef.current = false;
    setBusy(false);
    setDivisionId(currentDivisionId);
    setOriginalType(type);
    setPersistedCourtIds(new Set(pickedCourtIds));
    setMaxReached((m) => (m < 3 ? 3 : m));
    setStep(3);
  }

  function toggleCourt(courtId: string) {
    setPickedCourtIds((prev) => {
      const next = new Set(prev);
      if (next.has(courtId)) next.delete(courtId);
      else next.add(courtId);
      return next;
    });
  }

  // STEP 3: insert players + team + team_players. Returns true on success.
  // On any failure mid-sequence we clean up the rows we already inserted so we
  // don't leave orphans behind (esp. matters when a retry hits the team-name
  // unique index).
  async function persistCurrentTeam(): Promise<boolean> {
    if (!id || !divisionId) return false;

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

    // Client-side dedupe: if we already added this team this session, bail
    // before hitting the DB unique index (which produces a cryptic error).
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
      // Team insert failed — roll back the players we just inserted.
      await supabase.from('players').delete().in('id', insertedPlayerIds);
      setErrorMsg(`Could not create team: ${m}`);
      notifyAlert('Could not create team', m);
      return false;
    }
    const teamId = (teamRow as { id: string }).id;

    const teamPlayerRows = insertedPlayerIds.map((pid) => ({ team_id: teamId, player_id: pid }));
    const { error: tpErr } = await supabase.from('team_players').insert(teamPlayerRows);
    if (tpErr) {
      // Link insert failed — roll back the team AND the players.
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
    return ok;
  }

  // After saving the last team (or skipping), go back to tournament detail.
  // Use replace so a missing back-stack (deep link / refresh into the wizard)
  // still lands the admin somewhere sensible instead of triggering a GO_BACK
  // warning.
  function exitWizard() {
    if (router.canGoBack && router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/(admin)/tournaments/[id]', params: { id } });
    }
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
    if (ok) exitWizard();
  }

  function skipTeams() {
    exitWizard();
  }

  // Remove a team that was added this session (admin mistyped). Also cleans
  // up the player rows we inserted alongside it; team_players cascades via
  // the FK so it goes away when the team does.
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

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>New division</Text>
        <Text style={styles.subtitle}>Step {step} of 3 — {STEP_TITLES[step]}</Text>
      </View>

      <StepIndicator step={step} maxReached={maxReached} onSelect={goToStep} />

      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />

      {step === 1 && (
        <Step1Settings
          type={type} setType={setType}
          gender={gender} setGender={setGender}
          level={level} setLevel={setLevel}
          bestOf={bestOf} setBestOf={setBestOf}
          gameTo={gameTo} setGameTo={setGameTo}
          winBy={winBy} setWinBy={setWinBy}
          showPointsDetails={showPointsDetails} setShowPointsDetails={setShowPointsDetails}
          onCancel={() => exitWizard()}
          onNext={submitStep1}
          busy={busy}
        />
      )}

      {step === 2 && (
        <Step2Courts
          allCourts={allCourts}
          loading={courtsLoading}
          loadError={courtsLoadError}
          picked={pickedCourtIds}
          onToggle={toggleCourt}
          onBack={() => goToStep(1)}
          onNext={submitStep2}
          busy={busy}
        />
      )}

      {step === 3 && (
        <Step3Teams
          needsTwoPlayers={needsTwoPlayers}
          addedTeams={addedTeams}
          removingTeamId={removingTeamId}
          onRemove={removeAddedTeam}
          player1={player1} setPlayer1={setPlayer1}
          player2={player2} setPlayer2={setPlayer2}
          onBack={() => goToStep(2)}
          onSaveAndAddAnother={saveAndAddAnother}
          onSaveAndDone={saveAndDone}
          onSkip={skipTeams}
          busy={busy}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------- Step indicator ----------------

type StepIndicatorProps = {
  step: WizardStep;
  maxReached: WizardStep;
  onSelect: (s: WizardStep) => void;
};

function StepIndicator({ step, maxReached, onSelect }: StepIndicatorProps) {
  const items: { value: WizardStep; label: string }[] = [
    { value: 1, label: 'Settings' },
    { value: 2, label: 'Courts' },
    { value: 3, label: 'Teams' },
  ];
  return (
    <View style={styles.stepRow}>
      {items.map((it) => {
        const active = it.value === step;
        const reached = it.value <= maxReached;
        const completed = it.value < maxReached || (it.value < step);
        const tappable = reached && it.value < step;
        return (
          <Pressable
            key={it.value}
            disabled={!tappable}
            onPress={() => onSelect(it.value)}
            accessibilityRole="button"
            accessibilityLabel={`Go to step ${it.value} ${it.label}`}
            accessibilityState={{ selected: active, disabled: !tappable }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.stepPill,
              active && styles.stepPillActive,
              !active && reached && styles.stepPillReached,
              !active && !reached && styles.stepPillFuture,
              tappable && hovered && styles.stepPillHover,
              tappable && pressed && styles.stepPillHover,
            ]}
          >
            <View
              style={[
                styles.stepBadge,
                active && styles.stepBadgeActive,
                !active && reached && styles.stepBadgeReached,
                !active && !reached && styles.stepBadgeFuture,
              ]}
            >
              {completed && !active ? (
                <Feather name="check" size={12} color={colors.primaryText} />
              ) : (
                <Text style={[styles.stepBadgeText, active && styles.stepBadgeTextActive]}>
                  {it.value}
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                active && styles.stepLabelActive,
                !active && !reached && styles.stepLabelFuture,
              ]}
              numberOfLines={1}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------- Step 1 ----------------

type Step1Props = {
  type: DivisionType; setType: (v: DivisionType) => void;
  gender: DivisionGender; setGender: (v: DivisionGender) => void;
  level: DivisionLevel; setLevel: (v: DivisionLevel) => void;
  bestOf: 1 | 3; setBestOf: (v: 1 | 3) => void;
  gameTo: string; setGameTo: (v: string) => void;
  winBy: string; setWinBy: (v: string) => void;
  showPointsDetails: boolean; setShowPointsDetails: (v: boolean) => void;
  onCancel: () => void;
  onNext: () => void;
  busy: boolean;
};

function Step1Settings({
  type, setType, gender, setGender, level, setLevel,
  bestOf, setBestOf, gameTo, setGameTo, winBy, setWinBy,
  showPointsDetails, setShowPointsDetails, onCancel, onNext, busy,
}: Step1Props) {
  return (
    <>
      <Card>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Division</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Type</Text>
            <Segmented<DivisionType> options={TYPE_OPTIONS} value={type} onChange={setType} />
          </View>

          {type !== 'mixed_doubles' && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <Segmented<DivisionGender> options={GENDER_OPTIONS} value={gender} onChange={setGender} />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Level</Text>
            <Segmented<DivisionLevel> options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Scoring</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Best of</Text>
            <Segmented<1 | 3> options={BEST_OF_OPTIONS} value={bestOf} onChange={setBestOf} />
          </View>
          <Input
            label="Game to"
            value={gameTo}
            onChangeText={setGameTo}
            keyboardType="numeric"
            placeholder="11"
          />
          <Input
            label="Win by"
            value={winBy}
            onChangeText={setWinBy}
            keyboardType="numeric"
            placeholder="2"
          />
        </View>

        <View style={styles.sectionLast}>
          <Text style={styles.sectionLabel}>Public viewer</Text>
          <Pressable
            onPress={() => setShowPointsDetails(!showPointsDetails)}
            accessibilityRole="switch"
            accessibilityState={{ checked: showPointsDetails }}
            accessibilityLabel="Show points details on public viewer"
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.toggleRow,
              (pressed || hovered) && styles.toggleRowHover,
            ]}
          >
            <Feather
              name={showPointsDetails ? 'check-square' : 'square'}
              size={20}
              color={showPointsDetails ? colors.primary : colors.textMuted}
            />
            <Text style={styles.toggleLabel}>Show points details on public viewer</Text>
          </Pressable>
          <Text style={styles.toggleHelp}>
            Off is friendlier for beginner divisions — players just see W/L.
          </Text>
        </View>
      </Card>

      <View style={styles.actions}>
        <Button variant="ghost" onPress={onCancel}>Cancel</Button>
        <Button onPress={onNext} loading={busy} size="lg" style={styles.actionPrimary}>
          Next
        </Button>
      </View>
    </>
  );
}

// ---------------- Step 2 ----------------

type Step2Props = {
  allCourts: Court[];
  loading: boolean;
  loadError: string | null;
  picked: Set<string>;
  onToggle: (courtId: string) => void;
  onBack: () => void;
  onNext: () => void;
  busy: boolean;
};

function Step2Courts({ allCourts, loading, loadError, picked, onToggle, onBack, onNext, busy }: Step2Props) {
  const pickedCount = picked.size;
  return (
    <>
      <Card>
        <Text style={styles.sectionHeading}>Which courts will this division use?</Text>
        <Text style={styles.helper}>Matches will rotate through the selected courts.</Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : loadError ? (
          <ErrorBanner error={loadError} />
        ) : allCourts.length === 0 ? (
          <Text style={styles.helper}>
            No courts available. Add courts in Admin → Courts first.
          </Text>
        ) : (
          <>
            <View style={styles.courtPickerList}>
              {allCourts.map((c) => {
                const selected = picked.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => onToggle(c.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`Toggle ${c.name}`}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.courtToggle,
                      selected && styles.courtToggleSelected,
                      hovered && !selected && styles.courtToggleHover,
                      pressed && styles.courtTogglePressed,
                    ]}
                  >
                    <Text
                      style={[styles.courtToggleText, selected && styles.courtToggleTextSelected]}
                      numberOfLines={1}
                    >
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
            <Text style={styles.countFooter}>
              {pickedCount} of {allCourts.length} selected
            </Text>
          </>
        )}
      </Card>

      <View style={styles.actions}>
        <Button variant="ghost" onPress={onBack}>Back</Button>
        <Button
          onPress={onNext}
          loading={busy}
          size="lg"
          disabled={pickedCount === 0}
          style={styles.actionPrimary}
        >
          Next
        </Button>
      </View>
    </>
  );
}

// ---------------- Step 3 ----------------

type Step3Props = {
  needsTwoPlayers: boolean;
  addedTeams: AddedTeam[];
  removingTeamId: string | null;
  onRemove: (team: AddedTeam) => void;
  player1: string; setPlayer1: (v: string) => void;
  player2: string; setPlayer2: (v: string) => void;
  onBack: () => void;
  onSaveAndAddAnother: () => Promise<boolean>;
  onSaveAndDone: () => void;
  onSkip: () => void;
  busy: boolean;
};

function Step3Teams({
  needsTwoPlayers, addedTeams, removingTeamId, onRemove,
  player1, setPlayer1, player2, setPlayer2,
  onBack, onSaveAndAddAnother, onSaveAndDone, onSkip, busy,
}: Step3Props) {
  const player1Ref = useRef<TextInput>(null);
  const player2Ref = useRef<TextInput>(null);

  // After a successful save-and-add-another, keep the keyboard up and drop
  // the cursor back in Player 1 so the admin can keep typing.
  async function handleSaveAndAddAnother() {
    const ok = await onSaveAndAddAnother();
    if (ok) {
      // Slight delay isn't needed in practice — RN's focus call is queued.
      player1Ref.current?.focus();
    }
  }

  return (
    <>
      <Card>
        <Text style={styles.sectionHeading}>Add the teams that have registered.</Text>
        <Text style={styles.helper}>
          {needsTwoPlayers
            ? 'Doubles team — enter both players for each team.'
            : 'Singles entry — enter the player for each team.'}
        </Text>

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
                      onPress={() => onRemove(t)}
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

        <View style={styles.teamForm}>
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
                void handleSaveAndAddAnother();
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
                void handleSaveAndAddAnother();
              }}
            />
          )}
        </View>
      </Card>

      <View style={styles.step3Actions}>
        <Button onPress={() => { void handleSaveAndAddAnother(); }} loading={busy} size="lg">
          Save & add another
        </Button>
        <Button variant="secondary" onPress={onSaveAndDone} disabled={busy}>
          Save & done
        </Button>
        {addedTeams.length === 0 && (
          <Button variant="ghost" onPress={onSkip} disabled={busy}>
            Skip — add teams later
          </Button>
        )}
        <View style={styles.backRow}>
          <Button variant="ghost" onPress={onBack} disabled={busy}>Back</Button>
        </View>
      </View>
    </>
  );
}

// ---------------- Segmented (shared) ----------------

type SegmentedProps<T extends string | number> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
};

function Segmented<T extends string | number>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View style={styles.segmentRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.segment,
              active && styles.segmentActive,
              !active && hovered && styles.segmentHover,
              !active && pressed && styles.segmentHover,
            ]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------- Styles ----------------

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.lg },
  heading: { gap: spacing.xs },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted },

  // Step indicator
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  stepPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepPillReached: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
  },
  stepPillFuture: {
    backgroundColor: colors.secondary,
    borderColor: colors.border,
  },
  stepPillHover: {
    opacity: 0.85,
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  stepBadgeReached: { backgroundColor: colors.primary },
  stepBadgeFuture: { backgroundColor: colors.border },
  stepBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textMuted,
  },
  stepBadgeTextActive: { color: colors.primaryText },
  stepLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.primarySoftText,
  },
  stepLabelActive: { color: colors.primaryText },
  stepLabelFuture: { color: colors.textMuted },

  // Card sections
  section: { gap: spacing.md, marginBottom: spacing.lg },
  sectionLast: { gap: spacing.md },
  sectionLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  sectionHeading: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    marginBottom: spacing.xs,
  },
  helper: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  field: { gap: spacing.xs },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },

  // Segmented
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.secondary,
    borderRadius: radii.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
  },
  segmentHover: { backgroundColor: colors.border },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  segmentTextActive: {
    color: colors.primaryText,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    minHeight: 44,
  },
  toggleRowHover: { backgroundColor: colors.bgMuted },
  toggleLabel: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  toggleHelp: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
  },

  // Courts
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
    minWidth: 96,
    flexGrow: 1,
  },
  courtToggleHover: { backgroundColor: colors.bgMuted },
  courtTogglePressed: { opacity: 0.7 },
  courtToggleSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  courtToggleText: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    flexShrink: 1,
  },
  courtToggleTextSelected: {
    color: colors.primarySoftText,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  courtCheckBlank: { width: 16, height: 16 },
  countFooter: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    marginTop: spacing.md,
    textAlign: 'right',
  },

  // Step 3 added teams
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

  teamForm: { gap: spacing.md },

  // Action rows
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionPrimary: { flexShrink: 0 },
  step3Actions: { gap: spacing.sm },
  backRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: spacing.xs,
  },

  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
