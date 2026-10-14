import { Platform } from 'react-native';
import {
  ApiRoutes,
  buildGoUrl,
  isClickPlatform,
  type ApiErrorDto,
  type CategoryDto,
  type ProductDto,
  type ProductListQuery,
} from '@airoom/shared';
import { API_URL } from '../config';

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null for network failures. */
    readonly status: number | null,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.', null);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorDto> | null;
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.error);
  }
  return (await res.json()) as T;
}

export function getCategories(signal?: AbortSignal): Promise<CategoryDto[]> {
  return request(ApiRoutes.categories, signal);
}

export function getProducts(query: ProductListQuery = {}, signal?: AbortSignal): Promise<ProductDto[]> {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  const search = query.search?.trim();
  if (search) params.set('search', search);
  const qs = params.toString();
  return request(`${ApiRoutes.products}${qs ? `?${qs}` : ''}`, signal);
}

export function getProduct(id: string, signal?: AbortSignal): Promise<ProductDto> {
  return request(ApiRoutes.product(id), signal);
}

/**
 * Tracked purchase link for a product. Retailer URLs are never opened directly;
 * the API records the click and redirects.
 */
export function getBuyUrl(productId: string): string {
  return buildGoUrl(API_URL, productId, {
    platform: isClickPlatform(Platform.OS) ? Platform.OS : undefined,
  });
}
