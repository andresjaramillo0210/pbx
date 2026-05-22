import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../../src/components/Button';
import Card from '../../../../src/components/Card';
import DateInput from '../../../../src/components/DateInput';
import ErrorBanner from '../../../../src/components/ErrorBanner';
import Input from '../../../../src/components/Input';
import ScreenContainer from '../../../../src/components/ScreenContainer';
import { notifyAlert } from '../../../../src/lib/notify';
import { supabase } from '../../../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing, tracking } from '../../../../src/theme';

export default function EditTournament() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('name, starts_on, ends_on')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
      } else if (!data) {
        setLoadError('Tournament not found.');
      } else {
        const row = data as { name: string; starts_on: string | null; ends_on: string | null };
        setName(row.name ?? '');
        setStartsOn(row.starts_on);
        setEndsOn(row.ends_on);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function submit() {
    if (busyRef.current) return;
    if (!id) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      busyRef.current = false;
      setBusy(false);
      setErrorMsg('Name required: Please enter a tournament name.');
      notifyAlert('Name required', 'Please enter a tournament name.');
      return;
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      busyRef.current = false;
      setBusy(false);
      const msg = 'End date must be on or after the start date.';
      setErrorMsg(msg);
      notifyAlert('Invalid dates', msg);
      return;
    }

    const { error } = await supabase
      .from('tournaments')
      .update({
        name: trimmed,
        starts_on: startsOn,
        ends_on: endsOn,
      })
      .eq('id', id);

    busyRef.current = false;
    setBusy(false);

    if (error) {
      setErrorMsg(`Could not save: ${error.message}`);
      notifyAlert('Could not save', error.message);
      return;
    }
    router.back();
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
        <View style={styles.center}><Text style={styles.error}>{loadError}</Text></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>Edit tournament</Text>
        <Text style={styles.subtitle}>Update the name and schedule.</Text>
      </View>

      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />

      <Card>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Details</Text>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Spring Open 2026"
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Schedule</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Starts on</Text>
            <DateInput value={startsOn} onChange={setStartsOn} placeholder="YYYY-MM-DD" />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Ends on</Text>
            <DateInput value={endsOn} onChange={setEndsOn} placeholder="YYYY-MM-DD" />
          </View>
        </View>
      </Card>

      <View style={styles.actions}>
        <Button variant="ghost" onPress={() => router.back()}>
          Cancel
        </Button>
        <Button onPress={submit} loading={busy} size="lg" style={styles.save}>
          Save changes
        </Button>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  error: { color: colors.destructive },
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
  fieldGroup: { gap: spacing.xs },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
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
