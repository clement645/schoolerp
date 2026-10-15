import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { paginate, toSkipTake, type Paginated } from '../../common/http/pagination.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import {
  parseStudentImport,
  toCsv,
  type ImportedStudent,
  type ImportProblem,
} from './students.csv.js';
import type {
  ChangeStudentStatusDto,
  CreateStudentDto,
  GuardianDetailsDto,
  LinkGuardianDto,
  PromoteStudentsDto,
  StudentFilterDto,
  StudentStatusValue,
  TransferStudentDto,
  UpdateGuardianLinkDto,
  UpdateStudentDto,
} from './students.dto.js';

const MAX_EXPORT_ROWS = 10_000;
const MAX_REPORTED_PROBLEMS = 100;

/** Statuses that mean the student is no longer at the school. */
const LEFT: readonly StudentStatusValue[] = ['TRANSFERRED', 'WITHDRAWN', 'GRADUATED'];
const hasLeft = (status: StudentStatusValue): boolean => LEFT.includes(status);

type Ref = { id: string; name: string };

export interface StudentSummary {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: string;
  admissionDate: string;
  status: StudentStatusValue;
  /** Whether a photograph is on file (served by GET /students/:id/photo). */
  hasPhoto: boolean;
  /** Current class, or the last one for a student who has left. */
  class: Ref | null;
  stream: Ref | null;
}

export interface GuardianView {
  guardianId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  occupation: string | null;
  address: string | null;
  relationship: string;
  isPrimary: boolean;
}

export interface EnrollmentView {
  id: string;
  academicYear: Ref;
  class: Ref;
  stream: Ref | null;
  reason: string;
  startDate: string;
  endDate: string | null;
}

export interface StudentDetail extends StudentSummary {
  nationality: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  leftOn: string | null;
  leavingReason: string | null;
  guardians: GuardianView[];
  /** Newest first. */
  enrollments: EnrollmentView[];
}

export interface ImportResult {
  /** Whether the students were actually created (false for a dry run). */
  imported: boolean;
  /** Students in the file that passed every check. */
  valid: number;
  problems: ImportProblem[];
  /** True when more problems exist than are listed. */
  problemsTruncated: boolean;
}

export interface PromotionResult {
  promoted: number;
  repeated: number;
  graduated: number;
}

const REF = { select: { id: true, name: true } } as const;

