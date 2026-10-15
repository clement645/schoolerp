import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const logger = new Logger('Redis');
        const url = config.get('REDIS_URL', { infer: true });
        const { protocol, hostname } = new URL(url);
        const client = new Redis(url, {
          // Fail commands quickly instead of queueing them indefinitely
          // while Redis is down; callers decide how to degrade.
          maxRetriesPerRequest: 1,
          connectTimeout: 10_000,
          // Hosted Redis behind a shared TLS endpoint routes by server name
          // (SNI), which ioredis does not send unless told to.
          ...(protocol === 'rediss:' ? { tls: { servername: hostname } } : {}),
        });
        client.on('ready', () => logger.log('Redis connection established'));
        // Without a listener ioredis re-emits connection errors as unhandled.
        client.on('error', (error: Error) => logger.warn(`Redis error: ${error.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
