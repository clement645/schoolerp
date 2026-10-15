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
import { money, type Decimal } from './finance.calc.js';
import type {
  CreateRefundDto,
  PaymentMethodValue,
  PaymentsQueryDto,
  RecordPaymentDto,
} from './finance.dto.js';
import {
  assertNotFuture,
  availableOf,
  lockStudent,
  nextNumber,
  refreshInvoice,
  settle,
  today,
} from './finance.ledger.js';

export interface PaymentSummary {
  id: string;
  receiptNumber: string;
  student: { id: string; name: string; admissionNumber: string };
  amount: number;
  method: PaymentMethodValue;
  reference: string | null;
  paidOn: string;
  status: 'COMPLETED' | 'REVERSED';
  allocated: number;
  refunded: number;
  /** Settles no invoice and has not been refunded: the learner's credit. */
  unallocated: number;
}

export interface PaymentDetail extends PaymentSummary {
  notes: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  createdAt: string;
  allocations: { invoiceId: string; invoiceNumber: string; amount: number }[];
  refunds: {
    id: string;
    number: string;
    amount: number;
    method: string;
    reason: string;
    refundedOn: string;
  }[];
}

const SUMMARY_SELECT = {
  id: true,
  receiptNumber: true,
  amount: true,
  method: true,
  reference: true,
  paidOn: true,
  status: true,
  allocatedTotal: true,
  refundedTotal: true,
  student: {
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true },
  },
} satisfies Prisma.PaymentSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  notes: true,
  reversalReason: true,
  reversedAt: true,
  createdAt: true,
  allocations: {
    select: { amount: true, invoice: { select: { id: true, number: true } } },
    orderBy: { createdAt: 'asc' },
  },
  refunds: {
    select: { id: true, number: true, amount: true, method: true, reason: true, refundedOn: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PaymentSelect;

type SummaryRow = Prisma.PaymentGetPayload<{ select: typeof SUMMARY_SELECT }>;

export function toPaymentSummary(row: SummaryRow): PaymentSummary {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    student: {
      id: row.student.id,
      name: [row.student.firstName, row.student.middleName, row.student.lastName]
        .filter(Boolean)
        .join(' '),
      admissionNumber: row.student.admissionNumber,
    },
    amount: row.amount.toNumber(),
    method: row.method,
    reference: row.reference,
    paidOn: formatCalendarDate(row.paidOn),
    status: row.status,
    allocated: row.allocatedTotal.toNumber(),
    refunded: row.refundedTotal.toNumber(),
    unallocated: row.status === 'COMPLETED' ? availableOf(row).toNumber() : 0,
  };
}

export const paymentNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });

export interface NewPayment {
  studentId: string;
  amount: Decimal;
  method: PaymentMethodValue;
  reference: string | null;
  paidOn: Date;
  invoiceId?: string;
  notes: string | null;
  receivedById: string | null;
}

