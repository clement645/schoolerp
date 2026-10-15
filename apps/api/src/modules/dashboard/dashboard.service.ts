import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate } from '../../common/http/dates.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import { SchoolScopeService } from '../../common/school/school-scope.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { CalendarService, type CalendarEventView } from '../calendar/calendar.service.js';
import { ResultsService, type MeritRow } from '../examinations/results.service.js';
import { FinanceReportsService } from '../finance/finance-reports.service.js';
import type { PaymentSummary } from '../finance/payments.service.js';

export interface Dashboard {
  /** The term the figures are for: the one asked for, else the current one. */
  term: {
    id: string;
    name: string;
    academicYear: string;
    startDate: string;
    endDate: string;
  } | null;
  /** Each count is null when the caller may not see that kind of record. */
  counts: {
    students: number | null;
    teachers: number | null;
    classes: number | null;
  };
  /** Null without permission to see attendance. */
  attendance: {
    /** The last seven days, oldest first; days with no register have no rate. */
    week: {
      date: string;
      present: number;
      absent: number;
      late: number;
      excused: number;
      rate: number | null;
    }[];
    today: { rate: number | null; marked: number };
  } | null;
  /** Null without permission to see results. */
  performance: {
    trend: { examination: string; date: string; mean: number; passPercentage: number }[];
    latest: {
      examinationId: string;
      name: string;
      status: string;
      meanScore: number;
      passPercentage: number;
    } | null;
    meritList: MeritRow[];
  } | null;
  /** Null without permission to see finance. */
  finance: {
    currency: string;
    collected: number;
    outstanding: number;
    collectionRate: number;
    recentPayments: PaymentSummary[];
  } | null;
  /** Null without permission to see the calendar. */
  upcomingEvents: CalendarEventView[] | null;
}

const DAY = 86_400_000;

/**
 * The landing page's figures. Nothing is computed here that is not computed
 * the same way elsewhere: each section comes from the service that owns it,
 * with that service's own rules about who may see what.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly attendance: AttendanceService,
    private readonly results: ResultsService,
    private readonly finance: FinanceReportsService,
    private readonly calendar: CalendarService,
  ) {}

  async get(
    principal: Principal,
    schoolId: string | undefined,
    termId?: string,
  ): Promise<Dashboard> {
    const can = (permission: Parameters<typeof principal.permissions.has>[0]) =>
      principal.permissions.has(permission);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const base = await this.scopes.run(principal, schoolId, async (scope) => {
      const terms = await scope.tx.term.findMany({
        where: { schoolId: scope.schoolId },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
          academicYear: { select: { id: true, name: true } },
        },
        orderBy: { startDate: 'desc' },
      });
      const term =
        terms.find((entry) => entry.id === termId) ??
        terms.find((entry) => entry.isCurrent) ??
        terms[0] ??
        null;

      const classScope = await this.classScopes.resolve(scope, principal);
      const [students, teachers, classes, exams, events] = await Promise.all([
        can('students:read')
          ? scope.tx.student.count({
              where: {
                AND: [
                  { schoolId: scope.schoolId, status: 'ACTIVE' },
                  this.classScopes.studentFilter(classScope),
                ],
              },
            })
          : null,
        can('teachers:read')
          ? scope.tx.teacher.count({ where: { schoolId: scope.schoolId, status: 'ACTIVE' } })
          : null,
        can('classes:read')
          ? scope.tx.schoolClass.count({ where: { schoolId: scope.schoolId, isActive: true } })
          : null,
        can('results:read') && term
          ? scope.tx.examination.findMany({
              where: {
                schoolId: scope.schoolId,
                termId: term.id,
                status: { in: ['COMPILED', 'APPROVED', 'PUBLISHED'] },
              },
              select: { id: true, name: true, status: true },
              orderBy: { startDate: 'desc' },
              take: 1,
            })
          : [],
        can('calendar:read')
          ? this.calendar.between(scope, principal, today, new Date(today.getTime() + 180 * DAY), 5)
          : null,
      ]);
      return {
        term,
        counts: { students, teachers, classes },
        latestExam: exams[0] ?? null,
        events,
      };
    });

    const weekStart = new Date(today.getTime() - 6 * DAY);
    const [attendance, overview, analytics, finance] = await Promise.all([
      can('attendance:read')
        ? this.attendance.summary(principal, schoolId, {
            from: formatCalendarDate(weekStart),
            to: formatCalendarDate(today),
          })
        : null,
      base.latestExam
        ? this.results.overview(principal, schoolId, { examinationId: base.latestExam.id })
        : null,
      base.latestExam
        ? this.results.analytics(principal, schoolId, { examinationId: base.latestExam.id })
        : null,
      can('finance:read')
        ? this.finance.summary(principal, schoolId, { termId: base.term?.id })
        : null,
    ]);

    const byDay = new Map((attendance?.daily ?? []).map((day) => [day.date, day]));
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = formatCalendarDate(new Date(weekStart.getTime() + index * DAY));
      const day = byDay.get(date);
      return {
        date,
        present: day?.present ?? 0,
        absent: day?.absent ?? 0,
        late: day?.late ?? 0,
        excused: day?.excused ?? 0,
        rate: day?.rate ?? null,
      };
    });
    const todays = byDay.get(formatCalendarDate(today));

    return {
      term: base.term && {
        id: base.term.id,
        name: base.term.name,
        academicYear: base.term.academicYear.name,
        startDate: formatCalendarDate(base.term.startDate),
        endDate: formatCalendarDate(base.term.endDate),
      },
      counts: base.counts,
      attendance: attendance && {
        week,
        today: { rate: todays?.rate ?? null, marked: todays?.marked ?? 0 },
      },
      performance: can('results:read')
        ? {
            trend: (analytics?.trend ?? []).map(({ examination, date, mean, passPercentage }) => ({
              examination,
              date,
              mean,
              passPercentage,
            })),
            latest:
              base.latestExam && overview
                ? {
                    examinationId: base.latestExam.id,
                    name: base.latestExam.name,
                    status: base.latestExam.status,
                    meanScore: overview.stats.meanScore,
                    passPercentage: overview.stats.passPercentage,
                  }
                : null,
            meritList: (overview?.meritList ?? []).filter((row) => row.rank !== null).slice(0, 5),
          }
        : null,
      finance: finance && {
        currency: finance.currency,
        collected: finance.totals.collected,
        outstanding: finance.totals.outstanding,
        collectionRate: finance.totals.collectionRate,
        recentPayments: finance.recentPayments.slice(0, 5),
      },
      upcomingEvents: base.events,
    };
  }
}
