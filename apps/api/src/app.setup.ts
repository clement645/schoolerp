import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './common/http/request-id.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import type { Env } from './config/env.schema.js';

export const API_PREFIX = 'api';
export const API_DEFAULT_VERSION = '1';
export const SWAGGER_PATH = `${API_PREFIX}/docs`;

/**
 * Applies the HTTP pipeline shared by the real server and the e2e tests, so
 * tests exercise exactly the configuration that runs in production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Behind a reverse proxy the socket address is the proxy's. Trusting a
  // fixed number of hops lets rate limits and audit records see the real
  // client, without letting clients forge an address through the header.
  const hops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (hops > 0) {
    (app.getHttpAdapter().getInstance() as { set: (name: string, value: unknown) => void }).set(
      'trust proxy',
      hops,
    );
  }

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('EduMaster Pro API')
      .setDescription('Multi-tenant school management platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
