import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { loadPolicies } from '../../common/school/school-settings.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { StorageService } from '../../storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { findExam, loadClassScheme } from '../examinations/exam-context.js';
import { isLevelBased } from '../examinations/results.calc.js';
import { sortBoundaries, upperLimitOf } from '../grading/grading.rules.js';
import { renderReportCards, type ReportCardData, type ReportCardLogo } from './report-card.pdf.js';
import type { ReportCardsQueryDto, UpdateRemarksDto } from './report-cards.dto.js';

/** The most report cards one request may render; larger sets are split by class. */
export const MAX_BULK_REPORT_CARDS = 300;

export interface ReportCardRow {
  student: { id: string; name: string; admissionNumber: string };
  class: string;
  stream: string | null;
  average: number;
  grade: string | null;
  classPosition: number | null;
  hasClassTeacherRemarks: boolean;
  hasPrincipalRemarks: boolean;
}

export interface ReportCardList {
  examination: { id: string; name: string; status: string; term: string; academicYear: string };
  /** What the caller may write on these report cards. */
  canEdit: { classTeacherRemarks: boolean; principalRemarks: boolean };
  rows: ReportCardRow[];
}

export interface GeneratedPdf {
  buffer: Buffer;
  fileName: string;
}

const CARD_SELECT = {
  id: true,
  studentId: true,
  classId: true,
  className: true,
  streamName: true,
  gradingScheme: true,
  totalScore: true,
  maxTotal: true,
  average: true,
  grade: true,
  gradeDescriptor: true,
  points: true,
  subjectsSat: true,
  isComplete: true,
  classPosition: true,
  classSize: true,
  streamPosition: true,
  streamSize: true,
  classTeacherRemarks: true,
  principalRemarks: true,
  student: { select: { firstName: true, middleName: true, lastName: true, admissionNumber: true } },
  subjects: {
    select: {
      subjectName: true,
      subjectCode: true,
      score: true,
      maxMarks: true,
      percentage: true,
      grade: true,
      points: true,
      isAbsent: true,
    },
    orderBy: { subjectName: 'asc' },
  },
} satisfies Prisma.ResultSelect;

type CardRow = Prisma.ResultGetPayload<{ select: typeof CARD_SELECT }>;
type Exam = Awaited<ReturnType<typeof findExam>>;

