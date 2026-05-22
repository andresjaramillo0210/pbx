import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { colors, fontSize, fontWeight, radii, spacing } from '../theme';

type Props = {
  title: string;
  message?: string;
  action?: React.ReactNode;
};

export default function EmptyState({ title, message, action }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bgMuted,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.base,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 380,
  },
  action: { marginTop: spacing.md },
});
