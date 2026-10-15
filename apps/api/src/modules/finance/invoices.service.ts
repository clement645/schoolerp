import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { paginate, toSkipTake, type Paginated } from '../../common/http/pagination.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { structureNotFound } from './fees.service.js';
import {
  applyDiscounts,
  invoiceState,
  money,
  sum,
  ZERO,
  type ChargeLine,
  type DiscountRule,
} from './finance.calc.js';
import type {
  CreateCreditNoteDto,
  CreateInvoiceDto,
  GenerateInvoicesDto,
  InvoicesQueryDto,
} from './finance.dto.js';
import {
  lockStudent,
  nextNumber,
  refreshInvoice,
  releaseFromInvoice,
  settle,
  today,
  type LedgerStudent,
} from './finance.ledger.js';

export interface InvoiceSummary {
  id: string;
  number: string;
  student: { id: string; name: string; admissionNumber: string };
  class: string | null;
  term: string | null;
  issueDate: string;
  dueDate: string;
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  /** Owed and past its due date. */
  isOverdue: boolean;
  total: number;
  paid: number;
  credited: number;
  balance: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotal: number;
  discountTotal: number;
  notes: string | null;
  voidReason: string | null;
  lines: { kind: 'CHARGE' | 'DISCOUNT'; description: string; amount: number }[];
  payments: {
    paymentId: string;
    receiptNumber: string;
    paidOn: string;
    method: string;
    amount: number;
  }[];
  creditNotes: { id: string; number: string; amount: number; reason: string; createdAt: string }[];
}

export interface GenerationResult {
  created: number;
  /** Learners who already hold an invoice for this fee structure. */
  skipped: number;
  totalInvoiced: number;
}

