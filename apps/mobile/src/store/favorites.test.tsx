import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { sofaDto } from '../test/fixtures';
import { FAVORITES_STORAGE_KEY, FavoritesProvider, useFavorites } from './favorites';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const wrapper = ({ children }: { children: ReactNode }) => <FavoritesProvider>{children}</FavoritesProvider>;

describe('favorites store', () => {
  beforeEach(() => AsyncStorage.clear());

  it('toggles a product in and out of favorites', async () => {
    const { result } = await renderHook(() => useFavorites(), { wrapper });
    expect(result.current.isFavorite(sofaDto.id)).toBe(false);

    await act(() => result.current.toggleFavorite(sofaDto.id));
    expect(result.current.isFavorite(sofaDto.id)).toBe(true);
    expect(result.current.favoriteIds).toEqual([sofaDto.id]);

    await act(() => result.current.toggleFavorite(sofaDto.id));
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('keeps favorites on the device across app launches', async () => {
    const first = await renderHook(() => useFavorites(), { wrapper });
    await act(() => first.result.current.toggleFavorite(sofaDto.id));
    await waitFor(async () => expect(await AsyncStorage.getItem(FAVORITES_STORAGE_KEY)).toBe(JSON.stringify([sofaDto.id])));
    await first.unmount();

    const second = await renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(second.result.current.isFavorite(sofaDto.id)).toBe(true));
  });

  it('starts empty when the stored favorites cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, '{not json');

    const { result } = await renderHook(() => useFavorites(), { wrapper });
    // Once read, the unreadable value is replaced.
    await waitFor(async () => expect(await AsyncStorage.getItem(FAVORITES_STORAGE_KEY)).toBe('[]'));
    expect(result.current.favoriteIds).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
