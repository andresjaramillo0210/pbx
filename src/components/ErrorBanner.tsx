import { Pressable, StyleSheet, Text, View } from 'react-native';

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
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  message: {
    flex: 1,
    color: '#991b1b',
    fontSize: 14,
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
    color: '#991b1b',
    fontSize: 16,
    fontWeight: '700',
  },
});
