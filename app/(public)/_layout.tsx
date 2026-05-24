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
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="tournaments" options={{ title: 'Tournaments' }} />
      <Stack.Screen name="t/[id]" options={{ title: 'Tournament' }} />
      <Stack.Screen
        name="t/[id]/divisions/[divisionId]/index"
        options={{ title: 'Division' }}
      />
      <Stack.Screen
        name="t/[id]/divisions/[divisionId]/court-board"
        options={{ title: 'Court board' }}
      />
      <Stack.Screen
        name="t/[id]/divisions/[divisionId]/scoreboard"
        options={{ title: 'Scoreboard' }}
      />
    </Stack>
  );
}
