import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { createElement, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radii, spacing } from '../theme';

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  style?: any;
  /** Minimum date as YYYY-MM-DD (inclusive). Pass `'today'` for the current day. */
  min?: string;
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(s: string | null): Date {
  if (s && DATE_RE.test(s)) {
    const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
    return new Date(y, m - 1, d);
  }
  return new Date();
}

export default function DateInput({ value, onChange, placeholder, style, min }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(parseDate(value));
  const resolvedMin = min === 'today' ? todayYmd() : min;
  const minDate = resolvedMin ? parseDate(resolvedMin) : undefined;

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value: value ?? '',
      placeholder,
      min: resolvedMin,
      onChange: (e: any) => {
        const v = e.target.value as string;
        onChange(v === '' ? null : v);
      },
      style: {
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.borderStrong,
        borderRadius: radii.md,
        padding: spacing.md,
        fontSize: fontSize.md,
        fontFamily: 'inherit',
        backgroundColor: colors.bg,
        color: colors.text,
        boxSizing: 'border-box',
        width: '100%',
        minHeight: 44,
        ...(style ?? {}),
      },
    });
  }

  function openPicker() {
    setTempDate(parseDate(value));
    setPickerOpen(true);
  }

  function onChangeNative(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') {
      setPickerOpen(false);
      if (_event.type === 'set' && selected) {
        onChange(formatDate(selected));
      }
      return;
    }
    // iOS: keep modal open until user confirms
    if (selected) setTempDate(selected);
  }

  function confirmIos() {
    onChange(formatDate(tempDate));
    setPickerOpen(false);
  }

  function clearValue() {
    onChange(null);
    setPickerOpen(false);
  }

  const display = value && DATE_RE.test(value) ? value : '';

  return (
    <View>
      <Pressable onPress={openPicker} style={[styles.input, style]}>
        <Text style={display ? styles.value : styles.placeholder}>
          {display || placeholder || 'YYYY-MM-DD'}
        </Text>
      </Pressable>

      {pickerOpen && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={onChangeNative}
          minimumDate={minDate}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={onChangeNative}
                minimumDate={minDate}
              />
              <View style={styles.modalActions}>
                <Pressable onPress={clearValue} style={styles.modalSecondary}>
                  <Text style={styles.modalSecondaryText}>Clear</Text>
                </Pressable>
                <Pressable onPress={() => setPickerOpen(false)} style={styles.modalSecondary}>
                  <Text style={styles.modalSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={confirmIos} style={styles.modalPrimary}>
                  <Text style={styles.modalPrimaryText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  value: { fontSize: fontSize.md, color: colors.text },
  placeholder: { fontSize: fontSize.md, color: '#94a3b8' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.bg,
    padding: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalSecondaryText: { color: colors.text, fontWeight: '600', fontSize: fontSize.base },
  modalPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalPrimaryText: { color: colors.primaryText, fontWeight: '600', fontSize: fontSize.base },
});
