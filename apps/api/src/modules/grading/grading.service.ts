import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { SaveGradingSchemeDto } from './grading.dto.js';
import {
  sortBoundaries,
  upperLimitOf,
  validateBoundaries,
  type SchemeType,
} from './grading.rules.js';

export interface GradeBoundaryView {
  id: string;
  label: string;
  descriptor: string | null;
  minScore: number | null;
  /** Where the next grade begins; `null` for the top grade and unscored levels. */
  upperLimit: number | null;
  points: number | null;
}

export interface GradingSchemeView {
  id: string;
  name: string;
  type: SchemeType;
  description: string | null;
  isDefault: boolean;
  /** Number of classes explicitly assigned this scheme. */
  classCount: number;
  /** Ordered from the best grade to the worst. */
  boundaries: GradeBoundaryView[];
}

const SCHEME_SELECT = {
  id: true,
  name: true,
  type: true,
  description: true,
  isDefault: true,
  _count: { select: { classes: true } },
  boundaries: { select: { id: true, label: true, descriptor: true, minScore: true, points: true } },
} satisfies Prisma.GradingSchemeSelect;

type SchemeRow = Prisma.GradingSchemeGetPayload<{ select: typeof SCHEME_SELECT }>;

function toView({ _count, boundaries, ...scheme }: SchemeRow): GradingSchemeView {
  const numeric = boundaries.map((boundary) => ({
    ...boundary,
    minScore: boundary.minScore?.toNumber() ?? null,
    points: boundary.points?.toNumber() ?? null,
  }));
  return {
    ...scheme,
    classCount: _count.classes,
    boundaries: sortBoundaries(numeric).map((boundary) => ({
      ...boundary,
      upperLimit: upperLimitOf(numeric, boundary),
    })),
  };
}

const DUPLICATE = 'Another grading scheme already has this name.';

@Injectable()
export class GradingService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(principal: Principal, schoolId: string | undefined): Promise<GradingSchemeView[]> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const schemes = await tx.gradingScheme.findMany({
        where: { schoolId: id },
        select: SCHEME_SELECT,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return schemes.map(toView);
    });
  }

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: SaveGradingSchemeDto,
  ): Promise<GradingSchemeView> {
    this.assertValid(dto);
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        // A school's first scheme is the one it grades with until told otherwise.
        const isDefault =
          (await scope.tx.gradingScheme.count({ where: { schoolId: scope.schoolId } })) === 0;

        const scheme = await scope.tx.gradingScheme.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            name: dto.name,
            type: dto.type,
            description: dto.description ?? null,
            isDefault,
            boundaries: { create: this.boundaryRows(scope, dto) },
          },
          select: SCHEME_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'grading_scheme.created',
          { type: 'grading_scheme', id: scheme.id },
          this.snapshot(scheme),
        );
        return toView(scheme);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  /** Replaces a scheme, including its full set of grades. */
  async replace(
    actor: Actor,
    schoolId: string | undefined,
    schemeId: string,
    dto: SaveGradingSchemeDto,
  ): Promise<GradingSchemeView> {
    this.assertValid(dto);
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.find(scope, schemeId);

        await scope.tx.gradeBoundary.deleteMany({ where: { gradingSchemeId: schemeId } });
        const after = await scope.tx.gradingScheme.update({
          where: { id: schemeId },
          data: {
            name: dto.name,
            type: dto.type,
            description: dto.description ?? null,
            boundaries: { create: this.boundaryRows(scope, dto) },
          },
          select: SCHEME_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'grading_scheme.updated',
          { type: 'grading_scheme', id: schemeId },
          { before: this.snapshot(before), after: this.snapshot(after) },
        );
        return toView(after);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  setDefault(
    actor: Actor,
    schoolId: string | undefined,
    schemeId: string,
  ): Promise<GradingSchemeView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const scheme = await this.find(scope, schemeId);
      if (!scheme.isDefault) {
        // Clear first: a partial unique index allows one default per school.
        await scope.tx.gradingScheme.updateMany({
          where: { schoolId: scope.schoolId, isDefault: true },
          data: { isDefault: false },
        });
        await scope.tx.gradingScheme.update({ where: { id: schemeId }, data: { isDefault: true } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'grading_scheme.set_default',
          { type: 'grading_scheme', id: schemeId },
          { name: scheme.name },
        );
      }
      return toView(await this.find(scope, schemeId));
    });
  }

  async delete(actor: Actor, schoolId: string | undefined, schemeId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const scheme = await this.find(scope, schemeId);
        if (scheme.isDefault) {
          const others = await scope.tx.gradingScheme.count({
            where: { schoolId: scope.schoolId, id: { not: schemeId } },
          });
          if (others > 0) {
            throw new BadRequestException({
              code: 'DEFAULT_SCHEME',
              message: 'Choose another default grading scheme before deleting this one.',
            });
          }
        }
        await scope.tx.gradingScheme.delete({ where: { id: schemeId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'grading_scheme.deleted',
          { type: 'grading_scheme', id: schemeId },
          this.snapshot(scheme),
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse: 'This grading scheme is assigned to one or more classes and cannot be deleted.',
      });
    }
  }

  private assertValid(dto: SaveGradingSchemeDto): void {
    const problems = validateBoundaries(dto.type, dto.boundaries);
    if (problems.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_GRADING_SCHEME',
        message: problems[0],
        details: problems,
      });
    }
  }

  private boundaryRows(scope: SchoolScope, dto: SaveGradingSchemeDto) {
    return dto.boundaries.map((boundary) => ({
      tenantId: scope.tenantId,
      label: boundary.label,
      descriptor: boundary.descriptor ?? null,
      minScore: boundary.minScore ?? null,
      points: boundary.points ?? null,
    }));
  }

  private snapshot(scheme: SchemeRow): Prisma.InputJsonObject {
    const view = toView(scheme);
    return {
      name: view.name,
      type: view.type,
      grades: view.boundaries.map(({ label, minScore, points }) => ({ label, minScore, points })),
    };
  }

  private async find(scope: SchoolScope, schemeId: string): Promise<SchemeRow> {
    const scheme = await scope.tx.gradingScheme.findFirst({
      where: { id: schemeId, schoolId: scope.schoolId },
      select: SCHEME_SELECT,
    });
    if (!scheme) {
      throw new NotFoundException({
        code: 'GRADING_SCHEME_NOT_FOUND',
        message: 'Grading scheme not found.',
      });
    }
    return scheme;
  }
}
