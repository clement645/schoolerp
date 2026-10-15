import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { loadBranding } from '../../common/pdf/school-branding.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { loadPolicies } from '../../common/school/school-settings.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { StorageService } from '../../storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toCsv } from '../students/students.csv.js';
import { FinanceReportsService } from './finance-reports.service.js';
import type { InvoicesQueryDto, PaymentsQueryDto, StatementQueryDto } from './finance.dto.js';
import { date, methodLabel, renderInvoice, renderReceipt, renderStatement } from './finance.pdf.js';
import { InvoicesService, type InvoiceSummary } from './invoices.service.js';
import { PaymentsService, type PaymentSummary } from './payments.service.js';

export interface FinanceDocument {
  body: Buffer | string;
  fileName: string;
  contentType: 'application/pdf' | 'text/csv; charset=utf-8';
}

/** The most rows one list export may hold; narrow the filters for more. */
export const MAX_EXPORT_ROWS = 5000;
const PAGE = 100;

type Kind = 'invoice' | 'receipt' | 'statement' | 'statement_csv' | 'invoices_csv' | 'payments_csv';

const slug = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'document';

/**
 * Printable and downloadable finance documents. Each is built from the same
 * data the screens show — nothing is recalculated — and every download is
 * recorded in the audit log, since these documents carry personal data.
 */
