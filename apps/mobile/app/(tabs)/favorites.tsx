import { useMemo } from 'react';
import { router } from 'expo-router';
import type { ProductDto } from '@airoom/shared';
import { getProducts } from '../../src/api/client';
import { ProductGrid } from '../../src/components/ProductGrid';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/StateViews';
import { useAsync } from '../../src/hooks/useAsync';
import { useFavorites } from '../../src/store/favorites';

export default function FavoritesScreen() {
  const { favoriteIds } = useFavorites();
  // Favorites are stored as ids: look them up in the catalog (products no longer sold drop out).
  const catalog = useAsync((signal) => getProducts({}, signal), []);
  const favorites = useMemo(() => {
    const byId = new Map((catalog.data ?? []).map((p) => [p.id, p]));
    return favoriteIds.flatMap((id) => byId.get(id) ?? []);
  }, [catalog.data, favoriteIds]);

  const openProduct = (product: ProductDto) =>
    router.push({ pathname: '/product/[id]', params: { id: product.id } });

  if (catalog.status === 'error' && !catalog.data) {
    return <ErrorView message={catalog.error.message} onRetry={catalog.reload} />;
  }
  if (!catalog.data) return <LoadingView />;

  return (
    <ProductGrid
      products={favorites}
      onPressProduct={openProduct}
      refreshing={catalog.status === 'loading'}
      onRefresh={catalog.reload}
      ListEmptyComponent={
        <EmptyView title="No favorites yet" message="Tap “Save” on a product to keep it here." />
      }
    />
  );
}
