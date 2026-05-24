import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { fontSize, fontWeight, radii, spacing, tracking } from '../theme';

type Props = {
  status: string;
  /** Override the displayed label (e.g. "Waiting on Court 3"). Color follows
   * the underlying status. */
  labelOverride?: string;
};

// Map a raw status string from the DB to its on-screen label + colors.
// Dark-mode palette: each pill uses a deeply-tinted background of its hue
// (a few percent saturation lift over the bg) plus a bright accent text
// color that stays readable on the dark tint.
//
// Match statuses (`pending`, `scheduled`, `in_progress`, `reported`, `forfeit`,
// `voided`) and tournament/division statuses (`draft`, `published`, `open`,
// `locked`, `running`, `complete`, ...) all flow through here. Some strings
// overlap (e.g. `in_progress` is used by both tournaments and matches) so the
// shared meaning is fine.
//
// Tint palette (kept inline because StatusPill is the canonical owner):
//   green   bg #0f2a1a / fg #86efac  — running / live / done
//   blue    bg #1a223a / fg #93c5fd  — published / open
//   amber   bg #2e1f0a / fg #fbbf24  — locked / pending / scheduled
//   slate   bg #1a2336 / fg #94a3b8  — complete / voided / not started / archived
//   muted   bg #1a2336 / fg #cbd5e1  — draft / fallback
function statusMeta(status: string): { label: string; bg: string; fg: string } {
  const green = { bg: '#0f2a1a', fg: '#86efac' };
  const blue = { bg: '#1a223a', fg: '#93c5fd' };
  const amber = { bg: '#2e1f0a', fg: '#fbbf24' };
  const slate = { bg: '#1a2336', fg: '#94a3b8' };
  const muted = { bg: '#1a2336', fg: '#cbd5e1' };
  switch (status) {
    // --- Tournament statuses ---
    case 'draft':
      return { label: 'Draft', ...muted };
    case 'published':
      return { label: 'Published', ...blue };
    case 'completed':
      return { label: 'Complete', ...slate };
    case 'archived':
      return { label: 'Archived', ...slate };
    // --- Division statuses ---
    case 'open':
      return { label: 'Registration open', ...blue };
    case 'locked':
      return { label: 'Locked', ...amber };
    case 'running':
      return { label: 'Running', ...green };
    case 'complete':
      return { label: 'Complete', ...slate };
    // --- Match statuses ---
    // Pending / scheduled => amber (statusLocked hue).
    case 'pending':
      return { label: 'Pending', ...amber };
    case 'scheduled':
      return { label: 'Scheduled', ...amber };
    // In progress => green (statusRunning).
    case 'in_progress':
      return { label: 'Live', ...green };
    // Synthetic status: a later-round pending match that's waiting on a
    // shared player still in an earlier-round match. Muted slate so it reads
    // as "not active yet" vs the amber "Pending" which is ready to play.
    case 'not_started':
      return { label: 'Not started', ...slate };
    // Reported => green (done).
    case 'reported':
      return { label: 'Done', ...green };
    case 'forfeit':
      return { label: 'Forfeit', ...green };
    case 'voided':
      return { label: 'Voided', ...slate };
    default:
      return { label: status, ...muted };
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
