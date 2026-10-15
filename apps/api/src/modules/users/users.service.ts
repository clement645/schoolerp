import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { requireTenantId } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { paginate, toSkipTake, type Paginated } from '../../common/http/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type TenantTransaction } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { canGrantRole, isRoleKey, type RoleKey } from '../rbac/rbac.catalogue.js';
import type {
  CreateUserDto,
  ListUsersQueryDto,
  ResetUserPasswordDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './users.dto.js';

export interface UserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  roles: { key: string; name: string }[];
  lastLoginAt: Date | null;
  createdAt: Date;
}

const USER_VIEW_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: { role: { select: { key: true, name: true } } },
    orderBy: { role: { name: 'asc' } },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_VIEW_SELECT }>;

function toView(user: UserRow): UserView {
  return { ...user, roles: user.roles.map(({ role }) => role) };
}

const NOT_FOUND = { code: 'USER_NOT_FOUND', message: 'User not found.' };

/**
 * User administration within one tenant. Every query runs through
 * `withTenant`, so a user id belonging to another tenant is simply not found.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: Principal, query: ListUsersQueryDto): Promise<Paginated<UserView>> {
    const tenantId = requireTenantId(principal);
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    return this.prisma.withTenant(tenantId, async (tx) => {
      const [users, total] = await Promise.all([
        tx.user.findMany({
          where,
          select: USER_VIEW_SELECT,
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.user.count({ where }),
      ]);
      return paginate(users.map(toView), total, query);
    });
  }

  async get(principal: Principal, userId: string): Promise<UserView> {
    const tenantId = requireTenantId(principal);
    return this.prisma.withTenant(tenantId, async (tx) => toView(await this.find(tx, userId)));
  }

  async create(principal: Principal, dto: CreateUserDto, meta: RequestMeta): Promise<UserView> {
    const tenantId = requireTenantId(principal);
    this.assertCanGrant(principal, dto.roles);
    this.passwords.assertAcceptable(dto.temporaryPassword, { email: dto.email });
    const passwordHash = await this.passwords.hash(dto.temporaryPassword);

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const roles = await this.findRoles(tx, dto.roles);
        const user = await tx.user.create({
          data: {
            tenantId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            mustChangePassword: true,
            roles: { create: roles.map((role) => ({ roleId: role.id, tenantId })) },
          },
          select: USER_VIEW_SELECT,
        });
        await this.audit.record(
          {
            action: 'user.created',
            resourceType: 'user',
            resourceId: user.id,
            tenantId,
            actorId: principal.userId,
            meta,
            details: { email: user.email, roles: dto.roles },
          },
          tx,
        );
        return toView(user);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'A user with this email address already exists.',
        });
      }
      throw error;
    }
  }

  async update(
    principal: Principal,
    userId: string,
    dto: UpdateUserDto,
    meta: RequestMeta,
  ): Promise<UserView> {
    const tenantId = requireTenantId(principal);
    if (dto.status === 'DISABLED' && userId === principal.userId) {
      throw new BadRequestException({
        code: 'CANNOT_DISABLE_SELF',
        message: 'You cannot disable your own account.',
      });
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const before = await this.find(tx, userId);
      // Disabling someone is as consequential as changing their roles.
      if (dto.status && dto.status !== before.status) {
        this.assertCanGrant(principal, before.roles.map(({ role }) => role.key).filter(isRoleKey));
      }

      const after = await tx.user.update({
        where: { id: userId },
        data: { firstName: dto.firstName, lastName: dto.lastName, status: dto.status },
        select: USER_VIEW_SELECT,
      });
      if (after.status === 'DISABLED' && before.status !== 'DISABLED') {
        await this.revokeSessions(tx, userId);
      }

      const pick = (user: UserRow) => ({
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
      });
      await this.audit.record(
        {
          action: 'user.updated',
          resourceType: 'user',
          resourceId: userId,
          tenantId,
          actorId: principal.userId,
          meta,
          details: { before: pick(before), after: pick(after) },
        },
        tx,
      );
      return toView(after);
    });
  }

  async setRoles(
    principal: Principal,
    userId: string,
    dto: SetUserRolesDto,
    meta: RequestMeta,
  ): Promise<UserView> {
    const tenantId = requireTenantId(principal);
    if (userId === principal.userId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLES',
        message: 'You cannot change your own roles.',
      });
    }
    this.assertCanGrant(principal, dto.roles);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const before = await this.find(tx, userId);
      const previous = before.roles.map(({ role }) => role.key);
      // Taking a role away needs the same authority as granting it.
      this.assertCanGrant(principal, previous.filter(isRoleKey));

      const roles = await this.findRoles(tx, dto.roles);
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id, tenantId })),
      });

      await this.audit.record(
        {
          action: 'user.roles.changed',
          resourceType: 'user',
          resourceId: userId,
          tenantId,
          actorId: principal.userId,
          meta,
          details: { before: [...previous].sort(), after: [...dto.roles].sort() },
        },
        tx,
      );
      return toView(await this.find(tx, userId));
    });
  }

  /** Sets a temporary password and signs the user out everywhere. */
  async resetPassword(
    principal: Principal,
    userId: string,
    dto: ResetUserPasswordDto,
    meta: RequestMeta,
  ): Promise<void> {
    const tenantId = requireTenantId(principal);
    if (userId === principal.userId) {
      throw new BadRequestException({
        code: 'USE_CHANGE_PASSWORD',
        message: 'Use "Change password" to update your own password.',
      });
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await this.find(tx, userId);
      this.assertCanGrant(principal, user.roles.map(({ role }) => role.key).filter(isRoleKey));
      this.passwords.assertAcceptable(dto.temporaryPassword, { email: user.email });

      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await this.passwords.hash(dto.temporaryPassword),
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.revokeSessions(tx, userId);
      await this.audit.record(
        {
          action: 'user.password.reset',
          resourceType: 'user',
          resourceId: userId,
          tenantId,
          actorId: principal.userId,
          meta,
        },
        tx,
      );
    });
  }

  private async find(tx: TenantTransaction, userId: string): Promise<UserRow> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: USER_VIEW_SELECT });
    if (!user) throw new NotFoundException(NOT_FOUND);
    return user;
  }

  private async findRoles(tx: TenantTransaction, keys: readonly RoleKey[]) {
    const roles = await tx.role.findMany({
      where: { key: { in: [...keys] } },
      select: { id: true, key: true },
    });
    if (roles.length !== keys.length) {
      throw new BadRequestException({
        code: 'UNKNOWN_ROLE',
        message: 'One or more roles do not exist.',
      });
    }
    return roles;
  }

  private async revokeSessions(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Blocks privilege escalation: see `canGrantRole`. */
  private assertCanGrant(principal: Principal, roles: readonly RoleKey[]): void {
    const denied = roles.filter((role) => !canGrantRole(principal.permissions, role));
    if (denied.length > 0) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_GRANTABLE',
        message: 'You cannot manage accounts with roles that exceed your own access.',
        details: { roles: denied },
      });
    }
  }
}
