import { router } from 'expo-router';
import type { ProductDto } from '@airoom/shared';
import { ProductGrid } from '../../src/components/ProductGrid';
import { EmptyView } from '../../src/components/StateViews';
import { useFavorites } from '../../src/store/favorites';

export default function FavoritesScreen() {
  const { favorites } = useFavorites();

  const openProduct = (product: ProductDto) =>
    router.push({ pathname: '/product/[id]', params: { id: product.id } });

  return (
    <ProductGrid
      products={favorites}
      onPressProduct={openProduct}
      ListEmptyComponent={
        <EmptyView title="No favorites yet" message="Tap “Save” on a product to keep it here." />
      }
    />
  );
}
