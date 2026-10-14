import { statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import type { ProductDto } from '@airoom/shared';

/**
 * Asset URLs in the catalog may be absolute (CDN) or relative to this API (`/static/...`,
 * development assets). Relative ones are made absolute with the origin the client used,
 * so they work over USB (`localhost`) and Wi-Fi (the PC's IP) alike.
 */
export function requestOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

/** Returns a version tag for a relative asset path, or undefined. */
export type AssetVersioner = (urlPath: string) => string | undefined;

/**
 * Versions `/static/...` files by modification time. The app caches models by URL, so a
 * regenerated model must get a new URL or devices keep showing the old one.
 */
export function staticAssetVersioner(staticRoot: string): AssetVersioner {
  return (urlPath) => {
    if (!urlPath.startsWith('/static/')) return undefined;
    try {
      const file = path.join(staticRoot, ...urlPath.slice('/static/'.length).split('/'));
      return Math.floor(statSync(file).mtimeMs).toString(36);
    } catch {
      return undefined;
    }
  };
}

export function absoluteUrl(url: string, origin: string, versioner?: AssetVersioner): string {
  if (!url.startsWith('/')) return url;
  const version = versioner?.(url);
  return `${origin}${url}${version ? `?v=${version}` : ''}`;
}

export function withAbsoluteAssetUrls(product: ProductDto, origin: string, versioner?: AssetVersioner): ProductDto {
  return {
    ...product,
    thumbnailUrl: absoluteUrl(product.thumbnailUrl, origin, versioner),
    model: {
      ...product.model,
      glbUrl: absoluteUrl(product.model.glbUrl, origin, versioner),
      usdzUrl: absoluteUrl(product.model.usdzUrl, origin, versioner),
    },
  };
}
