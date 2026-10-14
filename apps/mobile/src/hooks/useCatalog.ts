import type { FurnitureCategory } from '@airoom/shared';
import { getCategories, getProduct, getProducts } from '../api/client';
import { useAsync } from './useAsync';

export function useCategories() {
  return useAsync((signal) => getCategories(signal), []);
}

export function useProducts(category: FurnitureCategory | undefined, search: string) {
  return useAsync((signal) => getProducts({ category, search }, signal), [category, search]);
}

export function useProduct(id: string) {
  return useAsync((signal) => getProduct(id, signal), [id]);
}
