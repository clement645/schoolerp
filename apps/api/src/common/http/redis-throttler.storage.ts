import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Counts a hit and returns the count with the window's remaining lifetime, in
 * one round trip so concurrent requests cannot both read a stale count.
 */
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

/**
 * Keeps rate-limit counters in Redis, so a limit holds across every instance
 * of the API rather than per process.
 *
 * If Redis cannot be reached, counting falls back to this process's memory:
 * requests are still limited, only less precisely, and the API stays up.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly local = new ThrottlerStorageService();
  private readonly namespace: string;
  private degraded = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.namespace = config.get('RATE_LIMIT_NAMESPACE', { infer: true });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      const [hits, remaining] = (await this.redis.eval(
        INCREMENT,
        1,
        `${this.namespace}:rate:${throttlerName}:${key}`,
        String(ttl),
      )) as [number, number];
      if (this.degraded) {
        this.degraded = false;
        this.logger.log('Rate limiting is using Redis again');
      }
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire: seconds,
        isBlocked,
        timeToBlockExpire: isBlocked ? seconds : 0,
      };
    } catch {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(
          'Redis unavailable; rate limiting is counting per instance until it returns',
        );
      }
      return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onApplicationShutdown(): void {
    this.local.onApplicationShutdown();
  }
}
