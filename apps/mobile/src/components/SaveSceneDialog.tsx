import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SCENE_NAME_MAX_LENGTH } from '@airoom/shared';
import { colors, spacing } from './theme';

interface Props {
  visible: boolean;
  /** Prefilled name (the scene's current name when it was saved before). */
  initialName: string;
  saving: boolean;
  /** What saving is doing right now (shown while saving). */
  progress?: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** Asks for the scene's name and saves it. */
export function SaveSceneDialog({ visible, initialName, saving, progress, onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);
  const trimmed = name.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>Save scene</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Living room"
            placeholderTextColor={colors.textMuted}
            maxLength={SCENE_NAME_MAX_LENGTH}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => trimmed && !saving && onSave(trimmed)}
            style={styles.input}
            accessibilityLabel="Scene name"
          />
          {saving && progress ? <Text style={styles.progress}>{progress}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.button, styles.secondary]}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !trimmed || saving, busy: saving }}
              disabled={!trimmed || saving}
              onPress={() => onSave(trimmed)}
              style={[styles.button, styles.primary, (!trimmed || saving) && styles.disabled]}
            >
              {saving ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.primaryText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  progress: { color: colors.textMuted, fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
