import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './auth.decorators.js';

const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to perform this action.',
};

/**
 * Authorises the principal established by `AuthGuard`. Runs after it.
 * A route that declares no access rule at all is denied.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const read = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, targets);

    if (read<boolean>(IS_PUBLIC_KEY)) return true;

    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (!principal) throw new ForbiddenException(FORBIDDEN);

    if (principal.mustChangePassword && !read<boolean>(ALLOW_PENDING_PASSWORD_CHANGE_KEY)) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your temporary password before continuing.',
      });
    }

    const required = read<string[]>(REQUIRED_PERMISSIONS_KEY);
    if (required && required.length > 0) {
      if (required.every((permission) => principal.permissions.has(permission))) return true;
      throw new ForbiddenException(FORBIDDEN);
    }

    if (read<boolean>(AUTHENTICATED_ONLY_KEY)) return true;

    this.logger.error(
      `${context.getClass().name}.${context.getHandler().name} declares no access rule; ` +
        'denying. Add @Public, @AuthenticatedOnly or @RequirePermissions.',
    );
    throw new ForbiddenException(FORBIDDEN);
  }
}
