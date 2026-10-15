import type { Redis } from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import { HealthService, PROBE_TIMEOUT_MS } from './health.service.js';

function createService(options: {
  query: () => Promise<unknown>;
  ping: () => Promise<unknown>;
  storage?: () => Promise<void>;
}) {
  const prisma = { $queryRaw: options.query } as unknown as PrismaService;
  const redis = { ping: options.ping } as unknown as Redis;
  const storage = {
    ping: options.storage ?? (() => Promise.resolve()),
  } as unknown as StorageService;
  return new HealthService(prisma, redis, storage);
}

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok when every dependency responds', async () => {
    const service = createService({
      query: () => Promise.resolve([{ '?column?': 1 }]),
      ping: () => Promise.resolve('PONG'),
    });

    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
    expect(report.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded when the database fails, without leaking the reason', async () => {
    const service = createService({
      query: () => Promise.reject(new Error('password authentication failed for user "admin"')),
      ping: () => Promise.resolve('PONG'),
    });

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks.database).toEqual({ status: 'down', latencyMs: null });
    expect(report.checks.redis.status).toBe('up');
    expect(JSON.stringify(report)).not.toContain('password');
  });

  it('reports degraded when Redis fails', async () => {
    const service = createService({
      query: () => Promise.resolve([]),
      ping: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks.redis).toEqual({ status: 'down', latencyMs: null });
  });

  it('reports degraded when object storage fails', async () => {
    const service = createService({
      query: () => Promise.resolve([]),
      ping: () => Promise.resolve('PONG'),
      storage: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.checks.storage).toEqual({ status: 'down', latencyMs: null });
    expect(report.checks.database.status).toBe('up');
  });

  it('treats a hanging dependency as down after the probe timeout', async () => {
    vi.useFakeTimers();
    const service = createService({
      query: () => new Promise(() => undefined),
      ping: () => Promise.resolve('PONG'),
    });

    const pending = service.check();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    const report = await pending;

    expect(report.status).toBe('degraded');
    expect(report.checks.database.status).toBe('down');
  });
});
