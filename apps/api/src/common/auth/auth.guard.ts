import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../modules/auth/token.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from './auth.decorators.js';
import type { Principal } from './principal.js';

const UNAUTHENTICATED = {
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required.',
};

/**
 * Authenticates every non-public request from its bearer access token and
 * rebuilds the principal from the database, so a disabled account, suspended
 * tenant, changed password or changed role takes effect on the next request
 * rather than when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);
    if (!token) throw new UnauthorizedException(UNAUTHENTICATED);

    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) throw new UnauthorizedException(UNAUTHENTICATED);

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        tenantId: true,
        email: true,
        status: true,
        mustChangePassword: true,
        passwordChangedAt: true,
        tenant: { select: { status: true } },
        roles: {
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException(UNAUTHENTICATED);
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException(UNAUTHENTICATED);
    }
    // `iat` has one-second resolution, hence the one-second allowance.
    if ((claims.iat + 1) * 1000 <= user.passwordChangedAt.getTime()) {
      throw new UnauthorizedException(UNAUTHENTICATED);
    }

    const principal: Principal = {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: claims.sid,
      email: user.email,
      roles: user.roles.map(({ role }) => role.key),
      permissions: new Set(
        user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
      ),
      mustChangePassword: user.mustChangePassword,
    };
    request.principal = principal;
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : null;
  }
}
