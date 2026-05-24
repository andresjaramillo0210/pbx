// Admin UI for managing a division's sponsor logos. Handles upload to the
// Supabase Storage `sponsors` bucket, per-row size selection (large/medium/
// small), and deletion. Image picker is web-only — admins work on web/tablet
// browser, native iOS upload can come later via expo-image-picker.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, fontSize, fontWeight, radii, spacing, tracking } from '../theme';
import Button from './Button';

export type SponsorSize = 'large' | 'medium' | 'small';

export type Sponsor = {
  id: string;
  division_id: string;
  image_url: string;
  size: SponsorSize;
  display_order: number;
};

type Props = {
  divisionId: string;
  /** Called whenever the sponsor list changes so the parent can refresh. */
  onChange?: () => void;
};

export default function SponsorManager({ divisionId, onChange }: Props) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: dbError } = await supabase
      .from('sponsors')
      .select('id, division_id, image_url, size, display_order')
      .eq('division_id', divisionId)
      .order('display_order', { ascending: true });
    if (dbError) {
      setError(dbError.message);
    } else {
      setSponsors((data as Sponsor[]) ?? []);
    }
    setLoading(false);
  }, [divisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickAndUpload = async () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError('Sponsor upload is currently web-only. Use the browser admin to add logos.');
      return;
    }
    setError(null);
    const file = await pickImageFile();
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${divisionId}/${Date.now()}.${ext}`;
      const { data: upRes, error: upErr } = await supabase.storage
        .from('sponsors')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = supabase.storage.from('sponsors').getPublicUrl(upRes.path);

      const nextOrder = sponsors.length;
      const { error: insErr } = await supabase
        .from('sponsors')
        .insert({ division_id: divisionId, image_url: publicUrl, size: 'medium', display_order: nextOrder });
      if (insErr) throw insErr;

      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const updateSize = async (sponsorId: string, size: SponsorSize) => {
    setError(null);
    // Optimistic update.
    setSponsors((prev) => prev.map((s) => (s.id === sponsorId ? { ...s, size } : s)));
    const { error: updErr } = await supabase.from('sponsors').update({ size }).eq('id', sponsorId);
    if (updErr) {
      setError(updErr.message);
      await load();
    } else {
      onChange?.();
    }
  };

  const remove = async (sponsor: Sponsor) => {
    setError(null);
    // Best-effort: remove storage object too. If it was uploaded from
    // elsewhere we just leave the row delete to handle the database side.
    const url = sponsor.image_url;
    const marker = '/storage/v1/object/public/sponsors/';
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      const objectPath = url.slice(idx + marker.length);
      await supabase.storage.from('sponsors').remove([objectPath]);
    }
    const { error: delErr } = await supabase.from('sponsors').delete().eq('id', sponsor.id);
    if (delErr) {
      setError(delErr.message);
    } else {
      await load();
      onChange?.();
    }
  };

  return (
    <View style={styles.wrap}>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <View style={styles.header}>
        <Text style={styles.headerHint}>
          LARGE = full-width banner · MEDIUM = two per row · SMALL = logo strip
        </Text>
        <Button onPress={pickAndUpload} loading={uploading} size="sm">
          Upload logo
        </Button>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sponsors.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No sponsors yet. Upload a logo to get started.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sponsors.map((s) => (
            <View key={s.id} style={styles.row}>
              <Image source={{ uri: s.image_url }} style={styles.thumb} resizeMode="contain" />
              <View style={styles.rowControls}>
                <View style={styles.sizeRow}>
                  {(['large', 'medium', 'small'] as SponsorSize[]).map((sz) => {
                    const active = s.size === sz;
                    return (
                      <Pressable
                        key={sz}
                        onPress={() => { void updateSize(s.id, sz); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.sizeBtn,
                          active && styles.sizeBtnActive,
                          !active && (hovered || pressed) && styles.sizeBtnHover,
                        ]}
                      >
                        <Text style={[styles.sizeBtnText, active && styles.sizeBtnTextActive]}>
                          {sz === 'large' ? 'L' : sz === 'medium' ? 'M' : 'S'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  onPress={() => { void remove(s); }}
                  accessibilityRole="button"
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.removeBtn,
                    (hovered || pressed) && styles.removeBtnActive,
                  ]}
                >
                  <Text style={styles.removeBtnText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  headerHint: {
    flex: 1,
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  center: { padding: spacing.lg, alignItems: 'center' },
  errorBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.destructiveSoft,
    borderWidth: 1,
    borderColor: colors.destructive,
  },
  errorText: { color: colors.destructiveSoftText, fontSize: fontSize.sm },
  emptyBox: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyText: { color: colors.textMuted, fontSize: fontSize.sm },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    width: 96,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  rowControls: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  sizeRow: { flexDirection: 'row', gap: 4 },
  sizeBtn: {
    minWidth: 36,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bgMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  sizeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sizeBtnHover: { backgroundColor: colors.bg },
  sizeBtnText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: tracking.caps,
  },
  sizeBtnTextActive: { color: colors.primaryText },
  removeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeBtnActive: { borderColor: colors.destructive },
  removeBtnText: { color: colors.textMuted, fontSize: fontSize.sm },
});
