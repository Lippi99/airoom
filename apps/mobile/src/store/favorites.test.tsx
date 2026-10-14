import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { sofaDto } from '../test/fixtures';
import { FavoritesProvider, useFavorites } from './favorites';

const wrapper = ({ children }: { children: ReactNode }) => <FavoritesProvider>{children}</FavoritesProvider>;

describe('favorites store', () => {
  it('toggles a product in and out of favorites', async () => {
    const { result } = await renderHook(() => useFavorites(), { wrapper });
    expect(result.current.isFavorite(sofaDto.id)).toBe(false);

    await act(() => result.current.toggleFavorite(sofaDto));
    expect(result.current.isFavorite(sofaDto.id)).toBe(true);
    expect(result.current.favorites).toEqual([sofaDto]);

    await act(() => result.current.toggleFavorite(sofaDto));
    expect(result.current.favorites).toEqual([]);
  });
});
