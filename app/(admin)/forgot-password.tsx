import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../src/components/Button';
import Card from '../../src/components/Card';
import ErrorBanner from '../../src/components/ErrorBanner';
import Input from '../../src/components/Input';
import ScreenContainer from '../../src/components/ScreenContainer';
import { notifyAlert } from '../../src/lib/notify';
import { supabase } from '../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../src/theme';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const busyRef = useRef(false);

  async function submit() {
    if (busyRef.current) return;
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError('Enter your email.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);

    // Where the recovery link should drop the user back into the app. On web
    // this is the current origin + /(admin)/reset-password. The route group
    // (admin) is a folder on disk but doesn't appear in the URL — Expo Router
    // strips parenthesised segments. So `/reset-password` is the visible URL.
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'https://pbx-zeta.vercel.app';
    const redirectTo = `${origin}/reset-password`;

    const { error: err } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo,
    });
    busyRef.current = false;
    setBusy(false);
    if (err) {
      setError(err.message);
      notifyAlert('Could not send reset email', err.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <ScreenContainer>
        <Card>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.body}>
            We sent a password reset link to {email.trim().toLowerCase()}. Click
            it to set a new password. The link expires in 1 hour.
          </Text>
          <View style={styles.actionsRow}>
            <Button variant="ghost" onPress={() => router.replace('/(admin)/login')}>
              Back to sign in
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
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.body}>
          Enter the email tied to your admin account. We'll send a link to set
          a new password.
        </Text>
        <View style={styles.field}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@club.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button variant="ghost" onPress={() => router.replace('/(admin)/login')}>
            Cancel
          </Button>
          <Button onPress={submit} loading={busy}>
            Send reset link
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
