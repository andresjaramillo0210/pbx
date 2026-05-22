import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { supabase } from '../../src/lib/supabase';
import { colors, fontWeight } from '../../src/theme';

export default function AdminLayout() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session && !pathname.endsWith('/login')) {
        router.replace('/(admin)/login');
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !pathname.endsWith('/login')) {
        router.replace('/(admin)/login');
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [pathname, router]);

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
      <Stack.Screen name="login" options={{ title: 'Admin sign in' }} />
      <Stack.Screen name="tournaments/index" options={{ title: 'Tournaments' }} />
      <Stack.Screen name="tournaments/new" options={{ title: 'New tournament' }} />
      <Stack.Screen name="tournaments/[id]/index" options={{ title: 'Tournament' }} />
      <Stack.Screen name="tournaments/[id]/edit" options={{ title: 'Edit tournament' }} />
      <Stack.Screen name="tournaments/[id]/divisions/new" options={{ title: 'New division' }} />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/index"
        options={{ title: 'Division' }}
      />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/edit"
        options={{ title: 'Edit division' }}
      />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/teams/new"
        options={{ title: 'New team' }}
      />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/teams/[teamId]/edit"
        options={{ title: 'Edit team' }}
      />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/generate"
        options={{ title: 'Generate matches' }}
      />
      <Stack.Screen
        name="tournaments/[id]/divisions/[divisionId]/matches/[matchId]/score"
        options={{ title: 'Enter score' }}
      />
      <Stack.Screen name="courts/index" options={{ title: 'Courts' }} />
    </Stack>
  );
}