const SUMMARY_SELECT = {
  id: true,
  number: true,
  className: true,
  issueDate: true,
  dueDate: true,
  status: true,
  total: true,
  paidTotal: true,
  creditTotal: true,
  balance: true,
  term: { select: { name: true } },
  student: {
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true },
  },
} satisfies Prisma.InvoiceSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  subtotal: true,
  discountTotal: true,
  notes: true,
  voidReason: true,
  lines: { select: { kind: true, description: true, amount: true }, orderBy: { position: 'asc' } },
  allocations: {
    select: {
      amount: true,
      payment: { select: { id: true, receiptNumber: true, paidOn: true, method: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  creditNotes: {
    select: { id: true, number: true, amount: true, reason: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryRow = Prisma.InvoiceGetPayload<{ select: typeof SUMMARY_SELECT }>;
type DetailRow = Prisma.InvoiceGetPayload<{ select: typeof DETAIL_SELECT }>;

export function toInvoiceSummary(row: SummaryRow): InvoiceSummary {
  return {
    id: row.id,
    number: row.number,
    student: {
      id: row.student.id,
      name: [row.student.firstName, row.student.middleName, row.student.lastName]
        .filter(Boolean)
        .join(' '),
      admissionNumber: row.student.admissionNumber,
    },
    class: row.className,
    term: row.term?.name ?? null,
    issueDate: formatCalendarDate(row.issueDate),
    dueDate: formatCalendarDate(row.dueDate),
    status: row.status,
    isOverdue: row.status !== 'VOID' && row.balance.greaterThan(0) && row.dueDate < today(),
    total: row.total.toNumber(),
    paid: row.paidTotal.toNumber(),
    credited: row.creditTotal.toNumber(),
    balance: row.balance.toNumber(),
  };
}

const toDetail = (row: DetailRow): InvoiceDetail => ({
  ...toInvoiceSummary(row),
  subtotal: row.subtotal.toNumber(),
  discountTotal: row.discountTotal.toNumber(),
  notes: row.notes,
  voidReason: row.voidReason,
  lines: row.lines.map((line) => ({
    kind: line.kind,
    description: line.description,
    amount: line.amount.toNumber(),
  })),
  payments: row.allocations.map((allocation) => ({
    paymentId: allocation.payment.id,
    receiptNumber: allocation.payment.receiptNumber,
    paidOn: formatCalendarDate(allocation.payment.paidOn),
    method: allocation.payment.method,
    amount: allocation.amount.toNumber(),
  })),
  creditNotes: row.creditNotes.map((note) => ({
    id: note.id,
    number: note.number,
    amount: note.amount.toNumber(),
    reason: note.reason,
    createdAt: note.createdAt.toISOString(),
  })),
});

export const invoiceNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });

/**
 * Invoices are immutable once issued. What a learner owes changes only
 * through payments, credit notes and — before anything is paid — voiding.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: InvoicesQueryDto,
  ): Promise<Paginated<InvoiceSummary>> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const search = query.search?.trim();
      const status: Prisma.InvoiceWhereInput =
        query.status === 'OUTSTANDING'
          ? { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }
          : query.status === 'OVERDUE'
            ? { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: today() } }
            : query.status
              ? { status: query.status }
              : {};
      const where: Prisma.InvoiceWhereInput = {
        schoolId: scope.schoolId,
        ...status,
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.classId ? { student: { currentClassId: query.classId } } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { student: { admissionNumber: { contains: search, mode: 'insensitive' } } },
                { student: { firstName: { contains: search, mode: 'insensitive' } } },
                { student: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        scope.tx.invoice.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
          ...toSkipTake(query),
        }),
        scope.tx.invoice.count({ where }),
      ]);
      return paginate(rows.map(toInvoiceSummary), total, query);
    });
  }

  get(principal: Principal, schoolId: string | undefined, id: string): Promise<InvoiceDetail> {
    return this.scopes.run(principal, schoolId, (scope) => this.load(scope, { id }));
  }

  /** Loads an invoice matching `where` within the school. Shared with the portals. */
  async load(scope: SchoolScope, where: Prisma.InvoiceWhereInput): Promise<InvoiceDetail> {
    const row = await scope.tx.invoice.findFirst({
      where: { ...where, schoolId: scope.schoolId },
      select: DETAIL_SELECT,
    });
    if (!row) throw invoiceNotFound();
    return toDetail(row);
  }

  create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const { issueDate, dueDate } = this.dates(dto);
      let termId = dto.termId ?? null;
      if (dto.termId) {
        const term = await scope.tx.term.count({
          where: { id: dto.termId, schoolId: scope.schoolId },
        });
        if (term === 0) {
          throw new BadRequestException({
            code: 'TERM_NOT_FOUND',
            message: 'The term does not exist.',
          });
        }
      } else if (dto.termId === undefined) {
        // Unless told otherwise, an invoice belongs to the term it is issued
        // in, so that term's figures include it.
        const term = await scope.tx.term.findFirst({
          where: {
            schoolId: scope.schoolId,
            startDate: { lte: issueDate },
            endDate: { gte: issueDate },
          },
          select: { id: true },
        });
        termId = term?.id ?? null;
      }
      const itemIds = [
        ...new Set(dto.lines.flatMap((line) => (line.feeItemId ? [line.feeItemId] : []))),
      ];
      if (itemIds.length > 0) {
        const found = await scope.tx.feeItem.count({
          where: { id: { in: itemIds }, schoolId: scope.schoolId },
        });
        if (found !== itemIds.length) {
          throw new BadRequestException({
            code: 'FEE_ITEM_NOT_FOUND',
            message: 'One or more fee items do not exist.',
          });
        }
      }

      const student = await lockStudent(scope, dto.studentId);
      const id = await this.issue(scope, actor, student, {
        charges: dto.lines.map((line) => ({
          feeItemId: line.feeItemId ?? null,
          description: line.description,
          amount: money(line.amount),
        })),
        applyDiscounts: dto.applyDiscounts ?? true,
        termId,
        feeStructureId: null,
        issueDate,
        dueDate,
        notes: dto.notes ?? null,
      });
      return this.load(scope, { id });
    });
  }

  /**
   * Invoices every active learner a fee structure applies to. Learners who
   * already hold an invoice for it are skipped, so running it again after new
   * admissions invoices only the newcomers.
   */
  generate(
    actor: Actor,
    schoolId: string | undefined,
    dto: GenerateInvoicesDto,
  ): Promise<GenerationResult> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const { issueDate, dueDate } = this.dates(dto);
      const structure = await scope.tx.feeStructure.findFirst({
        where: { id: dto.feeStructureId, schoolId: scope.schoolId },
        select: {
          id: true,
          name: true,
          isActive: true,
          termId: true,
          classId: true,
          lines: {
            select: { feeItemId: true, amount: true, feeItem: { select: { name: true } } },
            orderBy: { feeItem: { name: 'asc' } },
          },
        },
      });
      if (!structure) throw structureNotFound();
      if (!structure.isActive) {
        throw new ConflictException({
          code: 'FEE_STRUCTURE_INACTIVE',
          message: 'This fee structure is not active.',
        });
      }

      const students = await scope.tx.student.findMany({
        where: {
          schoolId: scope.schoolId,
          status: 'ACTIVE',
          ...(structure.classId
            ? { currentClassId: structure.classId }
            : { currentClassId: { not: null } }),
        },
        select: { id: true },
        orderBy: { admissionNumber: 'asc' },
      });
      const invoiced = new Set(
        (
          await scope.tx.invoice.findMany({
            where: { feeStructureId: structure.id, status: { not: 'VOID' } },
            select: { studentId: true },
          })
        ).map((invoice) => invoice.studentId),
      );
      const charges: ChargeLine[] = structure.lines.map((line) => ({
        feeItemId: line.feeItemId,
        description: line.feeItem.name,
        amount: line.amount,
      }));

      let created = 0;
      let totalInvoiced = ZERO;
      for (const { id } of students) {
        if (invoiced.has(id)) continue;
        const student = await lockStudent(scope, id);
        const invoiceId = await this.issue(scope, actor, student, {
          charges,
          applyDiscounts: true,
          termId: structure.termId,
          feeStructureId: structure.id,
          issueDate,
          dueDate,
          notes: null,
          audit: false,
        });
        const invoice = await scope.tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          select: { total: true },
        });
        totalInvoiced = totalInvoiced.plus(invoice.total);
        created += 1;
      }

      const result = {
        created,
        skipped: students.length - created,
        totalInvoiced: totalInvoiced.toNumber(),
      };
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.invoices.generated',
        { type: 'fee_structure', id: structure.id },
        {
          structure: structure.name,
          ...result,
        },
      );
      return result;
    });
  }

  /** Cancels an invoice that nothing has been paid or credited against. */
  void(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    reason: string,
  ): Promise<InvoiceDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const found = await scope.tx.invoice.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { studentId: true },
      });
      if (!found) throw invoiceNotFound();
      await lockStudent(scope, found.studentId);
      const invoice = await scope.tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { number: true, status: true, total: true, paidTotal: true, creditTotal: true },
      });
      if (invoice.status === 'VOID') {
        throw new ConflictException({
          code: 'INVOICE_VOID',
          message: 'This invoice has already been voided.',
        });
      }
      if (invoice.paidTotal.greaterThan(0) || invoice.creditTotal.greaterThan(0)) {
        throw new ConflictException({
          code: 'INVOICE_HAS_PAYMENTS',
          message:
            'This invoice has payments or credits against it. Issue a credit note instead of voiding it.',
        });
      }
      await scope.tx.invoice.update({
        where: { id },
        data: {
          status: 'VOID',
          balance: 0,
          voidedAt: new Date(),
          voidedById: actor.principal.userId,
          voidReason: reason,
        },
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.invoice.voided',
        { type: 'invoice', id },
        {
          number: invoice.number,
          total: invoice.total.toNumber(),
          reason,
        },
      );
      return this.load(scope, { id });
    });
  }

  /**
   * Reduces what is owed on an invoice. If the invoice was already paid for
   * more than it now costs, the excess is freed and applied to the learner's
   * other invoices, or left as credit that can be refunded.
   */
  creditNote(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: CreateCreditNoteDto,
  ): Promise<InvoiceDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const found = await scope.tx.invoice.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { studentId: true },
      });
      if (!found) throw invoiceNotFound();
      await lockStudent(scope, found.studentId);
      const invoice = await scope.tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { number: true, status: true, total: true, paidTotal: true, creditTotal: true },
      });
      if (invoice.status === 'VOID') {
        throw new ConflictException({
          code: 'INVOICE_VOID',
          message: 'A voided invoice cannot be credited.',
        });
      }
      const amount = money(dto.amount);
      const creditable = invoice.total.minus(invoice.creditTotal);
      if (amount.greaterThan(creditable)) {
        throw new UnprocessableEntityException({
          code: 'CREDIT_EXCEEDS_INVOICE',
          message: `At most ${creditable.toFixed(2)} of this invoice can still be credited.`,
        });
      }

      const number = await nextNumber(scope, 'CN', new Date().getUTCFullYear());
      const note = await scope.tx.creditNote.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          number,
          invoiceId: id,
          studentId: found.studentId,
          amount,
          reason: dto.reason,
          createdById: actor.principal.userId,
        },
        select: { id: true },
      });

      const creditTotal = invoice.creditTotal.plus(amount);
      // Money already paid beyond what the invoice now costs is freed first,
      // then the credit is recorded, so the balance never dips below zero.
      const overpaid = invoice.paidTotal.minus(invoice.total.minus(creditTotal));
      if (overpaid.greaterThan(0)) await releaseFromInvoice(scope, id, overpaid);
      await refreshInvoice(scope, id, { creditTotal });
      if (overpaid.greaterThan(0)) await settle(scope, found.studentId);

      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.credit_note.issued',
        { type: 'credit_note', id: note.id },
        {
          number,
          invoice: invoice.number,
          amount: amount.toNumber(),
          reason: dto.reason,
        },
      );
      return this.load(scope, { id });
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private dates(dto: { issueDate?: string; dueDate: string }): { issueDate: Date; dueDate: Date } {
    const issueDate = dto.issueDate ? parseCalendarDate(dto.issueDate) : today();
    const dueDate = parseCalendarDate(dto.dueDate);
    if (dueDate < issueDate) {
      throw new BadRequestException({
        code: 'INVALID_DUE_DATE',
        message: 'The due date cannot be before the issue date.',
      });
    }
    return { issueDate, dueDate };
  }

  /** Creates one invoice for a locked learner and applies any credit they hold. */
  private async issue(
    scope: SchoolScope,
    actor: Actor,
    student: LedgerStudent,
    input: {
      charges: ChargeLine[];
      applyDiscounts: boolean;
      termId: string | null;
      feeStructureId: string | null;
      issueDate: Date;
      dueDate: Date;
      notes: string | null;
      audit?: boolean;
    },
  ): Promise<string> {
    const rules: DiscountRule[] = input.applyDiscounts
      ? await scope.tx.studentDiscount.findMany({
          where: { studentId: student.id, schoolId: scope.schoolId, isActive: true },
          select: { name: true, category: true, kind: true, value: true, feeItemId: true },
          // Scholarships first, then the order they were granted.
          orderBy: [{ category: 'desc' }, { createdAt: 'asc' }],
        })
      : [];
    const discounts = applyDiscounts(input.charges, rules);
    const subtotal = sum(input.charges.map((charge) => charge.amount));
    const discountTotal = sum(discounts.map((discount) => discount.amount));
    const total = subtotal.minus(discountTotal);

    const number = await nextNumber(scope, 'INV', input.issueDate.getUTCFullYear());
    const invoice = await scope.tx.invoice.create({
      data: {
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        number,
        studentId: student.id,
        termId: input.termId,
        feeStructureId: input.feeStructureId,
        className: student.className,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        // A fully discounted invoice owes nothing from the start.
        status: invoiceState(total, ZERO, ZERO),
        subtotal,
        discountTotal,
        total,
        balance: total,
        notes: input.notes,
        createdById: actor.principal.userId,
        lines: {
          create: [
            ...input.charges.map((charge, index) => ({
              tenantId: scope.tenantId,
              kind: 'CHARGE' as const,
              feeItemId: charge.feeItemId,
              description: charge.description,
              amount: charge.amount,
              position: index,
            })),
            ...discounts.map((discount, index) => ({
              tenantId: scope.tenantId,
              kind: 'DISCOUNT' as const,
              feeItemId: discount.feeItemId,
              description: discount.description,
              amount: discount.amount,
              position: input.charges.length + index,
            })),
          ],
        },
      },
      select: { id: true },
    });
    // Money the learner already has on account goes towards the new invoice.
    await settle(scope, student.id);

    if (input.audit !== false) {
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.invoice.issued',
        { type: 'invoice', id: invoice.id },
        {
          number,
          studentId: student.id,
          total: total.toNumber(),
        },
      );
    }
    return invoice.id;
  }
}
