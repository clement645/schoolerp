import { ServiceUnavailableException } from '@nestjs/common';
import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type {
  DiscountView,
  FeeItemView,
  FeeStructureView,
} from '../src/modules/finance/fees.service.js';
import type { FinanceSummary, Statement } from '../src/modules/finance/finance-reports.service.js';
import type {
  GenerationResult,
  InvoiceDetail,
  InvoiceSummary,
} from '../src/modules/finance/invoices.service.js';
import {
  MpesaGateway,
  type StkPushAccepted,
  type StkPushRequest,
  type StkStatus,
} from '../src/modules/finance/mpesa.gateway.js';
import type {
  MpesaConfigView,
  MpesaTransactionView,
} from '../src/modules/finance/mpesa.service.js';
import type { PaymentDetail, PaymentSummary } from '../src/modules/finance/payments.service.js';
import type { Paginated } from '../src/common/http/pagination.js';
import type { StudentDetail } from '../src/modules/students/students.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  unique,
  type SeededTenant,
  type SignedIn,
  type TestContext,
} from './support/app.js';

type Method = 'get' | 'post' | 'put' | 'patch';
type Name = 'amina' | 'brian' | 'eve' | 'femi';

const today = new Date().toISOString().slice(0, 10);

const CALLBACK_SECRET = 'test-callback-secret-0123456789abcdef';

/** Stands in for Safaricom: records what it was asked and answers as scripted. */
class FakeGateway extends MpesaGateway {
  readonly environment = 'sandbox' as const;
  configured = true;
  requests: StkPushRequest[] = [];
  status: StkStatus = { state: 'PENDING' };

  isConfigured(): boolean {
    return this.configured;
  }
  assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'MPESA_NOT_CONFIGURED',
        message: 'M-Pesa has not been set up for this installation.',
      });
    }
  }
  callbackSecret(): string | null {
    return this.configured ? CALLBACK_SECRET : null;
  }
  stkPush(request: StkPushRequest): Promise<StkPushAccepted> {
    this.requests.push(request);
    return Promise.resolve({
      merchantRequestId: unique('mr'),
      checkoutRequestId: unique('ws_CO'),
      customerMessage: 'Success. Request accepted for processing',
    });
  }
  query(): Promise<StkStatus> {
    return Promise.resolve(this.status);
  }
}

