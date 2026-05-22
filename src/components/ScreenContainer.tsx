import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

type Props = {
  children: React.ReactNode;
  // Wrapper background; defaults to muted page background.
  background?: 'muted' | 'bg';
  // Use scroll for content-heavy screens (most). Disable for fixed-layout
  // screens (centered hero, etc.) where you want flex centering.
  scroll?: boolean;
  // Max content width.
  maxWidth?: number;
  // Add a KeyboardAvoidingView wrapper - on by default for forms.
  avoidKeyboard?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

export default function ScreenContainer({
  children,
  background = 'muted',
  scroll = true,
  maxWidth = 720,
  avoidKeyboard = true,
  contentContainerStyle,
  style,
}: Props) {
  const insets = useSafeAreaInsets();
  const bg = background === 'muted' ? colors.bgMuted : colors.bg;

  const inner = scroll ? (
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: spacing.xxl + insets.bottom, maxWidth },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.fixed,
        { backgroundColor: bg, paddingBottom: insets.bottom, maxWidth },
        contentContainerStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = (
    <View style={[styles.outer, { backgroundColor: bg }, style]}>{inner}</View>
  );

  if (!avoidKeyboard) return body;

  // Web doesn't need KeyboardAvoidingView (browser handles the soft keyboard).
  if (Platform.OS === 'web') return body;

  // iOS: padding mode is the standard recommendation.
  // Android: height mode lifts the content above the soft keyboard reliably;
  // padding mode underflows behind the IME on many devices.
  const behavior: 'padding' | 'height' = Platform.OS === 'ios' ? 'padding' : 'height';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={behavior}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'stretch' },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    alignSelf: 'center',
  },
  fixed: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    alignSelf: 'center',
  },
});
