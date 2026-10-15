import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionKey } from '../../modules/rbac/rbac.catalogue.js';
import type { Principal, RequestMeta } from './principal.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const AUTHENTICATED_ONLY_KEY = 'auth:authenticated-only';
export const REQUIRED_PERMISSIONS_KEY = 'auth:permissions';
export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'auth:allow-pending-password-change';

/*
 * Every route must carry exactly one access declaration — @Public,
 * @AuthenticatedOnly or @RequirePermissions. A route with none is rejected
 * at request time, so forgetting to protect an endpoint fails closed.
 */

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Any signed-in user, regardless of role. */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

/** The caller must hold every listed permission. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Reachable while the user still has to replace a temporary password. */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);

/** Injects the authenticated principal. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const principal = context.switchToHttp().getRequest<Request>().principal;
  if (!principal) {
    // Only reachable if the decorator is used on a @Public route.
    throw new InternalServerErrorException('No authenticated principal on this request');
  }
  return principal;
});

/** Injects the client's IP address and user agent for audit records. */
export const ClientMeta = createParamDecorator(
  (_: unknown, context: ExecutionContext): RequestMeta => {
    const request = context.switchToHttp().getRequest<Request>();
    const userAgent = request.headers['user-agent'];
    return {
      ipAddress: request.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    };
  },
);

/**
 * Narrows a principal to one that belongs to a tenant. Platform staff have no
 * tenant and cannot use tenant-scoped endpoints.
 */
export function requireTenantId(principal: Principal): string {
  if (!principal.tenantId) {
    throw new ForbiddenException({
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'This action is only available to users who belong to a school account.',
    });
  }
  return principal.tenantId;
}