const SUMMARY_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  admissionDate: true,
  status: true,
  photoKey: true,
  currentClass: REF,
  currentStream: REF,
} satisfies Prisma.StudentSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  nationality: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
  leftOn: true,
  leavingReason: true,
  guardians: {
    select: { relationship: true, isPrimary: true, guardian: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  enrollments: {
    select: {
      id: true,
      reason: true,
      startDate: true,
      endDate: true,
      academicYear: REF,
      class: REF,
      stream: REF,
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.StudentSelect;

type SummaryRow = Prisma.StudentGetPayload<{ select: typeof SUMMARY_SELECT }>;
type DetailRow = Prisma.StudentGetPayload<{ select: typeof DETAIL_SELECT }>;

function toSummary(row: SummaryRow): StudentSummary {
  // The storage key itself never leaves the server.
  const { currentClass, currentStream, dateOfBirth, admissionDate, photoKey, ...rest } = row;
  return {
    ...rest,
    hasPhoto: photoKey !== null,
    dateOfBirth: formatCalendarDate(dateOfBirth),
    admissionDate: formatCalendarDate(admissionDate),
    class: currentClass,
    stream: currentStream,
  };
}

function toDetail(row: DetailRow): StudentDetail {
  const { guardians, enrollments, leftOn, ...rest } = row;
  return {
    ...toSummary(rest),
    nationality: rest.nationality,
    emergencyContactName: rest.emergencyContactName,
    emergencyContactPhone: rest.emergencyContactPhone,
    emergencyContactRelationship: rest.emergencyContactRelationship,
    leavingReason: rest.leavingReason,
    leftOn: leftOn ? formatCalendarDate(leftOn) : null,
    guardians: guardians.map(({ guardian, relationship, isPrimary }) => ({
      guardianId: guardian.id,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      phone: guardian.phone,
      email: guardian.email,
      occupation: guardian.occupation,
      address: guardian.address,
      relationship,
      isPrimary,
    })),
    enrollments: enrollments.map((enrollment) => ({
      ...enrollment,
      startDate: formatCalendarDate(enrollment.startDate),
      endDate: enrollment.endDate ? formatCalendarDate(enrollment.endDate) : null,
    })),
  };
}

const invalid = (code: string, message: string, details?: unknown) =>
  new BadRequestException({ code, message, ...(details === undefined ? {} : { details }) });
const conflict = (code: string, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });
const notFound = () =>
  new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });

const today = (): Date => parseCalendarDate(new Date().toISOString().slice(0, 10));
const later = (a: Date, b: Date): Date => (a > b ? a : b);

interface CurrentYear {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

interface NewStudent {
  admissionNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  nationality?: string | null;
  admissionDate: string;
  classId: string;
  streamId: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────────

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: StudentFilterDto,
  ): Promise<Paginated<StudentSummary>> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const where = await this.visibleWhere(scope, principal, query);
      const [rows, total] = await Promise.all([
        scope.tx.student.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: this.orderBy(query),
          ...toSkipTake(query),
        }),
        scope.tx.student.count({ where }),
      ]);
      return paginate(rows.map(toSummary), total, query);
    });
  }

  get(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<StudentDetail> {
    return this.scopes.run(principal, schoolId, async (scope) =>
      toDetail(await this.findVisible(scope, principal, studentId)),
    );
  }

  /** Exports the filtered directory as CSV. The export itself is audited. */
  exportCsv(actor: Actor, schoolId: string | undefined, query: StudentFilterDto): Promise<string> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const where = await this.visibleWhere(scope, actor.principal, query);
      const rows = await scope.tx.student.findMany({
        where,
        orderBy: this.orderBy(query),
        take: MAX_EXPORT_ROWS,
        select: {
          ...SUMMARY_SELECT,
          nationality: true,
          guardians: {
            where: { isPrimary: true },
            select: {
              relationship: true,
              guardian: { select: { firstName: true, lastName: true, phone: true } },
            },
          },
        },
      });

      await this.audit.record(
        {
          action: 'students.exported',
          resourceType: 'student',
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          actorId: actor.principal.userId,
          meta: actor.meta,
          details: {
            count: rows.length,
            filters: {
              search: query.search ?? null,
              classId: query.classId ?? null,
              streamId: query.streamId ?? null,
              status: query.status ?? null,
            },
          },
        },
        scope.tx,
      );

      return toCsv(
        [
          'Admission number',
          'First name',
          'Middle name',
          'Last name',
          'Gender',
          'Date of birth',
          'Nationality',
          'Admission date',
          'Class',
          'Stream',
          'Status',
          'Primary guardian',
          'Guardian phone',
          'Guardian relationship',
        ],
        rows.map((row) => {
          const primary = row.guardians[0];
          return [
            row.admissionNumber,
            row.firstName,
            row.middleName,
            row.lastName,
            row.gender,
            formatCalendarDate(row.dateOfBirth),
            row.nationality,
            formatCalendarDate(row.admissionDate),
            row.currentClass?.name ?? null,
            row.currentStream?.name ?? null,
            row.status,
            primary ? `${primary.guardian.firstName} ${primary.guardian.lastName}` : null,
            primary?.guardian.phone ?? null,
            primary?.relationship ?? null,
          ];
        }),
      );
    });
  }

  // ── Admission and editing ──────────────────────────────────────────────────

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateStudentDto,
  ): Promise<StudentDetail> {
    this.assertSensibleDates(dto.dateOfBirth, dto.admissionDate);
    if ((dto.guardians ?? []).filter((guardian) => guardian.isPrimary).length > 1) {
      throw invalid('MULTIPLE_PRIMARY_GUARDIANS', 'Only one guardian can be the primary contact.');
    }

    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const year = await this.currentYear(scope);
        await this.assertPlacement(scope, dto.classId, dto.streamId ?? null);

        const studentId = await this.insertStudent(scope, year, {
          ...dto,
          streamId: dto.streamId ?? null,
        });

        const guardians = dto.guardians ?? [];
        const anyPrimary = guardians.some((guardian) => guardian.isPrimary);
        for (const [index, { relationship, isPrimary, ...details }] of guardians.entries()) {
          const guardian = await scope.tx.guardian.create({
            data: {
              tenantId: scope.tenantId,
              schoolId: scope.schoolId,
              ...this.guardianData(details),
            },
            select: { id: true },
          });
          await scope.tx.studentGuardian.create({
            data: {
              tenantId: scope.tenantId,
              studentId,
              guardianId: guardian.id,
              relationship,
              // With no explicit choice, the first guardian listed is contacted first.
              isPrimary: anyPrimary ? isPrimary === true : index === 0,
            },
          });
        }

        await this.record(scope, actor, 'student.created', studentId, {
          admissionNumber: dto.admissionNumber,
          name: `${dto.firstName} ${dto.lastName}`,
          classId: dto.classId,
          streamId: dto.streamId ?? null,
        });
        return toDetail(await this.findById(scope, studentId));
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'Another student already has this admission number.' });
    }
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: UpdateStudentDto,
  ): Promise<StudentDetail> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.findById(scope, studentId);
        this.assertSensibleDates(
          dto.dateOfBirth ?? formatCalendarDate(before.dateOfBirth),
          dto.admissionDate ?? formatCalendarDate(before.admissionDate),
        );

        const { dateOfBirth, admissionDate, ...rest } = dto;
        await scope.tx.student.update({
          where: { id: studentId },
          data: {
            ...rest,
            ...(dateOfBirth ? { dateOfBirth: parseCalendarDate(dateOfBirth) } : {}),
            ...(admissionDate ? { admissionDate: parseCalendarDate(admissionDate) } : {}),
          },
        });
        const after = await this.findById(scope, studentId);

        // Record only what actually changed, so the log stays readable.
        const changed = (Object.keys(dto) as (keyof UpdateStudentDto)[]).filter(
          (key) => dto[key] !== undefined && String(before[key]) !== String(after[key]),
        );
        const snapshot = (row: DetailRow) =>
          Object.fromEntries(
            changed.map((key) => {
              const value = row[key];
              return [key, value instanceof Date ? formatCalendarDate(value) : value];
            }),
          );
        if (changed.length > 0) {
          await this.record(scope, actor, 'student.updated', studentId, {
            before: snapshot(before),
            after: snapshot(after),
          });
        }
        return toDetail(after);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'Another student already has this admission number.' });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Moves a student to another class or stream within the school. */
  transfer(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: TransferStudentDto,
  ): Promise<StudentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const student = await this.findById(scope, studentId);
      if (hasLeft(student.status)) {
        throw conflict(
          'STUDENT_HAS_LEFT',
          'This student has left the school. Re-admit them first.',
        );
      }
      const streamId = dto.streamId ?? null;
      if (
        student.currentClass?.id === dto.classId &&
        (student.currentStream?.id ?? null) === streamId
      ) {
        throw invalid('SAME_PLACEMENT', 'The student is already in this class and stream.');
      }
      await this.assertPlacement(scope, dto.classId, streamId);
      const year = await this.currentYear(scope);
      const effective = dto.effectiveDate ? parseCalendarDate(dto.effectiveDate) : today();

      const startDate = await this.closeOpenEnrollment(scope, studentId, effective);
      await scope.tx.enrollment.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          studentId,
          academicYearId: year.id,
          classId: dto.classId,
          streamId,
          reason: 'TRANSFER',
          startDate,
        },
      });
      await scope.tx.student.update({
        where: { id: studentId },
        data: { currentClassId: dto.classId, currentStreamId: streamId },
      });

      const after = await this.findById(scope, studentId);
      const placement = (row: DetailRow) => ({
        class: row.currentClass?.name ?? null,
        stream: row.currentStream?.name ?? null,
      });
      await this.record(scope, actor, 'student.transferred', studentId, {
        before: placement(student),
        after: placement(after),
      });
      return toDetail(after);
    });
  }

  /**
   * Suspends, reinstates, re-admits a student, or records that they have left
   * (transferred out, withdrawn or graduated). Leaving closes their enrolment;
   * the record itself is kept.
   */
  changeStatus(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: ChangeStudentStatusDto,
  ): Promise<StudentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const student = await this.findById(scope, studentId);
      if (student.status === dto.status) {
        throw invalid('STATUS_UNCHANGED', 'The student already has this status.');
      }
      const effective = dto.effectiveDate ? parseCalendarDate(dto.effectiveDate) : today();
      if (effective > today()) {
        throw invalid('FUTURE_DATE', 'The effective date cannot be in the future.');
      }

      if (hasLeft(dto.status)) {
        if (hasLeft(student.status)) {
          throw conflict('STUDENT_HAS_LEFT', 'This student has already left the school.');
        }
        const leftOn = later(effective, student.admissionDate);
        await this.closeOpenEnrollment(scope, studentId, leftOn);
        await scope.tx.student.update({
          where: { id: studentId },
          data: { status: dto.status, leftOn, leavingReason: dto.reason ?? null },
        });
      } else if (hasLeft(student.status)) {
        if (dto.status !== 'ACTIVE') {
          throw invalid('READMIT_FIRST', 'A student who has left must be re-admitted as active.');
        }
        if (!dto.classId) {
          throw invalid('CLASS_REQUIRED', 'Choose the class the student is re-admitted into.');
        }
        const streamId = dto.streamId ?? null;
        await this.assertPlacement(scope, dto.classId, streamId);
        const year = await this.currentYear(scope);
        await scope.tx.enrollment.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            studentId,
            academicYearId: year.id,
            classId: dto.classId,
            streamId,
            reason: 'READMISSION',
            startDate: later(effective, student.leftOn ?? effective),
          },
        });
        await scope.tx.student.update({
          where: { id: studentId },
          data: {
            status: 'ACTIVE',
            leftOn: null,
            leavingReason: null,
            currentClassId: dto.classId,
            currentStreamId: streamId,
          },
        });
      } else {
        // Between ACTIVE and SUSPENDED: the placement is unaffected.
        await scope.tx.student.update({ where: { id: studentId }, data: { status: dto.status } });
      }

      await this.record(scope, actor, 'student.status.changed', studentId, {
        before: student.status,
        after: dto.status,
        effectiveDate: formatCalendarDate(effective),
        reason: dto.reason ?? null,
      });
      return toDetail(await this.findById(scope, studentId));
    });
  }

  /**
   * Moves a group of students into a new academic year: up a class, repeating
   * the same class, or graduating. Old enrolments end with their academic
   * year and new ones begin with the target year, all in one transaction.
   */
  promote(
    actor: Actor,
    schoolId: string | undefined,
    dto: PromoteStudentsDto,
  ): Promise<PromotionResult> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const targetYear = await scope.tx.academicYear.findFirst({
        where: { id: dto.toAcademicYearId, schoolId: scope.schoolId },
        select: { id: true, name: true, startDate: true },
      });
      if (!targetYear)
        throw invalid('UNKNOWN_ACADEMIC_YEAR', 'The target academic year does not exist.');

      const toClassId = dto.toClassId ?? null;
      const targetClass = toClassId
        ? await scope.tx.schoolClass.findFirst({
            where: { id: toClassId, schoolId: scope.schoolId, isActive: true },
            select: { id: true, name: true, streams: REF },
          })
        : null;
      if (toClassId && !targetClass) {
        throw invalid('UNKNOWN_CLASS', 'The target class does not exist or is inactive.');
      }

      const students = await scope.tx.student.findMany({
        where: { id: { in: dto.studentIds }, schoolId: scope.schoolId },
        select: {
          id: true,
          status: true,
          currentClassId: true,
          currentStream: REF,
          enrollments: {
            where: { endDate: null },
            select: {
              id: true,
              startDate: true,
              academicYearId: true,
              academicYear: { select: { endDate: true } },
            },
          },
        },
      });
      if (students.length !== dto.studentIds.length) {
        throw invalid('UNKNOWN_STUDENT', 'One or more students do not exist in this school.');
      }

      const ineligible = students.filter(
        (student) =>
          student.currentClassId !== dto.fromClassId ||
          hasLeft(student.status) ||
          student.enrollments.length !== 1,
      );
      if (ineligible.length > 0) {
        throw conflict(
          'NOT_IN_CLASS',
          'Some of the selected students are no longer active in this class. Refresh and try again.',
          { studentIds: ineligible.map((student) => student.id) },
        );
      }
      const alreadyMoved = students.filter(
        (student) => student.enrollments[0]?.academicYearId === targetYear.id,
      );
      if (alreadyMoved.length > 0) {
        throw conflict(
          'ALREADY_IN_TARGET_YEAR',
          `Some of the selected students are already enrolled in ${targetYear.name}.`,
          { studentIds: alreadyMoved.map((student) => student.id) },
        );
      }

      const repeating = targetClass?.id === dto.fromClassId;
      const result: PromotionResult = { promoted: 0, repeated: 0, graduated: 0 };

      for (const student of students) {
        const open = student.enrollments[0];
        if (!open) continue;
        // The old placement ends with its academic year, but never before it began.
        const endDate = later(open.academicYear.endDate, open.startDate);
        await scope.tx.enrollment.update({ where: { id: open.id }, data: { endDate } });

        if (!targetClass) {
          await scope.tx.student.update({
            where: { id: student.id },
            data: { status: 'GRADUATED', leftOn: endDate, leavingReason: 'Graduated' },
          });
          result.graduated += 1;
          continue;
        }

        // Keep learners in the stream of the same name where the next class has one.
        const stream =
          targetClass.streams.find((entry) => entry.name === student.currentStream?.name) ?? null;
        await scope.tx.enrollment.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            studentId: student.id,
            academicYearId: targetYear.id,
            classId: targetClass.id,
            streamId: stream?.id ?? null,
            reason: repeating ? 'REPEAT' : 'PROMOTION',
            startDate: later(targetYear.startDate, endDate),
          },
        });
        await scope.tx.student.update({
          where: { id: student.id },
          data: { currentClassId: targetClass.id, currentStreamId: stream?.id ?? null },
        });
        if (repeating) result.repeated += 1;
        else result.promoted += 1;
      }

      await this.audit.recordMany(
        students.map((student) => ({
          action: 'student.promoted' as const,
          resourceType: 'student',
          resourceId: student.id,
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          actorId: actor.principal.userId,
          meta: actor.meta,
          details: {
            toAcademicYear: targetYear.name,
            outcome: targetClass ? (repeating ? 'REPEAT' : 'PROMOTION') : 'GRADUATED',
            toClass: targetClass?.name ?? null,
          },
        })),
        scope.tx,
      );
      return result;
    });
  }

  // ── Guardians ──────────────────────────────────────────────────────────────

  /** Finds guardians already on record, e.g. to link a sibling's parent. */
  searchGuardians(
    principal: Principal,
    schoolId: string | undefined,
    search: string,
  ): Promise<
    { id: string; firstName: string; lastName: string; phone: string; students: string[] }[]
  > {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const term = search.trim();
      if (term.length < 2) return [];
      const guardians = await scope.tx.guardian.findMany({
        where: {
          schoolId: scope.schoolId,
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          students: {
            select: { student: { select: { firstName: true, lastName: true } } },
            take: 5,
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 10,
      });
      return guardians.map(({ students, ...guardian }) => ({
        ...guardian,
        students: students.map(({ student }) => `${student.firstName} ${student.lastName}`),
      }));
    });
  }

  async addGuardian(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: LinkGuardianDto,
  ): Promise<StudentDetail> {
    if (Boolean(dto.guardianId) === Boolean(dto.details)) {
      throw invalid('GUARDIAN_INPUT', 'Either choose an existing guardian or enter a new one.');
    }
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const student = await this.findById(scope, studentId);

        let guardianId = dto.guardianId;
        if (guardianId) {
          const existing = await scope.tx.guardian.findFirst({
            where: { id: guardianId, schoolId: scope.schoolId },
            select: { id: true },
          });
          if (!existing)
            throw invalid('UNKNOWN_GUARDIAN', 'That guardian does not exist in this school.');
        } else if (dto.details) {
          const created = await scope.tx.guardian.create({
            data: {
              tenantId: scope.tenantId,
              schoolId: scope.schoolId,
              ...this.guardianData(dto.details),
            },
            select: { id: true },
          });
          guardianId = created.id;
        }
        if (!guardianId) throw invalid('GUARDIAN_INPUT', 'Guardian details are required.');

        // A student's first guardian is their primary contact by default.
        const isPrimary = dto.isPrimary ?? student.guardians.length === 0;
        if (isPrimary) await this.clearPrimary(scope, studentId);
        await scope.tx.studentGuardian.create({
          data: {
            tenantId: scope.tenantId,
            studentId,
            guardianId,
            relationship: dto.relationship,
            isPrimary,
          },
        });

        await this.record(scope, actor, 'student.guardian.added', studentId, {
          guardianId,
          relationship: dto.relationship,
        });
        return toDetail(await this.findById(scope, studentId));
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'This guardian is already linked to the student.' });
    }
  }

  updateGuardian(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    guardianId: string,
    dto: UpdateGuardianLinkDto,
  ): Promise<StudentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const link = await this.findLink(scope, studentId, guardianId);

      if (dto.details) {
        // Contact details belong to the guardian, so they change for siblings too.
        await scope.tx.guardian.update({
          where: { id: guardianId },
          data: this.guardianData(dto.details),
        });
      }
      if (dto.isPrimary === true && !link.isPrimary) await this.clearPrimary(scope, studentId);
      await scope.tx.studentGuardian.update({
        where: { studentId_guardianId: { studentId, guardianId } },
        data: { relationship: dto.relationship, isPrimary: dto.isPrimary },
      });

      await this.record(scope, actor, 'student.guardian.updated', studentId, { guardianId });
      return toDetail(await this.findById(scope, studentId));
    });
  }

  /** Unlinks a guardian from a student; the guardian stays on record for siblings. */
  removeGuardian(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    guardianId: string,
  ): Promise<StudentDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const link = await this.findLink(scope, studentId, guardianId);
      await scope.tx.studentGuardian.delete({
        where: { studentId_guardianId: { studentId, guardianId } },
      });

      // Never leave a student with guardians but no primary contact.
      if (link.isPrimary) {
        const next = await scope.tx.studentGuardian.findFirst({
          where: { studentId },
          orderBy: { createdAt: 'asc' },
          select: { guardianId: true },
        });
        if (next) {
          await scope.tx.studentGuardian.update({
            where: { studentId_guardianId: { studentId, guardianId: next.guardianId } },
            data: { isPrimary: true },
          });
        }
      }
      // A guardian linked to nobody is personal data with no purpose.
      const remaining = await scope.tx.studentGuardian.count({ where: { guardianId } });
      if (remaining === 0) await scope.tx.guardian.delete({ where: { id: guardianId } });

      await this.record(scope, actor, 'student.guardian.removed', studentId, { guardianId });
      return toDetail(await this.findById(scope, studentId));
    });
  }

  // ── Bulk import ────────────────────────────────────────────────────────────

  /**
   * Imports students from CSV. The file is accepted only as a whole: if any
   * row has a problem nothing is created and every problem is reported. With
   * `dryRun` the file is checked the same way but never written.
   */
  async importCsv(
    actor: Actor,
    schoolId: string | undefined,
    content: string,
    dryRun: boolean,
  ): Promise<ImportResult> {
    const parsed = parseStudentImport(content);

    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const problems = [...parsed.problems];
      const year = await this.currentYear(scope);

      const classes = await scope.tx.schoolClass.findMany({
        where: { schoolId: scope.schoolId, isActive: true },
        select: { id: true, name: true, streams: REF },
      });
      const classByName = new Map(classes.map((entry) => [entry.name.toLowerCase(), entry]));

      const taken = new Set(
        (
          await scope.tx.student.findMany({
            where: {
              schoolId: scope.schoolId,
              admissionNumber: {
                in: parsed.students.map((s) => s.admissionNumber),
                mode: 'insensitive',
              },
            },
            select: { admissionNumber: true },
          })
        ).map((student) => student.admissionNumber.toLowerCase()),
      );

      const ready: { student: ImportedStudent; classId: string; streamId: string | null }[] = [];
      for (const student of parsed.students) {
        const fail = (message: string) => problems.push({ row: student.row, message });
        if (taken.has(student.admissionNumber.toLowerCase())) {
          fail(`A student with admission number "${student.admissionNumber}" already exists.`);
          continue;
        }
        const schoolClass = classByName.get(student.className.toLowerCase());
        if (!schoolClass) {
          fail(`Class "${student.className}" does not exist. Create it first or correct the name.`);
          continue;
        }
        let streamId: string | null = null;
        if (student.streamName) {
          const stream = schoolClass.streams.find(
            (entry) => entry.name.toLowerCase() === student.streamName?.toLowerCase(),
          );
          if (!stream) {
            fail(`Class "${schoolClass.name}" has no stream "${student.streamName}".`);
            continue;
          }
          streamId = stream.id;
        }
        ready.push({ student, classId: schoolClass.id, streamId });
      }

      problems.sort((a, b) => a.row - b.row);
      const result: ImportResult = {
        imported: false,
        valid: ready.length,
        problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
        problemsTruncated: problems.length > MAX_REPORTED_PROBLEMS,
      };
      if (dryRun || problems.length > 0) return result;

      // Siblings in one file, or already at the school, share a guardian record.
      const guardianIds = new Map<string, string>();
      const guardianKey = (g: NonNullable<ImportedStudent['guardian']>) =>
        `${g.phone.replace(/\s/g, '')}|${g.firstName.toLowerCase()}|${g.lastName.toLowerCase()}`;

      for (const { student, classId, streamId } of ready) {
        const studentId = await this.insertStudent(scope, year, { ...student, classId, streamId });

        if (student.guardian) {
          const key = guardianKey(student.guardian);
          let guardianId = guardianIds.get(key);
          if (!guardianId) {
            const existing = await scope.tx.guardian.findFirst({
              where: {
                schoolId: scope.schoolId,
                phone: student.guardian.phone,
                firstName: { equals: student.guardian.firstName, mode: 'insensitive' },
                lastName: { equals: student.guardian.lastName, mode: 'insensitive' },
              },
              select: { id: true },
            });
            guardianId =
              existing?.id ??
              (
                await scope.tx.guardian.create({
                  data: {
                    tenantId: scope.tenantId,
                    schoolId: scope.schoolId,
                    firstName: student.guardian.firstName,
                    lastName: student.guardian.lastName,
                    phone: student.guardian.phone,
                  },
                  select: { id: true },
                })
              ).id;
            guardianIds.set(key, guardianId);
          }
          await scope.tx.studentGuardian.create({
            data: {
              tenantId: scope.tenantId,
              studentId,
              guardianId,
              relationship: student.guardian.relationship,
              isPrimary: true,
            },
          });
        }
      }

      await this.audit.record(
        {
          action: 'students.imported',
          resourceType: 'student',
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          actorId: actor.principal.userId,
          meta: actor.meta,
          details: { count: ready.length, academicYear: year.name },
        },
        scope.tx,
      );
      return { ...result, imported: true };
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async insertStudent(
    scope: SchoolScope,
    year: CurrentYear,
    input: NewStudent,
  ): Promise<string> {
    const admissionDate = parseCalendarDate(input.admissionDate);
    const student = await scope.tx.student.create({
      data: {
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        admissionNumber: input.admissionNumber,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName,
        dateOfBirth: parseCalendarDate(input.dateOfBirth),
        gender: input.gender,
        nationality: input.nationality ?? null,
        admissionDate,
        currentClassId: input.classId,
        currentStreamId: input.streamId,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        emergencyContactRelationship: input.emergencyContactRelationship ?? null,
      },
      select: { id: true },
    });
    await scope.tx.enrollment.create({
      data: {
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        studentId: student.id,
        academicYearId: year.id,
        classId: input.classId,
        streamId: input.streamId,
        reason: 'ADMISSION',
        // A student admitted in an earlier year starts this year's placement
        // when the year does, not on their original admission date.
        startDate: later(admissionDate, year.startDate),
      },
    });
    return student.id;
  }

  private guardianData(details: GuardianDetailsDto) {
    return {
      firstName: details.firstName,
      lastName: details.lastName,
      phone: details.phone,
      email: details.email ?? null,
      occupation: details.occupation ?? null,
      address: details.address ?? null,
    };
  }

  private async clearPrimary(scope: SchoolScope, studentId: string): Promise<void> {
    await scope.tx.studentGuardian.updateMany({
      where: { studentId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  /**
   * Ends the student's open enrolment on `on` (never before it started) and
   * returns the date the next placement begins.
   */
  private async closeOpenEnrollment(
    scope: SchoolScope,
    studentId: string,
    on: Date,
  ): Promise<Date> {
    const open = await scope.tx.enrollment.findFirst({
      where: { studentId, endDate: null },
      select: { id: true, startDate: true },
    });
    if (!open) return on;
    const endDate = later(on, open.startDate);
    await scope.tx.enrollment.update({ where: { id: open.id }, data: { endDate } });
    return endDate;
  }

  private async currentYear(scope: SchoolScope): Promise<CurrentYear> {
    const year = await scope.tx.academicYear.findFirst({
      where: { schoolId: scope.schoolId, isCurrent: true },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    if (!year) {
      throw conflict(
        'NO_CURRENT_ACADEMIC_YEAR',
        'Set the current academic year in School Settings before enrolling students.',
      );
    }
    return year;
  }

  private async assertPlacement(
    scope: SchoolScope,
    classId: string,
    streamId: string | null,
  ): Promise<void> {
    const schoolClass = await scope.tx.schoolClass.findFirst({
      where: { id: classId, schoolId: scope.schoolId },
      select: { isActive: true, streams: { select: { id: true } } },
    });
    if (!schoolClass)
      throw invalid('UNKNOWN_CLASS', 'The selected class does not exist in this school.');
    if (!schoolClass.isActive) throw invalid('INACTIVE_CLASS', 'The selected class is inactive.');
    if (streamId && !schoolClass.streams.some((stream) => stream.id === streamId)) {
      throw invalid('UNKNOWN_STREAM', 'The selected stream does not belong to that class.');
    }
    if (!streamId && schoolClass.streams.length > 0) {
      throw invalid(
        'STREAM_REQUIRED',
        'This class has streams. Choose the stream the student joins.',
      );
    }
  }

  private assertSensibleDates(dateOfBirth: string, admissionDate: string): void {
    const now = new Date().toISOString().slice(0, 10);
    if (dateOfBirth >= admissionDate) {
      throw invalid('INVALID_DATES', 'The date of birth must be before the admission date.');
    }
    if (admissionDate > now) {
      throw invalid('INVALID_DATES', 'The admission date cannot be in the future.');
    }
    if (dateOfBirth < '1950-01-01') {
      throw invalid('INVALID_DATES', 'Check the date of birth.');
    }
  }

  /** The filter for a directory query, already narrowed to the caller's classes. */
  private async visibleWhere(
    scope: SchoolScope,
    principal: Principal,
    query: StudentFilterDto,
  ): Promise<Prisma.StudentWhereInput> {
    const classScope = await this.classScopes.resolve(scope, principal);
    const words = (query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5);

    return {
      AND: [
        { schoolId: scope.schoolId },
        this.classScopes.studentFilter(classScope),
        query.classId ? { currentClassId: query.classId } : {},
        query.streamId ? { currentStreamId: query.streamId } : {},
        query.status ? { status: query.status } : {},
        query.gender ? { gender: query.gender } : {},
        // Every word must match somewhere, so "amina otieno" finds one person.
        ...words.map((word) => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { middleName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
            { admissionNumber: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
      ],
    };
  }

  private orderBy(query: StudentFilterDto): Prisma.StudentOrderByWithRelationInput[] {
    const { order } = query;
    const byName: Prisma.StudentOrderByWithRelationInput[] = [
      { lastName: order },
      { firstName: order },
      { id: 'asc' },
    ];
    switch (query.sort) {
      case 'admissionNumber':
        return [{ admissionNumber: order }, { id: 'asc' }];
      case 'admissionDate':
        return [{ admissionDate: order }, { id: 'asc' }];
      case 'class':
        return [{ currentClass: { level: order } }, { currentStream: { name: order } }, ...byName];
      default:
        return byName;
    }
  }

  /** Loads a student the caller is allowed to see; anything else is "not found". */
  private async findVisible(
    scope: SchoolScope,
    principal: Principal,
    studentId: string,
  ): Promise<DetailRow> {
    const classScope = await this.classScopes.resolve(scope, principal);
    const student = await scope.tx.student.findFirst({
      where: {
        AND: [
          { id: studentId, schoolId: scope.schoolId },
          this.classScopes.studentFilter(classScope),
        ],
      },
      select: DETAIL_SELECT,
    });
    if (!student) throw notFound();
    return student;
  }

  /** For management actions, which already require a school-wide permission. */
  private async findById(scope: SchoolScope, studentId: string): Promise<DetailRow> {
    const student = await scope.tx.student.findFirst({
      where: { id: studentId, schoolId: scope.schoolId },
      select: DETAIL_SELECT,
    });
    if (!student) throw notFound();
    return student;
  }

  private async findLink(scope: SchoolScope, studentId: string, guardianId: string) {
    await this.findById(scope, studentId);
    const link = await scope.tx.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId, guardianId } },
      select: { isPrimary: true },
    });
    if (!link) {
      throw new NotFoundException({
        code: 'GUARDIAN_NOT_FOUND',
        message: 'This guardian is not linked to the student.',
      });
    }
    return link;
  }

  private record(
    scope: SchoolScope,
    actor: Actor,
    action: AuditAction,
    studentId: string,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'student',
        resourceId: studentId,
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        actorId: actor.principal.userId,
        meta: actor.meta,
        details,
      },
      scope.tx,
    );
  }
}
