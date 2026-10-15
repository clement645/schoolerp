import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Principal } from '../../common/auth/principal.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import {
  assertStatus,
  findExam,
  loadClassScheme,
  loadExamSubjects,
  type ClassScheme,
  type ExamSubject,
} from './exam-context.js';
import type { ExamStatus, MarkEntryDto, SaveMarksDto } from './examinations.dto.js';
import { computeStudent, isLevelBased, type MarkValue } from './results.calc.js';

const MAX_AUDITED_CHANGES = 100;
const MAX_REPORTED_PROBLEMS = 100;
const ABSENT_TOKENS = new Set(['abs', 'absent', 'x']);

export interface CellView {
  score: number | null;
  level: string | null;
  isAbsent: boolean;
  /** Quote this when saving a change to the cell; 0 means no mark exists yet. */
  version: number;
}

export interface SheetRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  stream: string | null;
  /** Keyed by subject id; a subject with no mark is simply absent from the map. */
  marks: Record<string, CellView>;
  /** Subjects this user may edit for this learner; null means all editable ones. */
  editableSubjectIds: string[] | null;
  total: number;
  maxTotal: number;
  average: number;
  grade: string | null;
  isComplete: boolean;
}

export interface MarksSheet {
  examination: { id: string; name: string; status: ExamStatus; term: string; academicYear: string };
  class: { id: string; name: string };
  /** How this class is graded; null when no scheme has been set up. */
  grading: {
    name: string;
    levelBased: boolean;
    levels: { label: string; descriptor: string | null }[];
  } | null;
  /** Whether this user can change any mark on this sheet right now. */
  editable: boolean;
  subjects: (ExamSubject & { canEdit: boolean })[];
  students: SheetRow[];
  stats: {
    totalStudents: number;
    marksEntered: number;
    marksExpected: number;
    /** Percentage of expected marks that have been entered. */
    completion: number;
    pendingEntry: number;
    /** Learners whose compiled results are waiting to be approved. */
    awaitingApproval: number;
  };
}

export interface MarksConflict {
  studentId: string;
  subjectId: string;
  current: CellView;
  updatedBy: string | null;
}

export interface MarksImportResult {
  imported: boolean;
  /** Cells that differ from what is stored and would be (or were) written. */
  changes: number;
  /** Of those, cells that already held a different mark. */
  overwrites: number;
  problems: { row: number; message: string }[];
  problemsTruncated: boolean;
}

interface SheetContext {
  exam: Awaited<ReturnType<typeof findExam>>;
  schoolClass: { id: string; name: string };
  scheme: ClassScheme | null;
  subjects: ExamSubject[];
  students: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    admissionNumber: string;
    currentStreamId: string | null;
    currentStream: { name: string } | null;
  }[];
  marks: Map<
    string,
    {
      id: string;
      score: number | null;
      level: string | null;
      isAbsent: boolean;
      version: number;
      updatedBy: string | null;
    }
  >;
  /** Decides whether the caller may edit a subject for a learner in a stream. */
  mayEdit: (subjectId: string, streamId: string | null) => boolean;
  /** True when the caller is limited to the subjects they teach. */
  restricted: boolean;
}

const key = (studentId: string, subjectId: string): string => `${studentId}:${subjectId}`;
const invalid = (code: string, message: string, details?: unknown) =>
  new BadRequestException({ code, message, ...(details === undefined ? {} : { details }) });

