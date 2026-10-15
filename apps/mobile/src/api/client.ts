import { Platform } from 'react-native';
import {
  ApiRoutes,
  buildGoUrl,
  isClickPlatform,
  type ApiErrorDto,
  type CategoryDto,
  type ProductDto,
  type ProductListQuery,
  type SaveSceneRequest,
  type SceneDto,
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

interface RequestOptions {
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions | AbortSignal = {}): Promise<T> {
  const { signal, method = 'GET', body } = options instanceof AbortSignal ? { signal: options } : options;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      signal,
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.', null);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorDto> | null;
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.error);
  }
  if (res.status === 204) return undefined as T;
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

/** Saved scenes, most recently updated first. */
export function getScenes(signal?: AbortSignal): Promise<SceneDto[]> {
  return request(ApiRoutes.scenes, signal);
}

export function getScene(id: string, signal?: AbortSignal): Promise<SceneDto> {
  return request(ApiRoutes.scene(id), signal);
}

export function createScene(scene: SaveSceneRequest): Promise<SceneDto> {
  return request(ApiRoutes.scenes, { method: 'POST', body: scene });
}

export function updateScene(id: string, scene: SaveSceneRequest): Promise<SceneDto> {
  return request(ApiRoutes.scene(id), { method: 'PUT', body: scene });
}

export function deleteScene(id: string): Promise<void> {
  return request(ApiRoutes.scene(id), { method: 'DELETE' });
}
