import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { sendNotFound } from '../errors';

/** apps/api/static: development assets (3D models, thumbnails) produced in this repo. */
export const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../../../static/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.usdz': 'model/vnd.usdz+zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Serves files under `/static/*` for development. Production assets belong on a CDN; seed
 * entries may point here with relative URLs (see `asset-urls.ts`).
 * Only known asset types; no hidden (`.x`) or build (`_x`) path segments.
 */
export function staticRoutes(root: string = DEFAULT_STATIC_ROOT) {
  const resolvedRoot = path.resolve(root);
  return async (app: FastifyInstance) => {
    app.get('/static/*', async (request, reply) => {
      const relative = (request.params as { '*': string })['*'] ?? '';
      const segments = relative.split('/');
      const notFound = () => sendNotFound(reply, 'File not found');
      if (segments.some((s) => !s || s.startsWith('.') || s.startsWith('_') || s.includes('\\'))) return notFound();

      const fullPath = path.resolve(resolvedRoot, ...segments);
      if (!fullPath.startsWith(resolvedRoot + path.sep)) return notFound();
      const contentType = CONTENT_TYPES[path.extname(fullPath).toLowerCase()];
      if (!contentType) return notFound();

      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile()) return notFound();

      return reply
        .header('Content-Type', contentType)
        .header('Content-Length', info.size)
        .header('Cache-Control', 'public, max-age=3600')
        .send(createReadStream(fullPath));
    });
  };
}
