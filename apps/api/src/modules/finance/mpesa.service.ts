import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { paginate, toSkipTake, type Paginated } from '../../common/http/pagination.js';
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { money } from './finance.calc.js';
import type { MpesaQueryDto, StkPushDto } from './finance.dto.js';
import { today } from './finance.ledger.js';
import { MpesaGateway } from './mpesa.gateway.js';
import { PaymentsService } from './payments.service.js';

export type MpesaState = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

export interface MpesaTransactionView {
  id: string;
  student: { id: string; name: string; admissionNumber: string };
  invoiceNumber: string | null;
  /** Shown masked: only the last three digits. */
  phone: string;
  amount: number;
  status: MpesaState;
  resultDescription: string | null;
  mpesaReceiptNumber: string | null;
  receiptNumber: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MpesaConfigView {
  configured: boolean;
  environment: 'sandbox' | 'production';
}

/** What Safaricom posts to the callback URL once the payer responds. */
const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().max(100),
      CheckoutRequestID: z.string().min(1).max(100),
      ResultCode: z.coerce.number().int(),
      ResultDesc: z.string().max(500).default(''),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() }),
          ),
        })
        .optional(),
    }),
  }),
});

interface Outcome {
  resultCode: number;
  resultDescription: string;
  /** Present only on a success reported by the callback. */
  receipt?: string;
  amount?: number;
}

const VIEW_SELECT = {
  id: true,
  phone: true,
  amount: true,
  status: true,
  resultDescription: true,
  mpesaReceiptNumber: true,
  createdAt: true,
  completedAt: true,
  invoice: { select: { number: true } },
  payment: { select: { receiptNumber: true } },
  student: {
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true },
  },
} satisfies Prisma.MpesaTransactionSelect;

