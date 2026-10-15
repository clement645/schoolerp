import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SchoolScope } from '../../common/school/school-scope.service.js';
import type { Boundary, SchemeType } from '../grading/grading.rules.js';
import type { ExamStatus } from './examinations.dto.js';

export interface ExamSubject {
  examSubjectId: string;
  subjectId: string;
  name: string;
  code: string;
  maxMarks: number;
  isCompulsory: boolean;
}

export interface ClassScheme {
  name: string;
  type: SchemeType;
  boundaries: Boundary[];
}

export const examNotFound = () =>
  new NotFoundException({ code: 'EXAMINATION_NOT_FOUND', message: 'Examination not found.' });

export async function findExam(scope: SchoolScope, examinationId: string) {
  const exam = await scope.tx.examination.findFirst({
    where: { id: examinationId, schoolId: scope.schoolId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      compileVersion: true,
      term: {
        select: { id: true, name: true, academicYear: { select: { id: true, name: true } } },
      },
    },
  });
  if (!exam) throw examNotFound();
  return exam;
}

/** Throws unless the examination is in one of the given states. */
export function assertStatus(
  exam: { status: ExamStatus },
  allowed: readonly ExamStatus[],
  message: string,
): void {
  if (!allowed.includes(exam.status)) {
    throw new ConflictException({ code: 'INVALID_EXAM_STATE', message });
  }
}

/** The subjects one class sits in an examination, in a stable order. */
export async function loadExamSubjects(
  scope: SchoolScope,
  examinationId: string,
  classId: string,
): Promise<ExamSubject[]> {
  const rows = await scope.tx.examinationSubject.findMany({
    where: { examinationId, classId },
    select: {
      id: true,
      maxMarks: true,
      isCompulsory: true,
      subject: { select: { id: true, name: true, code: true } },
    },
    orderBy: { subject: { name: 'asc' } },
  });
  return rows.map((row) => ({
    examSubjectId: row.id,
    subjectId: row.subject.id,
    name: row.subject.name,
    code: row.subject.code,
    maxMarks: row.maxMarks.toNumber(),
    isCompulsory: row.isCompulsory,
  }));
}

/** The scheme a class is graded with: its own, else the school default. */
export async function loadClassScheme(
  scope: SchoolScope,
  classId: string,
): Promise<ClassScheme | null> {
  const select = {
    name: true,
    type: true,
    boundaries: { select: { label: true, descriptor: true, minScore: true, points: true } },
  } as const;

  const own = await scope.tx.schoolClass.findFirst({
    where: { id: classId, schoolId: scope.schoolId },
    select: { gradingScheme: { select } },
  });
  const scheme =
    own?.gradingScheme ??
    (await scope.tx.gradingScheme.findFirst({
      where: { schoolId: scope.schoolId, isDefault: true },
      select,
    }));
  if (!scheme) return null;

  return {
    name: scheme.name,
    type: scheme.type,
    boundaries: scheme.boundaries.map((boundary) => ({
      label: boundary.label,
      descriptor: boundary.descriptor,
      minScore: boundary.minScore?.toNumber() ?? null,
      points: boundary.points?.toNumber() ?? null,
    })),
  };
}
