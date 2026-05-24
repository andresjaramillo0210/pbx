import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../../../../src/components/Button';
import Card from '../../../../../../src/components/Card';
import ErrorBanner from '../../../../../../src/components/ErrorBanner';
import Input from '../../../../../../src/components/Input';
import ScreenContainer from '../../../../../../src/components/ScreenContainer';
import SponsorManager from '../../../../../../src/components/SponsorManager';
import { notifyAlert } from '../../../../../../src/lib/notify';
import { supabase } from '../../../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../../../src/theme';

type DivisionType = 'singles' | 'doubles' | 'mixed_doubles';
type DivisionLevel = 'beginner' | 'intermediate' | 'advanced';
type DivisionGender = 'mens' | 'womens';
type DivisionFormat = 'round_robin' | 'pool_to_bracket' | 'single_elimination';

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

export default function EditDivision() {
  const { id, divisionId } = useLocalSearchParams<{ id: string; divisionId: string }>();
  const router = useRouter();

  const [original, setOriginal] = useState<Division | null>(null);
  const [type, setType] = useState<DivisionType>('doubles');
  // When the division is mixed_doubles, gender stays null. We keep a UI state
  // for the segmented control so the user has a choice when switching types
  // while the division is still open. Defaults to 'mens' for non-mixed.
  const [gender, setGender] = useState<DivisionGender>('mens');
  const [level, setLevel] = useState<DivisionLevel>('intermediate');
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [gameTo, setGameTo] = useState('11');
  const [winBy, setWinBy] = useState('2');
  const [showPointsDetails, setShowPointsDetails] = useState(true);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!id || !divisionId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('divisions')
        .select('id, tournament_id, type, level, gender, format, status, best_of, game_to, win_by, show_points_details')
        .eq('id', divisionId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const row = data as Division | null;
      if (!row) {
        setLoadError('Division not found.');
        setLoading(false);
        return;
      }
      if (row.tournament_id !== id) {
        setLoadError('Division does not belong to this tournament.');
        setLoading(false);
        return;
      }
      setOriginal(row);
      setType(row.type);
      // If the row already has a gender, use it. Otherwise keep the default
      // ('mens') — only used if the user switches type to non-mixed.
      if (row.gender) setGender(row.gender);
      setLevel(row.level);
      // best_of is stored as int — coerce to the segmented control's union.
      setBestOf(row.best_of === 3 ? 3 : 1);
      setGameTo(String(row.game_to));
      setWinBy(String(row.win_by));
      setShowPointsDetails(row.show_points_details);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, divisionId]);

  async function submit() {
    if (busyRef.current) return;
    if (!original) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);

    const isOpen = original.status === 'open';

    // Validate scoring fields only when they're editable (status === open).
    let gameToNum = original.game_to;
    let winByNum = original.win_by;
    if (isOpen) {
      const gT = parseInt(gameTo, 10);
      const wB = parseInt(winBy, 10);
      if (!Number.isFinite(gT) || gT < 1) {
        busyRef.current = false;
        setBusy(false);
        const msg = 'Game to must be a positive number (default 11).';
        setErrorMsg(msg);
        notifyAlert('Invalid game_to', msg);
        return;
      }
      if (!Number.isFinite(wB) || wB < 1) {
        busyRef.current = false;
        setBusy(false);
        const msg = 'Win by must be a positive number (default 2).';
        setErrorMsg(msg);
        notifyAlert('Invalid win_by', msg);
        return;
      }
      if (wB >= gT) {
        busyRef.current = false;
        setBusy(false);
        const msg = 'Win by must be less than Game to.';
        setErrorMsg(msg);
        notifyAlert('Invalid scoring', msg);
        return;
      }
      gameToNum = gT;
      winByNum = wB;
    }

    // Build the update payload. Only include fields the current status allows
    // changing — the DB will enforce the gender check constraint regardless.
    const update: Record<string, unknown> = {
      level,
      gender: (isOpen ? type : original.type) === 'mixed_doubles' ? null : gender,
      show_points_details: showPointsDetails,
    };
    if (isOpen) {
      update.type = type;
      update.best_of = bestOf;
      update.game_to = gameToNum;
      update.win_by = winByNum;
    }

    const { error } = await supabase
      .from('divisions')
      .update(update)
      .eq('id', original.id);

    busyRef.current = false;
    setBusy(false);

    if (error) {
      setErrorMsg(`Could not save: ${error.message}`);
      notifyAlert('Could not save', error.message);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({
        pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]',
        params: { id: id as string, divisionId: divisionId as string },
      });
    }
  }

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }
  if (loadError || !original) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}>
          <ErrorBanner error={loadError} onDismiss={() => setLoadError(null)} />
          {!loadError && <Text>Division not found.</Text>}
        </View>
      </ScreenContainer>
    );
  }

  const isOpen = original.status === 'open';
  // Show the Gender control when the effective type is not mixed_doubles.
  // While open, the effective type follows the `type` state; once locked, the
  // type is fixed to original.type.
  const effectiveType: DivisionType = isOpen ? type : original.type;
  const showGenderControl = effectiveType !== 'mixed_doubles';

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>Edit division</Text>
        <Text style={styles.subtitle}>
          {isOpen
            ? 'Adjust the division settings before generating matches.'
            : 'Matches have been generated — only level and gender can be changed.'}
        </Text>
      </View>

      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />

      <Card>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Division</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Type</Text>
            <Segmented<DivisionType>
              options={TYPE_OPTIONS}
              value={type}
              onChange={setType}
              disabled={!isOpen}
            />
          </View>

          {showGenderControl && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <Segmented<DivisionGender>
                options={GENDER_OPTIONS}
                value={gender}
                onChange={setGender}
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Level</Text>
            <Segmented<DivisionLevel>
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Scoring</Text>
          {!isOpen && (
            <Text style={styles.lockNote}>
              Type and scoring can&apos;t be changed after matches are generated. Use Regenerate matches on the division screen to start over.
            </Text>
          )}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Best of</Text>
            <Segmented<1 | 3>
              options={BEST_OF_OPTIONS}
              value={bestOf}
              onChange={setBestOf}
              disabled={!isOpen}
            />
          </View>

          <Input
            label="Game to"
            value={gameTo}
            onChangeText={setGameTo}
            keyboardType="number-pad"
            placeholder="11"
            editable={isOpen}
          />
          <Input
            label="Win by"
            value={winBy}
            onChangeText={setWinBy}
            keyboardType="number-pad"
            placeholder="2"
            editable={isOpen}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Public viewer</Text>

          <Pressable
            onPress={() => setShowPointsDetails((v) => !v)}
            accessibilityRole="checkbox"
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

      <Card>
        <Text style={styles.sectionLabel}>Sponsors</Text>
        <Text style={styles.subtitle}>
          Logos appear under the courts on the public TV view.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <SponsorManager divisionId={divisionId as string} />
        </View>
      </Card>

      <View style={styles.actions}>
        <Button
          variant="ghost"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace({
                pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]',
                params: { id: id as string, divisionId: divisionId as string },
              });
            }
          }}
        >
          Cancel
        </Button>
        <Button onPress={submit} loading={busy} size="lg" style={styles.save}>
          Save changes
        </Button>
      </View>
    </ScreenContainer>
  );
}

type SegmentedProps<T extends string | number> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
};

function Segmented<T extends string | number>({ options, value, onChange, disabled }: SegmentedProps<T>) {
  return (
    <View style={[styles.segmentRow, disabled && styles.segmentRowDisabled]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => { if (!disabled) onChange(opt.value); }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.segment,
              active && styles.segmentActive,
              !disabled && !active && hovered && styles.segmentHover,
              !disabled && !active && pressed && styles.segmentHover,
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
  section: { gap: spacing.md, marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
  field: { gap: spacing.xs },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  lockNote: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    lineHeight: 18,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.secondary,
    borderRadius: radii.pill,
    padding: 4,
    gap: 4,
  },
  segmentRowDisabled: {
    opacity: 0.55,
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
  segmentHover: {
    backgroundColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  segmentTextActive: {
    color: colors.primaryText,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    minHeight: 44,
  },
  toggleRowHover: {
    backgroundColor: colors.bgMuted,
  },
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  save: { flexShrink: 0 },
});
