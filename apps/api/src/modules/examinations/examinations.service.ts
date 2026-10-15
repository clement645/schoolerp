import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import {
  assertStatus,
  examNotFound,
  findExam,
  loadClassScheme,
  loadExamSubjects,
} from './exam-context.js';
import type {
  CreateExaminationDto,
  ExamStatus,
  ListExaminationsQueryDto,
  SetMaxMarksDto,
  UpdateExaminationDto,
} from './examinations.dto.js';
import { loadPolicies } from '../../common/school/school-settings.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { computeStudent, didPass, rank, type MarkValue } from './results.calc.js';

type Ref = { id: string; name: string };

export interface ExaminationSummary {
  id: string;
  name: string;
  type: string;
  status: ExamStatus;
  startDate: string;
  endDate: string;
  term: Ref;
  academicYear: Ref;
  classes: Ref[];
  /** Marks recorded so far against the number expected. */
  progress: { entered: number; expected: number };
}

export interface ExaminationDetail extends ExaminationSummary {
  compiledAt: Date | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  subjectsByClass: {
    class: Ref;
    subjects: {
      examSubjectId: string;
      subjectId: string;
      name: string;
      code: string;
      maxMarks: number;
      isCompulsory: boolean;
    }[];
  }[];
}

const EXAM_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  startDate: true,
  endDate: true,
  compiledAt: true,
  approvedAt: true,
  publishedAt: true,
  term: { select: { id: true, name: true, academicYear: { select: { id: true, name: true } } } },
  subjects: {
    select: {
      id: true,
      classId: true,
      maxMarks: true,
      isCompulsory: true,
      class: { select: { id: true, name: true, level: true } },
      subject: { select: { id: true, name: true, code: true } },
      _count: { select: { marks: true } },
    },
  },
} satisfies Prisma.ExaminationSelect;

type ExamRow = Prisma.ExaminationGetPayload<{ select: typeof EXAM_SELECT }>;

const invalid = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

/** Students who sit examinations: those currently at the school. */
const SITTING = { in: ['ACTIVE', 'SUSPENDED'] as ('ACTIVE' | 'SUSPENDED')[] };

