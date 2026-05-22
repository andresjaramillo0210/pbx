import React, { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../theme';

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
  helper?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, helper, containerStyle, style, onFocus, onBlur, ...rest }: Props,
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? colors.destructive
    : focused
      ? colors.borderFocus
      : colors.borderStrong;
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor="#94a3b8"
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { borderColor }, style]}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.caps,
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.md,
    minHeight: 44,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  helper: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    marginTop: 2,
  },
  error: {
    fontSize: fontSize.xs,
    color: colors.destructive,
    marginTop: 2,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
});
