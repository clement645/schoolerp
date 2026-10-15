import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { SchoolScope } from '../../common/school/school-scope.service.js';
import { allocate, invoiceState, money, sum, ZERO, type Decimal } from './finance.calc.js';

export type DocumentKind = 'INV' | 'RCT' | 'CN' | 'RF';

export interface LedgerStudent {
  id: string;
  name: string;
  admissionNumber: string;
  className: string | null;
}

/**
 * Finds a learner and locks their row for the rest of the transaction. Every
 * operation that moves money for a learner starts here, so two of them — say
 * two cashiers recording against the same invoice — run one after the other
 * and can never both spend the same balance.
 */
export async function lockStudent(scope: SchoolScope, studentId: string): Promise<LedgerStudent> {
  const locked = await scope.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM students WHERE id = ${studentId}::uuid AND school_id = ${scope.schoolId}::uuid FOR UPDATE`;
  if (locked.length === 0) {
    throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
  }
  const student = await scope.tx.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      admissionNumber: true,
      currentClass: { select: { name: true } },
    },
  });
  return {
    id: student.id,
    name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
    admissionNumber: student.admissionNumber,
    className: student.currentClass?.name ?? null,
  };
}

/** The next document number of a kind, e.g. `INV-2026-000042`. */
export async function nextNumber(
  scope: SchoolScope,
  kind: DocumentKind,
  year: number,
): Promise<string> {
  // The upsert takes a row lock, so concurrent callers queue for their number.
  const counter = await scope.tx.financeCounter.upsert({
    where: { schoolId_kind_year: { schoolId: scope.schoolId, kind, year } },
    create: { tenantId: scope.tenantId, schoolId: scope.schoolId, kind, year, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return `${kind}-${year}-${String(counter.value).padStart(6, '0')}`;
}

/**
 * Recomputes an invoice's paid total, balance and status from its
 * allocations. Passing `creditTotal` records a new credit in the same write,
 * so the totals are never momentarily inconsistent.
 */
export async function refreshInvoice(
  scope: SchoolScope,
  invoiceId: string,
  change: { creditTotal?: Decimal } = {},
): Promise<void> {
  const invoice = await scope.tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      total: true,
      creditTotal: true,
      status: true,
      allocations: { select: { amount: true } },
    },
  });
  if (invoice.status === 'VOID') return;
  const paid = sum(invoice.allocations.map((allocation) => allocation.amount));
  const credited = change.creditTotal ?? invoice.creditTotal;
  await scope.tx.invoice.update({
    where: { id: invoiceId },
    data: {
      paidTotal: paid,
      creditTotal: credited,
      balance: invoice.total.minus(paid).minus(credited),
      status: invoiceState(invoice.total, paid, credited),
    },
  });
}

/** Recomputes how much of a payment is tied to invoices. */
export async function refreshPayment(scope: SchoolScope, paymentId: string): Promise<void> {
  const allocations = await scope.tx.paymentAllocation.findMany({
    where: { paymentId },
    select: { amount: true },
  });
  await scope.tx.payment.update({
    where: { id: paymentId },
    data: { allocatedTotal: sum(allocations.map((allocation) => allocation.amount)) },
  });
}

/** The part of a completed payment that settles no invoice and was not refunded. */
export const availableOf = (payment: {
  amount: Decimal;
  allocatedTotal: Decimal;
  refundedTotal: Decimal;
}): Decimal => payment.amount.minus(payment.allocatedTotal).minus(payment.refundedTotal);

/**
 * Applies a learner's unallocated money to what they still owe: oldest payment
 * to the invoice due soonest. Call with the learner locked.
 *
 * @param firstInvoiceId an invoice to settle before the others, when the
 *   payer said what the money was for.
 */
export async function settle(
  scope: SchoolScope,
  studentId: string,
  firstInvoiceId?: string,
): Promise<void> {
  const [payments, invoices] = await Promise.all([
    scope.tx.payment.findMany({
      where: { studentId, schoolId: scope.schoolId, status: 'COMPLETED' },
      select: { id: true, amount: true, allocatedTotal: true, refundedTotal: true },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    }),
    scope.tx.invoice.findMany({
      where: {
        studentId,
        schoolId: scope.schoolId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        balance: { gt: 0 },
      },
      select: { id: true, balance: true },
      orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  if (firstInvoiceId) {
    invoices.sort((a, b) => Number(b.id === firstInvoiceId) - Number(a.id === firstInvoiceId));
  }

  const allocations = allocate(
    payments.map((payment) => ({ id: payment.id, available: availableOf(payment) })),
    invoices,
  );
  for (const { paymentId, invoiceId, amount } of allocations) {
    await scope.tx.paymentAllocation.upsert({
      where: { paymentId_invoiceId: { paymentId, invoiceId } },
      create: { tenantId: scope.tenantId, paymentId, invoiceId, amount },
      update: { amount: { increment: amount } },
    });
  }
  for (const id of new Set(allocations.map((allocation) => allocation.paymentId))) {
    await refreshPayment(scope, id);
  }
  for (const id of new Set(allocations.map((allocation) => allocation.invoiceId))) {
    await refreshInvoice(scope, id);
  }
}

/**
 * Frees `amount` of the money allocated to an invoice, newest allocation
 * first, so it can settle something else or be refunded. Used when a credit
 * note leaves an invoice paid for more than it now costs.
 */
export async function releaseFromInvoice(
  scope: SchoolScope,
  invoiceId: string,
  amount: Decimal,
): Promise<void> {
  let remaining = money(amount);
  const allocations = await scope.tx.paymentAllocation.findMany({
    where: { invoiceId },
    select: { id: true, paymentId: true, amount: true },
    orderBy: { createdAt: 'desc' },
  });
  const touched = new Set<string>();
  for (const allocation of allocations) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const freed = allocation.amount.lessThan(remaining) ? allocation.amount : remaining;
    if (freed.equals(allocation.amount)) {
      await scope.tx.paymentAllocation.delete({ where: { id: allocation.id } });
    } else {
      await scope.tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { amount: allocation.amount.minus(freed) },
      });
    }
    remaining = remaining.minus(freed);
    touched.add(allocation.paymentId);
  }
  for (const paymentId of touched) await refreshPayment(scope, paymentId);
  await refreshInvoice(scope, invoiceId);
}

/**
 * A date money changed hands. The server runs in UTC and schools east of it
 * are a day ahead for part of the night, so "today" may run one day ahead.
 */
export function assertNotFuture(date: Date, what: string): void {
  const latest = new Date();
  latest.setUTCHours(0, 0, 0, 0);
  latest.setUTCDate(latest.getUTCDate() + 1);
  if (date > latest) {
    throw new UnprocessableEntityException({
      code: 'DATE_IN_FUTURE',
      message: `${what} cannot be in the future.`,
    });
  }
}

export const today = (): Date => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
};

export { ZERO };
