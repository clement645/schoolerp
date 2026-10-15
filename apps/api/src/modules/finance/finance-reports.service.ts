import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { loadPolicies } from '../../common/school/school-settings.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  runStatement,
  sum,
  ZERO,
  type StatementEvent,
  type StatementKind,
} from './finance.calc.js';
import type { FinanceSummaryQueryDto, StatementQueryDto } from './finance.dto.js';
import { availableOf, today } from './finance.ledger.js';
import { toPaymentSummary, type PaymentSummary } from './payments.service.js';

export interface Statement {
  student: { id: string; name: string; admissionNumber: string; class: string | null };
  currency: string;
  from: string | null;
  to: string | null;
  openingBalance: number;
  /** What the learner owes at the end; negative when in credit. */
  closingBalance: number;
  totals: { invoiced: number; paid: number; credited: number; refunded: number };
  lines: {
    date: string;
    kind: StatementKind;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
}

export interface FinanceSummary {
  currency: string;
  totals: {
    invoiced: number;
    credited: number;
    collected: number;
    outstanding: number;
    overdue: number;
    overdueInvoices: number;
    /** Share of what was payable that has been collected, 0–100. */
    collectionRate: number;
    /** Money received that settles no invoice yet. */
    unallocated: number;
  };
  byMethod: { method: string; amount: number; payments: number }[];
  /** Collections in each of the last six months, oldest first. */
  monthly: { month: string; amount: number }[];
  byClass: { class: string; invoiced: number; outstanding: number }[];
  topBalances: {
    student: { id: string; name: string; admissionNumber: string };
    class: string | null;
    balance: number;
  }[];
  recentPayments: PaymentSummary[];
}

const nameOf = (student: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string => [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
const share = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.round((part / whole) * 10000) / 100;

@Injectable()
export class FinanceReportsService {
  constructor(private readonly scopes: SchoolScopeService) {}

  statement(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
    query: StatementQueryDto,
  ): Promise<Statement> {
    return this.scopes.run(principal, schoolId, (scope) =>
      this.statementFor(scope, studentId, query),
    );
  }

  /**
   * A learner's account: every invoice, payment, credit and refund in the
   * order it was posted, with a running balance. Shared with the portals,
   * whose callers must already have established the learner is theirs.
   */
  async statementFor(
    scope: SchoolScope,
    studentId: string,
    query: StatementQueryDto,
  ): Promise<Statement> {
    const student = await scope.tx.student.findFirst({
      where: { id: studentId, schoolId: scope.schoolId },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        admissionNumber: true,
        currentClass: { select: { name: true } },
      },
    });
    if (!student)
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });

    const where = { studentId, schoolId: scope.schoolId };
    const [invoices, payments, creditNotes, refunds, policies] = await Promise.all([
      scope.tx.invoice.findMany({
        where,
        select: {
          number: true,
          total: true,
          createdAt: true,
          voidedAt: true,
          voidReason: true,
          term: { select: { name: true } },
        },
      }),
      scope.tx.payment.findMany({
        where,
        select: {
          receiptNumber: true,
          amount: true,
          method: true,
          reference: true,
          createdAt: true,
          reversedAt: true,
          reversalReason: true,
        },
      }),
      scope.tx.creditNote.findMany({
        where,
        select: {
          number: true,
          amount: true,
          reason: true,
          createdAt: true,
          invoice: { select: { number: true } },
        },
      }),
      scope.tx.refund.findMany({
        where,
        select: { number: true, amount: true, reason: true, createdAt: true },
      }),
      loadPolicies(scope),
    ]);

    const events: StatementEvent[] = [];
    for (const invoice of invoices) {
      events.push({
        at: invoice.createdAt,
        kind: 'INVOICE',
        reference: invoice.number,
        description: invoice.term ? `Fees — ${invoice.term.name}` : 'Fees',
        debit: invoice.total,
        credit: ZERO,
      });
      if (invoice.voidedAt) {
        events.push({
          at: invoice.voidedAt,
          kind: 'INVOICE_VOIDED',
          reference: invoice.number,
          description: `Invoice voided: ${invoice.voidReason ?? ''}`.trim(),
          debit: ZERO,
          credit: invoice.total,
        });
      }
    }
    for (const payment of payments) {
      const method = payment.method.replace('_', ' ').toLowerCase();
      events.push({
        at: payment.createdAt,
        kind: 'PAYMENT',
        reference: payment.receiptNumber,
        description: `Payment by ${method}${payment.reference ? ` (${payment.reference})` : ''}`,
        debit: ZERO,
        credit: payment.amount,
      });
      if (payment.reversedAt) {
        events.push({
          at: payment.reversedAt,
          kind: 'PAYMENT_REVERSED',
          reference: payment.receiptNumber,
          description: `Payment reversed: ${payment.reversalReason ?? ''}`.trim(),
          debit: payment.amount,
          credit: ZERO,
        });
      }
    }
    for (const note of creditNotes) {
      events.push({
        at: note.createdAt,
        kind: 'CREDIT_NOTE',
        reference: note.number,
        description: `Credit on ${note.invoice.number}: ${note.reason}`,
        debit: ZERO,
        credit: note.amount,
      });
    }
    for (const refund of refunds) {
      events.push({
        at: refund.createdAt,
        kind: 'REFUND',
        reference: refund.number,
        description: `Refund: ${refund.reason}`,
        debit: refund.amount,
        credit: ZERO,
      });
    }

    const from = query.from ? parseCalendarDate(query.from) : null;
    // The end date is inclusive: everything posted before the next midnight.
    const until = query.to ? new Date(parseCalendarDate(query.to).getTime() + 86_400_000) : null;
    const all = runStatement(events);
    const before = from ? all.filter((line) => line.at < from) : [];
    const shown = all.filter((line) => (!from || line.at >= from) && (!until || line.at < until));
    const opening = before.length > 0 ? before[before.length - 1]!.balance : ZERO;
    const closing = shown.length > 0 ? shown[shown.length - 1]!.balance : opening;
    const total = (kinds: StatementKind[], side: 'debit' | 'credit') =>
      sum(shown.filter((line) => kinds.includes(line.kind)).map((line) => line[side])).toNumber();

    return {
      student: {
        id: student.id,
        name: nameOf(student),
        admissionNumber: student.admissionNumber,
        class: student.currentClass?.name ?? null,
      },
      currency: policies.currency,
      from: query.from ?? null,
      to: query.to ?? null,
      openingBalance: opening.toNumber(),
      closingBalance: closing.toNumber(),
      totals: {
        invoiced: total(['INVOICE'], 'debit') - total(['INVOICE_VOIDED'], 'credit'),
        paid: total(['PAYMENT'], 'credit') - total(['PAYMENT_REVERSED'], 'debit'),
        credited: total(['CREDIT_NOTE'], 'credit'),
        refunded: total(['REFUND'], 'debit'),
      },
      lines: shown.map((line) => ({
        date: formatCalendarDate(line.at),
        kind: line.kind,
        reference: line.reference,
        description: line.description,
        debit: line.debit.toNumber(),
        credit: line.credit.toNumber(),
        balance: line.balance.toNumber(),
      })),
    };
  }

