import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../src/components/Button';
import DateInput from '../../../src/components/DateInput';
import ErrorBanner from '../../../src/components/ErrorBanner';
import Input from '../../../src/components/Input';
import ScreenContainer from '../../../src/components/ScreenContainer';
import { notifyAlert } from '../../../src/lib/notify';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing, tracking } from '../../../src/theme';

export default function NewTournament() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    if (name.trim().length === 0) {
      busyRef.current = false;
      setBusy(false);
      setErrorMsg('Name required: Please enter a tournament name.');
      notifyAlert('Name required', 'Please enter a tournament name.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const { data: tRow, error: tErr } = await supabase
      .from('tournaments')
      .insert({
        name: name.trim(),
        starts_on: startsOn,
        ends_on: endsOn,
        status: 'draft',
        created_by: userId,
      })
      .select('id')
      .single();

    if (tErr || !tRow) {
      busyRef.current = false;
      setBusy(false);
      const msg = tErr?.message ?? 'Unknown error';
      setErrorMsg(`Could not create tournament: ${msg}`);
      notifyAlert('Could not create tournament', msg);
      return;
    }

    const tournamentId = tRow.id as string;

    busyRef.current = false;
    setBusy(false);
    router.replace({ pathname: '/(admin)/tournaments/[id]', params: { id: tournamentId } });
  }

  return (
    <ScreenContainer maxWidth={520} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>New tournament</Text>
        <Text style={styles.subtitle}>
          Start in draft. Add divisions and publish when you&apos;re ready.
        </Text>
      </View>

      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />

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
          <DateInput value={startsOn} onChange={setStartsOn} placeholder="YYYY-MM-DD" min="today" />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Ends on</Text>
          <DateInput value={endsOn} onChange={setEndsOn} placeholder="YYYY-MM-DD" min={startsOn || 'today'} />
        </View>
      </View>

      <Button onPress={submit} loading={busy} size="lg" style={styles.submit}>
        Create tournament
      </Button>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.lg },
  heading: { gap: spacing.xs },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted },
  section: { gap: spacing.md },
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
  submit: { marginTop: spacing.md },
});