/** The text a spreadsheet cell shows, whatever kind of value it holds. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // A formula cell: use what it evaluated to.
  if ('result' in value) return cellText(value.result);
  if ('richText' in value)
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  if ('text' in value) return String(value.text).trim();
  return '';
}

const describeCell = (cell: MarkValue | undefined): string | number | null => {
  if (!cell) return null;
  if (cell.isAbsent) return 'ABSENT';
  return cell.level ?? cell.score;
};

@Injectable()
export class MarksService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly audit: AuditService,
  ) {}

  /** The marks sheet for one class, with totals computed from stored marks. */
  getSheet(
    principal: Principal,
    schoolId: string | undefined,
    examinationId: string,
    classId: string,
    streamId?: string,
  ): Promise<MarksSheet> {
    return this.scopes.run(principal, schoolId, async (scope) =>
      this.toSheet(principal, await this.load(scope, principal, examinationId, classId, streamId)),
    );
  }

  /**
   * Saves a batch of mark changes atomically. Each entry quotes the version
   * of the mark it was based on; if anyone has changed that mark since, the
   * whole batch is refused and the conflicting cells are returned, so one
   * teacher can never silently overwrite another's work.
   */
  save(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    dto: SaveMarksDto,
  ): Promise<MarksSheet> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const context = await this.load(scope, actor.principal, examinationId, dto.classId);
      this.assertCanEnter(actor.principal, context);
      await this.apply(scope, actor, context, dto.entries, 'marks.saved');
      return this.toSheet(
        actor.principal,
        await this.load(scope, actor.principal, examinationId, dto.classId),
      );
    });
  }

  /** The sheet as an Excel workbook, in the layout the importer reads back. */
  async exportXlsx(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    classId: string,
    streamId?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const sheet = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const context = await this.load(scope, actor.principal, examinationId, classId, streamId);
      await this.audit.record(
        {
          action: 'marks.exported',
          resourceType: 'examination',
          resourceId: examinationId,
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          actorId: actor.principal.userId,
          meta: actor.meta,
          details: { class: context.schoolClass.name, students: context.students.length },
        },
        scope.tx,
      );
      return this.toSheet(actor.principal, context);
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Marks');
    worksheet.columns = [
      { header: 'Adm No', key: 'admissionNumber', width: 14 },
      { header: 'Student', key: 'name', width: 30 },
      { header: 'Stream', key: 'stream', width: 12 },
      ...sheet.subjects.map((subject) => ({
        header: `${subject.code} (/${subject.maxMarks})`,
        key: subject.subjectId,
        width: 14,
      })),
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Average', key: 'average', width: 10 },
      { header: 'Grade', key: 'grade', width: 8 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    for (const student of sheet.students) {
      const cells = Object.fromEntries(
        sheet.subjects.map((subject) => {
          const cell = student.marks[subject.subjectId];
          return [
            subject.subjectId,
            cell ? (cell.isAbsent ? 'ABS' : (cell.level ?? cell.score)) : null,
          ];
        }),
      );
      worksheet.addRow({
        admissionNumber: student.admissionNumber,
        name: student.name,
        stream: student.stream,
        ...cells,
        total: student.total,
        average: student.average,
        grade: student.grade,
      });
    }

    const safe = (text: string) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: `marks-${safe(sheet.examination.name)}-${safe(sheet.class.name)}.xlsx`,
    };
  }

  /**
   * Imports marks from a workbook exported by `exportXlsx`. Blank cells are
   * left as they are. Nothing is written unless the whole file is valid; with
   * `dryRun` nothing is written at all and the effect is only reported.
   */
  async importXlsx(
    actor: Actor,
    schoolId: string | undefined,
    examinationId: string,
    classId: string,
    file: Buffer,
    dryRun: boolean,
  ): Promise<MarksImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw invalid(
        'UNSUPPORTED_FILE',
        'This file could not be read. Upload the Excel file exported from this page.',
      );
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw invalid('UNSUPPORTED_FILE', 'The workbook has no sheets.');

    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const context = await this.load(scope, actor.principal, examinationId, classId);
      this.assertCanEnter(actor.principal, context);

      const text = cellText;

      // Map header cells to subjects by the code before " (/max)".
      const columns = new Map<number, ExamSubject>();
      let admissionColumn = 0;
      worksheet.getRow(1).eachCell((cell, column) => {
        const header = text(cell.value);
        if (/^adm/i.test(header)) admissionColumn = column;
        const code = header.replace(/\s*\(.*$/, '').toLowerCase();
        const subject = context.subjects.find((candidate) => candidate.code.toLowerCase() === code);
        if (subject) columns.set(column, subject);
      });

      const problems: { row: number; message: string }[] = [];
      if (!admissionColumn) problems.push({ row: 1, message: 'The "Adm No" column is missing.' });
      if (columns.size === 0)
        problems.push({ row: 1, message: 'No subject columns match this class’s subjects.' });

      const studentByAdmission = new Map(
        context.students.map((student) => [student.admissionNumber.toLowerCase(), student]),
      );
      const entries: MarkEntryDto[] = [];
      let overwrites = 0;

      if (problems.length === 0) {
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const admission = text(row.getCell(admissionColumn).value);
          if (!admission) return;
          const student = studentByAdmission.get(admission.toLowerCase());
          if (!student) {
            problems.push({
              row: rowNumber,
              message: `No student with admission number "${admission}" is in this class.`,
            });
            return;
          }
          for (const [column, subject] of columns) {
            const raw = text(row.getCell(column).value);
            if (!raw) continue;

            const existing = context.marks.get(key(student.id, subject.subjectId));
            const entry: MarkEntryDto = {
              studentId: student.id,
              subjectId: subject.subjectId,
              version: existing?.version ?? 0,
            };
            if (ABSENT_TOKENS.has(raw.toLowerCase())) entry.isAbsent = true;
            else if (/^\d+(\.\d{1,2})?$/.test(raw)) entry.score = Number(raw);
            else entry.level = raw;

            const problem = this.validateEntry(context, entry, student.currentStreamId);
            if (problem) {
              problems.push({ row: rowNumber, message: `${subject.code}: ${problem}` });
              continue;
            }
            if (this.isSame(existing, entry)) continue;
            if (existing && describeCell(existing) !== null) overwrites += 1;
            entries.push(entry);
          }
        });
      }

      const result: MarksImportResult = {
        imported: false,
        changes: entries.length,
        overwrites,
        problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
        problemsTruncated: problems.length > MAX_REPORTED_PROBLEMS,
      };
      if (dryRun || problems.length > 0 || entries.length === 0) return result;

      await this.apply(scope, actor, context, entries, 'marks.imported');
      return { ...result, imported: true };
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async load(
    scope: SchoolScope,
    principal: Principal,
    examinationId: string,
    classId: string,
    streamId?: string,
  ): Promise<SheetContext> {
    const exam = await findExam(scope, examinationId);
    const schoolClass = await scope.tx.schoolClass.findFirst({
      where: { id: classId, schoolId: scope.schoolId },
      select: { id: true, name: true },
    });
    const subjects = schoolClass ? await loadExamSubjects(scope, examinationId, classId) : [];
    if (!schoolClass || subjects.length === 0) {
      throw invalid('CLASS_NOT_IN_EXAM', 'This class does not sit this examination.');
    }

    const classScope = await this.classScopes.resolve(scope, principal);
    const students = await scope.tx.student.findMany({
      where: {
        AND: [
          {
            schoolId: scope.schoolId,
            currentClassId: classId,
            status: { in: ['ACTIVE', 'SUSPENDED'] },
          },
          streamId ? { currentStreamId: streamId } : {},
          this.classScopes.studentFilter(classScope),
        ],
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        admissionNumber: true,
        currentStreamId: true,
        currentStream: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });

    const rows = await scope.tx.mark.findMany({
      where: {
        examinationSubjectId: { in: subjects.map((subject) => subject.examSubjectId) },
        studentId: { in: students.map((student) => student.id) },
      },
      select: {
        id: true,
        studentId: true,
        examinationSubjectId: true,
        score: true,
        level: true,
        isAbsent: true,
        version: true,
        updatedById: true,
      },
    });
    const editors = new Map(
      (
        await scope.tx.user.findMany({
          where: {
            id: {
              in: [...new Set(rows.flatMap((row) => (row.updatedById ? [row.updatedById] : [])))],
            },
          },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((user) => [user.id, `${user.firstName} ${user.lastName}`]),
    );
    const subjectIdOf = new Map(
      subjects.map((subject) => [subject.examSubjectId, subject.subjectId]),
    );
    const marks: SheetContext['marks'] = new Map();
    for (const row of rows) {
      marks.set(key(row.studentId, subjectIdOf.get(row.examinationSubjectId) ?? ''), {
        id: row.id,
        score: row.score?.toNumber() ?? null,
        level: row.level,
        isAbsent: row.isAbsent,
        version: row.version,
        updatedBy: row.updatedById ? (editors.get(row.updatedById) ?? null) : null,
      });
    }

    // Staff who work across classes may enter any mark. A teacher may enter
    // marks only for the subjects they are assigned to teach, in the streams
    // they teach them to — a class teacher can see the sheet but not edit
    // colleagues' subjects.
    const restricted = !classScope.all;
    const teaching = restricted
      ? await scope.tx.teacherAssignment.findMany({
          where: {
            schoolId: scope.schoolId,
            classId,
            kind: 'SUBJECT_TEACHER',
            academicYearId: exam.term.academicYear.id,
            teacher: { userId: principal.userId, status: 'ACTIVE' },
          },
          select: { subjectId: true, streamId: true },
        })
      : [];
    const mayEdit = (subjectId: string, stream: string | null): boolean =>
      !restricted ||
      teaching.some(
        (assignment) =>
          assignment.subjectId === subjectId &&
          (assignment.streamId === null || assignment.streamId === stream),
      );

    return {
      exam,
      schoolClass,
      scheme: await loadClassScheme(scope, classId),
      subjects,
      students,
      marks,
      mayEdit,
      restricted,
    };
  }

  private assertCanEnter(principal: Principal, context: SheetContext): void {
    if (!principal.permissions.has('marks:enter')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to enter marks.',
      });
    }
    assertStatus(
      context.exam,
      ['OPEN'],
      context.exam.status === 'DRAFT'
        ? 'This examination is not open for marks entry yet.'
        : 'Marks entry is closed for this examination.',
    );
  }

  /** Returns what is wrong with an entry, or null if it is acceptable. */
  private validateEntry(
    context: SheetContext,
    entry: MarkEntryDto,
    streamId: string | null,
  ): string | null {
    const subject = context.subjects.find((candidate) => candidate.subjectId === entry.subjectId);
    if (!subject) return 'this subject is not part of the examination for this class.';
    if (!context.mayEdit(entry.subjectId, streamId)) {
      return 'you are not assigned to teach this subject to this learner’s class.';
    }

    const given = [entry.score != null, entry.level != null, entry.isAbsent === true].filter(
      Boolean,
    ).length;
    if (given > 1) return 'give a score, a level, or mark the learner absent — only one.';

    const levelBased = context.scheme ? isLevelBased(context.scheme.boundaries) : false;
    if (entry.score != null) {
      if (levelBased)
        return 'this class is graded by performance level; choose a level instead of a score.';
      if (entry.score > subject.maxMarks)
        return `${entry.score} is more than the maximum of ${subject.maxMarks}.`;
    }
    if (entry.level != null) {
      if (!levelBased) return 'this class is graded by score; enter a number.';
      const known = context.scheme?.boundaries.some(
        (boundary) => boundary.label.toLowerCase() === entry.level?.trim().toLowerCase(),
      );
      if (!known) return `"${entry.level}" is not a level of the grading scheme.`;
    }
    return null;
  }

  private isSame(existing: MarkValue | undefined, entry: MarkEntryDto): boolean {
    const next = this.normalise(entry);
    const current = existing ?? { score: null, level: null, isAbsent: false };
    return (
      current.score === next.score &&
      (current.level ?? null)?.toLowerCase() === next.level?.toLowerCase() &&
      current.isAbsent === next.isAbsent
    );
  }

  private normalise(entry: MarkEntryDto): MarkValue {
    const isAbsent = entry.isAbsent === true;
    return {
      score: isAbsent ? null : (entry.score ?? null),
      level: isAbsent ? null : (entry.level?.trim() ?? null),
      isAbsent,
    };
  }

  /** Validates and writes a batch of entries, all or nothing. */
  private async apply(
    scope: SchoolScope,
    actor: Actor,
    context: SheetContext,
    entries: readonly MarkEntryDto[],
    action: 'marks.saved' | 'marks.imported',
  ): Promise<void> {
    const studentById = new Map(context.students.map((student) => [student.id, student]));
    const seen = new Set<string>();
    const conflicts: MarksConflict[] = [];
    const changes: {
      entry: MarkEntryDto;
      before: MarkValue | undefined;
      subject: ExamSubject;
      admission: string;
    }[] = [];

    for (const entry of entries) {
      const cellKey = key(entry.studentId, entry.subjectId);
      if (seen.has(cellKey))
        throw invalid('DUPLICATE_ENTRY', 'The same mark appears twice in this request.');
      seen.add(cellKey);

      const student = studentById.get(entry.studentId);
      if (!student) {
        throw invalid(
          'UNKNOWN_STUDENT',
          'One or more learners are not in this class, or not in a class you teach.',
        );
      }
      const problem = this.validateEntry(context, entry, student.currentStreamId);
      if (problem) {
        const subject = context.subjects.find(
          (candidate) => candidate.subjectId === entry.subjectId,
        );
        throw invalid(
          'INVALID_MARK',
          `${student.firstName} ${student.lastName}, ${subject?.name ?? 'subject'}: ${problem}`,
          {
            studentId: entry.studentId,
            subjectId: entry.subjectId,
          },
        );
      }

      const existing = context.marks.get(cellKey);
      if ((existing?.version ?? 0) !== entry.version) {
        conflicts.push({
          studentId: entry.studentId,
          subjectId: entry.subjectId,
          current: existing
            ? {
                score: existing.score,
                level: existing.level,
                isAbsent: existing.isAbsent,
                version: existing.version,
              }
            : { score: null, level: null, isAbsent: false, version: 0 },
          updatedBy: existing?.updatedBy ?? null,
        });
        continue;
      }
      if (this.isSame(existing, entry)) continue;
      changes.push({
        entry,
        before: existing,
        subject: context.subjects.find(
          (candidate) => candidate.subjectId === entry.subjectId,
        ) as ExamSubject,
        admission: student.admissionNumber,
      });
    }

    const refuse = (found: MarksConflict[]) =>
      new ConflictException({
        code: 'MARKS_CONFLICT',
        message:
          found.length === 1
            ? 'Someone else changed one of these marks while you were working. Review it and save again.'
            : `Someone else changed ${found.length} of these marks while you were working. Review them and save again.`,
        details: { conflicts: found },
      });
    if (conflicts.length > 0) throw refuse(conflicts);

    for (const { entry, before, subject } of changes) {
      const value = this.normalise(entry);
      const existing = context.marks.get(key(entry.studentId, entry.subjectId));
      const lost: MarksConflict = {
        studentId: entry.studentId,
        subjectId: entry.subjectId,
        current: {
          score: before?.score ?? null,
          level: before?.level ?? null,
          isAbsent: before?.isAbsent ?? false,
          version: entry.version,
        },
        updatedBy: null,
      };

      if (existing) {
        // Conditional on the version, so a concurrent save cannot slip in
        // between the check above and this write.
        const { count } = await scope.tx.mark.updateMany({
          where: { id: existing.id, version: entry.version },
          data: { ...value, version: { increment: 1 }, updatedById: actor.principal.userId },
        });
        if (count !== 1) throw refuse([lost]);
      } else {
        try {
          await scope.tx.mark.create({
            data: {
              tenantId: scope.tenantId,
              schoolId: scope.schoolId,
              examinationSubjectId: subject.examSubjectId,
              studentId: entry.studentId,
              ...value,
              updatedById: actor.principal.userId,
            },
          });
        } catch (error) {
          // Two people entering the same empty cell: the second one loses.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            throw refuse([lost]);
          throw error;
        }
      }
    }

    if (changes.length === 0) return;
    await this.audit.record(
      {
        action,
        resourceType: 'examination',
        resourceId: context.exam.id,
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        actorId: actor.principal.userId,
        meta: actor.meta,
        details: {
          examination: context.exam.name,
          class: context.schoolClass.name,
          count: changes.length,
          changes: changes
            .slice(0, MAX_AUDITED_CHANGES)
            .map(({ entry, before, subject, admission }) => ({
              student: admission,
              subject: subject.code,
              before: describeCell(before),
              after: describeCell(this.normalise(entry)),
            })),
          truncated: changes.length > MAX_AUDITED_CHANGES,
        },
      },
      scope.tx,
    );
  }

  private toSheet(principal: Principal, context: SheetContext): MarksSheet {
    const boundaries = context.scheme?.boundaries ?? [];
    const specs = context.subjects.map((subject) => ({
      id: subject.subjectId,
      maxMarks: subject.maxMarks,
      isCompulsory: subject.isCompulsory,
    }));
    const open = context.exam.status === 'OPEN' && principal.permissions.has('marks:enter');

    let marksEntered = 0;
    const students = context.students.map((student): SheetRow => {
      const cells: Record<string, CellView> = {};
      const values = new Map<string, MarkValue>();
      for (const subject of context.subjects) {
        const mark = context.marks.get(key(student.id, subject.subjectId));
        if (!mark) continue;
        cells[subject.subjectId] = {
          score: mark.score,
          level: mark.level,
          isAbsent: mark.isAbsent,
          version: mark.version,
        };
        values.set(subject.subjectId, mark);
        if (describeCell(mark) !== null) marksEntered += 1;
      }
      const result = computeStudent(specs, values, boundaries);
      return {
        studentId: student.id,
        name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
        admissionNumber: student.admissionNumber,
        stream: student.currentStream?.name ?? null,
        marks: cells,
        editableSubjectIds: context.restricted
          ? context.subjects
              .filter((subject) => context.mayEdit(subject.subjectId, student.currentStreamId))
              .map((subject) => subject.subjectId)
          : null,
        total: result.totalScore,
        maxTotal: result.maxTotal,
        average: result.average,
        grade: result.grade,
        isComplete: result.isComplete,
      };
    });

    const compulsory = context.subjects.filter((subject) => subject.isCompulsory).length;
    const marksExpected = Math.max(compulsory * students.length, marksEntered);
    const subjects = context.subjects.map((subject) => ({
      ...subject,
      canEdit:
        open &&
        students.some((student) => student.editableSubjectIds?.includes(subject.subjectId) ?? true),
    }));

    return {
      examination: {
        id: context.exam.id,
        name: context.exam.name,
        status: context.exam.status,
        term: context.exam.term.name,
        academicYear: context.exam.term.academicYear.name,
      },
      class: context.schoolClass,
      grading: context.scheme
        ? {
            name: context.scheme.name,
            levelBased: isLevelBased(boundaries),
            levels: [...boundaries]
              .sort(
                (a, b) =>
                  (b.points ?? 0) - (a.points ?? 0) || (b.minScore ?? 0) - (a.minScore ?? 0),
              )
              .map(({ label, descriptor }) => ({ label, descriptor })),
          }
        : null,
      editable: open && subjects.some((subject) => subject.canEdit),
      subjects,
      students,
      stats: {
        totalStudents: students.length,
        marksEntered,
        marksExpected,
        completion: marksExpected === 0 ? 0 : Math.round((marksEntered / marksExpected) * 100),
        pendingEntry: Math.max(marksExpected - marksEntered, 0),
        awaitingApproval: context.exam.status === 'COMPILED' ? students.length : 0,
      },
    };
  }
}
