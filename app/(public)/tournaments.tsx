import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Card from '../../src/components/Card';
import EmptyState from '../../src/components/EmptyState';
import ScreenContainer from '../../src/components/ScreenContainer';
import { supabase } from '../../src/lib/supabase';
import { colors, fontSize, fontWeight, spacing } from '../../src/theme';

type Row = { id: string; name: string; starts_on: string | null };

export default function PublicTournaments() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, starts_on')
        .neq('status', 'draft')
        .order('starts_on', { ascending: false, nullsFirst: false });
      setRows((data ?? []) as Row[]);
    })();
  }, []);

  if (rows === null) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.heading}>
        <Text style={styles.title}>Tournaments</Text>
        <Text style={styles.subtitle}>Westminster Pickleball Xscape</Text>
      </View>
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          message="No tournaments have been published. Check back soon."
        />
      ) : (
        <View style={styles.list}>
          {rows.map((item) => (
            <Card
              key={item.id}
              onPress={() => router.push({ pathname: '/(public)/t/[id]', params: { id: item.id } })}
              accessibilityLabel={`Open tournament ${item.name}`}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowMeta}>{item.starts_on ?? 'No date set'}</Text>
            </Card>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  heading: { gap: spacing.xs, marginBottom: spacing.sm },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    color: colors.text,
  },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  list: { gap: spacing.md },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.text,
  },
  rowMeta: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
});
