import type { FastifyInstance } from 'fastify';
import { ApiRoutes } from '@airoom/shared';

export async function healthRoutes(app: FastifyInstance) {
  app.get(ApiRoutes.health, async () => ({ status: 'ok' }));
}
