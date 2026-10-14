/** Minimal logger contract so services do not depend on Fastify/pino. */
export interface Logger {
  error(obj: object, msg: string): void;
}