/**
 * Payments are never edited or deleted. A mistake is corrected by reversing
 * the payment, and money owed back is returned with a refund; both leave the
 * original record in place.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: PaymentsQueryDto,
  ): Promise<Paginated<PaymentSummary>> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const search = query.search?.trim();
      const where: Prisma.PaymentWhereInput = {
        schoolId: scope.schoolId,
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(query.method ? { method: query.method } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              paidOn: {
                ...(query.from ? { gte: parseCalendarDate(query.from) } : {}),
                ...(query.to ? { lte: parseCalendarDate(query.to) } : {}),
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { receiptNumber: { contains: search, mode: 'insensitive' } },
                { reference: { contains: search, mode: 'insensitive' } },
                { student: { admissionNumber: { contains: search, mode: 'insensitive' } } },
                { student: { firstName: { contains: search, mode: 'insensitive' } } },
                { student: { lastName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        scope.tx.payment.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
          ...toSkipTake(query),
        }),
        scope.tx.payment.count({ where }),
      ]);
      return paginate(rows.map(toPaymentSummary), total, query);
    });
  }

  get(principal: Principal, schoolId: string | undefined, id: string): Promise<PaymentDetail> {
    return this.scopes.run(principal, schoolId, (scope) => this.load(scope, { id }));
  }

  async load(scope: SchoolScope, where: Prisma.PaymentWhereInput): Promise<PaymentDetail> {
    const row = await scope.tx.payment.findFirst({
      where: { ...where, schoolId: scope.schoolId },
      select: DETAIL_SELECT,
    });
    if (!row) throw paymentNotFound();
    return {
      ...toPaymentSummary(row),
      notes: row.notes,
      reversalReason: row.reversalReason,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      allocations: row.allocations.map((allocation) => ({
        invoiceId: allocation.invoice.id,
        invoiceNumber: allocation.invoice.number,
        amount: allocation.amount.toNumber(),
      })),
      refunds: row.refunds.map((refund) => ({
        id: refund.id,
        number: refund.number,
        amount: refund.amount.toNumber(),
        method: refund.method,
        reason: refund.reason,
        refundedOn: formatCalendarDate(refund.refundedOn),
      })),
    };
  }

  record(
    actor: Actor,
    schoolId: string | undefined,
    dto: RecordPaymentDto,
  ): Promise<PaymentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      if (dto.method === 'MPESA') {
        // M-Pesa money is credited only by Safaricom's confirmation, never by hand.
        throw new BadRequestException({
          code: 'MPESA_NOT_MANUAL',
          message: 'M-Pesa payments are recorded automatically when Safaricom confirms them.',
        });
      }
      if (dto.method !== 'CASH' && !dto.reference) {
        throw new BadRequestException({
          code: 'REFERENCE_REQUIRED',
          message: 'Enter the transaction reference for this payment.',
        });
      }
      const id = await this.create(scope, {
        studentId: dto.studentId,
        amount: money(dto.amount),
        method: dto.method,
        reference: dto.reference ?? null,
        paidOn: dto.paidOn ? parseCalendarDate(dto.paidOn) : today(),
        invoiceId: dto.invoiceId,
        notes: dto.notes ?? null,
        receivedById: actor.principal.userId,
      });
      const payment = await this.load(scope, { id });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.payment.recorded',
        { type: 'payment', id },
        {
          receiptNumber: payment.receiptNumber,
          studentId: dto.studentId,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
        },
      );
      return payment;
    });
  }

  /**
   * Records money received and applies it to what the learner owes. Also used
   * for confirmed M-Pesa payments, which is why it takes a scope rather than
   * a signed-in user.
   */
  async create(scope: SchoolScope, input: NewPayment): Promise<string> {
    assertNotFuture(input.paidOn, 'The payment date');
    await lockStudent(scope, input.studentId);

    if (input.invoiceId) {
      const invoice = await scope.tx.invoice.findFirst({
        where: { id: input.invoiceId, schoolId: scope.schoolId, studentId: input.studentId },
        select: { status: true },
      });
      if (!invoice) {
        throw new UnprocessableEntityException({
          code: 'INVOICE_NOT_FOUND',
          message: 'That invoice does not belong to this learner.',
        });
      }
      if (invoice.status === 'VOID') {
        throw new ConflictException({
          code: 'INVOICE_VOID',
          message: 'A voided invoice cannot be paid.',
        });
      }
    }
    if (input.reference) {
      // Checked here for a clear message; the unique index is the guarantee.
      const duplicate = await scope.tx.payment.findFirst({
        where: { schoolId: scope.schoolId, method: input.method, reference: input.reference },
        select: { receiptNumber: true },
      });
      if (duplicate) {
        throw new ConflictException({
          code: 'DUPLICATE_PAYMENT',
          message: `This transaction has already been recorded as receipt ${duplicate.receiptNumber}.`,
        });
      }
    }

    const receiptNumber = await nextNumber(scope, 'RCT', input.paidOn.getUTCFullYear());
    const payment = await scope.tx.payment.create({
      data: {
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        receiptNumber,
        studentId: input.studentId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        paidOn: input.paidOn,
        notes: input.notes,
        receivedById: input.receivedById,
      },
      select: { id: true },
    });
    await settle(scope, input.studentId, input.invoiceId);
    return payment.id;
  }

  /** Cancels a payment recorded in error, returning its invoices to unpaid. */
  reverse(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    reason: string,
  ): Promise<PaymentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const found = await scope.tx.payment.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { studentId: true },
      });
      if (!found) throw paymentNotFound();
      await lockStudent(scope, found.studentId);
      const payment = await scope.tx.payment.findUniqueOrThrow({
        where: { id },
        select: {
          receiptNumber: true,
          amount: true,
          status: true,
          refundedTotal: true,
          allocations: { select: { id: true, invoiceId: true } },
        },
      });
      if (payment.status === 'REVERSED') {
        throw new ConflictException({
          code: 'PAYMENT_REVERSED',
          message: 'This payment has already been reversed.',
        });
      }
      if (payment.refundedTotal.greaterThan(0)) {
        throw new ConflictException({
          code: 'PAYMENT_HAS_REFUNDS',
          message: 'Part of this payment has been refunded, so it can no longer be reversed.',
        });
      }

      await scope.tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
      await scope.tx.payment.update({
        where: { id },
        data: {
          status: 'REVERSED',
          allocatedTotal: 0,
          reversedAt: new Date(),
          reversedById: actor.principal.userId,
          reversalReason: reason,
        },
      });
      for (const invoiceId of new Set(
        payment.allocations.map((allocation) => allocation.invoiceId),
      )) {
        await refreshInvoice(scope, invoiceId);
      }
      // Other money the learner has on account may now cover those invoices.
      await settle(scope, found.studentId);

      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.payment.reversed',
        { type: 'payment', id },
        {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount.toNumber(),
          reason,
        },
      );
      return this.load(scope, { id });
    });
  }

  /** Returns money from the part of a payment that settles no invoice. */
  refund(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: CreateRefundDto,
  ): Promise<PaymentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const found = await scope.tx.payment.findFirst({
        where: { id, schoolId: scope.schoolId },
        select: { studentId: true },
      });
      if (!found) throw paymentNotFound();
      await lockStudent(scope, found.studentId);
      const payment = await scope.tx.payment.findUniqueOrThrow({
        where: { id },
        select: {
          receiptNumber: true,
          status: true,
          amount: true,
          allocatedTotal: true,
          refundedTotal: true,
        },
      });
      if (payment.status === 'REVERSED') {
        throw new ConflictException({
          code: 'PAYMENT_REVERSED',
          message: 'A reversed payment cannot be refunded.',
        });
      }
      const amount = money(dto.amount);
      const available = availableOf(payment);
      if (amount.greaterThan(available)) {
        throw new UnprocessableEntityException({
          code: 'REFUND_EXCEEDS_CREDIT',
          message: available.greaterThan(0)
            ? `Only ${available.toFixed(2)} of this payment is unallocated and can be refunded.`
            : 'All of this payment settles invoices. Credit the invoice first to free the money.',
        });
      }

      const number = await nextNumber(scope, 'RF', new Date().getUTCFullYear());
      const refund = await scope.tx.refund.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          number,
          paymentId: id,
          studentId: found.studentId,
          amount,
          method: dto.method,
          reference: dto.reference ?? null,
          reason: dto.reason,
          refundedOn: today(),
          createdById: actor.principal.userId,
        },
        select: { id: true },
      });
      await scope.tx.payment.update({
        where: { id },
        data: { refundedTotal: payment.refundedTotal.plus(amount) },
      });

      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'finance.refund.issued',
        { type: 'refund', id: refund.id },
        {
          number,
          receiptNumber: payment.receiptNumber,
          amount: amount.toNumber(),
          method: dto.method,
          reason: dto.reason,
        },
      );
      return this.load(scope, { id });
    });
  }
}
