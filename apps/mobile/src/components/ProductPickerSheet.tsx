import { useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CategoryDto, FurnitureCategory, ProductDto } from '@airoom/shared';
import { formatDimensions } from '../utils/format';
import { CategoryFilter } from './CategoryFilter';
import { EmptyView } from './StateViews';
import { colors, spacing } from './theme';

interface Props {
  visible: boolean;
  products: ProductDto[];
  onPick: (product: ProductDto) => void;
  onClose: () => void;
}

/** Bottom sheet over the AR camera to choose the next product to place in the scene. */
export function ProductPickerSheet({ visible, products, onPick, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<FurnitureCategory | undefined>();

  // Only categories that have products, in catalog order.
  const categories = useMemo(() => {
    const seen = new Map<string, CategoryDto>();
    products.forEach((p) => seen.set(p.category.id, p.category));
    return [...seen.values()];
  }, [products]);
  const shown = category ? products.filter((p) => p.category.slug === category) : products;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Add to scene</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <View>
          <CategoryFilter categories={categories} selected={category} onSelect={setCategory} />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyView title="No products here" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name}`}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Image source={{ uri: item.thumbnailUrl }} style={styles.image} />
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.dimensions} numberOfLines={1}>
                {formatDimensions(item.dimensions)}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    height: '68%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  close: { fontSize: 18, color: colors.textMuted },
  list: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.md },
  row: { gap: spacing.sm },
  card: { flex: 1, maxWidth: '33.3%', gap: 2 },
  pressed: { opacity: 0.7 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: colors.border },
  name: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 4 },
  dimensions: { fontSize: 11, color: colors.textMuted },
});
