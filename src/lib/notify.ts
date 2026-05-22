import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is a no-op (buttons don't render, callbacks don't fire).
// These shims fall back to window.confirm/alert on web so the UX actually works there.

export function notifyAlert(title: string, message?: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function notifyConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  opts?: { confirmLabel?: string; destructive?: boolean; onCancel?: () => void }
) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    else opts?.onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: opts?.onCancel },
    {
      text: opts?.confirmLabel ?? 'OK',
      style: opts?.destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
}

// Promise-returning variant: resolves true on confirm, false on cancel.
// Useful when threading cascade-revert / multi-step decisions through async
// code without nested callback hell.
export function confirmAsync(
  title: string,
  message: string,
  opts?: { confirmLabel?: string; destructive?: boolean },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    notifyConfirm(title, message, () => resolve(true), {
      ...opts,
      onCancel: () => resolve(false),
    });
  });
}
