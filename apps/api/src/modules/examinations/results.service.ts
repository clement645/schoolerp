import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate } from '../../common/http/dates.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { ExaminationStatus, Prisma } from '../../generated/prisma/client.js';
import { findExam } from './exam-context.js';
import type { ResultsQueryDto } from './results.dto.js';
import { round2 } from './results.calc.js';

export interface MeritRow {
  resultId: string;
  /** Position within the current filter (class or stream), ties sharing one. */
  rank: number | null;
  student: { id: string; name: string; admissionNumber: string };
  class: string;
  stream: string | null;
  total: number;
  maxTotal: number;
  average: number;
  grade: string | null;
  points: number | null;
  /** Change in average since the learner's previous examination, if any. */
  trend: { direction: 'up' | 'down' | 'same'; change: number } | null;
  isComplete: boolean;
  passed: boolean | null;
}

export interface ResultsOverview {
  examination: { id: string; name: string; status: string; term: string; academicYear: string };
  stats: {
    studentsExamined: number;
    meanScore: number;
    highestScore: number;
    lowestScore: number;
    /** Share of examined learners who passed, 0–100. */
    passPercentage: number;
  };
  meritList: MeritRow[];
}

export interface ResultsAnalytics {
  subjectPerformance: {
    subject: string;
    code: string;
    mean: number;
    highest: number;
    lowest: number;
    entries: number;
  }[];
  gradeDistribution: { grade: string; count: number }[];
  classComparison: { class: string; mean: number; passPercentage: number; students: number }[];
  streamComparison: { class: string; stream: string; mean: number; students: number }[];
  /** Mean and pass rate of each compiled examination in the same academic year. */
  trend: {
    examinationId: string;
    examination: string;
    date: string;
    mean: number;
    passPercentage: number;
  }[];
}

export interface StudentResultView {
  student: { id: string; name: string; admissionNumber: string };
  examination: string;
  class: string;
  stream: string | null;
  average: number;
  grade: string | null;
  classPosition: number | null;
  classSize: number;
  subjects: {
    subject: string;
    code: string;
    score: number | null;
    maxMarks: number;
    /** Percentage, or points for a directly awarded level. */
    value: number | null;
    grade: string | null;
    isAbsent: boolean;
    /** The class's mean for the same subject, on the same scale as `value`. */
    classMean: number | null;
  }[];
  history: { examination: string; date: string; average: number; grade: string | null }[];
}

const RESULT_SELECT = {
  id: true,
  studentId: true,
  classId: true,
  className: true,
  streamName: true,
  totalScore: true,
  maxTotal: true,
  average: true,
  grade: true,
  points: true,
  subjectsSat: true,
  isComplete: true,
  passed: true,
  classPosition: true,
  classSize: true,
  student: {
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true },
  },
} satisfies Prisma.ResultSelect;

/** Statuses whose stored results are current; a reopened examination's are stale. */
const RELEASED: ExaminationStatus[] = ['COMPILED', 'APPROVED', 'PUBLISHED'];

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : round2(values.reduce((sum, value) => sum + value, 0) / values.length);
const share = (part: number, whole: number): number =>
  whole === 0 ? 0 : round2((part / whole) * 100);