@Injectable()
export class ExaminationsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: ListExaminationsQueryDto,
  ): Promise<ExaminationSummary[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exams = await scope.tx.examination.findMany({
        where: {
          schoolId: scope.schoolId,
          ...(query.termId ? { termId: query.termId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        select: EXAM_SELECT,
        orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
      });
      const sizes = await this.classSizes(scope);
      return exams.map((exam) => this.toSummary(exam, sizes));
    });
  }

  get(
    principal: Principal,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.scopes.run(principal, schoolId, (scope) => this.detail(scope, examinationId));
  }

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateExaminationDto,
  ): Promise<ExaminationDetail> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const term = await scope.tx.term.findFirst({
          where: { id: dto.termId, schoolId: scope.schoolId },
          select: { name: true, startDate: true, endDate: true },
        });
        if (!term) throw invalid('UNKNOWN_TERM', 'The selected term does not exist.');
        const dates = this.datesWithin(dto.startDate, dto.endDate, term);

        const classes = await scope.tx.schoolClass.findMany({
          where: { id: { in: dto.classIds }, schoolId: scope.schoolId, isActive: true },
          select: {
            id: true,
            name: true,
            subjects: {
              where: { subject: { isActive: true } },
              select: { subjectId: true, isCompulsory: true },
            },
          },
        });
        if (classes.length !== dto.classIds.length) {
          throw invalid('UNKNOWN_CLASS', 'One or more classes do not exist or are inactive.');
        }
        const empty = classes.filter((entry) => entry.subjects.length === 0);
        if (empty.length > 0) {
          throw invalid(
            'CLASS_WITHOUT_SUBJECTS',
            `Assign subjects to ${empty.map((entry) => entry.name).join(', ')} on the Classes page first.`,
          );
        }

        const exam = await scope.tx.examination.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            termId: dto.termId,
            name: dto.name,
            type: dto.type,
            ...dates,
            subjects: {
              create: classes.flatMap((entry) =>
                entry.subjects.map((subject) => ({
                  tenantId: scope.tenantId,
                  classId: entry.id,
                  subjectId: subject.subjectId,
                  isCompulsory: subject.isCompulsory,
                  maxMarks: dto.maxMarks ?? 100,
                })),
              ),
            },
          },
          select: { id: true },
        });
        await this.record(scope, actor, 'examination.created', exam.id, {
          name: dto.name,
          term: term.name,
          classes: classes.map((entry) => entry.name),
        });
        return this.detail(scope, exam.id);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'This term already has an examination with that name.' });
    }
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    dto: UpdateExaminationDto,
  ): Promise<ExaminationDetail> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const exam = await findExam(scope, examinationId);
        assertStatus(exam, ['DRAFT', 'OPEN'], 'Only a draft or open examination can be edited.');
        const term = await scope.tx.term.findUniqueOrThrow({
          where: { id: exam.term.id },
          select: { startDate: true, endDate: true },
        });
        const dates = this.datesWithin(
          dto.startDate ?? formatCalendarDate(exam.startDate),
          dto.endDate ?? formatCalendarDate(exam.endDate),
          term,
        );
        await scope.tx.examination.update({
          where: { id: examinationId },
          data: { name: dto.name, type: dto.type, ...dates },
        });
        await this.record(scope, actor, 'examination.updated', examinationId, {
          before: { name: exam.name, type: exam.type },
          after: { name: dto.name ?? exam.name, type: dto.type ?? exam.type },
        });
        return this.detail(scope, examinationId);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'This term already has an examination with that name.' });
    }
  }

  /** Changes a subject's maximum mark; it can never drop below a mark already entered. */
  setMaxMarks(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    examSubjectId: string,
    dto: SetMaxMarksDto,
  ): Promise<ExaminationDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await findExam(scope, examinationId);
      assertStatus(
        exam,
        ['DRAFT', 'OPEN'],
        'Maximum marks can only be changed while marks entry is open.',
      );

      const subject = await scope.tx.examinationSubject.findFirst({
        where: { id: examSubjectId, examinationId },
        select: { maxMarks: true, subject: { select: { name: true } } },
      });
      if (!subject) throw examNotFound();

      const highest = await scope.tx.mark.aggregate({
        where: { examinationSubjectId: examSubjectId },
        _max: { score: true },
      });
      const top = highest._max.score?.toNumber() ?? 0;
      if (top > dto.maxMarks) {
        throw conflict(
          'MARKS_EXCEED_MAXIMUM',
          `A mark of ${top} has already been entered for ${subject.subject.name}; the maximum cannot be lower.`,
        );
      }
      await scope.tx.examinationSubject.update({
        where: { id: examSubjectId },
        data: { maxMarks: dto.maxMarks },
      });
      await this.record(scope, actor, 'examination.updated', examinationId, {
        subject: subject.subject.name,
        maxMarks: { before: subject.maxMarks.toNumber(), after: dto.maxMarks },
      });
      return this.detail(scope, examinationId);
    });
  }

  async delete(actor: Actor, schoolId: string | undefined, examinationId: string): Promise<void> {
    await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await findExam(scope, examinationId);
      assertStatus(
        exam,
        ['DRAFT', 'OPEN'],
        'An examination with compiled results cannot be deleted.',
      );
      const marks = await scope.tx.mark.count({ where: { examinationSubject: { examinationId } } });
      if (marks > 0) {
        throw conflict(
          'EXAM_HAS_MARKS',
          'Marks have been entered for this examination; it cannot be deleted.',
        );
      }
      await scope.tx.examination.delete({ where: { id: examinationId } });
      await this.record(scope, actor, 'examination.deleted', examinationId, { name: exam.name });
    });
  }

  // ── Workflow ───────────────────────────────────────────────────────────────

  /** DRAFT → OPEN: teachers may now enter marks. */
  open(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.transition(actor, schoolId, examinationId, {
      from: ['DRAFT'],
      to: 'OPEN',
      action: 'examination.opened',
      refusal: 'Only a draft examination can be opened for marks entry.',
    });
  }

  /**
   * Returns a compiled or approved examination to marks entry. Any approval
   * is withdrawn, because the marks it covered may now change.
   */
  reopen(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.transition(actor, schoolId, examinationId, {
      from: ['COMPILED', 'APPROVED'],
      to: 'OPEN',
      action: 'examination.reopened',
      refusal:
        'Only a compiled or approved examination can be reopened. Published results are locked.',
      data: { approvedAt: null, approvedById: null },
    });
  }

  approve(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.transition(actor, schoolId, examinationId, {
      from: ['COMPILED'],
      to: 'APPROVED',
      action: 'examination.approved',
      refusal: 'Results must be compiled before they can be approved.',
      data: { approvedAt: new Date(), approvedById: actor.principal.userId },
    });
  }

  /** APPROVED → PUBLISHED: results are released and can never be changed again. */
  publish(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.transition(actor, schoolId, examinationId, {
      from: ['APPROVED'],
      to: 'PUBLISHED',
      action: 'examination.published',
      refusal: 'Results must be approved before they can be published.',
      data: { publishedAt: new Date(), publishedById: actor.principal.userId },
      afterwards: (scope, exam) => this.notifyPublished(scope, exam),
    });
  }

  /**
   * Closes marks entry and computes every learner's result from the stored
   * marks. Compiling again replaces the previous results, under a new
   * compile version.
   */
  compile(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
  ): Promise<ExaminationDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await findExam(scope, examinationId);
      const policies = await loadPolicies(scope);
      const policy = policies.rankingPolicy;
      assertStatus(exam, ['OPEN', 'COMPILED'], 'Only an open examination can be compiled.');

      const classIds = (
        await scope.tx.examinationSubject.findMany({
          where: { examinationId },
          select: { classId: true },
          distinct: ['classId'],
        })
      ).map((row) => row.classId);

      // Remarks typed against the previous compilation are carried over.
      const previous = new Map(
        (
          await scope.tx.result.findMany({
            where: { examinationId },
            select: { studentId: true, classTeacherRemarks: true, principalRemarks: true },
          })
        ).map((row) => [row.studentId, row]),
      );
      await scope.tx.result.deleteMany({ where: { examinationId } });

      const compileVersion = exam.compileVersion + 1;
      let compiled = 0;

      for (const classId of classIds) {
        const scheme = await loadClassScheme(scope, classId);
        const schoolClass = await scope.tx.schoolClass.findUniqueOrThrow({
          where: { id: classId },
          select: { name: true },
        });
        if (!scheme) {
          throw conflict(
            'NO_GRADING_SCHEME',
            `${schoolClass.name} has no grading scheme. Set a default scheme in School Settings first.`,
          );
        }
        const subjects = await loadExamSubjects(scope, examinationId, classId);
        const subjectByExamSubject = new Map(
          subjects.map((subject) => [subject.examSubjectId, subject]),
        );

        const marks = await scope.tx.mark.findMany({
          where: { examinationSubjectId: { in: subjects.map((subject) => subject.examSubjectId) } },
          select: {
            studentId: true,
            examinationSubjectId: true,
            score: true,
            level: true,
            isAbsent: true,
          },
        });
        const marksByStudent = new Map<string, Map<string, MarkValue>>();
        for (const mark of marks) {
          const subject = subjectByExamSubject.get(mark.examinationSubjectId);
          if (!subject) continue;
          const own = marksByStudent.get(mark.studentId) ?? new Map<string, MarkValue>();
          own.set(subject.subjectId, {
            score: mark.score?.toNumber() ?? null,
            level: mark.level,
            isAbsent: mark.isAbsent,
          });
          marksByStudent.set(mark.studentId, own);
        }

        // Everyone in the class now, plus anyone who has a mark here (e.g. a
        // learner who sat the papers and has since moved or left).
        const students = await scope.tx.student.findMany({
          where: {
            schoolId: scope.schoolId,
            OR: [
              { currentClassId: classId, status: SITTING },
              { id: { in: [...marksByStudent.keys()] } },
            ],
          },
          select: { id: true, currentClassId: true, currentStream: { select: { name: true } } },
        });

        const specs = subjects.map((subject) => ({
          id: subject.subjectId,
          maxMarks: subject.maxMarks,
          isCompulsory: subject.isCompulsory,
        }));
        const computed = students.map((student) => ({
          student,
          streamName:
            student.currentClassId === classId ? (student.currentStream?.name ?? null) : null,
          ...computeStudent(specs, marksByStudent.get(student.id) ?? new Map(), scheme.boundaries),
        }));

        const classPositions = rank(computed, policy);
        const byStream = new Map<string, typeof computed>();
        for (const entry of computed) {
          if (!entry.streamName) continue;
          byStream.set(entry.streamName, [...(byStream.get(entry.streamName) ?? []), entry]);
        }
        const streamPositions = new Map(
          [...byStream].map(([name, entries]) => [name, rank(entries, policy)] as const),
        );

        for (const entry of computed) {
          const stream = entry.streamName ? byStream.get(entry.streamName) : undefined;
          const remarks = previous.get(entry.student.id);
          await scope.tx.result.create({
            data: {
              tenantId: scope.tenantId,
              schoolId: scope.schoolId,
              examinationId,
              studentId: entry.student.id,
              classId,
              compileVersion,
              className: schoolClass.name,
              streamName: entry.streamName,
              gradingScheme: scheme.name,
              totalScore: entry.totalScore,
              maxTotal: entry.maxTotal,
              average: entry.average,
              grade: entry.grade,
              gradeDescriptor: entry.gradeDescriptor,
              points: entry.points,
              subjectsSat: entry.subjectsSat,
              isComplete: entry.isComplete,
              passed: didPass(entry, scheme.boundaries, policies.passMark),
              classPosition: classPositions.get(entry) ?? null,
              classSize: classPositions.size,
              streamPosition: entry.streamName
                ? (streamPositions.get(entry.streamName)?.get(entry) ?? null)
                : null,
              streamSize: stream
                ? (streamPositions.get(entry.streamName ?? '')?.size ?? null)
                : null,
              classTeacherRemarks: remarks?.classTeacherRemarks ?? null,
              principalRemarks: remarks?.principalRemarks ?? null,
              subjects: {
                create: entry.subjects.map((result) => {
                  const subject = subjects.find(
                    (candidate) => candidate.subjectId === result.subjectId,
                  );
                  return {
                    tenantId: scope.tenantId,
                    subjectId: result.subjectId,
                    subjectName: subject?.name ?? '',
                    subjectCode: subject?.code ?? '',
                    maxMarks: subject?.maxMarks ?? 0,
                    score: result.score,
                    percentage: result.percentage,
                    grade: result.grade,
                    points: result.points,
                    isAbsent: result.isAbsent,
                  };
                }),
              },
            },
          });
          compiled += 1;
        }
      }

      await scope.tx.examination.update({
        where: { id: examinationId },
        data: { status: 'COMPILED', compileVersion, compiledAt: new Date() },
      });
      await this.record(scope, actor, 'examination.compiled', examinationId, {
        name: exam.name,
        compileVersion,
        results: compiled,
        rankingPolicy: policy,
        passMark: policies.passMark,
      });
      return this.detail(scope, examinationId);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private transition(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    step: {
      from: readonly ExamStatus[];
      to: ExamStatus;
      action: AuditAction;
      refusal: string;
      data?: Prisma.ExaminationUncheckedUpdateInput;
      /** Runs in the same transaction, once the status has changed. */
      afterwards?: (scope: SchoolScope, exam: { id: string; name: string }) => Promise<void>;
    },
  ): Promise<ExaminationDetail> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await findExam(scope, examinationId);
      assertStatus(exam, step.from, step.refusal);
      // Conditional on the status read above, so two people cannot both move it.
      const { count } = await scope.tx.examination.updateMany({
        where: { id: examinationId, status: exam.status },
        data: { ...step.data, status: step.to },
      });
      if (count !== 1)
        throw conflict('INVALID_EXAM_STATE', 'The examination was changed by someone else.');
      await this.record(scope, actor, step.action, examinationId, {
        name: exam.name,
        before: exam.status,
        after: step.to,
      });
      await step.afterwards?.(scope, exam);
      return this.detail(scope, examinationId);
    });
  }

  /** Tells the parents and learners concerned that results can now be seen. */
  private async notifyPublished(
    scope: SchoolScope,
    exam: { id: string; name: string },
  ): Promise<void> {
    const results = await scope.tx.result.findMany({
      where: { examinationId: exam.id },
      select: {
        student: {
          select: {
            userId: true,
            guardians: { select: { guardian: { select: { userId: true } } } },
          },
        },
      },
    });
    const recipients = results.flatMap(({ student }) => [
      student.userId,
      ...student.guardians.map((link) => link.guardian.userId),
    ]);
    await this.notifications.notify(
      scope.tx,
      scope.tenantId,
      recipients.filter((userId): userId is string => userId !== null),
      {
        kind: 'RESULTS_PUBLISHED',
        title: `${exam.name} results are out`,
        body: 'Results and report cards are now available in your portal.',
        link: '/portal',
      },
    );
  }

  private datesWithin(
    startDate: string,
    endDate: string,
    term: { startDate: Date; endDate: Date },
  ) {
    const dates = { startDate: parseCalendarDate(startDate), endDate: parseCalendarDate(endDate) };
    if (dates.startDate > dates.endDate) {
      throw invalid('INVALID_DATE_RANGE', 'The end date cannot be before the start date.');
    }
    if (dates.startDate < term.startDate || dates.endDate > term.endDate) {
      throw invalid(
        'OUTSIDE_TERM',
        `The examination must fall within the term (${formatCalendarDate(term.startDate)} to ${formatCalendarDate(term.endDate)}).`,
      );
    }
    return dates;
  }

  /** Number of sitting students per class. */
  private async classSizes(scope: SchoolScope): Promise<Map<string, number>> {
    const groups = await scope.tx.student.groupBy({
      by: ['currentClassId'],
      where: { schoolId: scope.schoolId, status: SITTING, currentClassId: { not: null } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.currentClassId ?? '', group._count._all]));
  }

  private toSummary(exam: ExamRow, sizes: Map<string, number>): ExaminationSummary {
    const classes = new Map<string, { id: string; name: string; level: number }>();
    let entered = 0;
    let expected = 0;
    for (const subject of exam.subjects) {
      classes.set(subject.class.id, subject.class);
      entered += subject._count.marks;
      if (subject.isCompulsory) expected += sizes.get(subject.classId) ?? 0;
    }
    return {
      id: exam.id,
      name: exam.name,
      type: exam.type,
      status: exam.status,
      startDate: formatCalendarDate(exam.startDate),
      endDate: formatCalendarDate(exam.endDate),
      term: { id: exam.term.id, name: exam.term.name },
      academicYear: exam.term.academicYear,
      classes: [...classes.values()]
        .sort((a, b) => a.level - b.level)
        .map(({ id, name }) => ({ id, name })),
      progress: { entered, expected: Math.max(expected, entered) },
    };
  }

  private async detail(scope: SchoolScope, examinationId: string): Promise<ExaminationDetail> {
    const exam = await scope.tx.examination.findFirst({
      where: { id: examinationId, schoolId: scope.schoolId },
      select: EXAM_SELECT,
    });
    if (!exam) throw examNotFound();
    const summary = this.toSummary(exam, await this.classSizes(scope));

    return {
      ...summary,
      compiledAt: exam.compiledAt,
      approvedAt: exam.approvedAt,
      publishedAt: exam.publishedAt,
      subjectsByClass: summary.classes.map((schoolClass) => ({
        class: schoolClass,
        subjects: exam.subjects
          .filter((subject) => subject.classId === schoolClass.id)
          .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
          .map((subject) => ({
            examSubjectId: subject.id,
            subjectId: subject.subject.id,
            name: subject.subject.name,
            code: subject.subject.code,
            maxMarks: subject.maxMarks.toNumber(),
            isCompulsory: subject.isCompulsory,
          })),
      })),
    };
  }

  private record(
    scope: SchoolScope,
    actor: Actor,
    action: AuditAction,
    examinationId: string,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'examination',
        resourceId: examinationId,
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
