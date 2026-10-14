import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import type { FurnitureCategory, ProductDto } from '@airoom/shared';
import { CategoryFilter } from '../../src/components/CategoryFilter';
import { ProductGrid } from '../../src/components/ProductGrid';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/StateViews';
import { colors, spacing } from '../../src/components/theme';
import { useCategories, useProducts } from '../../src/hooks/useCatalog';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';

export default function CatalogScreen() {
  const [category, setCategory] = useState<FurnitureCategory | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());

  const categories = useCategories();
  const products = useProducts(category, search);

  const openProduct = (product: ProductDto) =>
    router.push({ pathname: '/product/[id]', params: { id: product.id } });

  let content: ReactElement;
  if (products.status === 'error' && !products.data) {
    content = <ErrorView message={products.error.message} onRetry={products.reload} />;
  } else if (!products.data) {
    content = <LoadingView />;
  } else {
    content = (
      <ProductGrid
        products={products.data}
        onPressProduct={openProduct}
        refreshing={products.status === 'loading'}
        onRefresh={products.reload}
        ListEmptyComponent={
          <EmptyView title="No products found" message="Try another category or search term." />
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        value={searchInput}
        onChangeText={setSearchInput}
        placeholder="Search furniture"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        style={styles.search}
      />
      {categories.data && (
        <View>
          <CategoryFilter categories={categories.data} selected={category} onSelect={setCategory} />
        </View>
      )}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
});
