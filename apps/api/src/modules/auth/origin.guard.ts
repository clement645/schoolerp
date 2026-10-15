import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema.js';

/**
 * CSRF defence for the endpoints that authenticate with the refresh cookie.
 * The cookie is SameSite=Strict already; this additionally rejects any
 * request whose Origin header names a site outside the allow-list. Requests
 * without an Origin header (non-browser clients) cannot carry a victim's
 * cookie and are let through.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowed = new Set(config.get('CORS_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin === undefined || this.allowed.has(origin)) return true;

    throw new ForbiddenException({
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'This request is not allowed from the current origin.',
    });
  }
}
