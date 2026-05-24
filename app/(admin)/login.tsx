import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import Button from '../../src/components/Button';
import ErrorBanner from '../../src/components/ErrorBanner';
import Input from '../../src/components/Input';
import ScreenContainer from '../../src/components/ScreenContainer';
import { notifyAlert } from '../../src/lib/notify';
import { supabase } from '../../src/lib/supabase';
import { colors, fontSize, fontWeight, radii, shadows, spacing, tracking } from '../../src/theme';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busyRef = useRef(false);
  const passwordRef = useRef<TextInput>(null);

  async function signIn() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const normalized = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    busyRef.current = false;
    setBusy(false);
    if (error) {
      setErrorMsg(`Sign in failed: ${error.message}`);
      notifyAlert('Sign in failed', error.message);
      return;
    }
    router.replace('/(admin)/tournaments');
  }

  return (
    <ScreenContainer maxWidth={440} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>pbxscape admin</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to manage tournaments and courts.</Text>
      </View>
      <ErrorBanner error={errorMsg} onDismiss={() => setErrorMsg(null)} />
      <View style={styles.card}>
        <Input
          label="Email"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
          placeholder="you@club.com"
        />
        <Input
          ref={passwordRef}
          label="Password"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={signIn}
          value={password}
          onChangeText={setPassword}
        />
        <Button onPress={signIn} loading={busy} size="lg" style={styles.submit}>
          Sign in
        </Button>
        <Pressable
          onPress={() => router.push('/(admin)/forgot-password')}
          accessibilityRole="link"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.forgotLink,
            (hovered || pressed) && styles.forgotLinkActive,
          ]}
        >
          <Text style={styles.forgotLinkText}>Forgot your password?</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.xxl },
  heading: { gap: spacing.xs, marginBottom: spacing.sm },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.primarySoftText,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textMuted,
  },
  // The form lives in a raised dark card so it pops off the page bg.
  card: {
    gap: spacing.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  submit: { marginTop: spacing.sm },
  forgotLink: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  forgotLinkActive: { opacity: 0.65 },
  forgotLinkText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    textDecorationLine: 'underline',
  },
});
