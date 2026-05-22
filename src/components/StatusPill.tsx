import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { fontSize, fontWeight, radii, spacing, tracking } from '../theme';

type Props = {
  status: string;
  /** Override the displayed label (e.g. "Waiting on Court 3"). Color follows
   * the underlying status. */
  labelOverride?: string;
};

// Map a raw status string from the DB to its on-screen label + colors.
// Soft background (~15% opacity of the base hue) + dark text version.
//
// Match statuses (`pending`, `scheduled`, `in_progress`, `reported`, `forfeit`,
// `voided`) and tournament/division statuses (`draft`, `published`, `open`,
// `locked`, `running`, `complete`, ...) all flow through here. Some strings
// overlap (e.g. `in_progress` is used by both tournaments and matches) so the
// shared meaning is fine.
function statusMeta(status: string): { label: string; bg: string; fg: string } {
  switch (status) {
    // --- Tournament statuses ---
    case 'draft':
      return { label: 'Draft', bg: '#f1f5f9', fg: '#475569' };
    case 'published':
      return { label: 'Published', bg: '#dbeafe', fg: '#1d4ed8' };
    case 'completed':
      return { label: 'Complete', bg: '#e2e8f0', fg: '#334155' };
    case 'archived':
      return { label: 'Archived', bg: '#e2e8f0', fg: '#475569' };
    // --- Division statuses ---
    case 'open':
      return { label: 'Registration open', bg: '#dbeafe', fg: '#1d4ed8' };
    case 'locked':
      return { label: 'Locked', bg: '#fef3c7', fg: '#92400e' };
    case 'running':
      return { label: 'Running', bg: '#dcfce7', fg: '#166534' };
    case 'complete':
      return { label: 'Complete', bg: '#e2e8f0', fg: '#334155' };
    // --- Match statuses (recolored) ---
    // Pending / scheduled => soft amber (statusLocked hue).
    case 'pending':
      return { label: 'Pending', bg: '#fef3c7', fg: '#92400e' };
    case 'scheduled':
      return { label: 'Scheduled', bg: '#fef3c7', fg: '#92400e' };
    // In progress => green (statusRunning).
    case 'in_progress':
      return { label: 'Live', bg: '#dcfce7', fg: '#166534' };
    // Synthetic status: a later-round pending match that's waiting on a
    // shared player still in an earlier-round match. Muted slate so it reads
    // as "not active yet" vs the amber "Pending" which is ready to play.
    case 'not_started':
      return { label: 'Not started', bg: '#f1f5f9', fg: '#64748b' };
    // Reported => green (done).
    case 'reported':
      return { label: 'Done', bg: '#dcfce7', fg: '#166534' };
    case 'forfeit':
      return { label: 'Forfeit', bg: '#dcfce7', fg: '#166534' };
    case 'voided':
      return { label: 'Voided', bg: '#e2e8f0', fg: '#334155' };
    default:
      return { label: status, bg: '#f1f5f9', fg: '#475569' };
  }
}

export default function StatusPill({ status, labelOverride }: Props) {
  const m = statusMeta(status);
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <Text style={[styles.text, { color: m.fg }]}>{labelOverride ?? m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: tracking.capsLoose,
  },
});
