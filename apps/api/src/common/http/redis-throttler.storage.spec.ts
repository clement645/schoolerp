import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

const config = { get: () => 'unit' } as unknown as ConfigService<Env, true>;

/** A stand-in for Redis that counts in memory like the Lua script does. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      eval: (_script: string, _keys: number, key: string, ttl: string) => {
        calls.push([key, ttl]);
        counters.set(key, (counters.get(key) ?? 0) + 1);
        return Promise.resolve([counters.get(key), 42_500]);
      },
    } as unknown as Redis,
  };
}

describe('RedisThrottlerStorage', () => {
  it('counts hits per key in Redis and blocks once the limit is passed', async () => {
    const redis = fakeRedis();
    const storage = new RedisThrottlerStorage(redis.client, config);
    const hit = () => storage.increment('client-a', 60_000, 2, 0, 'default');

    expect(await hit()).toEqual({
      totalHits: 1,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect((await hit()).isBlocked).toBe(false);
    expect(await hit()).toEqual({
      totalHits: 3,
      timeToExpire: 43,
      isBlocked: true,
      timeToBlockExpire: 43,
    });
    // Another client has its own count.
    expect((await storage.increment('client-b', 60_000, 2, 0, 'default')).totalHits).toBe(1);
    expect(redis.calls[0]).toEqual(['unit:rate:default:client-a', '60000']);
    storage.onApplicationShutdown();
  });

  it('keeps limiting from memory when Redis is unreachable', async () => {
    const down = { eval: () => Promise.reject(new Error('ECONNREFUSED')) } as unknown as Redis;
    const storage = new RedisThrottlerStorage(down, config);
    const hit = () => storage.increment('client-a', 60_000, 1, 0, 'default');

    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(true);
    storage.onApplicationShutdown();
  });
});
