import Fastify, { type FastifyServerOptions } from 'fastify';
import type { ApiErrorDto } from '@airoom/shared';
import { createContainer, type Container } from '../container';
import { categoryRoutes } from './routes/category-routes';
import { goRoutes } from './routes/go-routes';
import { healthRoutes } from './routes/health-routes';
import { productRoutes } from './routes/product-routes';
import { sceneRoutes } from './routes/scene-routes';
import { DEFAULT_STATIC_ROOT, staticRoutes } from './routes/static-routes';
import { staticAssetVersioner } from './asset-urls';

export interface BuildAppOptions {
  /** Inject a container in tests; by default the real one is created with the app logger. */
  container?: Container;
  logger?: FastifyServerOptions['logger'];
  /** Folder served at `/static/*`; defaults to apps/api/static. */
  staticRoot?: string;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const container = options.container ?? createContainer({ logger: app.log });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    const body: ApiErrorDto = { error: 'INTERNAL_ERROR', message: 'Something went wrong' };
    return reply.code(500).send(body);
  });

  app.register(healthRoutes);
  app.register(categoryRoutes(container.categoryService));
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  app.register(productRoutes(container.productService, staticAssetVersioner(staticRoot)));
  app.register(goRoutes(container.clickService));
  app.register(sceneRoutes(container.sceneService));
  app.register(staticRoutes(staticRoot));

  return app;
}
