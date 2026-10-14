import type { FastifyInstance } from 'fastify';
import type { ClickService } from '../../services/click-service';
import { sendNotFound, sendValidationError } from '../errors';
import { goParamsSchema, goQuerySchema } from '../schemas';

/** Tracked outbound link: records a click, then 302-redirects to the retailer. */
export function goRoutes(clickService: ClickService) {
  return async (app: FastifyInstance) => {
    app.get('/go/:productId', async (request, reply) => {
      const params = goParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      // Never fails: invalid values become undefined.
      const query = goQuerySchema.parse(request.query ?? {});

      const result = await clickService.trackAndResolve({
        productId: params.data.productId,
        platform: query.platform,
        sessionId: query.sessionId,
        userAgent: request.headers['user-agent'],
      });
      if (!result) return sendNotFound(reply, `Product "${params.data.productId}" not found`);

      return reply.header('Cache-Control', 'no-store').redirect(result.redirectUrl, 302);
    });
  };
}
