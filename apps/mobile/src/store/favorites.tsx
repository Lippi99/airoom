import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProductDto } from '@airoom/shared';

interface FavoritesContextValue {
  favorites: ProductDto[];
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (product: ProductDto) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * Favorites kept in memory for the app session.
 * TODO: persist on device (needs a storage dependency, e.g. AsyncStorage).
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<ProductDto[]>([]);

  const isFavorite = useCallback(
    (productId: string) => favorites.some((p) => p.id === productId),
    [favorites],
  );

  const toggleFavorite = useCallback((product: ProductDto) => {
    setFavorites((current) =>
      current.some((p) => p.id === product.id)
        ? current.filter((p) => p.id !== product.id)
        : [...current, product],
    );
  }, []);

  const value = useMemo(
    () => ({ favorites, isFavorite, toggleFavorite }),
    [favorites, isFavorite, toggleFavorite],
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used inside <FavoritesProvider>');
  return ctx;
}
