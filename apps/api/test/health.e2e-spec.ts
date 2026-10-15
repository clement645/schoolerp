import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Health (e2e, real PostgreSQL, Redis and object storage)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports every dependency as up', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
        checks: { database: { status: 'up' }, redis: { status: 'up' }, storage: { status: 'up' } },
      },
    });
    const { meta } = response.body as { meta: { requestId: string } };
    expect(meta.requestId).toMatch(UUID);
    expect(response.headers['x-request-id']).toBe(meta.requestId);
  });

  it('GET /api/v1/health/live responds without touching dependencies', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
      meta: { path: '/api/v1/does-not-exist' },
    });
  });

  it('does not serve unversioned or unprefixed routes', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
    await request(app.getHttpServer()).get('/api/health').expect(404);
  });

  it('sets security headers and ignores client-supplied request ids', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'spoofed')
      .expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('only allows configured CORS origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5180');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
