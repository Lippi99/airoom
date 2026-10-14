import { config } from './config';
import { buildApp } from './http/app';

const app = buildApp({ logger: { level: config.LOG_LEVEL } });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
