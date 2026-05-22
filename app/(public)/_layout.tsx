import { Stack } from 'expo-router';
import { colors, fontWeight } from '../../src/theme';

export default function PublicLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold as '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bgMuted },
      }}
    >
      <Stack.Screen name="tournaments" options={{ title: 'Tournaments' }} />
      <Stack.Screen name="t/[id]" options={{ title: 'Tournament' }} />
      <Stack.Screen
        name="t/[id]/divisions/[divisionId]"
        options={{ title: 'Division' }}
      />
    </Stack>
  );
}
