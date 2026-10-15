import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { PrismaService, type TenantTransaction } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

/** One message for every sign-in failure, so nothing about accounts leaks. */
const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid email or password.',
};
const INVALID_SESSION = {
  code: 'INVALID_SESSION',
  message: 'Your session has expired. Please sign in again.',
};

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  roles: { key: string; name: string }[];
  permissions: string[];
  tenant: { id: string; name: string; plan: string } | null;
  schools: { id: string; name: string }[];
}

export interface Session {
  accessToken: string;
  expiresInSeconds: number;
  user: UserProfile;
}

/** A session plus the refresh token, which travels only in a cookie. */
export interface IssuedSession {
  session: Session;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        status: true,
        lockedUntil: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user) {
      await this.passwords.verifyDecoy(password);
      await this.audit.record({
        action: 'auth.login.failed',
        resourceType: 'user',
        meta,
        details: { reason: 'unknown_account' },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const fail = async (reason: string): Promise<never> => {
      await this.audit.record({
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: user.id,
        tenantId: user.tenantId,
        actorId: user.id,
        meta,
        details: { reason },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    };

    const locked = user.lockedUntil !== null && user.lockedUntil > new Date();
    const passwordMatches = await this.passwords.verify(user.passwordHash, password);

    // A locked account rejects even the correct password, and attempts made
    // while locked do not extend the lock.
    if (locked) return fail('account_locked');

    if (!passwordMatches) {
      const { failedLoginCount } = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (failedLoginCount >= MAX_FAILED_LOGINS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          },
        });
        return fail('wrong_password_account_locked');
      }
      return fail('wrong_password');
    }

    if (user.status !== 'ACTIVE') return fail('account_disabled');
    if (user.tenant && user.tenant.status !== 'ACTIVE') return fail('tenant_suspended');

    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      return this.issueSession(tx, user.id, meta, randomUUID());
    });

    await this.audit.record({
      action: 'auth.login.succeeded',
      resourceType: 'user',
      resourceId: user.id,
      tenantId: user.tenantId,
      actorId: user.id,
      meta,
    });
    return issued;
  }

  /**
   * Exchanges a refresh token for a new session and a new refresh token.
   * Each token works once. Presenting a token that was already used means it
   * was copied, so the whole session is revoked.
   */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException(INVALID_SESSION);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: {
        id: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: { id: true, tenantId: true, status: true, tenant: { select: { status: true } } },
        },
      },
    });
    if (!stored) throw new UnauthorizedException(INVALID_SESSION);

    const { user } = stored;
    const now = new Date();

    if (stored.revokedAt) {
      const { count } = await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Only report when a live session was actually cut off; replaying a
      // token after an ordinary sign-out is not an incident.
      if (count > 0) {
        await this.audit.record({
          action: 'auth.refresh.reuse_detected',
          resourceType: 'session',
          resourceId: stored.familyId,
          tenantId: user.tenantId,
          actorId: user.id,
          meta,
        });
      }
      throw new UnauthorizedException(INVALID_SESSION);
    }

    if (stored.expiresAt <= now) throw new UnauthorizedException(INVALID_SESSION);
    if (user.status !== 'ACTIVE' || (user.tenant && user.tenant.status !== 'ACTIVE')) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent requests with the same token,
      // exactly one can win the rotation.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count !== 1) throw new UnauthorizedException(INVALID_SESSION);
      return this.issueSession(tx, user.id, meta, stored.familyId);
    });
  }

  /** Ends the session the refresh token belongs to. Always succeeds. */
  async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!refreshToken) return;

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { familyId: true, user: { select: { id: true, tenantId: true } } },
    });
    if (!stored) return;

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) {
      await this.audit.record({
        action: 'auth.logout',
        resourceType: 'session',
        resourceId: stored.familyId,
        tenantId: stored.user.tenantId,
        actorId: stored.user.id,
        meta,
      });
    }
  }

  /**
   * Changes the caller's password, signs out every other session and starts
   * a fresh one for the caller.
   */
  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { passwordHash: true },
    });

    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is incorrect.',
      });
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: 'Your new password must be different from the current one.',
      });
    }
    this.passwords.assertAcceptable(newPassword, { email: principal.email });

    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: principal.userId },
        data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
      });
      await tx.refreshToken.updateMany({
        where: { userId: principal.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          action: 'auth.password.changed',
          resourceType: 'user',
          resourceId: principal.userId,
          tenantId: principal.tenantId,
          actorId: principal.userId,
          meta,
        },
        tx,
      );
      return this.issueSession(tx, principal.userId, meta, randomUUID());
    });
  }

  async getProfile(userId: string, db: TenantTransaction = this.prisma): Promise<UserProfile> {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        mustChangePassword: true,
        tenant: {
          select: {
            id: true,
            name: true,
            plan: true,
            schools: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
          },
        },
        roles: {
          select: {
            role: {
              select: {
                key: true,
                name: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    const permissions = new Set(
      user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
    );

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
      roles: user.roles.map(({ role }) => ({ key: role.key, name: role.name })),
      permissions: [...permissions].sort(),
      tenant: user.tenant
        ? { id: user.tenant.id, name: user.tenant.name, plan: user.tenant.plan }
        : null,
      schools: user.tenant?.schools ?? [],
    };
  }

  private async issueSession(
    tx: TenantTransaction,
    userId: string,
    meta: RequestMeta,
    familyId: string,
  ): Promise<IssuedSession> {
    const refresh = this.tokens.generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    const access = await this.tokens.signAccessToken(userId, familyId);
    return {
      session: {
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
        user: await this.getProfile(userId, tx),
      },
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }
}
