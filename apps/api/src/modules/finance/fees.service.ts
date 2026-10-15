import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { money, sum } from './finance.calc.js';
import type {
  CreateDiscountDto,
  CreateFeeItemDto,
  SaveFeeStructureDto,
  UpdateFeeItemDto,
} from './finance.dto.js';

export interface FeeItemView {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface FeeStructureView {
  id: string;
  name: string;
  isActive: boolean;
  term: { id: string; name: string; academicYear: string };
  /** Null when the structure applies to every class. */
  class: { id: string; name: string } | null;
  lines: { feeItemId: string; feeItem: string; amount: number }[];
  total: number;
  /** Invoices raised from this structure that have not been voided. */
  invoiceCount: number;
}

export interface DiscountView {
  id: string;
  student: { id: string; name: string; admissionNumber: string };
  name: string;
  category: 'DISCOUNT' | 'SCHOLARSHIP';
  kind: 'PERCENTAGE' | 'FIXED';
  value: number;
  feeItem: { id: string; name: string } | null;
  isActive: boolean;
}

const STRUCTURE_SELECT = {
  id: true,
  name: true,
  isActive: true,
  term: { select: { id: true, name: true, academicYear: { select: { name: true } } } },
  class: { select: { id: true, name: true } },
  lines: {
    select: { feeItemId: true, amount: true, feeItem: { select: { name: true } } },
    orderBy: { feeItem: { name: 'asc' } },
  },
  _count: { select: { invoices: { where: { status: { not: 'VOID' } } } } },
} satisfies Prisma.FeeStructureSelect;

const DISCOUNT_SELECT = {
  id: true,
  name: true,
  category: true,
  kind: true,
  value: true,
  isActive: true,
  feeItem: { select: { id: true, name: true } },
  student: {
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true },
  },
} satisfies Prisma.StudentDiscountSelect;

const toStructure = (
  row: Prisma.FeeStructureGetPayload<{ select: typeof STRUCTURE_SELECT }>,
): FeeStructureView => ({
  id: row.id,
  name: row.name,
  isActive: row.isActive,
  term: { id: row.term.id, name: row.term.name, academicYear: row.term.academicYear.name },
  class: row.class,
  lines: row.lines.map((line) => ({
    feeItemId: line.feeItemId,
    feeItem: line.feeItem.name,
    amount: line.amount.toNumber(),
  })),
  total: sum(row.lines.map((line) => line.amount)).toNumber(),
  invoiceCount: row._count.invoices,
});

const toDiscount = (
  row: Prisma.StudentDiscountGetPayload<{ select: typeof DISCOUNT_SELECT }>,
): DiscountView => ({
  id: row.id,
  student: {
    id: row.student.id,
    name: [row.student.firstName, row.student.middleName, row.student.lastName]
      .filter(Boolean)
      .join(' '),
    admissionNumber: row.student.admissionNumber,
  },
  name: row.name,
  category: row.category,
  kind: row.kind,
  value: row.value.toNumber(),
  feeItem: row.feeItem,
  isActive: row.isActive,
});

