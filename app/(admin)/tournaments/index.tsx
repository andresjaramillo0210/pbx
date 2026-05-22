import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Button from '../../../src/components/Button';
import Card from '../../../src/components/Card';
import EmptyState from '../../../src/components/EmptyState';
import ScreenContainer from '../../../src/components/ScreenContainer';
import StatusPill from '../../../src/components/StatusPill';
import { supabase } from '../../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../../src/theme';

type Row = { id: string; name: string; status: string; starts_on: string | null };

export default function AdminTournaments() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setError(null);
        const { data, error: err } = await supabase
          .from('tournaments')
          .select('id, name, status, starts_on')
          .order('starts_on', { ascending: false, nullsFirst: false });
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRows([]);
          return;
        }
        setRows((data ?? []) as Row[]);
      })();
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <ScreenContainer>
      <View style={styles.topBar}>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => router.push('/(admin)/courts')}
        >
          Manage courts
        </Button>
      </View>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tournaments</Text>
          <Text style={styles.subtitle}>Manage your club&apos;s events</Text>
        </View>
        <Button onPress={() => router.push('/(admin)/tournaments/new')}>
          New tournament
        </Button>
      </View>
      {rows === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No tournaments yet"
          message="Spin up your first tournament to start adding divisions, teams, and courts."
          action={
            <Button onPress={() => router.push('/(admin)/tournaments/new')}>
              Create a tournament
            </Button>
          }
        />
      ) : (
        <View style={styles.list}>
          {rows.map((item) => (
            <Card
              key={item.id}
              onPress={() =>
                router.push({ pathname: '/(admin)/tournaments/[id]', params: { id: item.id } })
              }
              accessibilityLabel={`Open tournament ${item.name}`}
            >
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={styles.rowMeta}>
                {item.starts_on ? `Starts ${item.starts_on}` : 'No date set'}
              </Text>
            </Card>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: { alignItems: 'flex-start' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  list: { gap: spacing.md },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  rowMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  center: { paddingVertical: spacing.xxl, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.destructive },
});