const toView = (
  row: Prisma.MpesaTransactionGetPayload<{ select: typeof VIEW_SELECT }>,
): MpesaTransactionView => ({
  id: row.id,
  student: {
    id: row.student.id,
    name: [row.student.firstName, row.student.middleName, row.student.lastName]
      .filter(Boolean)
      .join(' '),
    admissionNumber: row.student.admissionNumber,
  },
  invoiceNumber: row.invoice?.number ?? null,
  phone: `${'*'.repeat(Math.max(0, row.phone.length - 3))}${row.phone.slice(-3)}`,
  amount: row.amount.toNumber(),
  status: row.status,
  resultDescription: row.resultDescription,
  mpesaReceiptNumber: row.mpesaReceiptNumber,
  receiptNumber: row.payment?.receiptNumber ?? null,
  createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

/** `0712…`, `+254712…` or `254712…` → `254712…`, the form Daraja expects. */
export const toMsisdn = (phone: string): string => `254${phone.replace(/^(\+?254|0)/, '')}`;

/** Result codes Safaricom uses for outcomes that are not plain failures. */
const CANCELLED_BY_USER = 1032;
const TIMED_OUT = 1037;
/** How long a second identical request is refused, to stop double prompts. */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

const SYSTEM_META: RequestMeta = { ipAddress: null, userAgent: 'mpesa-callback' };

/**
 * M-Pesa STK push. Money is credited in exactly one place — `complete` — and
 * only on Safaricom's word: its callback, or its answer to a status query.
 */
@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly prisma: PrismaService,
    private readonly gateway: MpesaGateway,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  config(): MpesaConfigView {
    return { configured: this.gateway.isConfigured(), environment: this.gateway.environment };
  }

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: MpesaQueryDto,
  ): Promise<Paginated<MpesaTransactionView>> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const where: Prisma.MpesaTransactionWhereInput = {
        schoolId: scope.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
      };
      const [rows, total] = await Promise.all([
        scope.tx.mpesaTransaction.findMany({
          where,
          select: VIEW_SELECT,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query),
        }),
        scope.tx.mpesaTransaction.count({ where }),
      ]);
      return paginate(rows.map(toView), total, query);
    });
  }

  /**
   * Prompts a phone to pay. Nothing is credited here: the request is recorded
   * as pending and settled when Safaricom reports the outcome.
   *
   * @param ownStudents when given, the learner must be one of these — used by
   *   the parent portal so a parent can only pay for their own children.
   */
  async requestPayment(
    actor: Actor,
    schoolId: string | undefined,
    dto: StkPushDto,
    ownStudents?: readonly string[],
  ): Promise<MpesaTransactionView> {
    if (ownStudents && !ownStudents.includes(dto.studentId)) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
    }
    // Refuses before anything is recorded when M-Pesa is not set up.
    this.gateway.assertConfigured();

    const phone = toMsisdn(dto.phone);
    const prepared = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const student = await scope.tx.student.findFirst({
        where: { id: dto.studentId, schoolId: scope.schoolId },
        select: { id: true, admissionNumber: true },
      });
      if (!student)
        throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
      if (dto.invoiceId) {
        const invoice = await scope.tx.invoice.findFirst({
          where: { id: dto.invoiceId, schoolId: scope.schoolId, studentId: student.id },
          select: { status: true, balance: true },
        });
        if (!invoice) {
          throw new UnprocessableEntityException({
            code: 'INVOICE_NOT_FOUND',
            message: 'That invoice does not belong to this learner.',
          });
        }
        if (invoice.status === 'VOID' || invoice.balance.lessThanOrEqualTo(0)) {
          throw new ConflictException({
            code: 'INVOICE_SETTLED',
            message: 'Nothing is owed on this invoice.',
          });
        }
      }
      const recent = await scope.tx.mpesaTransaction.count({
        where: {
          studentId: student.id,
          phone,
          amount: money(dto.amount),
          status: 'PENDING',
          createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
      });
      if (recent > 0) {
        throw new ConflictException({
          code: 'MPESA_REQUEST_PENDING',
          message:
            'A request for this amount was just sent to this phone. Wait for it to finish before trying again.',
        });
      }
      return { tenantId: scope.tenantId, schoolId: scope.schoolId, student };
    });

    // Outside the database transaction: a slow provider must not hold a connection.
    const accepted = await this.gateway.stkPush({
      phone,
      amount: dto.amount,
      accountReference: prepared.student.admissionNumber,
      description: 'School fees',
    });

    return this.prisma.withTenant(prepared.tenantId, async (tx) => {
      const scope: SchoolScope = { tenantId: prepared.tenantId, schoolId: prepared.schoolId, tx };
      const created = await tx.mpesaTransaction.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          studentId: prepared.student.id,
          invoiceId: dto.invoiceId ?? null,
          phone,
          amount: money(dto.amount),
          accountReference: prepared.student.admissionNumber,
          merchantRequestId: accepted.merchantRequestId,
          checkoutRequestId: accepted.checkoutRequestId,
          initiatedById: actor.principal.userId,
        },
        select: VIEW_SELECT,
      });
      await this.audit.record(
        {
          action: 'finance.mpesa.requested',
          resourceType: 'mpesa_transaction',
          resourceId: created.id,
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          actorId: actor.principal.userId,
          meta: actor.meta,
          details: {
            studentId: prepared.student.id,
            amount: dto.amount,
            environment: this.gateway.environment,
          },
        },
        tx,
      );
      return toView(created);
    });
  }

  /**
   * Asks Safaricom what became of a pending request — for when the callback
   * never arrived — and settles it accordingly.
   */
  async verify(
    principal: Principal,
    schoolId: string | undefined,
    id: string,
    ownStudents?: readonly string[],
  ): Promise<MpesaTransactionView> {
    const found = await this.scopes.run(principal, schoolId, (scope) =>
      scope.tx.mpesaTransaction.findFirst({
        where: {
          id,
          schoolId: scope.schoolId,
          ...(ownStudents ? { studentId: { in: [...ownStudents] } } : {}),
        },
        select: { checkoutRequestId: true, status: true },
      }),
    );
    if (!found)
      throw new NotFoundException({
        code: 'MPESA_TRANSACTION_NOT_FOUND',
        message: 'Transaction not found.',
      });

    if (found.status === 'PENDING') {
      const status = await this.gateway.query(found.checkoutRequestId);
      if (status.state === 'RESULT') {
        await this.complete(found.checkoutRequestId, {
          resultCode: status.resultCode,
          resultDescription: status.resultDescription,
        });
      }
    }
    return this.scopes.run(principal, schoolId, async (scope) =>
      toView(
        await scope.tx.mpesaTransaction.findUniqueOrThrow({ where: { id }, select: VIEW_SELECT }),
      ),
    );
  }

  /** Handles Safaricom's callback. The path secret is the only credential it carries. */
  async handleCallback(secret: string, body: unknown): Promise<void> {
    const expected = this.gateway.callbackSecret();
    const given = Buffer.from(secret);
    if (
      !expected ||
      given.length !== expected.length ||
      !timingSafeEqual(given, Buffer.from(expected))
    ) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not allowed.' });
    }
    const parsed = callbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_CALLBACK',
        message: 'Unrecognised callback.',
      });
    }
    const callback = parsed.data.Body.stkCallback;
    const item = (name: string) =>
      callback.CallbackMetadata?.Item.find((entry) => entry.Name === name)?.Value;
    const receipt = item('MpesaReceiptNumber');
    const amount = Number(item('Amount'));

    await this.complete(callback.CheckoutRequestID, {
      resultCode: callback.ResultCode,
      resultDescription: callback.ResultDesc,
      receipt:
        typeof receipt === 'string' && /^[A-Z0-9]{6,20}$/.test(receipt) ? receipt : undefined,
      amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    });
  }

  /**
   * Settles a request from its outcome. Safe to call any number of times for
   * the same request: a payment is created at most once.
   */
  private async complete(checkoutRequestId: string, outcome: Outcome): Promise<void> {
    // The callback names no tenant, so the request is located with the
    // privileged connection, then handled inside its tenant like all else.
    const located = await this.prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId },
      select: { id: true, tenantId: true, schoolId: true },
    });
    if (!located) {
      this.logger.warn('M-Pesa result received for an unknown request');
      return;
    }

    await this.prisma.withTenant(located.tenantId, async (tx) => {
      const scope: SchoolScope = { tenantId: located.tenantId, schoolId: located.schoolId, tx };
      // Serialises a callback and a status query arriving together.
      await tx.$queryRaw`SELECT id FROM mpesa_transactions WHERE id = ${located.id}::uuid FOR UPDATE`;
      const request = await tx.mpesaTransaction.findUniqueOrThrow({
        where: { id: located.id },
        select: {
          id: true,
          status: true,
          studentId: true,
          invoiceId: true,
          amount: true,
          mpesaReceiptNumber: true,
          paymentId: true,
        },
      });

      if (request.status === 'SUCCESS') {
        // Already credited. A late callback may still supply the receipt
        // number that a status query could not.
        if (outcome.receipt && !request.mpesaReceiptNumber)
          await this.attachReceipt(scope, request, outcome.receipt);
        return;
      }

      if (outcome.resultCode !== 0) {
        const status: MpesaState =
          outcome.resultCode === CANCELLED_BY_USER
            ? 'CANCELLED'
            : outcome.resultCode === TIMED_OUT
              ? 'TIMEOUT'
              : 'FAILED';
        await tx.mpesaTransaction.update({
          where: { id: request.id },
          data: {
            status,
            resultCode: outcome.resultCode,
            resultDescription: outcome.resultDescription,
            completedAt: new Date(),
          },
        });
        await this.record(scope, 'finance.mpesa.failed', request.id, {
          status,
          resultCode: outcome.resultCode,
        });
        return;
      }

      if (outcome.receipt) {
        const used = await tx.mpesaTransaction.count({
          where: { mpesaReceiptNumber: outcome.receipt, id: { not: request.id } },
        });
        if (used > 0) {
          this.logger.warn('M-Pesa receipt already credited to another request; ignored');
          return;
        }
      }

      // Safaricom's figure is what was actually paid.
      const amount = money(outcome.amount ?? request.amount);
      const invoice = request.invoiceId
        ? await tx.invoice.findUnique({
            where: { id: request.invoiceId },
            select: { status: true },
          })
        : null;
      const paymentId = await this.payments.create(scope, {
        studentId: request.studentId,
        amount,
        method: 'MPESA',
        // Until the callback supplies the receipt, the request id stands in.
        reference: outcome.receipt ?? checkoutRequestId.toUpperCase().slice(0, 50),
        paidOn: today(),
        invoiceId:
          invoice && invoice.status !== 'VOID' ? (request.invoiceId ?? undefined) : undefined,
        notes: outcome.receipt ? null : 'Confirmed by M-Pesa status query; receipt number pending.',
        receivedById: null,
      });
      await tx.mpesaTransaction.update({
        where: { id: request.id },
        data: {
          status: 'SUCCESS',
          resultCode: 0,
          resultDescription: outcome.resultDescription,
          mpesaReceiptNumber: outcome.receipt ?? null,
          paymentId,
          completedAt: new Date(),
        },
      });
      await this.record(scope, 'finance.mpesa.confirmed', request.id, {
        paymentId,
        amount: amount.toNumber(),
        receipt: outcome.receipt ?? null,
      });
    });
  }

  private async attachReceipt(
    scope: SchoolScope,
    request: { id: string; paymentId: string | null },
    receipt: string,
  ): Promise<void> {
    const used = await scope.tx.mpesaTransaction.count({ where: { mpesaReceiptNumber: receipt } });
    if (used > 0) return;
    await scope.tx.mpesaTransaction.update({
      where: { id: request.id },
      data: { mpesaReceiptNumber: receipt },
    });
    if (request.paymentId) {
      await scope.tx.payment.update({
        where: { id: request.paymentId },
        data: { reference: receipt, notes: null },
      });
    }
  }

  private record(
    scope: SchoolScope,
    action: 'finance.mpesa.confirmed' | 'finance.mpesa.failed',
    id: string,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'mpesa_transaction',
        resourceId: id,
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        actorId: null,
        meta: SYSTEM_META,
        details,
      },
      scope.tx,
    );
  }
}
