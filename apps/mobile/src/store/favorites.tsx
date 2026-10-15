import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key of the favorite product ids (JSON array). */
export const FAVORITES_STORAGE_KEY = 'airoom.favorites.v1';

interface FavoritesContextValue {
  /** Favorite product ids, in the order they were added. */
  favoriteIds: string[];
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * Favorite products, kept on the device so they survive app restarts. Only ids are stored:
 * screens look the products up in the catalog, so prices and model URLs stay current and
 * products no longer sold drop out.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  /** Nothing is written before the stored ids are read (it would erase them). */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void readStoredIds().then((stored) => {
      if (!active) return;
      // Ids toggled while reading are kept too.
      setFavoriteIds((current) => [...new Set([...stored, ...current])]);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds)).catch((error: unknown) =>
      console.warn('Could not save favorites', error),
    );
  }, [favoriteIds, loaded]);

  const isFavorite = useCallback((productId: string) => favoriteIds.includes(productId), [favoriteIds]);

  const toggleFavorite = useCallback((productId: string) => {
    setFavoriteIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId],
    );
  }, []);

  const value = useMemo(
    () => ({ favoriteIds, isFavorite, toggleFavorite }),
    [favoriteIds, isFavorite, toggleFavorite],
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used inside <FavoritesProvider>');
  return ctx;
}

/** The stored ids; empty when there are none or they can't be read. */
async function readStoredIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch (error) {
    console.warn('Could not read favorites', error);
    return [];
  }
}