describe('Finance (e2e)', () => {
  let ctx: TestContext;
  const gateway = new FakeGateway();
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let accountant: SignedIn;
  let teacher: SignedIn;

  let term: TermView;
  let grade7: ClassView;
  let grade8: ClassView;
  let students: Record<Name, StudentDetail>;
  let tuition: FeeItemView;
  let lunch: FeeItemView;
  let structure: FeeStructureView;
  let invoices: Record<'amina' | 'brian', InvoiceSummary>;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1/finance${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const invoiceOf = async (id: string) =>
    dataOf<InvoiceDetail>(await asAdmin('get', `/invoices/${id}`).expect(200));
  const paymentOf = async (id: string) =>
    dataOf<PaymentDetail>(await asAdmin('get', `/payments/${id}`).expect(200));
  const pay = (
    student: StudentDetail,
    amount: number,
    extra: Record<string, unknown> = {},
    actor: SignedIn = admin,
  ) =>
    call(actor, 'post', '/payments').send({
      studentId: student.id,
      amount,
      method: 'CASH',
      ...extra,
    });
  const listInvoices = async (query: string) =>
    dataOf<Paginated<InvoiceSummary>>(await asAdmin('get', `/invoices?${query}`).expect(200));
  const state = (invoice: InvoiceSummary) => ({
    status: invoice.status,
    total: invoice.total,
    paid: invoice.paid,
    credited: invoice.credited,
    balance: invoice.balance,
  });

  let admission = 0;
  async function admit(firstName: string, classId: string) {
    return dataOf<StudentDetail>(
      await ctx
        .http()
        .post('/api/v1/students')
        .set('Authorization', admin.bearer)
        .send({
          admissionNumber: `F-${String((admission += 1)).padStart(3, '0')}`,
          firstName,
          lastName: 'Learner',
          dateOfBirth: '2013-04-17',
          gender: 'FEMALE',
          admissionDate: '2026-01-05',
          classId,
          streamId: null,
        })
        .expect(201),
    );
  }

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(MpesaGateway).useValue(gateway),
    );
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [accountantUser, teacherUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['ACCOUNTANT'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
    ]);
    [admin, betaAdmin, accountant, teacher] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, accountantUser),
      signIn(ctx, teacherUser),
    ]);
    const school = (method: 'get' | 'post', path: string) =>
      ctx.http()[method](`/api/v1${path}`).set('Authorization', admin.bearer);

    const year = dataOf<AcademicYearView>(
      await school('post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201),
    );
    term = dataOf<TermView>(
      await school('post', `/academic-years/${year.id}/terms`)
        .send({ name: 'Term 3', sequence: 3, startDate: '2026-08-31', endDate: '2026-11-20' })
        .expect(201),
    );
    grade7 = dataOf<ClassView>(
      await school('post', '/classes').send({ name: 'Grade 7', level: 7 }).expect(201),
    );
    grade8 = dataOf<ClassView>(
      await school('post', '/classes').send({ name: 'Grade 8', level: 8 }).expect(201),
    );
    students = {
      amina: await admit('Amina', grade7.id),
      brian: await admit('Brian', grade7.id),
      eve: await admit('Eve', grade8.id),
      femi: await admit('Femi', grade8.id),
    };
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('fee items, structures and discounts', () => {
    it('creates fee items, refusing duplicates and bad amounts', async () => {
      tuition = dataOf<FeeItemView>(
        await asAdmin('post', '/fee-items').send({ name: 'Tuition' }).expect(201),
      );
      lunch = dataOf<FeeItemView>(
        await call(accountant, 'post', '/fee-items')
          .send({ name: 'Lunch', description: 'Midday meal' })
          .expect(201),
      );
      const duplicate = await asAdmin('post', '/fee-items').send({ name: 'tuition' }).expect(400);
      expect(errorOf(duplicate).code).toBe('DUPLICATE');

      const renamed = dataOf<FeeItemView>(
        await asAdmin('patch', `/fee-items/${lunch.id}`)
          .send({ name: 'Lunch programme' })
          .expect(200),
      );
      expect(renamed.name).toBe('Lunch programme');
    });

    it('builds a fee structure from fee items', async () => {
      const body = {
        name: 'Grade 7 — Term 3',
        termId: term.id,
        classId: grade7.id,
        lines: [
          { feeItemId: tuition.id, amount: 30000 },
          { feeItemId: lunch.id, amount: 6000 },
        ],
      };
      structure = dataOf<FeeStructureView>(
        await asAdmin('post', '/fee-structures').send(body).expect(201),
      );
      expect(structure).toMatchObject({
        total: 36000,
        class: { name: 'Grade 7' },
        invoiceCount: 0,
      });

      await asAdmin('post', '/fee-structures').send(body).expect(409);
      await asAdmin('post', '/fee-structures')
        .send({ ...body, name: 'Twice', lines: [body.lines[0], body.lines[0]] })
        .expect(400);
      await asAdmin('post', '/fee-structures')
        .send({ ...body, name: 'Cents', lines: [{ feeItemId: tuition.id, amount: 10.005 }] })
        .expect(400);
      await asAdmin('post', '/fee-structures')
        .send({ ...body, name: 'Negative', lines: [{ feeItemId: tuition.id, amount: -5 }] })
        .expect(400);
      await asAdmin('post', '/fee-structures')
        .send({ ...body, name: 'No term', termId: grade7.id })
        .expect(400);
    });

    it('grants a learner a standing discount', async () => {
      const discount = dataOf<DiscountView>(
        await asAdmin('post', '/discounts')
          .send({
            studentId: students.brian.id,
            name: 'Sibling discount',
            category: 'DISCOUNT',
            kind: 'PERCENTAGE',
            value: 10,
          })
          .expect(201),
      );
      expect(discount).toMatchObject({
        student: { name: 'Brian Learner' },
        value: 10,
        isActive: true,
      });
      const tooMuch = await asAdmin('post', '/discounts')
        .send({
          studentId: students.brian.id,
          name: 'x2',
          category: 'DISCOUNT',
          kind: 'PERCENTAGE',
          value: 120,
        })
        .expect(400);
      expect(errorOf(tooMuch).code).toBe('INVALID_DISCOUNT');
    });
  });

  describe('invoicing', () => {
    it('invoices every learner of the class once, applying discounts', async () => {
      const first = dataOf<GenerationResult>(
        await asAdmin('post', '/invoices/generate')
          .send({ feeStructureId: structure.id, dueDate: '2026-12-15' })
          .expect(200),
      );
      expect(first).toEqual({ created: 2, skipped: 0, totalInvoiced: 68400 });

      // Running it again invoices nobody twice.
      const second = dataOf<GenerationResult>(
        await asAdmin('post', '/invoices/generate')
          .send({ feeStructureId: structure.id, dueDate: '2026-12-15' })
          .expect(200),
      );
      expect(second).toEqual({ created: 0, skipped: 2, totalInvoiced: 0 });

      const list = await listInvoices(`classId=${grade7.id}`);
      expect(list.total).toBe(2);
      const find = (name: string) =>
        list.items.find((i) => i.student.name === `${name} Learner`) as InvoiceSummary;
      invoices = { amina: find('Amina'), brian: find('Brian') };
      expect(invoices.amina.number).toMatch(/^INV-\d{4}-\d{6}$/);
      expect(state(invoices.amina)).toEqual({
        status: 'ISSUED',
        total: 36000,
        paid: 0,
        credited: 0,
        balance: 36000,
      });

      const brian = await invoiceOf(invoices.brian.id);
      expect(brian).toMatchObject({
        subtotal: 36000,
        discountTotal: 3600,
        total: 32400,
        class: 'Grade 7',
        term: 'Term 3',
      });
      expect(brian.lines).toEqual([
        { kind: 'CHARGE', description: 'Lunch programme', amount: 6000 },
        { kind: 'CHARGE', description: 'Tuition', amount: 30000 },
        { kind: 'DISCOUNT', description: 'Sibling discount (10%)', amount: 3600 },
      ]);
    });

    it('validates a manual invoice', async () => {
      const base = {
        studentId: students.eve.id,
        dueDate: '2026-12-15',
        lines: [{ description: 'Trip', amount: 500 }],
      };
      await asAdmin('post', '/invoices')
        .send({ ...base, lines: [] })
        .expect(400);
      await asAdmin('post', '/invoices')
        .send({ ...base, total: 1 })
        .expect(400);
      const early = await asAdmin('post', '/invoices')
        .send({ ...base, issueDate: '2026-12-01', dueDate: '2026-11-01' })
        .expect(400);
      expect(errorOf(early).code).toBe('INVALID_DUE_DATE');
      await asAdmin('post', '/invoices')
        .send({ ...base, studentId: grade7.id })
        .expect(404);
    });
  });

  describe('payments', () => {
    let cash: PaymentDetail;
    let bank: PaymentDetail;

    it('records a partial payment against the oldest invoice', async () => {
      cash = dataOf<PaymentDetail>(await pay(students.amina, 10000, {}, accountant).expect(201));
      expect(cash).toMatchObject({
        amount: 10000,
        allocated: 10000,
        unallocated: 0,
        status: 'COMPLETED',
      });
      expect(cash.receiptNumber).toMatch(/^RCT-\d{4}-000001$/);
      expect(cash.allocations).toEqual([
        { invoiceId: invoices.amina.id, invoiceNumber: invoices.amina.number, amount: 10000 },
      ]);
      expect(state(await invoiceOf(invoices.amina.id))).toEqual({
        status: 'PARTIALLY_PAID',
        total: 36000,
        paid: 10000,
        credited: 0,
        balance: 26000,
      });
    });

    it('keeps an overpayment as credit', async () => {
      bank = dataOf<PaymentDetail>(
        await pay(students.amina, 30000, { method: 'BANK_TRANSFER', reference: 'bnk-123' }).expect(
          201,
        ),
      );
      expect(bank).toMatchObject({ reference: 'BNK-123', allocated: 26000, unallocated: 4000 });
      expect((await invoiceOf(invoices.amina.id)).status).toBe('PAID');
    });

    it('refuses duplicates, missing references, manual M-Pesa and future dates', async () => {
      const twice = await pay(students.brian, 100, {
        method: 'BANK_TRANSFER',
        reference: 'BNK-123',
      }).expect(409);
      expect(errorOf(twice)).toMatchObject({ code: 'DUPLICATE_PAYMENT' });
      expect(errorOf(twice).message).toContain(bank.receiptNumber);

      const missing = await pay(students.brian, 100, { method: 'CHEQUE' }).expect(400);
      expect(errorOf(missing).code).toBe('REFERENCE_REQUIRED');
      const manual = await pay(students.brian, 100, {
        method: 'MPESA',
        reference: 'QGH7X1ABCD',
      }).expect(400);
      expect(errorOf(manual).code).toBe('MPESA_NOT_MANUAL');
      const future = await pay(students.brian, 100, { paidOn: '2099-01-01' }).expect(422);
      expect(errorOf(future).code).toBe('DATE_IN_FUTURE');

      await pay(students.brian, 0).expect(400);
      await pay(students.brian, 10.999).expect(400);
      await pay(students.brian, 100, { invoiceId: invoices.amina.id }).expect(422);
      expect((await listPayments(`studentId=${students.brian.id}`)).total).toBe(0);
    });

    const listPayments = async (query: string) =>
      dataOf<Paginated<PaymentSummary>>(await asAdmin('get', `/payments?${query}`).expect(200));

    it('applies credit to the learner’s next invoice', async () => {
      const trip = dataOf<InvoiceDetail>(
        await asAdmin('post', '/invoices')
          .send({
            studentId: students.amina.id,
            dueDate: '2026-12-15',
            lines: [{ description: 'Trip', amount: 1500 }],
          })
          .expect(201),
      );
      expect(state(trip)).toEqual({
        status: 'PAID',
        total: 1500,
        paid: 1500,
        credited: 0,
        balance: 0,
      });
      // Issued during Term 3, so it counts towards that term without being told.
      const inTerm = today >= '2026-08-31' && today <= '2026-11-20';
      expect(trip.term).toBe(inTerm ? 'Term 3' : null);
      expect(await paymentOf(bank.id)).toMatchObject({ allocated: 27500, unallocated: 2500 });
    });

    it('refunds only what settles no invoice', async () => {
      const tooMuch = await asAdmin('post', `/payments/${bank.id}/refunds`)
        .send({ amount: 3000, method: 'BANK_TRANSFER', reason: 'Overpaid' })
        .expect(422);
      expect(errorOf(tooMuch).code).toBe('REFUND_EXCEEDS_CREDIT');

      const refunded = dataOf<PaymentDetail>(
        await asAdmin('post', `/payments/${bank.id}/refunds`)
          .send({
            amount: 2500,
            method: 'BANK_TRANSFER',
            reference: 'ref-9',
            reason: 'Overpaid fees',
          })
          .expect(201),
      );
      expect(refunded).toMatchObject({ refunded: 2500, unallocated: 0 });
      expect(refunded.refunds[0]).toMatchObject({ amount: 2500, reason: 'Overpaid fees' });

      const locked = await asAdmin('post', `/payments/${bank.id}/reverse`)
        .send({ reason: 'Mistake' })
        .expect(409);
      expect(errorOf(locked).code).toBe('PAYMENT_HAS_REFUNDS');
    });

    it('reverses a payment without deleting it', async () => {
      const wrong = dataOf<PaymentDetail>(await pay(students.brian, 5000).expect(201));
      expect((await invoiceOf(invoices.brian.id)).balance).toBe(27400);

      await asAdmin('post', `/payments/${wrong.id}/reverse`).send({}).expect(400);
      const reversed = dataOf<PaymentDetail>(
        await asAdmin('post', `/payments/${wrong.id}/reverse`)
          .send({ reason: 'Posted to the wrong learner' })
          .expect(200),
      );
      expect(reversed).toMatchObject({
        status: 'REVERSED',
        allocated: 0,
        unallocated: 0,
        reversalReason: 'Posted to the wrong learner',
        allocations: [],
      });
      expect(state(await invoiceOf(invoices.brian.id))).toEqual({
        status: 'ISSUED',
        total: 32400,
        paid: 0,
        credited: 0,
        balance: 32400,
      });
      // The record is still there, and cannot be reversed twice.
      expect((await listPayments(`studentId=${students.brian.id}&status=REVERSED`)).total).toBe(1);
      await asAdmin('post', `/payments/${wrong.id}/reverse`).send({ reason: 'Again' }).expect(409);
    });

    it('credits an invoice, freeing money already paid against it', async () => {
      const tooMuch = await asAdmin('post', `/invoices/${invoices.amina.id}/credit-notes`)
        .send({ amount: 36000.01, reason: 'Too much' })
        .expect(422);
      expect(errorOf(tooMuch).code).toBe('CREDIT_EXCEEDS_INVOICE');

      const credited = dataOf<InvoiceDetail>(
        await asAdmin('post', `/invoices/${invoices.amina.id}/credit-notes`)
          .send({ amount: 6000, reason: 'Lunch programme waived' })
          .expect(201),
      );
      expect(state(credited)).toEqual({
        status: 'PAID',
        total: 36000,
        paid: 30000,
        credited: 6000,
        balance: 0,
      });
      expect(credited.creditNotes[0]).toMatchObject({
        amount: 6000,
        reason: 'Lunch programme waived',
      });
      expect(credited.creditNotes[0]?.number).toMatch(/^CN-\d{4}-000001$/);
      // The newest payment gives the money back; it is now refundable credit.
      expect(await paymentOf(bank.id)).toMatchObject({
        allocated: 21500,
        refunded: 2500,
        unallocated: 6000,
      });
      expect(await paymentOf(cash.id)).toMatchObject({ allocated: 10000, unallocated: 0 });
    });

    it('voids only an invoice with nothing against it, then allows re-invoicing', async () => {
      const paid = await asAdmin('post', `/invoices/${invoices.amina.id}/void`)
        .send({ reason: 'Wrong' })
        .expect(409);
      expect(errorOf(paid).code).toBe('INVOICE_HAS_PAYMENTS');

      const voided = dataOf<InvoiceDetail>(
        await asAdmin('post', `/invoices/${invoices.brian.id}/void`)
          .send({ reason: 'Wrong structure' })
          .expect(200),
      );
      expect(voided).toMatchObject({
        status: 'VOID',
        balance: 0,
        voidReason: 'Wrong structure',
        isOverdue: false,
      });
      await asAdmin('post', `/invoices/${invoices.brian.id}/void`)
        .send({ reason: 'Again' })
        .expect(409);
      await asAdmin('post', `/invoices/${invoices.brian.id}/credit-notes`)
        .send({ amount: 5, reason: 'Not allowed' })
        .expect(409);
      await pay(students.brian, 100, { invoiceId: invoices.brian.id }).expect(409);

      const again = dataOf<GenerationResult>(
        await asAdmin('post', '/invoices/generate')
          .send({ feeStructureId: structure.id, dueDate: '2026-12-15' })
          .expect(200),
      );
      expect(again).toEqual({ created: 1, skipped: 1, totalInvoiced: 32400 });
    });
  });

  describe('two cashiers at once', () => {
    it('never spends the same balance twice', async () => {
      const invoice = dataOf<InvoiceDetail>(
        await asAdmin('post', '/invoices')
          .send({
            studentId: students.eve.id,
            dueDate: '2026-12-15',
            lines: [{ description: 'Tuition', amount: 25000 }],
          })
          .expect(201),
      );
      const [first, second] = await Promise.all([
        pay(students.eve, 20000, { invoiceId: invoice.id }),
        pay(students.eve, 20000, { invoiceId: invoice.id }),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);

      const after = await invoiceOf(invoice.id);
      expect(state(after)).toEqual({
        status: 'PAID',
        total: 25000,
        paid: 25000,
        credited: 0,
        balance: 0,
      });
      const payments = await Promise.all(
        [first, second].map((r) => paymentOf(dataOf<PaymentDetail>(r).id)),
      );
      expect(payments.reduce((sum, p) => sum + p.allocated, 0)).toBe(25000);
      expect(payments.reduce((sum, p) => sum + p.unallocated, 0)).toBe(15000);
      // Receipt numbers were not handed out twice.
      expect(new Set(payments.map((p) => p.receiptNumber)).size).toBe(2);
    });

    it('records a bank transaction once even when submitted twice together', async () => {
      const attempts = await Promise.all(
        [1, 2, 3].map(() =>
          pay(students.femi, 700, { method: 'BANK_TRANSFER', reference: 'BNK-777' }),
        ),
      );
      expect(attempts.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const recorded = await ctx.prisma.payment.count({ where: { reference: 'BNK-777' } });
      expect(recorded).toBe(1);
    });
  });

  describe('statements and reports', () => {
    it('lists a learner’s account in posting order with a running balance', async () => {
      const statement = dataOf<Statement>(
        await asAdmin('get', `/students/${students.amina.id}/statement`).expect(200),
      );
      expect(
        statement.lines.map((line) => [line.kind, line.debit, line.credit, line.balance]),
      ).toEqual([
        ['INVOICE', 36000, 0, 36000],
        ['PAYMENT', 0, 10000, 26000],
        ['PAYMENT', 0, 30000, -4000],
        ['INVOICE', 1500, 0, -2500],
        ['REFUND', 2500, 0, 0],
        ['CREDIT_NOTE', 0, 6000, -6000],
      ]);
      expect(statement).toMatchObject({
        currency: 'KES',
        openingBalance: 0,
        closingBalance: -6000,
        totals: { invoiced: 37500, paid: 40000, credited: 6000, refunded: 2500 },
      });
    });

    it('shows voids and reversals rather than hiding them', async () => {
      const statement = dataOf<Statement>(
        await asAdmin('get', `/students/${students.brian.id}/statement`).expect(200),
      );
      expect(statement.lines.map((line) => line.kind)).toEqual([
        'INVOICE',
        'PAYMENT',
        'PAYMENT_REVERSED',
        'INVOICE_VOIDED',
        'INVOICE',
      ]);
      expect(statement.closingBalance).toBe(32400);
      expect(statement.totals).toEqual({ invoiced: 32400, paid: 0, credited: 0, refunded: 0 });

      // Nothing was posted before 2020, and everything before tomorrow.
      const none = dataOf<Statement>(
        await asAdmin(
          'get',
          `/students/${students.brian.id}/statement?from=2019-01-01&to=2019-12-31`,
        ).expect(200),
      );
      expect(none).toMatchObject({ lines: [], openingBalance: 0, closingBalance: 0 });
    });

    it('summarises the school’s position', async () => {
      const summary = dataOf<FinanceSummary>(await asAdmin('get', '/summary').expect(200));
      // Amina 36000 + 1500, Brian 32400 (voided one excluded), Eve 25000.
      expect(summary.totals).toMatchObject({
        invoiced: 94900,
        credited: 6000,
        collected: 56500,
        outstanding: 32400,
        overdue: 0,
        overdueInvoices: 0,
        collectionRate: 63.55,
        // Amina 6000, Eve 15000, Femi 700.
        unallocated: 21700,
      });
      expect(summary.byMethod).toEqual([
        { method: 'CASH', amount: 50000, payments: 3 },
        { method: 'BANK_TRANSFER', amount: 28200, payments: 2 },
      ]);
      expect(summary.byClass).toEqual([
        { class: 'Grade 7', invoiced: 63900, outstanding: 32400 },
        { class: 'Grade 8', invoiced: 25000, outstanding: 0 },
      ]);
      expect(summary.topBalances).toEqual([
        {
          student: expect.objectContaining({ name: 'Brian Learner' }) as unknown,
          class: 'Grade 7',
          balance: 32400,
        },
      ]);
      expect(summary.monthly).toHaveLength(6);
      expect(summary.monthly.reduce((sum, month) => sum + month.amount, 0)).toBe(78200);
      expect(summary.recentPayments.length).toBeGreaterThan(0);
    });

    it('finds overdue invoices and searches by number or learner', async () => {
      const old = dataOf<InvoiceDetail>(
        await asAdmin('post', '/invoices')
          .send({
            studentId: students.femi.id,
            issueDate: '2026-01-10',
            dueDate: '2026-01-31',
            applyDiscounts: false,
            lines: [{ description: 'Boarding', amount: 9000 }],
          })
          .expect(201),
      );
      // Issued before any term began, so it belongs to none.
      expect(old.term).toBeNull();
      // Femi's 700 on account went straight to it.
      expect(state(old)).toMatchObject({ status: 'PARTIALLY_PAID', paid: 700, balance: 8300 });
      expect(old.isOverdue).toBe(true);

      const overdue = await listInvoices('status=OVERDUE');
      expect(overdue.items.map((invoice) => invoice.number)).toEqual([old.number]);
      expect((await listInvoices(`search=${old.number}`)).total).toBe(1);
      expect((await listInvoices('search=femi')).total).toBe(1);
      expect((await listInvoices('status=VOID')).total).toBe(1);
      expect((await listInvoices('status=OUTSTANDING')).total).toBe(2);
      await asAdmin('get', '/invoices?status=LATE').expect(400);
    });
  });

  describe('documents and exports', () => {
    const download = (actor: SignedIn, path: string) =>
      call(actor, 'get', path)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const csvRows = (body: Buffer) =>
      body
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');

    it('produces an invoice, a receipt and a statement as private PDFs', async () => {
      const amina = await invoiceOf(invoices.amina.id);
      const paymentId = amina.payments[0]?.paymentId as string;
      for (const path of [
        `/invoices/${invoices.amina.id}/pdf`,
        `/payments/${paymentId}/pdf`,
        `/students/${students.amina.id}/statement/pdf`,
        `/students/${students.amina.id}/statement/pdf?from=2026-01-01&to=2026-12-31`,
      ]) {
        const response = await download(accountant, path).expect(200);
        const pdf = response.body as Buffer;
        expect(response.headers['content-type'], path).toBe('application/pdf');
        expect(response.headers['cache-control'], path).toBe('no-store');
        expect(response.headers['content-disposition'], path).toMatch(
          /^inline; filename=".+\.pdf"/,
        );
        expect(pdf.subarray(0, 5).toString(), path).toBe('%PDF-');
        expect(pages(pdf), path).toBeGreaterThanOrEqual(1);
      }
      const voided = await download(admin, `/invoices/${invoices.brian.id}/pdf`).expect(200);
      expect(voided.headers['content-disposition']).toContain(invoices.brian.number);
    });

    it('exports the statement as CSV with signed amounts left as numbers', async () => {
      const response = await download(admin, `/students/${students.amina.id}/statement/csv`).expect(
        200,
      );
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="statement-.+\.csv"/,
      );
      const rows = csvRows(response.body as Buffer);
      expect(rows[0]).toBe('Date,Entry,Reference,Details,Charged (KES),Paid (KES),Balance (KES)');
      expect(rows).toHaveLength(7);
      // A balance in credit is a plain negative number, not a neutralised string.
      expect(rows[3]).toMatch(/,-4000$/);
      expect(rows[6]).toMatch(/^\d{4}-\d{2}-\d{2},CREDIT_NOTE,CN-\d{4}-000001,.*,,6000,-6000$/);
    });

    it('exports the invoice and payment lists with the screen’s filters', async () => {
      const outstanding = csvRows(
        (await download(admin, '/exports/invoices.csv?status=OUTSTANDING').expect(200))
          .body as Buffer,
      );
      expect(outstanding[0]).toMatch(/^Invoice,Admission number,Learner,/);
      expect(outstanding).toHaveLength(1 + (await listInvoices('status=OUTSTANDING')).total);

      const reversed = csvRows(
        (await download(admin, '/exports/payments.csv?status=REVERSED').expect(200)).body as Buffer,
      );
      expect(reversed).toHaveLength(2);
      expect(reversed[1]).toContain('REVERSED');
      await call(admin, 'get', '/exports/invoices.csv?status=LATE').expect(400);
    });

    it('records each download, and keeps documents to finance staff within the tenant', async () => {
      const exported = await ctx.prisma.auditLog.findMany({
        where: { tenantId: alpha.id, action: 'finance.document.exported' },
        select: { metadata: true },
      });
      const kinds = exported.map((entry) => (entry.metadata as { kind: string }).kind);
      expect(kinds).toEqual(
        expect.arrayContaining([
          'invoice',
          'receipt',
          'statement',
          'statement_csv',
          'invoices_csv',
          'payments_csv',
        ]),
      );

      await call(teacher, 'get', `/invoices/${invoices.amina.id}/pdf`).expect(403);
      await call(teacher, 'get', '/exports/payments.csv').expect(403);
      await call(betaAdmin, 'get', `/invoices/${invoices.amina.id}/pdf`).expect(404);
      await call(betaAdmin, 'get', `/students/${students.amina.id}/statement/pdf`).expect(404);
      const theirs = csvRows(
        (await download(betaAdmin, '/exports/invoices.csv').expect(200)).body as Buffer,
      );
      expect(theirs).toHaveLength(1);
    });
  });

  describe('access', () => {
    it('keeps finance to those with finance permissions', async () => {
      await call(teacher, 'get', '/invoices').expect(403);
      await call(teacher, 'get', '/summary').expect(403);
      await call(teacher, 'get', `/students/${students.amina.id}/statement`).expect(403);
      await pay(students.amina, 100, {}, teacher).expect(403);
      await ctx.http().get('/api/v1/finance/invoices').expect(401);
      await call(accountant, 'get', '/summary').expect(200);
    });

    it('keeps each tenant’s money to itself', async () => {
      await call(betaAdmin, 'get', `/invoices/${invoices.amina.id}`).expect(404);
      await call(betaAdmin, 'get', `/students/${students.amina.id}/statement`).expect(404);
      await pay(students.amina, 100, {}, betaAdmin).expect(404);
      await call(betaAdmin, 'post', `/invoices/${invoices.amina.id}/void`)
        .send({ reason: 'Not mine' })
        .expect(404);
      const theirs = dataOf<Paginated<InvoiceSummary>>(
        await call(betaAdmin, 'get', '/invoices').expect(200),
      );
      expect(theirs.total).toBe(0);
      const summary = dataOf<FinanceSummary>(await call(betaAdmin, 'get', '/summary').expect(200));
      expect(summary.totals.invoiced).toBe(0);
    });

    it('cannot delete financial records, even from application code', async () => {
      const attempt = (work: Parameters<typeof ctx.prisma.withTenant>[1]) =>
        ctx.prisma.withTenant(alpha.id, work);
      await expect(attempt((tx) => tx.payment.deleteMany())).rejects.toThrow(/permission denied/);
      await expect(attempt((tx) => tx.invoice.deleteMany())).rejects.toThrow(/permission denied/);
      await expect(attempt((tx) => tx.refund.deleteMany())).rejects.toThrow(/permission denied/);
      await expect(attempt((tx) => tx.creditNote.deleteMany())).rejects.toThrow(
        /permission denied/,
      );
    });

    it('audits every movement of money', async () => {
      const actions = await ctx.prisma.auditLog.groupBy({
        by: ['action'],
        where: { tenantId: alpha.id, action: { startsWith: 'finance.' } },
        _count: { _all: true },
      });
      const count = Object.fromEntries(actions.map((row) => [row.action, row._count._all]));
      expect(count).toMatchObject({
        'finance.payment.recorded': 6,
        'finance.payment.reversed': 1,
        'finance.refund.issued': 1,
        'finance.credit_note.issued': 1,
        'finance.invoice.voided': 1,
        'finance.invoices.generated': 3,
      });
    });
  });

  describe('M-Pesa', () => {
    const callback = (secret: string, body: unknown) =>
      ctx
        .http()
        .post(`/api/v1/finance/mpesa/callback/${secret}`)
        .send(body as object);
    const result = (
      checkoutRequestId: string,
      resultCode: number,
      receipt?: string,
      amount?: number,
    ) => ({
      Body: {
        stkCallback: {
          MerchantRequestID: 'mr-1',
          CheckoutRequestID: checkoutRequestId,
          ResultCode: resultCode,
          ResultDesc:
            resultCode === 0
              ? 'The service request is processed successfully.'
              : 'Request cancelled by user',
          ...(receipt
            ? {
                CallbackMetadata: {
                  Item: [
                    { Name: 'Amount', Value: amount },
                    { Name: 'MpesaReceiptNumber', Value: receipt },
                    { Name: 'TransactionDate', Value: 20261013101500 },
                    { Name: 'PhoneNumber', Value: 254712345678 },
                  ],
                },
              }
            : {}),
        },
      },
    });
    const push = (amount: number, extra: Record<string, unknown> = {}) =>
      asAdmin('post', '/mpesa/stk-push').send({
        studentId: students.brian.id,
        phone: '0712345678',
        amount,
        ...extra,
      });
    const checkoutOf = async (id: string) =>
      (await ctx.prisma.mpesaTransaction.findUniqueOrThrow({ where: { id } })).checkoutRequestId;
    const transaction = async (id: string) =>
      dataOf<Paginated<MpesaTransactionView>>(
        await asAdmin('get', '/mpesa/transactions').expect(200),
      ).items.find((item) => item.id === id) as MpesaTransactionView;
    const mpesaPayments = () =>
      ctx.prisma.payment.count({ where: { studentId: students.brian.id, method: 'MPESA' } });
    let brianInvoice: InvoiceSummary;

    beforeAll(async () => {
      brianInvoice = (await listInvoices(`studentId=${students.brian.id}&status=OUTSTANDING`))
        .items[0] as InvoiceSummary;
    });

    it('reports whether it is set up', async () => {
      const config = dataOf<MpesaConfigView>(await asAdmin('get', '/mpesa/config').expect(200));
      expect(config).toEqual({ configured: true, environment: 'sandbox' });
    });

    it('prompts the phone and records a pending request, crediting nothing', async () => {
      const pending = dataOf<MpesaTransactionView>(
        await push(5000, { invoiceId: brianInvoice.id }).expect(201),
      );
      expect(pending).toMatchObject({
        status: 'PENDING',
        amount: 5000,
        phone: '*********678',
        receiptNumber: null,
      });
      expect(gateway.requests[gateway.requests.length - 1]).toMatchObject({
        phone: '254712345678',
        amount: 5000,
        accountReference: students.brian.admissionNumber,
      });
      expect(await mpesaPayments()).toBe(0);

      // A second identical prompt straight away is refused.
      const again = await push(5000, { invoiceId: brianInvoice.id }).expect(409);
      expect(errorOf(again).code).toBe('MPESA_REQUEST_PENDING');

      await push(50.5).expect(400);
      await push(100, { phone: '12345' }).expect(400);
      await call(teacher, 'post', '/mpesa/stk-push')
        .send({ studentId: students.brian.id, phone: '0712345678', amount: 10 })
        .expect(403);
    });

    it('authenticates and validates callbacks', async () => {
      await callback('wrong-secret', result('anything', 0, 'QGH7X1ABCD', 5000)).expect(403);
      await callback(CALLBACK_SECRET, { Body: { nothing: true } }).expect(400);
      // A well-formed result for a request we never made is accepted and ignored.
      await callback(CALLBACK_SECRET, result('ws_CO_unknown', 0, 'QGH7X1ZZZZ', 5000)).expect(200);
      expect(await mpesaPayments()).toBe(0);
    });

    it('credits the payment once when Safaricom confirms it, however often it says so', async () => {
      const pending = (await ctx.prisma.mpesaTransaction.findFirstOrThrow({
        where: { studentId: students.brian.id, status: 'PENDING' },
      })) as { id: string; checkoutRequestId: string };
      const body = result(pending.checkoutRequestId, 0, 'QGH7X1ABCD', 5000);

      await Promise.all([
        callback(CALLBACK_SECRET, body).expect(200),
        callback(CALLBACK_SECRET, body).expect(200),
      ]);
      await callback(CALLBACK_SECRET, body).expect(200);

      expect(await mpesaPayments()).toBe(1);
      const done = await transaction(pending.id);
      expect(done).toMatchObject({ status: 'SUCCESS', mpesaReceiptNumber: 'QGH7X1ABCD' });
      expect(done.receiptNumber).toMatch(/^RCT-/);
      expect(state(await invoiceOf(brianInvoice.id))).toMatchObject({
        status: 'PARTIALLY_PAID',
        paid: 5000,
        balance: 27400,
      });

      const payment = await ctx.prisma.payment.findFirstOrThrow({
        where: { reference: 'QGH7X1ABCD' },
      });
      expect(payment).toMatchObject({ method: 'MPESA', receivedById: null });
      const audited = await ctx.prisma.auditLog.count({
        where: { tenantId: alpha.id, action: 'finance.mpesa.confirmed' },
      });
      expect(audited).toBe(1);
    });

    it('records a cancelled prompt without crediting anything', async () => {
      const pending = dataOf<MpesaTransactionView>(await push(1200).expect(201));
      await callback(CALLBACK_SECRET, result(await checkoutOf(pending.id), 1032)).expect(200);
      expect(await transaction(pending.id)).toMatchObject({
        status: 'CANCELLED',
        receiptNumber: null,
      });
      expect(await mpesaPayments()).toBe(1);
    });

    it('will not credit the same M-Pesa receipt to a second request', async () => {
      const pending = dataOf<MpesaTransactionView>(await push(1300).expect(201));
      await callback(
        CALLBACK_SECRET,
        result(await checkoutOf(pending.id), 0, 'QGH7X1ABCD', 1300),
      ).expect(200);
      expect(await transaction(pending.id)).toMatchObject({ status: 'PENDING' });
      expect(await mpesaPayments()).toBe(1);
    });

    it('settles a missed callback by asking Safaricom, then takes the receipt when it arrives', async () => {
      const pending = dataOf<MpesaTransactionView>(await push(2000).expect(201));
      const checkout = await checkoutOf(pending.id);

      gateway.status = { state: 'PENDING' };
      const waiting = dataOf<MpesaTransactionView>(
        await asAdmin('post', `/mpesa/transactions/${pending.id}/verify`).expect(200),
      );
      expect(waiting.status).toBe('PENDING');
      expect(await mpesaPayments()).toBe(1);

      gateway.status = { state: 'RESULT', resultCode: 0, resultDescription: 'Processed' };
      const verified = dataOf<MpesaTransactionView>(
        await asAdmin('post', `/mpesa/transactions/${pending.id}/verify`).expect(200),
      );
      expect(verified).toMatchObject({ status: 'SUCCESS', mpesaReceiptNumber: null });
      expect(await mpesaPayments()).toBe(2);

      // The late callback adds the receipt number; it does not pay again.
      await callback(CALLBACK_SECRET, result(checkout, 0, 'QGH7X2EFGH', 2000)).expect(200);
      expect(await mpesaPayments()).toBe(2);
      expect(await transaction(pending.id)).toMatchObject({ mpesaReceiptNumber: 'QGH7X2EFGH' });
      const payment = await ctx.prisma.payment.findFirstOrThrow({
        where: { reference: 'QGH7X2EFGH' },
      });
      expect(payment.amount.toNumber()).toBe(2000);
    });

    it('says so plainly when M-Pesa is not set up, and credits nothing', async () => {
      gateway.configured = false;
      try {
        const config = dataOf<MpesaConfigView>(await asAdmin('get', '/mpesa/config').expect(200));
        expect(config.configured).toBe(false);
        const refused = await push(900).expect(503);
        expect(errorOf(refused).code).toBe('MPESA_NOT_CONFIGURED');
        // With no secret configured, no callback can be authenticated.
        await callback(CALLBACK_SECRET, result('ws_CO_x', 0, 'QGH7X3IJKL', 900)).expect(403);
        expect(await ctx.prisma.mpesaTransaction.count({ where: { amount: 900 } })).toBe(0);
      } finally {
        gateway.configured = true;
      }
    });

    it('keeps M-Pesa requests within their tenant', async () => {
      const theirs = dataOf<Paginated<MpesaTransactionView>>(
        await call(betaAdmin, 'get', '/mpesa/transactions').expect(200),
      );
      expect(theirs.total).toBe(0);
      const pending = await ctx.prisma.mpesaTransaction.findFirstOrThrow({
        where: { studentId: students.brian.id },
      });
      await call(betaAdmin, 'post', `/mpesa/transactions/${pending.id}/verify`).expect(404);
    });
  });
});
