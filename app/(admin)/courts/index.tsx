import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../src/components/Button';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ErrorBanner from '../../../src/components/ErrorBanner';
import Input from '../../../src/components/Input';
import ScreenContainer from '../../../src/components/ScreenContainer';
import Section from '../../../src/components/Section';
import { notifyAlert, notifyConfirm } from '../../../src/lib/notify';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../../src/theme';

type Court = {
  id: string;
  name: string;
  stream_url: string | null;
  display_order: number;
  archived_at: string | null;
};

type Draft = { name: string; stream_url: string };

export default function CourtsAdmin() {
  const [active, setActive] = useState<Court[]>([]);
  const [archived, setArchived] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showArchived, setShowArchived] = useState(false);

  // Inline add form
  const [newName, setNewName] = useState('');
  const [newStream, setNewStream] = useState('');
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  // Per-row edit drafts
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const savingRef = useRef(false);

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const archivingRef = useRef(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const restoringRef = useRef(false);

  const [seeding, setSeeding] = useState(false);
  const seedingRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('courts')
      .select('id, name, stream_url, display_order, archived_at')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Court[];
    setActive(rows.filter((c) => c.archived_at === null));
    setArchived(rows.filter((c) => c.archived_at !== null));
    setLoading(false);
  }, []);

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

  function getDraft(c: Court): Draft {
    return edits[c.id] ?? { name: c.name, stream_url: c.stream_url ?? '' };
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? { name: '', stream_url: '' }), ...patch } }));
  }

  async function addCourt() {
    if (addingRef.current) return;
    const name = newName.trim();
    if (name.length === 0) {
      setError('Court name required');
      notifyAlert('Court name required');
      return;
    }
    addingRef.current = true;
    setAdding(true);
    const nextOrder = active.length;
    const { data, error: err } = await supabase
      .from('courts')
      .insert({
        name,
        stream_url: newStream.trim() || null,
        display_order: nextOrder,
      })
      .select('id, name, stream_url, display_order, archived_at')
      .single();
    addingRef.current = false;
    setAdding(false);
    if (err || !data) {
      const msg = err?.message ?? 'Unknown error';
      setError(`Could not add court: ${msg}`);
      notifyAlert('Could not add court', msg);
      return;
    }
    setActive((cs) => [...cs, data as Court]);
    setNewName('');
    setNewStream('');
  }

  async function saveEdit(c: Court) {
    if (savingRef.current) return;
    const draft = getDraft(c);
    const name = draft.name.trim();
    if (name.length === 0) {
      setError('Court name required');
      notifyAlert('Court name required');
      return;
    }
    savingRef.current = true;
    setSavingId(c.id);
    const { data, error: err } = await supabase
      .from('courts')
      .update({ name, stream_url: draft.stream_url.trim() || null })
      .eq('id', c.id)
      .select('id, name, stream_url, display_order, archived_at')
      .single();
    savingRef.current = false;
    setSavingId(null);
    if (err || !data) {
      const msg = err?.message ?? 'Unknown error';
      setError(`Could not save court: ${msg}`);
      notifyAlert('Could not save court', msg);
      return;
    }
    setActive((cs) => cs.map((row) => (row.id === c.id ? (data as Court) : row)));
    setEdits((e) => {
      const next = { ...e };
      delete next[c.id];
      return next;
    });
  }

  function confirmArchive(c: Court) {
    notifyConfirm(
      'Archive court?',
      `${c.name} will be hidden from active courts. Matches that reference it remain intact.`,
      () => doArchive(c),
      { confirmLabel: 'Archive', destructive: true },
    );
  }

  async function doArchive(c: Court) {
    if (archivingRef.current) return;
    archivingRef.current = true;
    setArchivingId(c.id);
    const { data, error: err } = await supabase
      .from('courts')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', c.id)
      .select('id, name, stream_url, display_order, archived_at')
      .single();
    archivingRef.current = false;
    setArchivingId(null);
    if (err || !data) {
      const msg = err?.message ?? 'Unknown error';
      setError(`Could not archive court: ${msg}`);
      notifyAlert('Could not archive court', msg);
      return;
    }
    setActive((cs) => cs.filter((row) => row.id !== c.id));
    setArchived((cs) => [...cs, data as Court]);
  }

  async function seedDefaultCourts() {
    if (seedingRef.current) return;
    seedingRef.current = true;
    setSeeding(true);
    const rows = Array.from({ length: 11 }, (_, i) => ({
      name: `Court ${i + 1}`,
      stream_url: null,
      display_order: i + 1,
    }));
    const { data, error: err } = await supabase
      .from('courts')
      .insert(rows)
      .select('id, name, stream_url, display_order, archived_at');
    seedingRef.current = false;
    setSeeding(false);
    if (err || !data) {
      const msg = err?.message ?? 'Unknown error';
      setError(`Could not seed default courts: ${msg}`);
      notifyAlert('Could not seed default courts', msg);
      return;
    }
    setActive((cs) => [...cs, ...(data as Court[])]);
  }

  async function doRestore(c: Court) {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoringId(c.id);
    const { data, error: err } = await supabase
      .from('courts')
      .update({ archived_at: null })
      .eq('id', c.id)
      .select('id, name, stream_url, display_order, archived_at')
      .single();
    restoringRef.current = false;
    setRestoringId(null);
    if (err || !data) {
      const msg = err?.message ?? 'Unknown error';
      setError(`Could not restore court: ${msg}`);
      notifyAlert('Could not restore court', msg);
      return;
    }
    setArchived((cs) => cs.filter((row) => row.id !== c.id));
    setActive((cs) => [...cs, data as Court]);
  }

  if (loading) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <View style={styles.heading}>
        <Text style={styles.title}>Courts</Text>
        <Text style={styles.subtitle}>Westminster Pickleball Xscape</Text>
      </View>

      <Section title="Active courts">
        {active.length === 0 ? (
          <EmptyState
            title="No active courts"
            message="Add at least one court below before publishing a tournament."
            action={
              <Button onPress={seedDefaultCourts} loading={seeding}>
                Add courts 1–11
              </Button>
            }
          />
        ) : (
          active.map((c) => {
            const draft = getDraft(c);
            const dirty =
              draft.name !== c.name || draft.stream_url !== (c.stream_url ?? '');
            return (
              <Card key={c.id}>
                <View style={styles.courtFields}>
                  <Input
                    label="Name"
                    value={draft.name}
                    onChangeText={(v) => updateDraft(c.id, { name: v })}
                    placeholder="Court name"
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                  <Input
                    label="Stream URL"
                    value={draft.stream_url}
                    onChangeText={(v) => updateDraft(c.id, { stream_url: v })}
                    placeholder="Optional"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>
                <View style={styles.rowActions}>
                  {dirty && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => saveEdit(c)}
                      loading={savingId === c.id}
                    >
                      Save
                    </Button>
                  )}
                </View>
              </Card>
            );
          })
        )}
      </Section>

      <Section title="Add court">
        <Card>
          <View style={styles.courtFields}>
            <Input
              label="Name"
              value={newName}
              onChangeText={setNewName}
              placeholder="Court 1"
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Input
              label="Stream URL"
              value={newStream}
              onChangeText={setNewStream}
              placeholder="Optional"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Button onPress={addCourt} loading={adding} style={styles.addBtn}>
              Add court
            </Button>
          </View>
        </Card>
      </Section>

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  heading: { gap: spacing.xs },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  courtFields: { gap: spacing.md },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  addBtn: { marginTop: spacing.sm },
  disclosureRow: { alignItems: 'flex-start', marginTop: spacing.lg },
  empty: { color: colors.textMuted, paddingVertical: spacing.sm },
  archivedList: { gap: spacing.md },
  archivedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgMuted,
  },
  archivedName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  archivedMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
});
