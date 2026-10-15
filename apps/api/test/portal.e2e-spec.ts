import { ServiceUnavailableException } from '@nestjs/common';
import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { StudentAttendance } from '../src/modules/attendance/attendance.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type { ExaminationDetail } from '../src/modules/examinations/examinations.service.js';
import type { InvoiceDetail } from '../src/modules/finance/invoices.service.js';
import {
  MpesaGateway,
  type StkPushAccepted,
  type StkStatus,
} from '../src/modules/finance/mpesa.gateway.js';
import type { MpesaTransactionView } from '../src/modules/finance/mpesa.service.js';
import type { NotificationList } from '../src/modules/communication/notifications.service.js';
import type { PortalChild } from '../src/modules/portal/portal-access.service.js';
import type {
  PortalAccounts,
  PortalFees,
  PortalOverview,
  PortalResultSummary,
} from '../src/modules/portal/portal.service.js';
import type { ReportCardData } from '../src/modules/report-cards/report-card.pdf.js';
import type { StudentDetail } from '../src/modules/students/students.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  unique,
  type SeededTenant,
  type SeededUser,
  type SignedIn,
  type TestContext,
} from './support/app.js';

type Method = 'get' | 'post' | 'put';
type Name = 'amina' | 'brian' | 'chege';

class FakeGateway extends MpesaGateway {
  readonly environment = 'sandbox' as const;
  isConfigured(): boolean {
    return true;
  }
  assertConfigured(): void {
    if (!this.isConfigured()) throw new ServiceUnavailableException();
  }
  callbackSecret(): string {
    return 'portal-test-callback-secret-0123456789';
  }
  stkPush(): Promise<StkPushAccepted> {
    return Promise.resolve({
      merchantRequestId: unique('mr'),
      checkoutRequestId: unique('ws_CO'),
      customerMessage: 'Accepted',
    });
  }
  query(): Promise<StkStatus> {
    return Promise.resolve({ state: 'PENDING' });
  }
}

