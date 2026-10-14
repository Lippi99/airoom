import type { ReactElement } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import type { ProductDto } from '@airoom/shared';
import { ProductCard } from './ProductCard';
import { spacing } from './theme';

interface Props {
  products: ProductDto[];
  onPressProduct: (product: ProductDto) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListEmptyComponent?: ReactElement;
}

export function ProductGrid({ products, onPressProduct, refreshing, onRefresh, ListEmptyComponent }: Props) {
  const renderItem: ListRenderItem<ProductDto> = ({ item }) => (
    <View style={styles.cell}>
      <ProductCard product={item} onPress={onPressProduct} />
    </View>
  );

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      numColumns={2}
      contentContainerStyle={[styles.content, products.length === 0 && styles.empty]}
      columnWrapperStyle={styles.row}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListEmptyComponent={ListEmptyComponent}
      keyboardDismissMode="on-drag"
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  empty: { flexGrow: 1 },
  row: { gap: spacing.md },
  cell: { flex: 1, maxWidth: '50%' },
});
