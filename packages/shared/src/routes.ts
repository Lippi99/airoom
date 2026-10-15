import type { ClickPlatform } from './clicks';

export const ApiRoutes = {
  health: '/health',
  categories: '/categories',
  products: '/products',
  product: (id: string) => `/products/${encodeURIComponent(id)}`,
  go: (productId: string) => `/go/${encodeURIComponent(productId)}`,
  scenes: '/scenes',
  scene: (id: string) => `/scenes/${encodeURIComponent(id)}`,
} as const;

export interface GoLinkParams {
  platform?: ClickPlatform;
  sessionId?: string;
}

/** Builds the tracked outbound link. The only way the app may open a retailer page. */
export function buildGoUrl(apiBaseUrl: string, productId: string, params: GoLinkParams = {}): string {
  const query = new URLSearchParams();
  if (params.platform) query.set('platform', params.platform);
  if (params.sessionId) query.set('sessionId', params.sessionId);
  const qs = query.toString();
  return `${apiBaseUrl.replace(/\/+$/, '')}${ApiRoutes.go(productId)}${qs ? `?${qs}` : ''}`;
}
