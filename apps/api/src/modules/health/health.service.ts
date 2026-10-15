import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { StorageService } from '../../storage/storage.service.js';
import type { DependencyCheck, HealthReport } from './health.types.js';

export const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis, storage] = await Promise.all([
      this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('redis', () => this.redis.ping()),
      this.probe('storage', () => this.storage.ping()),
    ]);
    const allUp = [database, redis, storage].every((check) => check.status === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis, storage },
    };
  }

  /**
   * Runs a dependency probe with a timeout. Failure reasons are logged
   * server-side only; the public report exposes just up/down.
   */
  private async probe(name: string, run: () => PromiseLike<unknown>): Promise<DependencyCheck> {
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`probe timed out after ${PROBE_TIMEOUT_MS}ms`)),
            PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Health probe failed for ${name}: ${reason}`);
      return { status: 'down', latencyMs: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
