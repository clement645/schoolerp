import { ExecutionContext, SetMetadata } from '@nestjs/common';

const STRICT_RATE_LIMIT_KEY = 'rate-limit:strict';

/**
 * Applies the tighter per-client limit meant for endpoints that accept a
 * password, where every request is a guess.
 */
export const StrictRateLimit = () => SetMetadata(STRICT_RATE_LIMIT_KEY, true);

export function isStrictlyRateLimited(context: ExecutionContext): boolean {
  return Reflect.getMetadata(STRICT_RATE_LIMIT_KEY, context.getHandler()) === true;
}
