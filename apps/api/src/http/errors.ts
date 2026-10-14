import type { FastifyReply } from 'fastify';
import type { ApiErrorDto } from '@airoom/shared';
import type { ZodError } from 'zod';

export function sendNotFound(reply: FastifyReply, message: string) {
  const body: ApiErrorDto = { error: 'NOT_FOUND', message };
  return reply.code(404).send(body);
}

export function sendValidationError(reply: FastifyReply, error: ZodError) {
  const body: ApiErrorDto = {
    error: 'VALIDATION_ERROR',
    message: error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '),
  };
  return reply.code(400).send(body);
}
