import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { requireTenantId } from '../auth/auth.decorators.js';
import type { Principal } from '../auth/principal.js';
import { PrismaService, type TenantTransaction } from '../../prisma/prisma.service.js';

export const SCHOOL_HEADER = 'x-school-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The school a request operates on, with a transaction confined to its tenant. */
export interface SchoolScope {
  tenantId: string;
  schoolId: string;
  tx: TenantTransaction;
}

/**
 * Injects the school selected by the client through the `X-School-Id` header,
 * or `undefined` when the header is absent.
 */
export const RequestedSchool = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | undefined => {
    const value = context.switchToHttp().getRequest<Request>().headers[SCHOOL_HEADER];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new BadRequestException({
        code: 'INVALID_SCHOOL',
        message: 'The X-School-Id header must be a school identifier.',
      });
    }
    return value;
  },
);

@Injectable()
export class SchoolScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` for one school of the caller's tenant.
   *
   * The school is looked up inside the tenant transaction, so row-level
   * security guarantees it belongs to the caller: another tenant's school id
   * is simply not found. A tenant with a single school may omit the header.
   */
  run<T>(
    principal: Principal,
    requestedSchoolId: string | undefined,
    work: (scope: SchoolScope) => Promise<T>,
  ): Promise<T> {
    const tenantId = requireTenantId(principal);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const schools = await tx.school.findMany({
        where: requestedSchoolId ? { id: requestedSchoolId } : {},
        select: { id: true },
        take: 2,
      });

      if (requestedSchoolId && schools.length === 0) {
        throw new NotFoundException({ code: 'SCHOOL_NOT_FOUND', message: 'School not found.' });
      }
      const [school, another] = schools;
      if (!school || another) {
        throw new BadRequestException({
          code: 'SCHOOL_REQUIRED',
          message: 'Select which school this request is for.',
        });
      }
      return work({ tenantId, schoolId: school.id, tx });
    });
  }
}
