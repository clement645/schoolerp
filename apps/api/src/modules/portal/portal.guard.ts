import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedOnly } from '../../common/auth/auth.decorators.js';

/** Admits holders of either portal permission; everyone else is refused. */
@Injectable()
export class PortalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (
      principal?.permissions.has('portal:parent') ||
      principal?.permissions.has('portal:student')
    ) {
      return true;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
    });
  }
}

/**
 * A route for parents and students. It runs after the global guards, which
 * have already authenticated the caller; this adds the either-or permission
 * check that `@RequirePermissions` (all-of) cannot express.
 */
export const PortalUser = () => applyDecorators(AuthenticatedOnly(), UseGuards(PortalGuard));
