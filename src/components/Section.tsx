import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { colors, fontSize, fontWeight, spacing, tracking } from '../theme';

type Props = {
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
};

export default function Section({ title, action, children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, marginTop: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 28,
  },
  title: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
    flexShrink: 1,
  },
  action: { flexShrink: 0 },
  body: { gap: spacing.md },
});
