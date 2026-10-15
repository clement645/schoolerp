import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  API_DEFAULT_VERSION,
  API_PREFIX,
  configureApp,
  setupSwagger,
  SWAGGER_PATH,
} from './app.setup.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = new Logger('Bootstrap');

  configureApp(app);
  app.enableShutdownHooks();

  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });
  if (swaggerEnabled) {
    setupSwagger(app);
  }

  const host = config.get('API_HOST', { infer: true });
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, host);

  const baseUrl = `http://${host}:${port}`;
  logger.log(`API listening on ${baseUrl}/${API_PREFIX}/v${API_DEFAULT_VERSION}`);
  if (swaggerEnabled) {
    logger.log(`API documentation at ${baseUrl}/${SWAGGER_PATH}`);
  }
}

await bootstrap();
