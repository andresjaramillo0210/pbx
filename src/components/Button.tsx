import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, fontWeight, radii, spacing } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = {
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
};

export default function Button({
  onPress,
  disabled,
  loading,
  variant = 'primary',
  size = 'md',
  children,
  style,
  textStyle,
  accessibilityLabel,
}: Props) {
  const isDisabled = !!(disabled || loading);
  const variantContainer = containerByVariant[variant];
  const variantText = textByVariant[variant];
  const sizeContainer = containerBySize[size];
  const sizeText = textBySize[size];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        variantContainer,
        sizeContainer,
        hovered && !isDisabled && hoverByVariant[variant],
        pressed && !isDisabled && pressedByVariant[variant],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'primary'
              ? colors.primaryText
              : variant === 'destructive'
                ? '#ffffff'
                : colors.primary
          }
        />
      ) : (
        <Text style={[styles.text, variantText, sizeText, textStyle]} numberOfLines={1}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  text: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

const containerByVariant: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border },
  destructive: { backgroundColor: colors.destructive },
  ghost: { backgroundColor: 'transparent' },
};

const hoverByVariant: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primaryHover },
  secondary: { backgroundColor: colors.secondaryHover },
  destructive: { backgroundColor: colors.destructiveHover },
  ghost: { backgroundColor: colors.secondary },
};

const pressedByVariant: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primaryPressed, opacity: 0.92 },
  secondary: { backgroundColor: colors.borderStrong, opacity: 0.92 },
  destructive: { backgroundColor: colors.destructiveHover, opacity: 0.92 },
  ghost: { backgroundColor: colors.border, opacity: 0.92 },
};

const textByVariant: Record<ButtonVariant, TextStyle> = {
  primary: { color: colors.primaryText },
  secondary: { color: colors.secondaryText },
  // Destructive uses pure white on red for max contrast; the near-black
  // primaryText would muddy the red bg.
  destructive: { color: '#ffffff' },
  ghost: { color: colors.primary },
};

const containerBySize: Record<ButtonSize, ViewStyle> = {
  sm: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  md: { minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  lg: { minHeight: 52, paddingHorizontal: spacing.xl, paddingVertical: spacing.md + 2 },
};

const textBySize: Record<ButtonSize, TextStyle> = {
  sm: { fontSize: fontSize.sm },
  md: { fontSize: fontSize.base },
  lg: { fontSize: fontSize.md },
};
