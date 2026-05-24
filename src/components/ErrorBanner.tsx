import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { colors, fontSize, fontWeight, radii, spacing } from '../theme';

type Props = {
  error: string | null;
  onDismiss?: () => void;
};

// Inline visible banner for errors. Acts as a safety net for cases where
// react-native-web's Alert.alert is a no-op and the popup never appears.
export default function ErrorBanner({ error, onDismiss }: Props) {
  if (error === null) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.message}>{error}</Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} style={styles.dismiss} accessibilityLabel="Dismiss error">
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.destructiveSoft,
    borderWidth: 1,
    borderColor: colors.destructive,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  message: {
    flex: 1,
    color: colors.destructiveSoftText,
    fontSize: fontSize.base,
  },
  dismiss: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -10,
    marginRight: -8,
  },
  dismissText: {
    color: colors.destructiveSoftText,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
  },
});
