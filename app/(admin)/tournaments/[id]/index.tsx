import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../../src/components/Button';
import Card from '../../../../src/components/Card';
import EmptyState from '../../../../src/components/EmptyState';
import ErrorBanner from '../../../../src/components/ErrorBanner';
import ScreenContainer from '../../../../src/components/ScreenContainer';
import Section from '../../../../src/components/Section';
import StatusPill from '../../../../src/components/StatusPill';
import {
  reassignCourts as reassignCourtsOp,
  regenerateMatches as regenerateMatchesOp,
} from '../../../../src/lib/divisionOps';
import { notifyAlert, notifyConfirm } from '../../../../src/lib/notify';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../../../../src/theme';

type Tournament = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status: 'draft' | 'published' | 'in_progress' | 'completed' | 'archived';
};

type Division = {
  id: string;
  type: 'singles' | 'doubles' | 'mixed_doubles';
  level: 'beginner' | 'intermediate' | 'advanced';
  gender: 'mens' | 'womens' | null;
  format: 'round_robin' | 'pool_to_bracket' | 'single_elimination' | null;
  status: string;
  best_of: number;
};

type Team = {
  id: string;
  name: string;
  division_id: string;
  withdrawn_at: string | null;
};

// Build the on-screen division label: gender + type + level.
// Mixed doubles intentionally has no gender prefix (it is its own category).
function labelDivision(
  type: 'singles' | 'doubles' | 'mixed_doubles',
  level: 'beginner' | 'intermediate' | 'advanced',
  gender: 'mens' | 'womens' | null,
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
function labelFormat(f: string | null) {
  if (f === 'round_robin') return 'Round robin';
  if (f === 'pool_to_bracket') return 'Pool → bracket';
  if (f === 'single_elimination') return 'Single elimination';
  return 'No format yet';
}

export default function TournamentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);

  // Per-division busy state for the action row. We track a single
  // `busyDivisionId` rather than a Set so that all action buttons on the
  // active division go disabled while a destructive op runs; other
  // divisions stay interactive (so two admins / two tabs can work in
  // parallel). The ref mirrors the state for double-tap guarding.
  const [busyDivisionId, setBusyDivisionId] = useState<string | null>(null);
  // Track which division cards have their team list expanded. Default collapsed.
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const busyDivisionRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const tRes = await supabase
      .from('tournaments')
      .select('id, name, starts_on, ends_on, status')
      .eq('id', id)
      .maybeSingle();
    if (tRes.error) {
      setError(tRes.error.message);
      setLoading(false);
      return;
    }
    setTournament((tRes.data as Tournament) ?? null);

    const dRes = await supabase
      .from('divisions')
      .select('id, type, level, gender, format, status, best_of')
      .eq('tournament_id', id);
    if (dRes.error) setError(dRes.error.message);
    const divs = (dRes.data as Division[]) ?? [];
    setDivisions(divs);

    if (divs.length > 0) {
      const divIds = divs.map((d) => d.id);
      const teamRes = await supabase
        .from('teams')
        .select('id, name, division_id, withdrawn_at')
        .in('division_id', divIds);
      if (teamRes.error) setError(teamRes.error.message);
      setTeams((teamRes.data as Team[]) ?? []);
    } else {
      setTeams([]);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (cancelled) return;
        await load();
      })();
      return () => { cancelled = true; };
    }, [load])
  );

  async function doPublish() {
    if (!tournament) return;
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    const { error: err } = await supabase
      .from('tournaments')
      .update({ status: 'published' })
      .eq('id', tournament.id);
    publishingRef.current = false;
    setPublishing(false);
    if (err) {
      setError(`Could not publish: ${err.message}`);
      notifyAlert('Could not publish', err.message);
      return;
    }
    setTournament({ ...tournament, status: 'published' });
  }

  async function publish() {
    if (!tournament) return;
    const missing: string[] = [];
    if (divisions.length < 1) missing.push('at least one division');

    const { count, error: courtErr } = await supabase
      .from('courts')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null);
    if (courtErr) {
      setError(`Could not check courts: ${courtErr.message}`);
      notifyAlert('Could not check courts', courtErr.message);
      return;
    }
    if ((count ?? 0) < 1) missing.push('at least one active court');

    if (missing.length > 0) {
      const msg = `Add ${missing.join(' and ')} before publishing.`;
      setError(`Cannot publish yet: ${msg}`);
      notifyAlert('Cannot publish yet', msg);
      return;
    }
    notifyConfirm(
      'Publish tournament?',
      'Players will be able to view it once published.',
      doPublish,
      { confirmLabel: 'Publish' },
    );
  }

  // Per-division action handlers. Guarded by `busyDivisionRef` so the
  // same division can't be hit twice in a row. Each one calls into
  // `divisionOps` so the logic stays in one place.
  async function handleReassignCourts(divisionId: string) {
    if (busyDivisionRef.current) return;
    notifyConfirm(
      'Reassign courts?',
      'This redistributes existing matches across the current court selection. Existing scores stay.',
      async () => {
        if (busyDivisionRef.current) return;
        busyDivisionRef.current = divisionId;
        setBusyDivisionId(divisionId);
        const result = await reassignCourtsOp(divisionId);
        busyDivisionRef.current = null;
        setBusyDivisionId(null);
        if (!result.ok) {
          setError(`Reassign failed: ${result.error}`);
          notifyAlert('Reassign failed', result.error);
          return;
        }
        await load();
        if (result.updated === 0) {
          notifyAlert('No changes needed', 'Court assignments already match the current set.');
        } else {
          notifyAlert(
            'Courts reassigned',
            `${result.updated} match${result.updated === 1 ? '' : 'es'} updated.`,
          );
        }
      },
      { confirmLabel: 'Reassign' },
    );
  }

  async function handleRegenerateMatches(divisionId: string) {
    if (busyDivisionRef.current) return;
    notifyConfirm(
      'Regenerate matches?',
      'All matches and scores for this division will be deleted. You’ll pick a format again from scratch. Cannot be undone.',
      async () => {
        if (busyDivisionRef.current) return;
        busyDivisionRef.current = divisionId;
        setBusyDivisionId(divisionId);
        const result = await regenerateMatchesOp(divisionId);
        busyDivisionRef.current = null;
        setBusyDivisionId(null);
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

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }
  if (!tournament) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><Text>Tournament not found.</Text></View>
      </ScreenContainer>
    );
  }

  const dateRange = (() => {
    const s = tournament.starts_on;
    const e = tournament.ends_on;
    if (!s && !e) return 'TBD';
    if (!s) return e!;
    if (!e || s === e) return s;
    return `${s} – ${e}`;
  })();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: tournament.name }} />
      <Pressable
        onPress={() => router.push('/(admin)/tournaments')}
        accessibilityRole="link"
        accessibilityLabel="Back to all tournaments"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.breadcrumb,
          hovered && styles.breadcrumbHover,
          pressed && styles.breadcrumbPressed,
        ]}
      >
        <Feather name="chevron-left" size={16} color={colors.textMuted} />
        <Text style={styles.breadcrumbText}>All tournaments</Text>
      </Pressable>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Card>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={styles.title} numberOfLines={2}>{tournament.name}</Text>
            <Text style={styles.meta}>{dateRange}</Text>
            <View style={styles.pillRow}>
              <StatusPill status={tournament.status} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit tournament"
                onPress={() =>
                  router.push({
                    pathname: '/(admin)/tournaments/[id]/edit',
                    params: { id: tournament.id },
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
          </View>
        </View>
      </Card>

      <Section
        title="Divisions"
        action={
          <Button
            variant="ghost"
            size="sm"
            onPress={() =>
              router.push({
                pathname: '/(admin)/tournaments/[id]/divisions/new',
                params: { id: tournament.id },
              })
            }
          >
            Add division
          </Button>
        }
      >
        {divisions.length === 0 ? (
          <EmptyState
            title="No divisions yet"
            message="Add a division to start collecting teams."
            action={
              <Button
                onPress={() =>
                  router.push({
                    pathname: '/(admin)/tournaments/[id]/divisions/new',
                    params: { id: tournament.id },
                  })
                }
              >
                Add division
              </Button>
            }
          />
        ) : (
          divisions.map((d) => {
            const divTeams = teams.filter((t) => t.division_id === d.id);
            const activeTeamCount = divTeams.filter((t) => !t.withdrawn_at).length;
            const teamCount = divTeams.length;
            const isOpen = d.status === 'open';
            const canGenerate = isOpen && activeTeamCount >= 2;
            const isBusy = busyDivisionId === d.id;
            return (
              <Card key={d.id}>
                <View style={styles.divHeader}>
                  <Text style={styles.divTitle} numberOfLines={1}>
                    {labelDivision(d.type, d.level, d.gender)}
                  </Text>
                  <View style={styles.divHeaderTrail}>
                    <StatusPill status={d.status} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit division"
                      onPress={() =>
                        router.push({
                          pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]/edit',
                          params: { id: tournament.id, divisionId: d.id },
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
                </View>
                <View style={styles.chipRow}>
                  <Chip label={`${teamCount} ${teamCount === 1 ? 'team' : 'teams'}`} />
                  <Chip label={labelFormat(d.format)} />
                  <Chip label={`Best of ${d.best_of}`} />
                </View>
                <View style={styles.divActions}>
                  {/* Edit shortcuts — always visible regardless of status. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onPress={() =>
                      router.push({
                        pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]',
                        params: { id: tournament.id, divisionId: d.id, focus: 'teams' },
                      })
                    }
                  >
                    Edit teams
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onPress={() =>
                      router.push({
                        pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]',
                        params: { id: tournament.id, divisionId: d.id, focus: 'courts' },
                      })
                    }
                  >
                    Edit courts
                  </Button>
                  {isOpen ? (
                    canGenerate && (
                      <Button
                        size="sm"
                        disabled={isBusy}
                        onPress={() =>
                          router.push({
                            pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]/generate',
                            params: { id: tournament.id, divisionId: d.id },
                          })
                        }
                      >
                        Generate matches
                      </Button>
                    )
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBusy}
                        onPress={() =>
                          router.push({
                            pathname: '/(admin)/tournaments/[id]/divisions/[divisionId]',
                            params: { id: tournament.id, divisionId: d.id, focus: 'score' },
                          })
                        }
                      >
                        Schedule
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBusy}
                        loading={isBusy}
                        onPress={() => handleReassignCourts(d.id)}
                      >
                        Reassign courts
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isBusy}
                        loading={isBusy}
                        onPress={() => handleRegenerateMatches(d.id)}
                      >
                        Regenerate matches
                      </Button>
                    </>
                  )}
                </View>
                {divTeams.length > 0 && (
                  <Pressable
                    onPress={() =>
                      setExpandedTeams((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedTeams.has(d.id) }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.teamsToggle,
                      hovered && styles.teamsToggleHover,
                      pressed && styles.teamsTogglePressed,
                    ]}
                  >
                    <Text style={styles.teamsToggleText}>
                      {expandedTeams.has(d.id) ? 'Hide teams' : 'Show teams'} · {divTeams.length}
                    </Text>
                    <Feather
                      name={expandedTeams.has(d.id) ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </Pressable>
                )}
                {divTeams.length > 0 && expandedTeams.has(d.id) && (
                  <View style={styles.teamGrid}>
                    {divTeams.map((t) => {
                      const withdrawn = t.withdrawn_at != null;
                      return (
                        <View key={t.id} style={styles.teamGridCell}>
                          <Pressable
                            onPress={() =>
                              router.push({
                                pathname:
                                  '/(admin)/tournaments/[id]/divisions/[divisionId]/teams/[teamId]/edit',
                                params: {
                                  id: tournament.id,
                                  divisionId: d.id,
                                  teamId: t.id,
                                },
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Edit team ${t.name}`}
                            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                              styles.teamCard,
                              hovered && styles.teamCardHover,
                              pressed && styles.teamCardPressed,
                            ]}
                          >
                            <Text
                              style={[styles.teamName, withdrawn && styles.teamNameWithdrawn]}
                              numberOfLines={2}
                            >
                              {t.name}
                            </Text>
                            <View style={styles.teamCardTrail}>
                              {withdrawn && (
                                <View style={styles.withdrawnPill}>
                                  <Text style={styles.withdrawnPillText}>Withdrawn</Text>
                                </View>
                              )}
                              <Feather name="edit-2" size={12} color={colors.textSubtle} />
                            </View>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Card>
            );
          })
        )}
      </Section>

      {tournament.status === 'draft' && (
        <Button
          onPress={publish}
          loading={publishing}
          size="lg"
          style={styles.publishBtn}
        >
          Publish tournament
        </Button>
      )}
    </ScreenContainer>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.3,
  },
  meta: { fontSize: fontSize.base, color: colors.textMuted },
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
  divHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  divHeaderTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  divTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  chipText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
    textTransform: 'uppercase',
  },
  divActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  teamGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  teamGridCell: {
    flexBasis: '49%',
    minWidth: 160,
    flexGrow: 1,
  },
  teamsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.md,
    minHeight: 44,
    marginTop: spacing.sm,
  },
  teamsToggleHover: { backgroundColor: colors.secondary },
  teamsTogglePressed: { opacity: 0.7 },
  teamsToggleText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bgMuted,
    minHeight: 44,
  },
  teamCardHover: {
    backgroundColor: colors.secondary,
  },
  teamCardPressed: {
    opacity: 0.7,
  },
  teamCardTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  teamName: {
    flexShrink: 1,
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  teamNameWithdrawn: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  withdrawnPill: {
    backgroundColor: colors.secondary,
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
  publishBtn: { marginTop: spacing.lg },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: radii.sm,
    minHeight: 32,
  },
  breadcrumbHover: { backgroundColor: colors.bgMuted },
  breadcrumbPressed: { opacity: 0.7 },
  breadcrumbText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    marginLeft: 2,
  },
});
