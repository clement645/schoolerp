import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { ClassScopeService, type ClassScope } from '../../common/school/class-scope.service.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { addToTally, daysBetween, emptyTally, monthBounds, type Tally } from './attendance.calc.js';
import type {
  AttendanceRangeQueryDto,
  AttendanceStatus,
  MarkRegisterDto,
  MonthlyQueryDto,
  RegisterQueryDto,
} from './attendance.dto.js';

/** Longest period one report may cover. */
export const MAX_RANGE_DAYS = 366;

interface StudentRef {
  id: string;
  name: string;
  admissionNumber: string;
}

export interface RegisterView {
  class: { id: string; name: string };
  date: string;
  /** Null until the register has been marked for this day. */
  lastMarkedAt: string | null;
  students: {
    student: StudentRef;
    stream: string | null;
    status: AttendanceStatus | null;
    note: string | null;
  }[];
  summary: Tally & { unmarked: number };
}

export interface AttendanceSummary {
  from: string;
  to: string;
  totals: Tally;
  daily: (Tally & { date: string })[];
  byClass: { classId: string; class: string; rate: number | null; marked: number }[];
  /** Per-learner figures; only when a single class is selected. */
  students: (Tally & { student: StudentRef; stream: string | null })[];
}

export interface MonthlyRegister {
  month: string;
  class: { id: string; name: string };
  /** The days in the month on which this class's register was marked. */
  days: string[];
  students: (Tally & {
    student: StudentRef;
    stream: string | null;
    marks: Record<string, AttendanceStatus>;
  })[];
}

export interface StudentAttendance {
  from: string;
  to: string;
  totals: Tally;
  records: { date: string; status: AttendanceStatus; note: string | null }[];
}

const STUDENT_NAME = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  admissionNumber: true,
} as const;

const refOf = (student: {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  admissionNumber: string;
}): StudentRef => ({
  id: student.id,
  name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
  admissionNumber: student.admissionNumber,
});

const byName = (a: { student: StudentRef }, b: { student: StudentRef }): number =>
  a.student.name.localeCompare(b.student.name);

