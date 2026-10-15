import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/http/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import type { CreateTenantDto, UpdateTenantStatusDto } from './tenants.dto.js';

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'ACTIVE' | 'SUSPENDED';
  schoolCount: number;
  userCount: number;
  createdAt: Date;
}

const TENANT_VIEW_SELECT = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  status: true,
  createdAt: true,
  _count: { select: { schools: true, users: true } },
} satisfies Prisma.TenantSelect;

type TenantRow = Prisma.TenantGetPayload<{ select: typeof TENANT_VIEW_SELECT }>;

function toView({ _count, ...tenant }: TenantRow): TenantView {
  return { ...tenant, schoolCount: _count.schools, userCount: _count.users };
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'tenant';
}

/**
 * Platform-level tenant administration. These operations are deliberately
 * cross-tenant, so they use the privileged connection rather than
 * `withTenant`; the endpoints are restricted to platform staff.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQueryDto): Promise<Paginated<TenantView>> {
    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        select: TENANT_VIEW_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.tenant.count(),
    ]);
    return paginate(tenants.map(toView), total, query);
  }

  /** Creates a tenant with its first school and school administrator. */
  async create(principal: Principal, dto: CreateTenantDto, meta: RequestMeta): Promise<TenantView> {
    this.passwords.assertAcceptable(dto.admin.temporaryPassword, { email: dto.admin.email });
    const passwordHash = await this.passwords.hash(dto.admin.temporaryPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const baseSlug = slugify(dto.name);
        const taken = await tx.tenant.findUnique({
          where: { slug: baseSlug },
          select: { id: true },
        });
        const slug = taken ? `${baseSlug}-${randomBytes(3).toString('hex')}` : baseSlug;

        const adminRole = await tx.role.findUniqueOrThrow({
          where: { key: 'SCHOOL_ADMIN' },
          select: { id: true },
        });

        const tenant = await tx.tenant.create({
          data: {
            name: dto.name,
            slug,
            plan: dto.plan ?? 'STANDARD',
            schools: { create: { name: dto.schoolName } },
          },
          select: { id: true },
        });
        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.admin.email,
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
            passwordHash,
            mustChangePassword: true,
            roles: { create: { roleId: adminRole.id, tenantId: tenant.id } },
          },
          select: { id: true, email: true },
        });

        await this.audit.record(
          {
            action: 'tenant.created',
            resourceType: 'tenant',
            resourceId: tenant.id,
            tenantId: tenant.id,
            actorId: principal.userId,
            meta,
            details: { name: dto.name, school: dto.schoolName, adminEmail: admin.email },
          },
          tx,
        );

        return toView(
          await tx.tenant.findUniqueOrThrow({
            where: { id: tenant.id },
            select: TENANT_VIEW_SELECT,
          }),
        );
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

  /** Suspending a tenant blocks sign-in and ends every active session. */
  async setStatus(
    principal: Principal,
    tenantId: string,
    dto: UpdateTenantStatusDto,
    meta: RequestMeta,
  ): Promise<TenantView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true },
      });
      if (!before) {
        throw new NotFoundException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' });
      }

      const after = await tx.tenant.update({
        where: { id: tenantId },
        data: { status: dto.status },
        select: TENANT_VIEW_SELECT,
      });

      if (before.status !== after.status) {
        if (after.status === 'SUSPENDED') {
          await tx.refreshToken.updateMany({
            where: { user: { tenantId }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await this.audit.record(
          {
            action: 'tenant.status.changed',
            resourceType: 'tenant',
            resourceId: tenantId,
            tenantId,
            actorId: principal.userId,
            meta,
            details: { before: before.status, after: after.status },
          },
          tx,
        );
      }
      return toView(after);
    });
  }
}