const nameOf = (student: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string => [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
const joined = (parts: (string | null)[], separator: string): string | null =>
  parts.filter(Boolean).join(separator) || null;
const slug = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'report';

/**
 * Report cards are a presentation of compiled results: nothing is recalculated
 * here. Staff see them from the moment results are compiled (marked
 * provisional until published); parents and students only once published.
 */
@Injectable()
export class ReportCardsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    examinationId: string,
    query: ReportCardsQueryDto,
  ): Promise<ReportCardList> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      const results = await scope.tx.result.findMany({
        where: await this.visible(scope, principal, examinationId, query),
        select: {
          studentId: true,
          className: true,
          streamName: true,
          average: true,
          grade: true,
          classPosition: true,
          classTeacherRemarks: true,
          principalRemarks: true,
          student: {
            select: { firstName: true, middleName: true, lastName: true, admissionNumber: true },
          },
        },
        orderBy: [{ className: 'asc' }, { streamName: 'asc' }, { student: { lastName: 'asc' } }],
      });
      const open = exam.status !== 'PUBLISHED';
      return {
        examination: {
          id: exam.id,
          name: exam.name,
          status: exam.status,
          term: exam.term.name,
          academicYear: exam.term.academicYear.name,
        },
        canEdit: {
          classTeacherRemarks:
            open &&
            (this.overseesRemarks(principal) || (await this.isAnyClassTeacher(scope, principal))),
          principalRemarks: open && principal.permissions.has('results:approve'),
        },
        rows: results.map((result) => ({
          student: {
            id: result.studentId,
            name: nameOf(result.student),
            admissionNumber: result.student.admissionNumber,
          },
          class: result.className,
          stream: result.streamName,
          average: result.average.toNumber(),
          grade: result.grade,
          classPosition: result.classPosition,
          hasClassTeacherRemarks: Boolean(result.classTeacherRemarks),
          hasPrincipalRemarks: Boolean(result.principalRemarks),
        })),
      };
    });
  }

  /** The content of one learner's report card. */
  card(
    principal: Principal,
    schoolId: string | undefined,
    examinationId: string,
    studentId: string,
  ): Promise<ReportCardData> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      const where = await this.visible(scope, principal, examinationId, {});
      const [card] = await this.build(scope, exam, { ...where, studentId });
      if (!card) throw reportCardNotFound();
      return card;
    });
  }

  pdf(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    studentId: string,
  ): Promise<GeneratedPdf> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      const where = await this.visible(scope, actor.principal, examinationId, {});
      const cards = await this.build(scope, exam, { ...where, studentId });
      const card = cards[0];
      if (!card) throw reportCardNotFound();
      await this.recordExport(scope, actor, exam.id, 1, { studentId });
      return {
        buffer: await renderReportCards(cards, await this.logo(scope)),
        fileName: `${slug(`${card.student.admissionNumber}-${card.student.name}-${exam.name}`)}.pdf`,
      };
    });
  }

  /** Every report card in the selection as one document, a page per learner. */
  bulkPdf(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    query: ReportCardsQueryDto,
  ): Promise<GeneratedPdf> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      const where = await this.visible(scope, actor.principal, examinationId, query);
      const count = await scope.tx.result.count({ where });
      if (count === 0) throw reportCardNotFound('There are no report cards in this selection.');
      if (count > MAX_BULK_REPORT_CARDS) {
        throw new UnprocessableEntityException({
          code: 'TOO_MANY_REPORT_CARDS',
          message: `This selection has ${count} report cards. Choose a class or stream to download at most ${MAX_BULK_REPORT_CARDS} at a time.`,
        });
      }
      const cards = await this.build(scope, exam, where);
      await this.recordExport(scope, actor, exam.id, cards.length, {
        classId: query.classId ?? null,
        stream: query.stream ?? null,
      });
      const first = cards[0];
      const label =
        query.classId && first
          ? `${first.student.class}${query.stream ? `-${query.stream}` : ''}`
          : 'all';
      return {
        buffer: await renderReportCards(cards, await this.logo(scope)),
        fileName: `${slug(`report-cards-${exam.name}-${label}`)}.pdf`,
      };
    });
  }

  /** Writes remarks; each kind needs its own authority, and publishing locks both. */
  updateRemarks(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    studentId: string,
    dto: UpdateRemarksDto,
  ): Promise<ReportCardData> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const exam = await this.compiledExam(scope, examinationId);
      if (exam.status === 'PUBLISHED') {
        throw new ConflictException({
          code: 'RESULTS_LOCKED',
          message: 'These results have been published; report cards can no longer be changed.',
        });
      }
      const where = await this.visible(scope, actor.principal, examinationId, {});
      const result = await scope.tx.result.findFirst({
        where: { ...where, studentId },
        select: {
          id: true,
          classId: true,
          streamName: true,
          classTeacherRemarks: true,
          principalRemarks: true,
        },
      });
      if (!result) throw reportCardNotFound();

      if (
        dto.principalRemarks !== undefined &&
        !actor.principal.permissions.has('results:approve')
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only those who approve results may write the principal’s remarks.',
        });
      }
      if (
        dto.classTeacherRemarks !== undefined &&
        !this.overseesRemarks(actor.principal) &&
        !(await this.isClassTeacherOf(scope, actor.principal, result))
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the learner’s class teacher may write the class teacher’s remarks.',
        });
      }

      const data = {
        ...(dto.classTeacherRemarks !== undefined
          ? { classTeacherRemarks: dto.classTeacherRemarks }
          : {}),
        ...(dto.principalRemarks !== undefined ? { principalRemarks: dto.principalRemarks } : {}),
      };
      if (Object.keys(data).length > 0) {
        await scope.tx.result.update({ where: { id: result.id }, data });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'results.remarks.updated',
          { type: 'result', id: result.id },
          {
            examinationId,
            studentId,
            before: {
              classTeacherRemarks: result.classTeacherRemarks,
              principalRemarks: result.principalRemarks,
            },
            after: data,
          },
        );
      }
      const [card] = await this.build(scope, exam, { id: result.id });
      if (!card) throw reportCardNotFound();
      return card;
    });
  }

  /**
   * Report cards for results already narrowed to what the caller may see.
   * Shared with the portals, which pass their own, stricter filter.
   */
  async build(
    scope: SchoolScope,
    exam: Exam,
    where: Prisma.ResultWhereInput,
  ): Promise<ReportCardData[]> {
    const [results, school, policies] = await Promise.all([
      scope.tx.result.findMany({
        where: { ...where, examinationId: exam.id, schoolId: scope.schoolId },
        select: CARD_SELECT,
        orderBy: [{ className: 'asc' }, { streamName: 'asc' }, { classPosition: 'asc' }],
      }),
      scope.tx.school.findUniqueOrThrow({
        where: { id: scope.schoolId },
        select: {
          name: true,
          motto: true,
          addressLine: true,
          city: true,
          county: true,
          country: true,
          phone: true,
          email: true,
          website: true,
        },
      }),
      loadPolicies(scope),
    ]);

    const keys = new Map<string, Awaited<ReturnType<typeof this.gradingKey>>>();
    const cards: ReportCardData[] = [];
    for (const result of results) {
      if (!keys.has(result.classId)) keys.set(result.classId, await this.gradingKey(scope, result));
      const key = keys.get(result.classId) ?? { levelBased: false, entries: [] };
      const position = (place: number | null, outOf: number | null, shown: boolean) =>
        shown && place !== null && outOf !== null ? { position: place, outOf } : null;

      cards.push({
        school: {
          name: school.name,
          motto: school.motto,
          address: joined([school.addressLine, school.city, school.county, school.country], ', '),
          contact: joined([school.phone, school.email, school.website], '  |  '),
        },
        examination: {
          id: exam.id,
          name: exam.name,
          term: exam.term.name,
          academicYear: exam.term.academicYear.name,
          status: exam.status,
        },
        student: {
          id: result.studentId,
          name: nameOf(result.student),
          admissionNumber: result.student.admissionNumber,
          class: result.className,
          stream: result.streamName,
        },
        levelBased: key.levelBased,
        subjects: result.subjects.map((subject) => ({
          subject: subject.subjectName,
          code: subject.subjectCode,
          score: subject.score?.toNumber() ?? null,
          maxMarks: subject.maxMarks.toNumber(),
          percentage: subject.percentage?.toNumber() ?? null,
          grade: subject.grade,
          points: subject.points?.toNumber() ?? null,
          isAbsent: subject.isAbsent,
        })),
        summary: {
          total: result.totalScore.toNumber(),
          maxTotal: result.maxTotal.toNumber(),
          average: result.average.toNumber(),
          grade: result.grade,
          gradeDescriptor: result.gradeDescriptor,
          points: result.points?.toNumber() ?? null,
          subjectsSat: result.subjectsSat,
          isComplete: result.isComplete,
          classPosition: position(
            result.classPosition,
            result.classSize,
            policies.showClassPosition,
          ),
          streamPosition: position(
            result.streamPosition,
            result.streamSize,
            policies.showStreamPosition,
          ),
        },
        remarks: { classTeacher: result.classTeacherRemarks, principal: result.principalRemarks },
        gradingKey: key.entries,
        isPublished: exam.status === 'PUBLISHED',
      });
    }
    return cards;
  }

  /** The school's logo, when it is in a format a PDF can embed. */
  async logo(scope: SchoolScope): Promise<ReportCardLogo | null> {
    const school = await scope.tx.school.findUnique({
      where: { id: scope.schoolId },
      select: { logoKey: true, logoContentType: true },
    });
    if (!school?.logoKey || !['image/png', 'image/jpeg'].includes(school.logoContentType ?? '')) {
      return null;
    }
    try {
      const object = await this.storage.get(school.logoKey);
      const chunks: Buffer[] = [];
      for await (const chunk of object.body) chunks.push(chunk as Buffer);
      return { data: Buffer.concat(chunks) };
    } catch {
      // A missing logo must not stop report cards being produced.
      return null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async compiledExam(scope: SchoolScope, examinationId: string): Promise<Exam> {
    const exam = await findExam(scope, examinationId);
    if (exam.status === 'DRAFT' || exam.status === 'OPEN') {
      throw new ConflictException({
        code: 'RESULTS_NOT_COMPILED',
        message: 'Report cards are available once the examination has been compiled.',
      });
    }
    return exam;
  }

  private async visible(
    scope: SchoolScope,
    principal: Principal,
    examinationId: string,
    query: ReportCardsQueryDto,
  ): Promise<Prisma.ResultWhereInput> {
    const classScope = await this.classScopes.resolve(scope, principal);
    return {
      schoolId: scope.schoolId,
      examinationId,
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.stream ? { streamName: query.stream } : {}),
      student: this.classScopes.studentFilter(classScope),
    };
  }

  /**
   * The grading key shown on a card. Results keep only the scheme's name, so
   * the key is printed only while the class still uses that scheme.
   */
  private async gradingKey(
    scope: SchoolScope,
    result: Pick<CardRow, 'classId' | 'gradingScheme' | 'subjects'>,
  ): Promise<{ levelBased: boolean; entries: ReportCardData['gradingKey'] }> {
    // Whether levels were awarded is read from the result itself.
    const levelBased =
      result.subjects.length > 0 &&
      result.subjects.every((subject) => subject.score === null && subject.percentage === null);
    const scheme = await loadClassScheme(scope, result.classId);
    if (!scheme || scheme.name !== result.gradingScheme) return { levelBased, entries: [] };

    const ordered = sortBoundaries(scheme.boundaries);
    return {
      levelBased: levelBased || isLevelBased(scheme.boundaries),
      entries: ordered.map((boundary) => {
        const upper = upperLimitOf(ordered, boundary);
        return {
          label: boundary.label,
          descriptor: boundary.descriptor,
          range:
            boundary.minScore === null
              ? ''
              : upper === null
                ? `${boundary.minScore}-100`
                : `${boundary.minScore}-<${upper}`,
        };
      }),
    };
  }

  /** Senior staff who may write a class teacher's remarks on their behalf. */
  private overseesRemarks(principal: Principal): boolean {
    return (
      principal.permissions.has('records:all_classes') &&
      (principal.permissions.has('results:approve') ||
        principal.permissions.has('examinations:manage'))
    );
  }

  private classTeacherAssignments(
    scope: SchoolScope,
    principal: Principal,
  ): Prisma.TeacherAssignmentWhereInput {
    return {
      schoolId: scope.schoolId,
      kind: 'CLASS_TEACHER',
      academicYear: { isCurrent: true },
      teacher: { userId: principal.userId, status: 'ACTIVE' },
    };
  }

  private async isAnyClassTeacher(scope: SchoolScope, principal: Principal): Promise<boolean> {
    return (
      (await scope.tx.teacherAssignment.count({
        where: this.classTeacherAssignments(scope, principal),
      })) > 0
    );
  }

  private async isClassTeacherOf(
    scope: SchoolScope,
    principal: Principal,
    result: { classId: string; streamName: string | null },
  ): Promise<boolean> {
    const held = await scope.tx.teacherAssignment.count({
      where: {
        ...this.classTeacherAssignments(scope, principal),
        classId: result.classId,
        OR: [
          { streamId: null },
          ...(result.streamName ? [{ stream: { name: result.streamName } }] : []),
        ],
      },
    });
    return held > 0;
  }

  private recordExport(
    scope: SchoolScope,
    actor: Actor,
    examinationId: string,
    count: number,
    selection: Prisma.InputJsonObject,
  ): Promise<void> {
    return auditConfigChange(
      this.audit,
      scope,
      actor,
      'report_cards.generated',
      { type: 'examination', id: examinationId },
      { count, ...selection },
    );
  }
}

function reportCardNotFound(message = 'Report card not found.'): NotFoundException {
  return new NotFoundException({ code: 'REPORT_CARD_NOT_FOUND', message });
}
