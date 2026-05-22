import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../src/components/Button';
import Card from '../../src/components/Card';
import ErrorBanner from '../../src/components/ErrorBanner';
import Input from '../../src/components/Input';
import ScreenContainer from '../../src/components/ScreenContainer';
import { notifyAlert } from '../../src/lib/notify';
import { supabase } from '../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../src/theme';

// Reached via the recovery email link. Supabase JS auto-signs the user in
// with a temporary session when the link is clicked (PASSWORD_RECOVERY event
// fires on web), then this screen takes over so they can set a new password.

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const busyRef = useRef(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setHasSession(!!data.session);
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    if (busyRef.current) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    busyRef.current = false;
    setBusy(false);
    if (err) {
      setError(err.message);
      notifyAlert('Could not set new password', err.message);
      return;
    }
    notifyAlert('Password updated', 'You can use your new password from now on.');
    router.replace('/(admin)/tournaments');
  }

  if (hasSession === false) {
    return (
      <ScreenContainer>
        <Card>
          <Text style={styles.title}>Recovery link expired</Text>
          <Text style={styles.body}>
            The link you used isn't active anymore (it may have expired or
            already been used). Request a new one to continue.
          </Text>
          <View style={styles.actionsRow}>
            <Button onPress={() => router.replace('/(admin)/forgot-password')}>
              Send a new link
            </Button>
          </View>
        </Card>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <Card>
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.body}>Pick something at least 8 characters long.</Text>
        <View style={styles.field}>
          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => (confirmRef.current as any)?.focus?.()}
          />
        </View>
        <View style={styles.field}>
          <Input
            ref={confirmRef}
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button onPress={submit} loading={busy}>
            Save password
          </Button>
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  field: { marginTop: spacing.lg },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
