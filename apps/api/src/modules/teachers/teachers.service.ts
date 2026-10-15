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
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import type {
  CreateAssignmentDto,
  CreateTeacherDto,
  TeacherFilterDto,
  UpdateTeacherDto,
} from './teachers.dto.js';

type Ref = { id: string; name: string };

export interface AssignmentView {
  id: string;
  kind: 'SUBJECT_TEACHER' | 'CLASS_TEACHER';
  academicYear: Ref & { isCurrent: boolean };
  class: Ref;
  /** Null means the whole class. */
  stream: Ref | null;
  subject: (Ref & { code: string }) | null;
}

export interface TeacherSummary {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** The linked login account, if any. */
  user: { id: string; email: string } | null;
}

export interface TeacherDetail extends TeacherSummary {
  registrationNumber: string | null;
  employmentDate: string | null;
  /** Current year first, then by class. */
  assignments: AssignmentView[];
}

export interface WorkloadRow {
  teacher: { id: string; name: string; staffNumber: string };
  /** Subject-teaching assignments (one per subject per class or stream). */
  teachingAssignments: number;
  subjects: string[];
  classes: string[];
  classTeacherOf: string[];
}

export interface Workload {
  academicYear: Ref | null;
  rows: WorkloadRow[];
}

const REF = { select: { id: true, name: true } } as const;

const SUMMARY_SELECT = {
  id: true,
  staffNumber: true,
  firstName: true,
  lastName: true,
  gender: true,
  phone: true,
  email: true,
  status: true,
  user: { select: { id: true, email: true } },
} satisfies Prisma.TeacherSelect;

const ASSIGNMENT_SELECT = {
  id: true,
  kind: true,
  academicYear: { select: { id: true, name: true, isCurrent: true } },
  class: { select: { id: true, name: true, level: true } },
  stream: REF,
  subject: { select: { id: true, name: true, code: true } },
} satisfies Prisma.TeacherAssignmentSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  registrationNumber: true,
  employmentDate: true,
  assignments: {
    select: ASSIGNMENT_SELECT,
    orderBy: [
      { academicYear: { startDate: 'desc' } },
      { class: { level: 'asc' } },
      { kind: 'asc' },
    ],
  },
} satisfies Prisma.TeacherSelect;

type DetailRow = Prisma.TeacherGetPayload<{ select: typeof DETAIL_SELECT }>;
type AssignmentRow = Prisma.TeacherAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

const toAssignment = ({ class: schoolClass, ...assignment }: AssignmentRow): AssignmentView => ({
  ...assignment,
  class: { id: schoolClass.id, name: schoolClass.name },
});

const toDetail = ({ assignments, employmentDate, ...teacher }: DetailRow): TeacherDetail => ({
  ...teacher,
  employmentDate: employmentDate ? formatCalendarDate(employmentDate) : null,
  assignments: assignments.map(toAssignment),
});

/** "Grade 7 East", or just "Grade 7" for a whole class. */
const placementLabel = (schoolClass: { name: string }, stream: { name: string } | null): string =>
  stream ? `${schoolClass.name} ${stream.name}` : schoolClass.name;

const invalid = (code: string, message: string) => new BadRequestException({ code, message });
const notFound = () =>
  new NotFoundException({ code: 'TEACHER_NOT_FOUND', message: 'Teacher not found.' });

const DUPLICATE =
  'Another teacher already has this staff number, or that account is already linked.';

