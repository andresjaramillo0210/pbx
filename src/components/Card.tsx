import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii, shadows, spacing } from '../theme';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  // Use `flat` to drop the shadow on screens where shadows compound badly.
  flat?: boolean;
  accessibilityLabel?: string;
};

export default function Card({ children, onPress, style, flat, accessibilityLabel }: Props) {
  const baseStyle = [styles.card, !flat && shadows.card, style];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          ...baseStyle,
          hovered && !flat && shadows.cardHover,
          hovered && styles.hovered,
          pressed && styles.pressed,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={baseStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  hovered: {
    borderColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.95,
    borderColor: colors.borderStrong,
  },
});