/** Fee items, the fee structures built from them, and learners' discounts. */
@Injectable()
export class FeesService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Fee items ──────────────────────────────────────────────────────────────

  listItems(principal: Principal, schoolId: string | undefined): Promise<FeeItemView[]> {
    return this.scopes.run(principal, schoolId, (scope) =>
      scope.tx.feeItem.findMany({
        where: { schoolId: scope.schoolId },
        select: { id: true, name: true, description: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  createItem(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateFeeItemDto,
  ): Promise<FeeItemView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.assertItemNameFree(scope, dto.name);
      const item = await scope.tx.feeItem.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          name: dto.name,
          description: dto.description ?? null,
        },
        select: { id: true, name: true, description: true, isActive: true },
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.fee_item.created',
        { type: 'fee_item', id: item.id },
        { name: item.name },
      );
      return item;
    });
  }

  updateItem(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: UpdateFeeItemDto,
  ): Promise<FeeItemView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const before = await scope.tx.feeItem.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { id: true, name: true, description: true, isActive: true },
      });
      if (!before)
        throw new NotFoundException({ code: 'FEE_ITEM_NOT_FOUND', message: 'Fee item not found.' });
      if (dto.name !== undefined && dto.name.toLowerCase() !== before.name.toLowerCase()) {
        await this.assertItemNameFree(scope, dto.name);
      }
      const item = await scope.tx.feeItem.update({
        where: { id },
        data: dto,
        select: { id: true, name: true, description: true, isActive: true },
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.fee_item.updated',
        { type: 'fee_item', id },
        { before, after: item },
      );
      return item;
    });
  }

  // ── Fee structures ─────────────────────────────────────────────────────────

  listStructures(principal: Principal, schoolId: string | undefined): Promise<FeeStructureView[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const rows = await scope.tx.feeStructure.findMany({
        where: { schoolId: scope.schoolId },
        select: STRUCTURE_SELECT,
        orderBy: [{ term: { startDate: 'desc' } }, { name: 'asc' }],
      });
      return rows.map(toStructure);
    });
  }

  createStructure(
    actor: Actor,
    schoolId: string | undefined,
    dto: SaveFeeStructureDto,
  ): Promise<FeeStructureView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.assertStructureParts(scope, dto);
      try {
        const created = await scope.tx.feeStructure.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            name: dto.name,
            termId: dto.termId,
            classId: dto.classId ?? null,
            isActive: dto.isActive ?? true,
            lines: {
              create: dto.lines.map((line) => ({
                tenantId: scope.tenantId,
                feeItemId: line.feeItemId,
                amount: money(line.amount),
              })),
            },
          },
          select: STRUCTURE_SELECT,
        });
        const view = toStructure(created);
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'finance.fee_structure.created',
          { type: 'fee_structure', id: view.id },
          { name: view.name, total: view.total },
        );
        return view;
      } catch (error) {
        rethrowConflict(error, {
          duplicate: 'A fee structure with this name already exists for the term.',
        });
      }
    });
  }

  /**
   * Changes a structure. Its amounts only affect invoices raised afterwards:
   * invoices already issued keep the amounts they were issued with.
   */
  updateStructure(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: SaveFeeStructureDto,
  ): Promise<FeeStructureView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const existing = await scope.tx.feeStructure.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: STRUCTURE_SELECT,
      });
      if (!existing) throw structureNotFound();
      await this.assertStructureParts(scope, dto);
      try {
        await scope.tx.feeStructureLine.deleteMany({ where: { feeStructureId: id } });
        const updated = await scope.tx.feeStructure.update({
          where: { id },
          data: {
            name: dto.name,
            termId: dto.termId,
            classId: dto.classId ?? null,
            ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
            lines: {
              create: dto.lines.map((line) => ({
                tenantId: scope.tenantId,
                feeItemId: line.feeItemId,
                amount: money(line.amount),
              })),
            },
          },
          select: STRUCTURE_SELECT,
        });
        const view = toStructure(updated);
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'finance.fee_structure.updated',
          { type: 'fee_structure', id },
          {
            before: { name: existing.name, total: toStructure(existing).total },
            after: { name: view.name, total: view.total },
          },
        );
        return view;
      } catch (error) {
        rethrowConflict(error, {
          duplicate: 'A fee structure with this name already exists for the term.',
        });
      }
    });
  }

  // ── Discounts and scholarships ─────────────────────────────────────────────

  listDiscounts(
    principal: Principal,
    schoolId: string | undefined,
    studentId?: string,
  ): Promise<DiscountView[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const rows = await scope.tx.studentDiscount.findMany({
        where: { schoolId: scope.schoolId, ...(studentId ? { studentId } : {}) },
        select: DISCOUNT_SELECT,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      });
      return rows.map(toDiscount);
    });
  }

  createDiscount(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateDiscountDto,
  ): Promise<DiscountView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      if (dto.kind === 'PERCENTAGE' && dto.value > 100) {
        throw new BadRequestException({
          code: 'INVALID_DISCOUNT',
          message: 'A percentage discount cannot exceed 100.',
        });
      }
      const student = await scope.tx.student.count({
        where: { id: dto.studentId, schoolId: scope.schoolId },
      });
      if (student === 0)
        throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
      if (dto.feeItemId) await this.assertItems(scope, [dto.feeItemId]);

      const created = await scope.tx.studentDiscount.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          studentId: dto.studentId,
          name: dto.name,
          category: dto.category,
          kind: dto.kind,
          value: money(dto.value),
          feeItemId: dto.feeItemId ?? null,
        },
        select: DISCOUNT_SELECT,
      });
      const view = toDiscount(created);
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.discount.created',
        { type: 'student_discount', id: view.id },
        {
          studentId: dto.studentId,
          name: view.name,
          category: view.category,
          kind: view.kind,
          value: view.value,
        },
      );
      return view;
    });
  }

  /** Ends or reinstates a discount. Invoices already issued are unaffected. */
  setDiscountActive(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    isActive: boolean,
  ): Promise<DiscountView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const existing = await scope.tx.studentDiscount.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { isActive: true },
      });
      if (!existing)
        throw new NotFoundException({ code: 'DISCOUNT_NOT_FOUND', message: 'Discount not found.' });
      const updated = await scope.tx.studentDiscount.update({
        where: { id },
        data: { isActive },
        select: DISCOUNT_SELECT,
      });
      if (existing.isActive !== isActive) {
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'finance.discount.updated',
          { type: 'student_discount', id },
          { isActive },
        );
      }
      return toDiscount(updated);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async assertItemNameFree(scope: SchoolScope, name: string): Promise<void> {
    const taken = await scope.tx.feeItem.count({
      where: { schoolId: scope.schoolId, name: { equals: name, mode: 'insensitive' } },
    });
    if (taken > 0) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: 'A fee item with this name already exists.',
      });
    }
  }

  private async assertItems(scope: SchoolScope, ids: string[]): Promise<void> {
    const found = await scope.tx.feeItem.count({
      where: { id: { in: ids }, schoolId: scope.schoolId },
    });
    if (found !== new Set(ids).size) {
      throw new BadRequestException({
        code: 'FEE_ITEM_NOT_FOUND',
        message: 'One or more fee items do not exist.',
      });
    }
  }

  private async assertStructureParts(scope: SchoolScope, dto: SaveFeeStructureDto): Promise<void> {
    const ids = dto.lines.map((line) => line.feeItemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_FEE_ITEM',
        message: 'A fee item appears more than once.',
      });
    }
    await this.assertItems(scope, ids);
    const term = await scope.tx.term.count({ where: { id: dto.termId, schoolId: scope.schoolId } });
    if (term === 0)
      throw new BadRequestException({
        code: 'TERM_NOT_FOUND',
        message: 'The term does not exist.',
      });
    if (dto.classId) {
      const schoolClass = await scope.tx.schoolClass.count({
        where: { id: dto.classId, schoolId: scope.schoolId },
      });
      if (schoolClass === 0)
        throw new BadRequestException({
          code: 'CLASS_NOT_FOUND',
          message: 'The class does not exist.',
        });
    }
  }
}

export const structureNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'FEE_STRUCTURE_NOT_FOUND', message: 'Fee structure not found.' });