@Injectable()
export class FinanceDocumentsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly reports: FinanceReportsService,
  ) {}

  invoicePdf(actor: Actor, schoolId: string | undefined, id: string): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, (scope) =>
      this.invoiceFor(scope, actor, { id }),
    );
  }

  receiptPdf(actor: Actor, schoolId: string | undefined, id: string): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, (scope) =>
      this.receiptFor(scope, actor, { id }),
    );
  }

  statementPdf(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    query: StatementQueryDto,
  ): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, (scope) =>
      this.statementFor(scope, actor, studentId, query),
    );
  }

  statementCsv(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    query: StatementQueryDto,
  ): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const statement = await this.reports.statementFor(scope, studentId, query);
      const body = toCsv(
        [
          'Date',
          'Entry',
          'Reference',
          'Details',
          `Charged (${statement.currency})`,
          `Paid (${statement.currency})`,
          `Balance (${statement.currency})`,
        ],
        [
          ...(statement.openingBalance !== 0
            ? [
                [
                  statement.from ?? '',
                  'Balance brought forward',
                  '',
                  '',
                  null,
                  null,
                  statement.openingBalance,
                ],
              ]
            : []),
          ...statement.lines.map((line) => [
            line.date,
            line.kind,
            line.reference,
            line.description,
            line.debit || null,
            line.credit || null,
            line.balance,
          ]),
        ],
      );
      await this.record(
        scope,
        actor,
        'statement_csv',
        { type: 'student', id: studentId },
        statement.student.admissionNumber,
      );
      return {
        body,
        fileName: `${slug(`statement-${statement.student.admissionNumber}-${statement.student.name}`)}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    });
  }

  /** The invoice list, with the same filters as the screen, as CSV. */
  async invoicesCsv(
    actor: Actor,
    schoolId: string | undefined,
    query: InvoicesQueryDto,
  ): Promise<FinanceDocument> {
    const rows = await this.collect((page) =>
      this.invoices.list(actor.principal, schoolId, { ...query, page, pageSize: PAGE }),
    );
    const currency = await this.currency(actor, schoolId);
    const body = toCsv(
      [
        'Invoice',
        'Admission number',
        'Learner',
        'Class',
        'Term',
        'Issued',
        'Due',
        'Status',
        'Overdue',
        `Total (${currency})`,
        `Paid (${currency})`,
        `Credited (${currency})`,
        `Balance (${currency})`,
      ],
      rows.map((invoice: InvoiceSummary) => [
        invoice.number,
        invoice.student.admissionNumber,
        invoice.student.name,
        invoice.class,
        invoice.term,
        invoice.issueDate,
        invoice.dueDate,
        invoice.status,
        invoice.isOverdue ? 'Yes' : 'No',
        invoice.total,
        invoice.paid,
        invoice.credited,
        invoice.balance,
      ]),
    );
    await this.scopes.run(actor.principal, schoolId, (scope) =>
      this.record(
        scope,
        actor,
        'invoices_csv',
        { type: 'school', id: scope.schoolId },
        `${rows.length} invoices`,
      ),
    );
    return {
      body,
      fileName: `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  async paymentsCsv(
    actor: Actor,
    schoolId: string | undefined,
    query: PaymentsQueryDto,
  ): Promise<FinanceDocument> {
    const rows = await this.collect((page) =>
      this.payments.list(actor.principal, schoolId, { ...query, page, pageSize: PAGE }),
    );
    const currency = await this.currency(actor, schoolId);
    const body = toCsv(
      [
        'Receipt',
        'Date',
        'Admission number',
        'Learner',
        'Method',
        'Reference',
        'Status',
        `Amount (${currency})`,
        `Applied (${currency})`,
        `Refunded (${currency})`,
        `Unallocated (${currency})`,
      ],
      rows.map((payment: PaymentSummary) => [
        payment.receiptNumber,
        payment.paidOn,
        payment.student.admissionNumber,
        payment.student.name,
        methodLabel(payment.method),
        payment.reference,
        payment.status,
        payment.amount,
        payment.allocated,
        payment.refunded,
        payment.unallocated,
      ]),
    );
    await this.scopes.run(actor.principal, schoolId, (scope) =>
      this.record(
        scope,
        actor,
        'payments_csv',
        { type: 'school', id: scope.schoolId },
        `${rows.length} payments`,
      ),
    );
    return {
      body,
      fileName: `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  // ── Shared with the portals, whose callers have already been checked ──────

  async invoiceFor(
    scope: SchoolScope,
    actor: Actor,
    where: Prisma.InvoiceWhereInput,
  ): Promise<FinanceDocument> {
    const invoice = await this.invoices.load(scope, where);
    const [branding, policies] = await Promise.all([
      loadBranding(scope, this.storage),
      loadPolicies(scope),
    ]);
    const body = await renderInvoice(invoice, branding, policies.currency);
    await this.record(scope, actor, 'invoice', { type: 'invoice', id: invoice.id }, invoice.number);
    return {
      body,
      fileName: `${slug(`${invoice.number}-${invoice.student.name}`)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  async receiptFor(
    scope: SchoolScope,
    actor: Actor,
    where: Prisma.PaymentWhereInput,
  ): Promise<FinanceDocument> {
    const payment = await this.payments.load(scope, where);
    const [branding, policies] = await Promise.all([
      loadBranding(scope, this.storage),
      loadPolicies(scope),
    ]);
    const body = await renderReceipt(payment, branding, policies.currency);
    await this.record(
      scope,
      actor,
      'receipt',
      { type: 'payment', id: payment.id },
      payment.receiptNumber,
    );
    return {
      body,
      fileName: `${slug(`${payment.receiptNumber}-${payment.student.name}`)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  async statementFor(
    scope: SchoolScope,
    actor: Actor,
    studentId: string,
    query: StatementQueryDto,
  ): Promise<FinanceDocument> {
    const [statement, branding] = await Promise.all([
      this.reports.statementFor(scope, studentId, query),
      loadBranding(scope, this.storage),
    ]);
    const body = await renderStatement(statement, branding);
    await this.record(
      scope,
      actor,
      'statement',
      { type: 'student', id: studentId },
      statement.student.admissionNumber,
    );
    const period = statement.to ?? new Date().toISOString().slice(0, 10);
    return {
      body,
      fileName: `${slug(`statement-${statement.student.admissionNumber}-${statement.student.name}-${period}`)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async collect<T>(
    page: (page: number) => Promise<{ items: T[]; total: number }>,
  ): Promise<T[]> {
    const first = await page(1);
    if (first.total > MAX_EXPORT_ROWS) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_TOO_LARGE',
        message: `This selection has ${first.total} rows. Narrow the filters to export at most ${MAX_EXPORT_ROWS}.`,
      });
    }
    const rows = [...first.items];
    for (let next = 2; rows.length < first.total; next += 1) {
      const more = await page(next);
      if (more.items.length === 0) break;
      rows.push(...more.items);
    }
    return rows;
  }

  private currency(actor: Actor, schoolId: string | undefined): Promise<string> {
    return this.scopes.run(
      actor.principal,
      schoolId,
      async (scope) => (await loadPolicies(scope)).currency,
    );
  }

  private record(
    scope: SchoolScope,
    actor: Actor,
    kind: Kind,
    resource: { type: string; id: string },
    reference: string,
  ): Promise<void> {
    return auditConfigChange(this.audit, scope, actor, 'finance.document.exported', resource, {
      kind,
      reference,
    });
  }
}

export { date };
