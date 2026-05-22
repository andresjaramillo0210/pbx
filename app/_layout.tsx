import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, fontWeight } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: fontWeight.semibold as '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bgMuted },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'pbxscape', headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="(public)" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