  summary(
    principal: Principal,
    schoolId: string | undefined,
    query: FinanceSummaryQueryDto,
  ): Promise<FinanceSummary> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const invoices: Prisma.InvoiceWhereInput = {
        schoolId: scope.schoolId,
        status: { not: 'VOID' },
        ...(query.termId ? { termId: query.termId } : {}),
      };
      const completed: Prisma.PaymentWhereInput = { schoolId: scope.schoolId, status: 'COMPLETED' };
      const monthStart = today();
      monthStart.setUTCDate(1);
      const sixMonthsAgo = new Date(monthStart);
      sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5);

      const [totals, overdue, byMethod, daily, byClass, balances, recent, credit, policies] =
        await Promise.all([
          scope.tx.invoice.aggregate({
            where: invoices,
            _sum: { total: true, creditTotal: true, paidTotal: true, balance: true },
          }),
          scope.tx.invoice.aggregate({
            where: { ...invoices, balance: { gt: 0 }, dueDate: { lt: today() } },
            _sum: { balance: true },
            _count: { _all: true },
          }),
          scope.tx.payment.groupBy({
            by: ['method'],
            where: completed,
            _sum: { amount: true, refundedTotal: true },
            _count: { _all: true },
          }),
          scope.tx.payment.groupBy({
            by: ['paidOn'],
            where: { ...completed, paidOn: { gte: sixMonthsAgo } },
            _sum: { amount: true, refundedTotal: true },
          }),
          scope.tx.invoice.groupBy({
            by: ['className'],
            where: invoices,
            _sum: { total: true, creditTotal: true, balance: true },
          }),
          scope.tx.invoice.groupBy({
            by: ['studentId'],
            where: { ...invoices, balance: { gt: 0 } },
            _sum: { balance: true },
            orderBy: { _sum: { balance: 'desc' } },
            take: 10,
          }),
          scope.tx.payment.findMany({
            where: { schoolId: scope.schoolId },
            select: {
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
                select: {
                  id: true,
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  admissionNumber: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 8,
          }),
          scope.tx.payment.findMany({
            where: completed,
            select: { amount: true, allocatedTotal: true, refundedTotal: true },
          }),
          loadPolicies(scope),
        ]);

      const invoiced = totals._sum.total ?? ZERO;
      const credited = totals._sum.creditTotal ?? ZERO;
      const collected = totals._sum.paidTotal ?? ZERO;

      const months = new Map<string, number>();
      for (let offset = 0; offset < 6; offset += 1) {
        const month = new Date(sixMonthsAgo);
        month.setUTCMonth(month.getUTCMonth() + offset);
        months.set(month.toISOString().slice(0, 7), 0);
      }
      for (const row of daily) {
        const key = row.paidOn.toISOString().slice(0, 7);
        const net = (row._sum.amount ?? ZERO).minus(row._sum.refundedTotal ?? ZERO).toNumber();
        if (months.has(key))
          months.set(key, Math.round(((months.get(key) ?? 0) + net) * 100) / 100);
      }

      const debtors = await scope.tx.student.findMany({
        where: { id: { in: balances.map((row) => row.studentId) } },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          admissionNumber: true,
          currentClass: { select: { name: true } },
        },
      });
      const debtor = new Map(debtors.map((student) => [student.id, student]));

      return {
        currency: policies.currency,
        totals: {
          invoiced: invoiced.toNumber(),
          credited: credited.toNumber(),
          collected: collected.toNumber(),
          outstanding: (totals._sum.balance ?? ZERO).toNumber(),
          overdue: (overdue._sum.balance ?? ZERO).toNumber(),
          overdueInvoices: overdue._count._all,
          collectionRate: share(collected.toNumber(), invoiced.minus(credited).toNumber()),
          unallocated: sum(credit.map((payment) => availableOf(payment))).toNumber(),
        },
        byMethod: byMethod
          .map((row) => ({
            method: row.method,
            amount: (row._sum.amount ?? ZERO).minus(row._sum.refundedTotal ?? ZERO).toNumber(),
            payments: row._count._all,
          }))
          .sort((a, b) => b.amount - a.amount),
        monthly: [...months].map(([month, amount]) => ({ month, amount })),
        byClass: byClass
          .map((row) => ({
            class: row.className ?? 'No class',
            invoiced: (row._sum.total ?? ZERO).minus(row._sum.creditTotal ?? ZERO).toNumber(),
            outstanding: (row._sum.balance ?? ZERO).toNumber(),
          }))
          .sort((a, b) => a.class.localeCompare(b.class, undefined, { numeric: true })),
        topBalances: balances.flatMap((row) => {
          const student = debtor.get(row.studentId);
          return student
            ? [
                {
                  student: {
                    id: student.id,
                    name: nameOf(student),
                    admissionNumber: student.admissionNumber,
                  },
                  class: student.currentClass?.name ?? null,
                  balance: (row._sum.balance ?? ZERO).toNumber(),
                },
              ]
            : [];
        }),
        recentPayments: recent.map(toPaymentSummary),
      };
    });
  }
}