const nameOf = (student: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string => [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');

/**
 * Read-only views over compiled results. Nothing here recalculates a result:
 * every figure is aggregated from what was stored when the examination was
 * compiled.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
  ) {}

  overview(
    principal: Principal,
    schoolId: string | undefined,
    query: ResultsQueryDto,
  ): Promise<ResultsOverview> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, query.examinationId);
      const results = await scope.tx.result.findMany({
        where: await this.visible(scope, principal, query),
        select: RESULT_SELECT,
      });
      const examined = results.filter((result) => result.subjectsSat > 0);
      const averages = examined.map((result) => result.average.toNumber());

      // The learner's previous result, for the trend arrow.
      const earlier = await scope.tx.result.findMany({
        where: {
          studentId: { in: results.map((result) => result.studentId) },
          subjectsSat: { gt: 0 },
          examination: {
            schoolId: scope.schoolId,
            status: { in: RELEASED },
            startDate: { lt: exam.startDate },
          },
        },
        select: { studentId: true, average: true, examination: { select: { startDate: true } } },
        orderBy: { examination: { startDate: 'desc' } },
      });
      const previous = new Map<string, number>();
      for (const row of earlier) {
        if (!previous.has(row.studentId)) previous.set(row.studentId, row.average.toNumber());
      }

      // Positions are recomputed for the filter in view, so a stream's list
      // runs 1..n rather than showing gaps from the whole class.
      const ordered = [...results].sort((a, b) => b.average.toNumber() - a.average.toNumber());
      let position = 0;
      let last: number | null = null;
      const meritList = ordered.map((result, index): MeritRow => {
        const average = result.average.toNumber();
        let rank: number | null = null;
        if (result.subjectsSat > 0) {
          if (last === null || average !== last) position = index + 1;
          last = average;
          rank = position;
        }
        const before = previous.get(result.studentId);
        const change = before === undefined ? null : round2(average - before);
        return {
          resultId: result.id,
          rank,
          student: {
            id: result.student.id,
            name: nameOf(result.student),
            admissionNumber: result.student.admissionNumber,
          },
          class: result.className,
          stream: result.streamName,
          total: result.totalScore.toNumber(),
          maxTotal: result.maxTotal.toNumber(),
          average,
          grade: result.grade,
          points: result.points?.toNumber() ?? null,
          trend:
            change === null || result.subjectsSat === 0
              ? null
              : { direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same', change },
          isComplete: result.isComplete,
          passed: result.passed,
        };
      });

      return {
        examination: {
          id: exam.id,
          name: exam.name,
          status: exam.status,
          term: exam.term.name,
          academicYear: exam.term.academicYear.name,
        },
        stats: {
          studentsExamined: examined.length,
          meanScore: mean(averages),
          highestScore: averages.length ? Math.max(...averages) : 0,
          lowestScore: averages.length ? Math.min(...averages) : 0,
          passPercentage: share(examined.filter((result) => result.passed).length, examined.length),
        },
        meritList,
      };
    });
  }

  analytics(
    principal: Principal,
    schoolId: string | undefined,
    query: ResultsQueryDto,
  ): Promise<ResultsAnalytics> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, query.examinationId);
      const where = await this.visible(scope, principal, query);
      const results = await scope.tx.result.findMany({
        where: { ...where, subjectsSat: { gt: 0 } },
        select: {
          className: true,
          streamName: true,
          average: true,
          grade: true,
          passed: true,
          points: true,
          class: { select: { level: true } },
          subjects: {
            select: {
              subjectName: true,
              subjectCode: true,
              percentage: true,
              points: true,
              grade: true,
            },
          },
        },
      });

      // Subject performance: percentage where there is one, else points.
      const bySubject = new Map<string, { subject: string; code: string; values: number[] }>();
      for (const result of results) {
        for (const subject of result.subjects) {
          const value = subject.percentage?.toNumber() ?? subject.points?.toNumber();
          if (value === undefined || subject.grade === null) continue;
          const entry = bySubject.get(subject.subjectCode) ?? {
            subject: subject.subjectName,
            code: subject.subjectCode,
            values: [],
          };
          entry.values.push(value);
          bySubject.set(subject.subjectCode, entry);
        }
      }

      // Grades in order of merit, best first.
      const grades = new Map<string, { count: number; best: number }>();
      for (const result of results) {
        if (!result.grade) continue;
        const entry = grades.get(result.grade) ?? { count: 0, best: -Infinity };
        entry.count += 1;
        entry.best = Math.max(entry.best, result.points?.toNumber() ?? result.average.toNumber());
        grades.set(result.grade, entry);
      }

      const group = <K extends string>(keyOf: (result: (typeof results)[number]) => K | null) => {
        const groups = new Map<K, (typeof results)[number][]>();
        for (const result of results) {
          const key = keyOf(result);
          if (key !== null) groups.set(key, [...(groups.get(key) ?? []), result]);
        }
        return groups;
      };
      const classes = group((result) => result.className);
      const streams = group((result) =>
        result.streamName ? `${result.className}\u0000${result.streamName}` : null,
      );

      // The same learners across the year's other compiled examinations.
      const sameYear = await scope.tx.examination.findMany({
        where: {
          schoolId: scope.schoolId,
          term: { academicYearId: exam.term.academicYear.id },
          status: { in: RELEASED },
        },
        select: {
          id: true,
          name: true,
          startDate: true,
          results: {
            where: { ...this.withoutExam(where), subjectsSat: { gt: 0 } },
            select: { average: true, passed: true },
          },
        },
        orderBy: { startDate: 'asc' },
      });

      return {
        subjectPerformance: [...bySubject.values()]
          .map(({ subject, code, values }) => ({
            subject,
            code,
            mean: mean(values),
            highest: Math.max(...values),
            lowest: Math.min(...values),
            entries: values.length,
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject)),
        gradeDistribution: [...grades]
          .sort(([, a], [, b]) => b.best - a.best)
          .map(([grade, { count }]) => ({ grade, count })),
        classComparison: [...classes]
          .map(([name, rows]) => ({
            class: name,
            level: rows[0]?.class.level ?? 0,
            mean: mean(rows.map((row) => row.average.toNumber())),
            passPercentage: share(rows.filter((row) => row.passed).length, rows.length),
            students: rows.length,
          }))
          .sort((a, b) => a.level - b.level)
          .map((row) => ({
            class: row.class,
            mean: row.mean,
            passPercentage: row.passPercentage,
            students: row.students,
          })),
        streamComparison: [...streams]
          .map(([key, rows]) => {
            const [className = '', stream = ''] = key.split('\u0000');
            return {
              class: className,
              stream,
              mean: mean(rows.map((row) => row.average.toNumber())),
              students: rows.length,
            };
          })
          .sort((a, b) => a.class.localeCompare(b.class) || a.stream.localeCompare(b.stream)),
        trend: sameYear
          .filter((entry) => entry.results.length > 0)
          .map((entry) => ({
            examinationId: entry.id,
            examination: entry.name,
            date: formatCalendarDate(entry.startDate),
            mean: mean(entry.results.map((row) => row.average.toNumber())),
            passPercentage: share(
              entry.results.filter((row) => row.passed).length,
              entry.results.length,
            ),
          })),
      };
    });
  }

  /** One learner's result with class means per subject, and their history. */
  student(
    principal: Principal,
    schoolId: string | undefined,
    examinationId: string,
    studentId: string,
  ): Promise<StudentResultView> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      const result = await scope.tx.result.findFirst({
        where: { ...(await this.visible(scope, principal, { examinationId })), studentId },
        select: {
          ...RESULT_SELECT,
          subjects: {
            select: {
              subjectId: true,
              subjectName: true,
              subjectCode: true,
              score: true,
              maxMarks: true,
              percentage: true,
              points: true,
              grade: true,
              isAbsent: true,
            },
            orderBy: { subjectName: 'asc' },
          },
        },
      });
      if (!result)
        throw new NotFoundException({ code: 'RESULT_NOT_FOUND', message: 'Result not found.' });

      const classmates = await scope.tx.resultSubject.groupBy({
        by: ['subjectId'],
        where: { result: { examinationId, classId: result.classId }, grade: { not: null } },
        _avg: { percentage: true, points: true },
      });
      const classMean = new Map(
        classmates.map((row) => [
          row.subjectId,
          row._avg.percentage?.toNumber() ?? row._avg.points?.toNumber() ?? null,
        ]),
      );

      const history = await scope.tx.result.findMany({
        where: {
          studentId,
          subjectsSat: { gt: 0 },
          examination: { schoolId: scope.schoolId, status: { in: RELEASED } },
        },
        select: {
          average: true,
          grade: true,
          examination: { select: { name: true, startDate: true } },
        },
        orderBy: { examination: { startDate: 'asc' } },
      });

      return {
        student: {
          id: result.student.id,
          name: nameOf(result.student),
          admissionNumber: result.student.admissionNumber,
        },
        examination: exam.name,
        class: result.className,
        stream: result.streamName,
        average: result.average.toNumber(),
        grade: result.grade,
        classPosition: result.classPosition,
        classSize: result.classSize,
        subjects: result.subjects.map((subject) => {
          const average = classMean.get(subject.subjectId);
          return {
            subject: subject.subjectName,
            code: subject.subjectCode,
            score: subject.score?.toNumber() ?? null,
            maxMarks: subject.maxMarks.toNumber(),
            value:
              subject.percentage?.toNumber() ??
              (subject.grade ? (subject.points?.toNumber() ?? null) : null),
            grade: subject.grade,
            isAbsent: subject.isAbsent,
            classMean: average === null || average === undefined ? null : round2(average),
          };
        }),
        history: history.map((row) => ({
          examination: row.examination.name,
          date: formatCalendarDate(row.examination.startDate),
          average: row.average.toNumber(),
          grade: row.grade,
        })),
      };
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async compiledExam(scope: SchoolScope, examinationId: string) {
    const exam = await findExam(scope, examinationId);
    if (exam.status === 'DRAFT' || exam.status === 'OPEN') {
      throw new ConflictException({
        code: 'RESULTS_NOT_COMPILED',
        message: 'Results are available once the examination has been compiled.',
      });
    }
    return exam;
  }

  /** The results a caller may see: the filter, narrowed to their classes. */
  private async visible(
    scope: SchoolScope,
    principal: Principal,
    query: ResultsQueryDto,
  ): Promise<Prisma.ResultWhereInput> {
    const classScope = await this.classScopes.resolve(scope, principal);
    return {
      schoolId: scope.schoolId,
      examinationId: query.examinationId,
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.stream ? { streamName: query.stream } : {}),
      student: this.classScopes.studentFilter(classScope),
    };
  }

  private withoutExam(where: Prisma.ResultWhereInput): Prisma.ResultWhereInput {
    const rest = { ...where };
    delete rest.examinationId;
    return rest;
  }
}
