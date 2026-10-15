import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate } from '../../common/http/dates.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import { AttendanceService, type StudentAttendance } from '../attendance/attendance.service.js';
import { AuditService } from '../audit/audit.service.js';
import { findExam } from '../examinations/exam-context.js';
import {
  FinanceDocumentsService,
  type FinanceDocument,
} from '../finance/finance-documents.service.js';
import { FinanceReportsService, type Statement } from '../finance/finance-reports.service.js';
import type { InvoiceSummary } from '../finance/invoices.service.js';
import { toInvoiceSummary } from '../finance/invoices.service.js';
import {
  MpesaService,
  type MpesaConfigView,
  type MpesaTransactionView,
} from '../finance/mpesa.service.js';
import { renderReportCards, type ReportCardData } from '../report-cards/report-card.pdf.js';
import { ReportCardsService, type GeneratedPdf } from '../report-cards/report-cards.service.js';
import { PortalAccessService, type PortalChild } from './portal-access.service.js';
import type { PortalRangeQueryDto, PortalStkPushDto } from './portal.dto.js';

export interface PortalResultSummary {
  examinationId: string;
  examination: string;
  term: string;
  academicYear: string;
  publishedAt: string | null;
  average: number;
  grade: string | null;
  subjectsSat: number;
}

export interface PortalOverview {
  child: PortalChild;
  /** The last 30 days. */
  attendance: {
    rate: number | null;
    present: number;
    absent: number;
    late: number;
    excused: number;
  };
  fees: { currency: string; balance: number; overdue: number };
  latestResult: PortalResultSummary | null;
}

export interface PortalFees {
  statement: Statement;
  /** Invoices with something still owed, soonest due first. */
  outstanding: InvoiceSummary[];
}

export interface PortalAccounts {
  student: { email: string | null };
  guardians: { guardianId: string; name: string; relationship: string; email: string | null }[];
}