@Injectable()
export class AttendanceService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly audit: AuditService,
  ) {}

  register(
    principal: Principal,
    schoolId: string | undefined,
    query: RegisterQueryDto,
  ): Promise<RegisterView> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const classScope = await this.classScopes.resolve(scope, principal);
      return this.loadRegister(scope, classScope, query);
    });
  }

  /**
   * Records a day's attendance. Marking again corrects the earlier marks
   * rather than adding to them: a learner has at most one mark per day, which
   * the database enforces.
   */
  mark(actor: Actor, schoolId: string | undefined, dto: MarkRegisterDto): Promise<RegisterView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const date = parseCalendarDate(dto.date);
      this.assertMarkable(date);
      const classScope = await this.classScopes.resolve(scope, actor.principal);
      const schoolClass = await this.findClass(scope, classScope, dto.classId);

      const ids = dto.records.map((record) => record.studentId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException({
          code: 'DUPLICATE_STUDENT',
          message: 'A learner appears more than once in this register.',
        });
      }
      // Only learners who are in this class now, and whom the caller teaches.
      const students = await scope.tx.student.findMany({
        where: {
          AND: [
            {
              id: { in: ids },
              schoolId: scope.schoolId,
              status: 'ACTIVE',
              currentClassId: dto.classId,
            },
            this.classScopes.studentFilter(classScope),
          ],
        },
        select: { id: true, currentStreamId: true },
      });
      if (students.length !== ids.length) {
        throw new UnprocessableEntityException({
          code: 'STUDENT_NOT_IN_CLASS',
          message:
            'One or more learners are not active members of this class, or are outside the classes you teach.',
        });
      }
      const streamOf = new Map(students.map((student) => [student.id, student.currentStreamId]));

      const session = await scope.tx.attendanceSession.upsert({
        where: { classId_date: { classId: dto.classId, date } },
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, classId: dto.classId, date },
        // Touches `updatedAt`, which is shown as "last marked".
        update: { updatedAt: new Date() },
        select: { id: true },
      });
      const existing = new Map(
        (
          await scope.tx.attendanceRecord.findMany({
            where: { studentId: { in: ids }, date },
            select: { id: true, studentId: true, status: true, note: true },
          })
        ).map((record) => [record.studentId, record]),
      );

      const changes: Prisma.InputJsonObject[] = [];
      let created = 0;
      for (const entry of dto.records) {
        const before = existing.get(entry.studentId);
        const note = entry.note ?? null;
        if (!before) {
          created += 1;
          await scope.tx.attendanceRecord.create({
            data: {
              tenantId: scope.tenantId,
              schoolId: scope.schoolId,
              sessionId: session.id,
              studentId: entry.studentId,
              date,
              streamId: streamOf.get(entry.studentId) ?? null,
              status: entry.status,
              note,
              markedById: actor.principal.userId,
            },
          });
        } else if (before.status !== entry.status || before.note !== note) {
          await scope.tx.attendanceRecord.update({
            where: { id: before.id },
            data: {
              sessionId: session.id,
              status: entry.status,
              note,
              markedById: actor.principal.userId,
            },
          });
          changes.push({ studentId: entry.studentId, from: before.status, to: entry.status });
        }
      }

      if (created > 0 || changes.length > 0) {
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'attendance.marked',
          { type: 'attendance_session', id: session.id },
          { class: schoolClass.name, date: dto.date, created, corrected: changes },
        );
      }
      return this.loadRegister(scope, classScope, dto);
    });
  }

  summary(
    principal: Principal,
    schoolId: string | undefined,
    query: AttendanceRangeQueryDto,
  ): Promise<AttendanceSummary> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const { from, to } = this.range(query.from, query.to);
      const classScope = await this.classScopes.resolve(scope, principal);
      if (query.classId) await this.findClass(scope, classScope, query.classId);

      const where: Prisma.AttendanceRecordWhereInput = {
        schoolId: scope.schoolId,
        date: { gte: from, lte: to },
        ...(query.classId ? { session: { classId: query.classId } } : {}),
        ...(query.streamId ? { streamId: query.streamId } : {}),
        student: this.classScopes.studentFilter(classScope),
      };

      const [byDay, sessions] = await Promise.all([
        scope.tx.attendanceRecord.groupBy({
          by: ['date', 'status'],
          where,
          _count: { _all: true },
        }),
        scope.tx.attendanceRecord.groupBy({
          by: ['sessionId', 'status'],
          where,
          _count: { _all: true },
        }),
      ]);

      const totals = emptyTally();
      const days = new Map<string, Tally>();
      for (const row of byDay) {
        const key = formatCalendarDate(row.date);
        addToTally(
          days.get(key) ?? days.set(key, emptyTally()).get(key)!,
          row.status,
          row._count._all,
        );
        addToTally(totals, row.status, row._count._all);
      }

      const sessionClass = new Map(
        (
          await scope.tx.attendanceSession.findMany({
            where: { id: { in: [...new Set(sessions.map((row) => row.sessionId))] } },
            select: { id: true, class: { select: { id: true, name: true, level: true } } },
          })
        ).map((session) => [session.id, session.class]),
      );
      const classes = new Map<string, { class: string; level: number; tally: Tally }>();
      for (const row of sessions) {
        const schoolClass = sessionClass.get(row.sessionId);
        if (!schoolClass) continue;
        const entry =
          classes.get(schoolClass.id) ??
          classes
            .set(schoolClass.id, {
              class: schoolClass.name,
              level: schoolClass.level,
              tally: emptyTally(),
            })
            .get(schoolClass.id)!;
        addToTally(entry.tally, row.status, row._count._all);
      }

      return {
        from: query.from,
        to: query.to,
        totals,
        daily: [...days]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, tally]) => ({ date, ...tally })),
        byClass: [...classes]
          .sort(([, a], [, b]) => a.level - b.level || a.class.localeCompare(b.class))
          .map(([classId, entry]) => ({
            classId,
            class: entry.class,
            rate: entry.tally.rate,
            marked: entry.tally.marked,
          })),
        students: query.classId ? await this.perStudent(scope, where) : [],
      };
    });
  }

  monthly(
    principal: Principal,
    schoolId: string | undefined,
    query: MonthlyQueryDto,
  ): Promise<MonthlyRegister> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const { from, to } = monthBounds(query.month);
      const classScope = await this.classScopes.resolve(scope, principal);
      const schoolClass = await this.findClass(scope, classScope, query.classId);

      const records = await scope.tx.attendanceRecord.findMany({
        where: {
          schoolId: scope.schoolId,
          date: { gte: from, lte: to },
          session: { classId: query.classId },
          ...(query.streamId ? { streamId: query.streamId } : {}),
          student: this.classScopes.studentFilter(classScope),
        },
        select: {
          date: true,
          status: true,
          stream: { select: { name: true } },
          student: { select: STUDENT_NAME },
        },
        orderBy: { date: 'asc' },
      });

      const days = new Set<string>();
      const students = new Map<string, MonthlyRegister['students'][number]>();
      for (const record of records) {
        const day = formatCalendarDate(record.date);
        days.add(day);
        const entry =
          students.get(record.student.id) ??
          students
            .set(record.student.id, {
              student: refOf(record.student),
              stream: record.stream?.name ?? null,
              marks: {},
              ...emptyTally(),
            })
            .get(record.student.id)!;
        entry.marks[day] = record.status;
        addToTally(entry, record.status);
      }

      return {
        month: query.month,
        class: schoolClass,
        days: [...days].sort(),
        students: [...students.values()].sort(byName),
      };
    });
  }

  /** One learner's attendance, for staff who may see that learner. */
  student(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
    range: { from: string; to: string },
  ): Promise<StudentAttendance> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const classScope = await this.classScopes.resolve(scope, principal);
      const found = await scope.tx.student.count({
        where: {
          AND: [
            { id: studentId, schoolId: scope.schoolId },
            this.classScopes.studentFilter(classScope),
          ],
        },
      });
      if (found === 0)
        throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
      return this.forStudent(scope, studentId, range);
    });
  }

  /**
   * A learner's attendance, with no check on who is asking: callers must have
   * established that the learner is theirs to see. Shared with the portals.
   */
  async forStudent(
    scope: SchoolScope,
    studentId: string,
    range: { from: string; to: string },
  ): Promise<StudentAttendance> {
    const { from, to } = this.range(range.from, range.to);
    const records = await scope.tx.attendanceRecord.findMany({
      where: { schoolId: scope.schoolId, studentId, date: { gte: from, lte: to } },
      select: { date: true, status: true, note: true },
      orderBy: { date: 'desc' },
    });
    const totals = emptyTally();
    for (const record of records) addToTally(totals, record.status);
    return {
      from: range.from,
      to: range.to,
      totals,
      records: records.map((record) => ({
        date: formatCalendarDate(record.date),
        status: record.status,
        note: record.note,
      })),
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async loadRegister(
    scope: SchoolScope,
    classScope: ClassScope,
    query: { classId: string; streamId?: string; date: string },
  ): Promise<RegisterView> {
    const date = parseCalendarDate(query.date);
    const schoolClass = await this.findClass(scope, classScope, query.classId);
    const visible = this.classScopes.studentFilter(classScope);

    const [members, session] = await Promise.all([
      scope.tx.student.findMany({
        where: {
          AND: [
            {
              schoolId: scope.schoolId,
              status: 'ACTIVE',
              currentClassId: query.classId,
              ...(query.streamId ? { currentStreamId: query.streamId } : {}),
            },
            visible,
          ],
        },
        select: { ...STUDENT_NAME, currentStream: { select: { name: true } } },
      }),
      scope.tx.attendanceSession.findUnique({
        where: { classId_date: { classId: query.classId, date } },
        select: {
          updatedAt: true,
          records: {
            where: { ...(query.streamId ? { streamId: query.streamId } : {}), student: visible },
            select: {
              status: true,
              note: true,
              stream: { select: { name: true } },
              student: { select: STUDENT_NAME },
            },
          },
        },
      }),
    ]);

    const rows = new Map<string, RegisterView['students'][number]>(
      members.map((student) => [
        student.id,
        {
          student: refOf(student),
          stream: student.currentStream?.name ?? null,
          status: null,
          note: null,
        },
      ]),
    );
    // Learners marked that day stay on the register even if they have since
    // moved class or left, so a past register reads as it was taken.
    for (const record of session?.records ?? []) {
      rows.set(record.student.id, {
        student: refOf(record.student),
        stream: rows.get(record.student.id)?.stream ?? record.stream?.name ?? null,
        status: record.status,
        note: record.note,
      });
    }

    const students = [...rows.values()].sort(byName);
    const tally = emptyTally();
    for (const row of students) if (row.status) addToTally(tally, row.status);
    return {
      class: schoolClass,
      date: query.date,
      lastMarkedAt: session && session.records.length > 0 ? session.updatedAt.toISOString() : null,
      students,
      summary: { ...tally, unmarked: students.length - tally.marked },
    };
  }

  private async perStudent(
    scope: SchoolScope,
    where: Prisma.AttendanceRecordWhereInput,
  ): Promise<AttendanceSummary['students']> {
    const grouped = await scope.tx.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where,
      _count: { _all: true },
    });
    const tallies = new Map<string, Tally>();
    for (const row of grouped) {
      addToTally(
        tallies.get(row.studentId) ?? tallies.set(row.studentId, emptyTally()).get(row.studentId)!,
        row.status,
        row._count._all,
      );
    }
    const students = await scope.tx.student.findMany({
      where: { id: { in: [...tallies.keys()] } },
      select: { ...STUDENT_NAME, currentStream: { select: { name: true } } },
    });
    return students
      .map((student) => ({
        student: refOf(student),
        stream: student.currentStream?.name ?? null,
        ...(tallies.get(student.id) ?? emptyTally()),
      }))
      .sort(byName);
  }

  /** The class, if it exists and the caller teaches at least part of it. */
  private async findClass(
    scope: SchoolScope,
    classScope: ClassScope,
    classId: string,
  ): Promise<{ id: string; name: string }> {
    const schoolClass = await scope.tx.schoolClass.findFirst({
      where: { id: classId, schoolId: scope.schoolId },
      select: { id: true, name: true },
    });
    if (!schoolClass)
      throw new NotFoundException({ code: 'CLASS_NOT_FOUND', message: 'Class not found.' });
    if (!classScope.all && !classScope.placements.some((held) => held.classId === classId)) {
      throw new ForbiddenException({
        code: 'CLASS_NOT_ASSIGNED',
        message: 'You are not assigned to this class.',
      });
    }
    return schoolClass;
  }

  private range(fromText: string, toText: string): { from: Date; to: Date } {
    const from = parseCalendarDate(fromText);
    const to = parseCalendarDate(toText);
    const days = daysBetween(from, to);
    if (days < 1) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The start date must not be after the end date.',
      });
    }
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LONG',
        message: `A report can cover at most ${MAX_RANGE_DAYS} days.`,
      });
    }
    return { from, to };
  }

  /**
   * Attendance cannot be recorded ahead of time. The server works in UTC and
   * schools east of it start their day earlier, so "today" is allowed to run
   * one day ahead of the server's date.
   */
  private assertMarkable(date: Date): void {
    const latest = new Date();
    latest.setUTCHours(0, 0, 0, 0);
    latest.setUTCDate(latest.getUTCDate() + 1);
    if (date > latest) {
      throw new UnprocessableEntityException({
        code: 'DATE_IN_FUTURE',
        message: 'Attendance cannot be recorded for a future date.',
      });
    }
  }
}
