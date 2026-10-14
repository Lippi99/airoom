import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { CategoryDto, FurnitureCategory } from '@airoom/shared';
import { colors, spacing } from './theme';

interface Props {
  categories: CategoryDto[];
  selected: FurnitureCategory | undefined;
  onSelect: (slug: FurnitureCategory | undefined) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: Props) {
  const chips: { slug: FurnitureCategory | undefined; label: string }[] = [
    { slug: undefined, label: 'All' },
    ...categories.map((c) => ({ slug: c.slug, label: c.name })),
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chips.map(({ slug, label }) => {
        const active = slug === selected;
        return (
          <Pressable
            key={slug ?? 'all'}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(slug)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.text, fontSize: 14 },
  labelActive: { color: colors.accentText, fontWeight: '600' },
});