@Injectable()
export class TeachersService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: TeacherFilterDto,
  ): Promise<Paginated<TeacherSummary>> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const words = (query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const where: Prisma.TeacherWhereInput = {
        AND: [
          { schoolId: id },
          query.status ? { status: query.status } : {},
          ...words.map((word) => ({
            OR: [
              { firstName: { contains: word, mode: 'insensitive' as const } },
              { lastName: { contains: word, mode: 'insensitive' as const } },
              { staffNumber: { contains: word, mode: 'insensitive' as const } },
            ],
          })),
        ],
      };
      const [rows, total] = await Promise.all([
        tx.teacher.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.teacher.count({ where }),
      ]);
      return paginate(rows, total, query);
    });
  }

  get(
    principal: Principal,
    schoolId: string | undefined,
    teacherId: string,
  ): Promise<TeacherDetail> {
    return this.scopes.run(principal, schoolId, async (scope) =>
      toDetail(await this.find(scope, teacherId)),
    );
  }

  /** The staff profile linked to the caller's own account, if there is one. */
  getOwn(principal: Principal, schoolId: string | undefined): Promise<TeacherDetail | null> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const teacher = await tx.teacher.findFirst({
        where: { schoolId: id, userId: principal.userId },
        select: DETAIL_SELECT,
      });
      return teacher ? toDetail(teacher) : null;
    });
  }

  /** Active accounts of this tenant that are not yet linked to a staff profile. */
  linkableUsers(
    principal: Principal,
    schoolId: string | undefined,
  ): Promise<{ id: string; name: string; email: string }[]> {
    return this.scopes.run(principal, schoolId, async ({ tx }) => {
      const users = await tx.user.findMany({
        where: {
          status: 'ACTIVE',
          teacher: null,
          roles: { some: { role: { key: { in: ['TEACHER', 'CLASS_TEACHER'] } } } },
        },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 200,
      });
      return users.map((user) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
      }));
    });
  }

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateTeacherDto,
  ): Promise<TeacherDetail> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        await this.assertUserInTenant(scope, dto.userId);
        const { employmentDate, ...rest } = dto;
        const teacher = await scope.tx.teacher.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            ...rest,
            employmentDate: employmentDate ? parseCalendarDate(employmentDate) : null,
          },
          select: DETAIL_SELECT,
        });
        await this.record(scope, actor, 'teacher.created', teacher.id, {
          staffNumber: teacher.staffNumber,
          name: `${teacher.firstName} ${teacher.lastName}`,
        });
        return toDetail(teacher);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    teacherId: string,
    dto: UpdateTeacherDto,
  ): Promise<TeacherDetail> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.find(scope, teacherId);
        await this.assertUserInTenant(scope, dto.userId);

        const { employmentDate, ...rest } = dto;
        const after = await scope.tx.teacher.update({
          where: { id: teacherId },
          data: {
            ...rest,
            ...(employmentDate === undefined
              ? {}
              : { employmentDate: employmentDate ? parseCalendarDate(employmentDate) : null }),
          },
          select: DETAIL_SELECT,
        });

        const pick = (row: DetailRow) => ({
          staffNumber: row.staffNumber,
          name: `${row.firstName} ${row.lastName}`,
          status: row.status,
          linkedAccount: row.user?.email ?? null,
        });
        await this.record(scope, actor, 'teacher.updated', teacherId, {
          before: pick(before),
          after: pick(after),
        });
        return toDetail(after);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  async addAssignment(
    actor: Actor,
    schoolId: string | undefined,
    teacherId: string,
    dto: CreateAssignmentDto,
  ): Promise<TeacherDetail> {
    const isSubject = dto.kind === 'SUBJECT_TEACHER';
    if (isSubject && !dto.subjectId) {
      throw invalid('SUBJECT_REQUIRED', 'Choose the subject this teacher will teach.');
    }
    const subjectId = isSubject ? (dto.subjectId ?? null) : null;
    const streamId = dto.streamId ?? null;

    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const teacher = await this.find(scope, teacherId);
        if (teacher.status !== 'ACTIVE') {
          throw invalid('TEACHER_INACTIVE', 'An inactive teacher cannot be given new assignments.');
        }

        const year = await scope.tx.academicYear.findFirst({
          where: {
            schoolId: scope.schoolId,
            ...(dto.academicYearId ? { id: dto.academicYearId } : { isCurrent: true }),
          },
          select: { id: true, name: true },
        });
        if (!year) {
          throw invalid(
            'UNKNOWN_ACADEMIC_YEAR',
            dto.academicYearId
              ? 'The selected academic year does not exist.'
              : 'Set the current academic year in School Settings first.',
          );
        }

        const schoolClass = await scope.tx.schoolClass.findFirst({
          where: { id: dto.classId, schoolId: scope.schoolId },
          select: {
            name: true,
            streams: REF,
            subjects: { select: { subjectId: true, subject: { select: { name: true } } } },
          },
        });
        if (!schoolClass) throw invalid('UNKNOWN_CLASS', 'The selected class does not exist.');
        const stream = streamId ? schoolClass.streams.find((entry) => entry.id === streamId) : null;
        if (streamId && !stream) {
          throw invalid('UNKNOWN_STREAM', 'The selected stream does not belong to that class.');
        }
        const taught = schoolClass.subjects.find((entry) => entry.subjectId === subjectId);
        if (isSubject && !taught) {
          throw invalid(
            'SUBJECT_NOT_TAUGHT',
            `That subject is not taught in ${schoolClass.name}. Add it on the Classes page first.`,
          );
        }

        const assignment = await scope.tx.teacherAssignment.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            teacherId,
            academicYearId: year.id,
            classId: dto.classId,
            streamId,
            subjectId,
            kind: dto.kind,
          },
          select: { id: true },
        });
        await this.record(scope, actor, 'teacher.assignment.added', teacherId, {
          assignmentId: assignment.id,
          kind: dto.kind,
          academicYear: year.name,
          class: placementLabel(schoolClass, stream ?? null),
          subject: taught?.subject.name ?? null,
        });
        return toDetail(await this.find(scope, teacherId));
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE',
          message: isSubject
            ? 'This teacher already teaches that subject to that class.'
            : 'That class or stream already has a class teacher for this academic year.',
        });
      }
      throw error;
    }
  }

  removeAssignment(
    actor: Actor,
    schoolId: string | undefined,
    teacherId: string,
    assignmentId: string,
  ): Promise<TeacherDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const teacher = await this.find(scope, teacherId);
      const assignment = teacher.assignments.find((entry) => entry.id === assignmentId);
      if (!assignment) {
        throw new NotFoundException({
          code: 'ASSIGNMENT_NOT_FOUND',
          message: 'Assignment not found.',
        });
      }
      await scope.tx.teacherAssignment.delete({ where: { id: assignmentId } });
      await this.record(scope, actor, 'teacher.assignment.removed', teacherId, {
        assignmentId,
        kind: assignment.kind,
        academicYear: assignment.academicYear.name,
        class: placementLabel(assignment.class, assignment.stream),
        subject: assignment.subject?.name ?? null,
      });
      return toDetail(await this.find(scope, teacherId));
    });
  }

  /** What each active teacher is responsible for in an academic year. */
  workload(
    principal: Principal,
    schoolId: string | undefined,
    academicYearId: string | undefined,
  ): Promise<Workload> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const year = await tx.academicYear.findFirst({
        where: { schoolId: id, ...(academicYearId ? { id: academicYearId } : { isCurrent: true }) },
        select: { id: true, name: true },
      });
      if (!year) return { academicYear: null, rows: [] };

      const teachers = await tx.teacher.findMany({
        where: { schoolId: id, status: 'ACTIVE' },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          staffNumber: true,
          assignments: {
            where: { academicYearId: year.id },
            select: {
              kind: true,
              class: { select: { name: true, level: true } },
              stream: REF,
              subject: REF,
            },
            orderBy: [{ class: { level: 'asc' } }],
          },
        },
      });

      const unique = (values: string[]): string[] => [...new Set(values)];
      return {
        academicYear: year,
        rows: teachers.map((teacher) => {
          const teaching = teacher.assignments.filter((a) => a.kind === 'SUBJECT_TEACHER');
          const pastoral = teacher.assignments.filter((a) => a.kind === 'CLASS_TEACHER');
          return {
            teacher: {
              id: teacher.id,
              name: `${teacher.firstName} ${teacher.lastName}`,
              staffNumber: teacher.staffNumber,
            },
            teachingAssignments: teaching.length,
            subjects: unique(teaching.flatMap((a) => (a.subject ? [a.subject.name] : []))).sort(),
            classes: unique(teaching.map((a) => placementLabel(a.class, a.stream))),
            classTeacherOf: pastoral.map((a) => placementLabel(a.class, a.stream)),
          };
        }),
      };
    });
  }

  private async find(scope: SchoolScope, teacherId: string): Promise<DetailRow> {
    const teacher = await scope.tx.teacher.findFirst({
      where: { id: teacherId, schoolId: scope.schoolId },
      select: DETAIL_SELECT,
    });
    if (!teacher) throw notFound();
    return teacher;
  }

  /** The tenant transaction hides other tenants' users, so this is the check. */
  private async assertUserInTenant(
    scope: SchoolScope,
    userId: string | null | undefined,
  ): Promise<void> {
    if (!userId) return;
    const user = await scope.tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw invalid('UNKNOWN_USER', 'That user account does not exist.');
  }

  private record(
    scope: SchoolScope,
    actor: Actor,
    action: AuditAction,
    teacherId: string,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'teacher',
        resourceId: teacherId,
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