const DAY = 86_400_000;
const isoDaysAgo = (days: number): string => formatCalendarDate(new Date(Date.now() - days * DAY));
const slug = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * What parents and students can see: their own learners' published results
 * and report cards, attendance and fee account — nothing else, and nothing
 * provisional.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly access: PortalAccessService,
    private readonly attendance: AttendanceService,
    private readonly reportCards: ReportCardsService,
    private readonly finance: FinanceReportsService,
    private readonly mpesa: MpesaService,
    private readonly audit: AuditService,
    private readonly documents: FinanceDocumentsService,
  ) {}

  children(principal: Principal, schoolId: string | undefined): Promise<PortalChild[]> {
    return this.scopes.run(principal, schoolId, (scope) => this.access.children(scope, principal));
  }

  overview(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<PortalOverview> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const child = await this.access.requireChild(scope, principal, studentId);
      const [attendance, statement, overdue, results] = await Promise.all([
        this.attendance.forStudent(scope, studentId, { from: isoDaysAgo(30), to: isoDaysAgo(0) }),
        this.finance.statementFor(scope, studentId, {}),
        scope.tx.invoice.aggregate({
          where: {
            studentId,
            schoolId: scope.schoolId,
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
            dueDate: { lt: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
          },
          _sum: { balance: true },
        }),
        this.publishedResults(scope, studentId, 1),
      ]);
      return {
        child,
        attendance: {
          rate: attendance.totals.rate,
          present: attendance.totals.present,
          absent: attendance.totals.absent,
          late: attendance.totals.late,
          excused: attendance.totals.excused,
        },
        fees: {
          currency: statement.currency,
          balance: statement.closingBalance,
          overdue: overdue._sum.balance?.toNumber() ?? 0,
        },
        latestResult: results[0] ?? null,
      };
    });
  }

  results(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<PortalResultSummary[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, principal, studentId);
      return this.publishedResults(scope, studentId);
    });
  }

  /** A published report card, as data. Unpublished results do not exist here. */
  reportCard(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
    examinationId: string,
  ): Promise<ReportCardData> {
    return this.scopes.run(principal, schoolId, (scope) =>
      this.card(scope, principal, studentId, examinationId),
    );
  }

  reportCardPdf(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    examinationId: string,
  ): Promise<GeneratedPdf> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const card = await this.card(scope, actor.principal, studentId, examinationId);
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'report_cards.generated',
        { type: 'examination', id: examinationId },
        {
          count: 1,
          studentId,
          via: 'portal',
        },
      );
      return {
        buffer: await renderReportCards([card], await this.reportCards.logo(scope)),
        fileName: `${slug(`${card.student.admissionNumber}-${card.examination.name}`) || 'report-card'}.pdf`,
      };
    });
  }

  attendanceOf(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
    query: PortalRangeQueryDto,
  ): Promise<StudentAttendance> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, principal, studentId);
      const to = query.to ?? isoDaysAgo(0);
      const from =
        query.from ??
        formatCalendarDate(new Date(new Date(`${to}T00:00:00.000Z`).getTime() - 90 * DAY));
      return this.attendance.forStudent(scope, studentId, { from, to });
    });
  }

  fees(principal: Principal, schoolId: string | undefined, studentId: string): Promise<PortalFees> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, principal, studentId);
      const [statement, invoices] = await Promise.all([
        this.finance.statementFor(scope, studentId, {}),
        scope.tx.invoice.findMany({
          where: {
            studentId,
            schoolId: scope.schoolId,
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
            balance: { gt: 0 },
          },
          select: {
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
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                admissionNumber: true,
              },
            },
          },
          orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }],
        }),
      ]);
      return { statement, outstanding: invoices.map(toInvoiceSummary) };
    });
  }

  /** The learner's statement of account as a PDF. */
  statementPdf(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, actor.principal, studentId);
      return this.documents.statementFor(scope, actor, studentId, {});
    });
  }

  /** One of the learner's invoices as a PDF; anyone else's is not found. */
  invoicePdf(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    invoiceId: string,
  ): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, actor.principal, studentId);
      return this.documents.invoiceFor(scope, actor, { id: invoiceId, studentId });
    });
  }

  /** A receipt for one of the learner's payments, by its receipt number. */
  receiptPdf(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    receiptNumber: string,
  ): Promise<FinanceDocument> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.access.requireChild(scope, actor.principal, studentId);
      return this.documents.receiptFor(scope, actor, { receiptNumber, studentId });
    });
  }

  mpesaConfig(): MpesaConfigView {
    return this.mpesa.config();
  }

  /** A parent pays for their own child. Students cannot start payments. */
  async pay(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: PortalStkPushDto,
  ): Promise<MpesaTransactionView> {
    const own = await this.ownChildren(actor.principal, schoolId);
    return this.mpesa.requestPayment(actor, schoolId, { studentId, ...dto }, own);
  }

  async verifyPayment(
    principal: Principal,
    schoolId: string | undefined,
    transactionId: string,
  ): Promise<MpesaTransactionView> {
    const own = await this.ownChildren(principal, schoolId);
    return this.mpesa.verify(principal, schoolId, transactionId, own);
  }

  // ── Linking accounts (staff) ───────────────────────────────────────────────

  accounts(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<PortalAccounts> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const student = await scope.tx.student.findFirst({
        where: { id: studentId, schoolId: scope.schoolId },
        select: {
          user: { select: { email: true } },
          guardians: {
            select: {
              relationship: true,
              guardian: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  user: { select: { email: true } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!student)
        throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
      return {
        student: { email: student.user?.email ?? null },
        guardians: student.guardians.map((link) => ({
          guardianId: link.guardian.id,
          name: `${link.guardian.firstName} ${link.guardian.lastName}`,
          relationship: link.relationship,
          email: link.guardian.user?.email ?? null,
        })),
      };
    });
  }

  linkStudent(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    email: string | null,
  ): Promise<PortalAccounts> {
    return this.link(actor, schoolId, studentId, { kind: 'student', email });
  }

  linkGuardian(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    guardianId: string,
    email: string | null,
  ): Promise<PortalAccounts> {
    return this.link(actor, schoolId, studentId, { kind: 'guardian', guardianId, email });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async link(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    target:
      | { kind: 'student'; email: string | null }
      | { kind: 'guardian'; guardianId: string; email: string | null },
  ): Promise<PortalAccounts> {
    await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const student = await scope.tx.student.findFirst({
        where: { id: studentId, schoolId: scope.schoolId },
        select: { id: true, guardians: { select: { guardianId: true } } },
      });
      if (!student)
        throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
      if (
        target.kind === 'guardian' &&
        !student.guardians.some((link) => link.guardianId === target.guardianId)
      ) {
        throw new NotFoundException({ code: 'GUARDIAN_NOT_FOUND', message: 'Guardian not found.' });
      }

      const role = target.kind === 'student' ? 'STUDENT' : 'PARENT';
      let userId: string | null = null;
      if (target.email) {
        // Row-level security confines this lookup to the caller's tenant.
        const user = await scope.tx.user.findFirst({
          where: { email: target.email },
          select: {
            id: true,
            roles: { select: { role: { select: { key: true } } } },
            guardianProfile: { select: { id: true } },
            studentProfile: { select: { id: true } },
          },
        });
        if (!user) {
          throw new BadRequestException({
            code: 'USER_NOT_FOUND',
            message:
              'No user account has that email address. Create the account under Users & Roles first.',
          });
        }
        if (!user.roles.some((entry) => entry.role.key === role)) {
          throw new BadRequestException({
            code: 'WRONG_ROLE',
            message: `That account does not have the ${role === 'PARENT' ? 'Parent / Guardian' : 'Student'} role.`,
          });
        }
        const holder =
          target.kind === 'student' ? user.studentProfile?.id : user.guardianProfile?.id;
        const self = target.kind === 'student' ? studentId : target.guardianId;
        if (holder && holder !== self) {
          throw new ConflictException({
            code: 'ACCOUNT_ALREADY_LINKED',
            message: `That account is already linked to another ${target.kind === 'student' ? 'student' : 'guardian'}.`,
          });
        }
        userId = user.id;
      }

      if (target.kind === 'student') {
        await scope.tx.student.update({ where: { id: studentId }, data: { userId } });
      } else {
        await scope.tx.guardian.update({ where: { id: target.guardianId }, data: { userId } });
      }
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        userId ? 'portal.account.linked' : 'portal.account.unlinked',
        target.kind === 'student'
          ? { type: 'student', id: studentId }
          : { type: 'guardian', id: target.guardianId },
        { userId, studentId },
      );
    });
    return this.accounts(actor.principal, schoolId, studentId);
  }

  private async ownChildren(principal: Principal, schoolId: string | undefined): Promise<string[]> {
    if (!principal.permissions.has('portal:parent')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only a parent or guardian can make a payment.',
      });
    }
    // Only learners reached through the caller's guardian record count here.
    return this.scopes.run(principal, schoolId, async (scope) =>
      (
        await scope.tx.studentGuardian.findMany({
          where: { guardian: { userId: principal.userId, schoolId: scope.schoolId } },
          select: { studentId: true },
        })
      ).map((link) => link.studentId),
    );
  }

  private async card(
    scope: SchoolScope,
    principal: Principal,
    studentId: string,
    examinationId: string,
  ): Promise<ReportCardData> {
    await this.access.requireChild(scope, principal, studentId);
    const notFound = () =>
      new NotFoundException({ code: 'REPORT_CARD_NOT_FOUND', message: 'Report card not found.' });
    // An unpublished examination is reported exactly like a missing one.
    const exam = await findExam(scope, examinationId).catch(() => null);
    if (!exam || exam.status !== 'PUBLISHED') throw notFound();
    const [card] = await this.reportCards.build(scope, exam, { studentId });
    if (!card) throw notFound();
    return card;
  }

  private async publishedResults(
    scope: SchoolScope,
    studentId: string,
    take?: number,
  ): Promise<PortalResultSummary[]> {
    const results = await scope.tx.result.findMany({
      where: { studentId, schoolId: scope.schoolId, examination: { status: 'PUBLISHED' } },
      select: {
        average: true,
        grade: true,
        subjectsSat: true,
        examination: {
          select: {
            id: true,
            name: true,
            publishedAt: true,
            term: { select: { name: true, academicYear: { select: { name: true } } } },
          },
        },
      },
      orderBy: { examination: { startDate: 'desc' } },
      ...(take ? { take } : {}),
    });
    return results.map((result) => ({
      examinationId: result.examination.id,
      examination: result.examination.name,
      term: result.examination.term.name,
      academicYear: result.examination.term.academicYear.name,
      publishedAt: result.examination.publishedAt?.toISOString() ?? null,
      average: result.average.toNumber(),
      grade: result.grade,
      subjectsSat: result.subjectsSat,
    }));
  }
}
