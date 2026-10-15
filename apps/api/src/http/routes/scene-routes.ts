import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApiRoutes, type ApiErrorDto } from '@airoom/shared';
import type { SaveSceneResult, SceneService } from '../../services/scene-service';
import { sendNotFound, sendValidationError } from '../errors';
import { idParamsSchema, saveSceneSchema } from '../schemas';

/** Saved AR scenes (in memory until a database is added). */
export function sceneRoutes(sceneService: SceneService) {
  return async (app: FastifyInstance) => {
    app.get(ApiRoutes.scenes, async () => sceneService.list());

    app.get(`${ApiRoutes.scenes}/:id`, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      const scene = await sceneService.getById(params.data.id);
      return scene ?? sendNotFound(reply, `Scene "${params.data.id}" not found`);
    });

    app.post(ApiRoutes.scenes, async (request, reply) => {
      const body = saveSceneSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(reply, body.error);
      return sendSaved(reply, await sceneService.create(body.data), 201);
    });

    app.put(`${ApiRoutes.scenes}/:id`, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      const body = saveSceneSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(reply, body.error);
      const result = await sceneService.update(params.data.id, body.data);
      if (!result) return sendNotFound(reply, `Scene "${params.data.id}" not found`);
      return sendSaved(reply, result, 200);
    });

    app.delete(`${ApiRoutes.scenes}/:id`, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      if (!(await sceneService.delete(params.data.id))) return sendNotFound(reply, `Scene "${params.data.id}" not found`);
      return reply.code(204).send();
    });
  };
}

function sendSaved(reply: FastifyReply, result: SaveSceneResult, status: number) {
  if ('unknownProductIds' in result) {
    const body: ApiErrorDto = {
      error: 'UNKNOWN_PRODUCT',
      message: `Not in the catalog: ${result.unknownProductIds.join(', ')}`,
    };
    return reply.code(400).send(body);
  }
  return reply.code(status).send(result.scene);
}