describe('Parent and student portals (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let teacher: SignedIn;
  let grace: SignedIn;
  let peter: SignedIn;
  let aminaSelf: SignedIn;
  let stranger: SignedIn;
  let betaParent: SignedIn;
  let users: Record<
    'grace' | 'peter' | 'amina' | 'stranger' | 'teacher' | 'betaParent',
    SeededUser
  >;

  let students: Record<Name, StudentDetail>;
  let guardians: Record<'grace' | 'peter', string>;
  let published: ExaminationDetail;
  let provisional: ExaminationDetail;
  let invoices: Record<'amina' | 'chege', InvoiceDetail>;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const childrenOf = async (actor: SignedIn) =>
    dataOf<PortalChild[]>(await call(actor, 'get', '/portal/children').expect(200));
  const child = (student: StudentDetail, path = '') => `/portal/children/${student.id}${path}`;
  const linkGuardian = (
    student: StudentDetail,
    guardianId: string,
    email: string | null,
    actor = admin,
  ) =>
    call(actor, 'put', `/students/${student.id}/portal-accounts/guardians/${guardianId}`).send({
      email,
    });

  beforeAll(async () => {
    ctx = await createTestApp((builder) =>
      builder.overrideProvider(MpesaGateway).useValue(new FakeGateway()),
    );
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const seed = (tenant: SeededTenant, role: 'PARENT' | 'STUDENT' | 'TEACHER') =>
      seedUser(ctx, { tenantId: tenant.id, roles: [role] });
    users = {
      grace: await seed(alpha, 'PARENT'),
      peter: await seed(alpha, 'PARENT'),
      amina: await seed(alpha, 'STUDENT'),
      stranger: await seed(alpha, 'PARENT'),
      teacher: await seed(alpha, 'TEACHER'),
      betaParent: await seed(beta, 'PARENT'),
    };
    [admin, teacher, grace, peter, aminaSelf, stranger, betaParent] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, users.teacher),
      signIn(ctx, users.grace),
      signIn(ctx, users.peter),
      signIn(ctx, users.amina),
      signIn(ctx, users.stranger),
      signIn(ctx, users.betaParent),
    ]);

    const year = dataOf<AcademicYearView>(
      await asAdmin('post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201),
    );
    const term = dataOf<TermView>(
      await asAdmin('post', `/academic-years/${year.id}/terms`)
        .send({ name: 'Term 2', sequence: 2, startDate: '2026-05-04', endDate: '2026-08-07' })
        .expect(201),
    );
    await asAdmin('post', '/grading-schemes')
      .send({
        name: 'Percentage',
        type: 'PERCENTAGE',
        boundaries: [
          { label: 'A', minScore: 80, points: 12 },
          { label: 'C', minScore: 50, points: 6 },
          { label: 'E', minScore: 0, points: 1 },
        ],
      })
      .expect(201);
    const maths = dataOf<SubjectView>(
      await asAdmin('post', '/subjects').send({ name: 'Mathematics', code: 'MAT' }).expect(201),
    );
    const grade7 = dataOf<ClassView>(
      await asAdmin('post', '/classes').send({ name: 'Grade 7', level: 7 }).expect(201),
    );
    await asAdmin('put', `/classes/${grade7.id}/subjects`)
      .send({ subjects: [{ subjectId: maths.id, isCompulsory: true }] })
      .expect(200);

    let admission = 0;
    const admit = async (firstName: string, lastName: string) =>
      dataOf<StudentDetail>(
        await asAdmin('post', '/students')
          .send({
            admissionNumber: `P-${String((admission += 1)).padStart(3, '0')}`,
            firstName,
            lastName,
            dateOfBirth: '2013-04-17',
            gender: 'FEMALE',
            admissionDate: '2026-01-05',
            classId: grade7.id,
            streamId: null,
          })
          .expect(201),
      );
    students = {
      amina: await admit('Amina', 'Otieno'),
      brian: await admit('Brian', 'Otieno'),
      chege: await admit('Chege', 'Mwangi'),
    };
    const addGuardian = async (student: StudentDetail, body: Record<string, unknown>) =>
      dataOf<StudentDetail>(
        await asAdmin('post', `/students/${student.id}/guardians`).send(body).expect(201),
      );
    const withGrace = await addGuardian(students.amina, {
      details: { firstName: 'Grace', lastName: 'Otieno', phone: '+254711000010' },
      relationship: 'MOTHER',
    });
    const graceId = withGrace.guardians[0]?.guardianId as string;
    await addGuardian(students.brian, { guardianId: graceId, relationship: 'MOTHER' });
    const withPeter = await addGuardian(students.chege, {
      details: { firstName: 'Peter', lastName: 'Mwangi', phone: '+254711000011' },
      relationship: 'FATHER',
    });
    guardians = { grace: graceId, peter: withPeter.guardians[0]?.guardianId as string };

    const sit = async (name: string, startDate: string, publish: boolean) => {
      const exam = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations')
          .send({
            name,
            type: 'MID_TERM',
            termId: term.id,
            startDate,
            endDate: startDate,
            classIds: [grade7.id],
          })
          .expect(201),
      );
      await asAdmin('post', `/examinations/${exam.id}/open`).expect(200);
      await asAdmin('put', `/examinations/${exam.id}/marks`)
        .send({
          classId: grade7.id,
          entries: [
            { studentId: students.amina.id, subjectId: maths.id, version: 0, score: 88 },
            { studentId: students.brian.id, subjectId: maths.id, version: 0, score: 61 },
            { studentId: students.chege.id, subjectId: maths.id, version: 0, score: 45 },
          ],
        })
        .expect(200);
      await asAdmin('post', `/examinations/${exam.id}/compile`).expect(200);
      if (publish) {
        await asAdmin('post', `/examinations/${exam.id}/approve`).expect(200);
        await asAdmin('post', `/examinations/${exam.id}/publish`).expect(200);
      }
      return exam;
    };
    published = await sit('Mid-term', '2026-06-01', true);
    provisional = await sit('End-term', '2026-07-20', false);

    const today = new Date().toISOString().slice(0, 10);
    await asAdmin('put', '/attendance/register')
      .send({
        classId: grade7.id,
        date: today,
        records: [
          { studentId: students.amina.id, status: 'PRESENT' },
          { studentId: students.brian.id, status: 'ABSENT', note: 'Unwell' },
          { studentId: students.chege.id, status: 'LATE' },
        ],
      })
      .expect(200);

    const invoice = async (student: StudentDetail, amount: number) =>
      dataOf<InvoiceDetail>(
        await asAdmin('post', '/finance/invoices')
          .send({
            studentId: student.id,
            dueDate: '2026-12-15',
            lines: [{ description: 'Tuition', amount }],
          })
          .expect(201),
      );
    invoices = {
      amina: await invoice(students.amina, 30000),
      chege: await invoice(students.chege, 20000),
    };
    await asAdmin('post', '/finance/payments')
      .send({ studentId: students.amina.id, amount: 12000, method: 'CASH' })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('linking accounts', () => {
    it('links a guardian to a parent account, checking the account first', async () => {
      const unknown = await linkGuardian(
        students.amina,
        guardians.grace,
        'nobody@test.example',
      ).expect(400);
      expect(errorOf(unknown).code).toBe('USER_NOT_FOUND');
      const wrongRole = await linkGuardian(
        students.amina,
        guardians.grace,
        users.teacher.email,
      ).expect(400);
      expect(errorOf(wrongRole).code).toBe('WRONG_ROLE');
      // An account in another school's tenant is invisible, not merely refused.
      const foreign = await linkGuardian(
        students.amina,
        guardians.grace,
        users.betaParent.email,
      ).expect(400);
      expect(errorOf(foreign).code).toBe('USER_NOT_FOUND');
      await linkGuardian(students.amina, guardians.grace, 'not-an-email').expect(400);

      const linked = dataOf<PortalAccounts>(
        await linkGuardian(students.amina, guardians.grace, users.grace.email.toUpperCase()).expect(
          200,
        ),
      );
      expect(linked.guardians).toEqual([
        {
          guardianId: guardians.grace,
          name: 'Grace Otieno',
          relationship: 'MOTHER',
          email: users.grace.email,
        },
      ]);
      await linkGuardian(students.chege, guardians.peter, users.peter.email).expect(200);
    });

    it('refuses to give one account two identities, or to link the wrong guardian', async () => {
      const taken = await linkGuardian(students.chege, guardians.peter, users.grace.email).expect(
        409,
      );
      expect(errorOf(taken).code).toBe('ACCOUNT_ALREADY_LINKED');
      // Peter is not a guardian of Amina.
      await linkGuardian(students.amina, guardians.peter, users.stranger.email).expect(404);
    });

    it('links a learner’s own account and keeps linking to administrators', async () => {
      const path = `/students/${students.amina.id}/portal-accounts`;
      const parentAsStudent = await asAdmin('put', `${path}/student`)
        .send({ email: users.grace.email })
        .expect(400);
      expect(errorOf(parentAsStudent).code).toBe('WRONG_ROLE');
      const linked = dataOf<PortalAccounts>(
        await asAdmin('put', `${path}/student`).send({ email: users.amina.email }).expect(200),
      );
      expect(linked.student.email).toBe(users.amina.email);

      await call(teacher, 'put', `${path}/student`).send({ email: null }).expect(403);
      await call(teacher, 'get', path).expect(403);
      await call(grace, 'get', path).expect(403);
      await linkGuardian(students.amina, guardians.grace, null, grace).expect(403);
    });
  });

  describe('whose records a portal user reaches', () => {
    it('gives a parent their own children, and a student themselves', async () => {
      expect((await childrenOf(grace)).map((c) => [c.name, c.relationship])).toEqual([
        ['Amina Otieno', 'MOTHER'],
        ['Brian Otieno', 'MOTHER'],
      ]);
      expect((await childrenOf(peter)).map((c) => c.name)).toEqual(['Chege Mwangi']);
      expect((await childrenOf(aminaSelf)).map((c) => [c.name, c.relationship])).toEqual([
        ['Amina Otieno', 'SELF'],
      ]);
      expect(await childrenOf(stranger)).toEqual([]);
    });

    it('never shows a parent another family’s child, by any route', async () => {
      const paths = [
        '',
        '/results',
        '/attendance',
        '/fees',
        `/report-cards/${published.id}`,
        `/report-cards/${published.id}/pdf`,
      ];
      for (const path of paths) {
        const response = await call(grace, 'get', child(students.chege, path)).expect(404);
        expect(errorOf(response).code, path).toBe('STUDENT_NOT_FOUND');
        // A sibling is not the student's own record either.
        await call(aminaSelf, 'get', child(students.brian, path)).expect(404);
        await call(stranger, 'get', child(students.amina, path)).expect(404);
      }
    });

    it('answers the same for a child that is not theirs as for one that does not exist', async () => {
      const real = await call(grace, 'get', child(students.chege)).expect(404);
      const invented = await call(
        grace,
        'get',
        '/portal/children/018f4b2e-0000-7000-8000-000000000000',
      ).expect(404);
      expect(errorOf(real)).toEqual(errorOf(invented));
    });

    it('is closed to staff, to the signed-out and to other tenants', async () => {
      await call(admin, 'get', '/portal/children').expect(403);
      await call(teacher, 'get', child(students.amina)).expect(403);
      await ctx.http().get('/api/v1/portal/children').expect(401);
      expect(await childrenOf(betaParent)).toEqual([]);
      await call(betaParent, 'get', child(students.amina)).expect(404);
      await call(
        betaParent,
        'get',
        child(students.amina, `/report-cards/${published.id}/pdf`),
      ).expect(404);
    });

    it('gives a portal user nothing from the staff API', async () => {
      const staffRoutes = [
        '/students',
        `/students/${students.amina.id}`,
        `/results?examinationId=${published.id}`,
        `/examinations/${published.id}/report-cards`,
        `/examinations/${published.id}/report-cards/students/${students.amina.id}/pdf`,
        `/attendance/students/${students.amina.id}?from=2026-01-01&to=2026-12-31`,
        '/finance/invoices',
        `/finance/students/${students.amina.id}/statement`,
        '/users',
        '/audit-logs',
      ];
      for (const route of staffRoutes) {
        expect((await call(grace, 'get', route)).status, route).toBe(403);
        expect((await call(aminaSelf, 'get', route)).status, route).toBe(403);
      }
    });
  });

  describe('what they see', () => {
    it('shows published results only', async () => {
      const results = dataOf<PortalResultSummary[]>(
        await call(grace, 'get', child(students.amina, '/results')).expect(200),
      );
      expect(results.map((r) => [r.examination, r.average, r.grade])).toEqual([
        ['Mid-term', 88, 'A'],
      ]);

      const card = dataOf<ReportCardData>(
        await call(grace, 'get', child(students.amina, `/report-cards/${published.id}`)).expect(
          200,
        ),
      );
      expect(card).toMatchObject({
        isPublished: true,
        student: { name: 'Amina Otieno' },
        summary: { average: 88 },
      });

      // Compiled but unpublished: indistinguishable from not existing.
      const hidden = await call(
        grace,
        'get',
        child(students.amina, `/report-cards/${provisional.id}`),
      ).expect(404);
      expect(errorOf(hidden).code).toBe('REPORT_CARD_NOT_FOUND');
      await call(grace, 'get', child(students.amina, `/report-cards/${provisional.id}/pdf`)).expect(
        404,
      );
      await call(aminaSelf, 'get', child(students.amina, `/report-cards/${provisional.id}`)).expect(
        404,
      );
    });

    it('serves the published report card as a private PDF and records the download', async () => {
      const response = await call(
        aminaSelf,
        'get',
        child(students.amina, `/report-cards/${published.id}/pdf`),
      )
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['cache-control']).toBe('no-store');
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      const logged = await ctx.prisma.auditLog.findFirst({
        where: { tenantId: alpha.id, action: 'report_cards.generated', actorId: users.amina.id },
      });
      expect(logged?.metadata).toMatchObject({ via: 'portal', studentId: students.amina.id });
    });

    it('shows attendance, the fee account and an overview', async () => {
      const attendance = dataOf<StudentAttendance>(
        await call(grace, 'get', child(students.brian, '/attendance')).expect(200),
      );
      expect(attendance.totals).toMatchObject({ absent: 1, marked: 1, rate: 0 });
      expect(attendance.records[0]).toMatchObject({ status: 'ABSENT', note: 'Unwell' });
      await call(grace, 'get', child(students.brian, '/attendance?from=2026-13-01')).expect(400);

      const fees = dataOf<PortalFees>(
        await call(grace, 'get', child(students.amina, '/fees')).expect(200),
      );
      expect(fees.statement).toMatchObject({
        closingBalance: 18000,
        totals: { invoiced: 30000, paid: 12000 },
      });
      expect(fees.outstanding.map((i) => [i.number, i.balance])).toEqual([
        [invoices.amina.number, 18000],
      ]);

      const overview = dataOf<PortalOverview>(
        await call(grace, 'get', child(students.amina)).expect(200),
      );
      expect(overview).toMatchObject({
        child: { name: 'Amina Otieno', class: 'Grade 7' },
        attendance: { rate: 100, present: 1 },
        fees: { currency: 'KES', balance: 18000, overdue: 0 },
        latestResult: { examination: 'Mid-term', grade: 'A' },
      });
    });
  });

  describe('fee documents', () => {
    it('lets a family download its own statement, invoices and receipts only', async () => {
      const fees = dataOf<PortalFees>(
        await call(grace, 'get', child(students.amina, '/fees')).expect(200),
      );
      const receipt = fees.statement.lines.find((line) => line.kind === 'PAYMENT')
        ?.reference as string;
      for (const path of [
        '/statement/pdf',
        `/invoices/${invoices.amina.id}/pdf`,
        `/receipts/${receipt}/pdf`,
      ]) {
        const response = await call(grace, 'get', child(students.amina, path)).expect(200);
        expect(response.headers['content-type'], path).toBe('application/pdf');
        expect(response.headers['cache-control'], path).toBe('no-store');
        await call(aminaSelf, 'get', child(students.amina, path)).expect(200);
      }

      // Another family's invoice, even named under one's own child's address.
      await call(grace, 'get', child(students.amina, `/invoices/${invoices.chege.id}/pdf`)).expect(
        404,
      );
      await call(grace, 'get', child(students.chege, `/invoices/${invoices.chege.id}/pdf`)).expect(
        404,
      );
      await call(grace, 'get', child(students.chege, '/statement/pdf')).expect(404);
      await call(peter, 'get', child(students.amina, `/receipts/${receipt}/pdf`)).expect(404);
      await call(stranger, 'get', child(students.amina, '/statement/pdf')).expect(404);
      await call(grace, 'get', child(students.amina, '/receipts/not-a-receipt/pdf')).expect(400);
      // Staff use the staff routes; the portal ones are not theirs.
      await call(admin, 'get', child(students.amina, '/statement/pdf')).expect(403);
    });
  });

  describe('paying by M-Pesa', () => {
    const pay = (actor: SignedIn, student: StudentDetail, body: Record<string, unknown> = {}) =>
      call(actor, 'post', child(student, '/mpesa')).send({
        phone: '0712345678',
        amount: 5000,
        ...body,
      });

    it('lets a parent pay for their own child only', async () => {
      const pending = dataOf<MpesaTransactionView>(
        await pay(grace, students.amina, { invoiceId: invoices.amina.id }).expect(201),
      );
      expect(pending).toMatchObject({
        status: 'PENDING',
        amount: 5000,
        student: { name: 'Amina Otieno' },
      });

      const notTheirs = await pay(grace, students.chege).expect(404);
      expect(errorOf(notTheirs).code).toBe('STUDENT_NOT_FOUND');
      // Their own child, someone else's invoice.
      await pay(grace, students.amina, { invoiceId: invoices.chege.id, amount: 700 }).expect(422);
      // Students cannot start payments, even for themselves.
      await pay(aminaSelf, students.amina, { amount: 800 }).expect(403);
      await pay(stranger, students.amina, { amount: 900 }).expect(404);

      await call(grace, 'post', `/portal/mpesa/${pending.id}/verify`).expect(200);
      await call(peter, 'post', `/portal/mpesa/${pending.id}/verify`).expect(404);
      await call(aminaSelf, 'post', `/portal/mpesa/${pending.id}/verify`).expect(403);
      // Nothing was credited by any of this.
      const fees = dataOf<PortalFees>(
        await call(grace, 'get', child(students.amina, '/fees')).expect(200),
      );
      expect(fees.statement.closingBalance).toBe(18000);
    });
  });

  describe('being told when results are published', () => {
    it('notifies the linked parents and learners once each, and nobody else', async () => {
      const unread = async (actor: SignedIn) =>
        dataOf<NotificationList>(
          await call(actor, 'get', '/notifications?unreadOnly=true').expect(200),
        );
      const before = (await unread(grace)).total;

      await asAdmin('post', `/examinations/${provisional.id}/approve`).expect(200);
      await asAdmin('post', `/examinations/${provisional.id}/publish`).expect(200);

      // Grace has two children in the examination but is told once.
      const graces = await unread(grace);
      expect(graces.total).toBe(before + 1);
      expect(graces.items[0]).toMatchObject({
        kind: 'RESULTS_PUBLISHED',
        title: 'End-term results are out',
        link: '/portal',
      });
      expect((await unread(peter)).items[0]?.kind).toBe('RESULTS_PUBLISHED');
      expect((await unread(aminaSelf)).items[0]?.kind).toBe('RESULTS_PUBLISHED');
      expect((await unread(stranger)).total).toBe(0);
      expect((await unread(teacher)).total).toBe(0);

      // And the newly published report card is now there to see.
      await call(grace, 'get', child(students.amina, `/report-cards/${provisional.id}`)).expect(
        200,
      );
    });
  });

  describe('removing access', () => {
    it('takes effect at once when the link is removed', async () => {
      await linkGuardian(students.amina, guardians.grace, null).expect(200);
      expect(await childrenOf(grace)).toEqual([]);
      await call(grace, 'get', child(students.amina)).expect(404);
      await call(grace, 'get', child(students.brian, '/fees')).expect(404);

      const audited = await ctx.prisma.auditLog.count({
        where: {
          tenantId: alpha.id,
          action: { in: ['portal.account.linked', 'portal.account.unlinked'] },
        },
      });
      expect(audited).toBe(4);
    });
  });
});
