import { z } from 'zod';
import { apiDownload, apiRequest, apiSend, type DownloadedFile } from '@/services/http';

const ref = z.object({ id: z.string(), name: z.string() });

export const examStatusSchema = z.enum(['DRAFT', 'OPEN', 'COMPILED', 'APPROVED', 'PUBLISHED']);
export type ExamStatus = z.infer<typeof examStatusSchema>;

export const examSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: examStatusSchema,
  startDate: z.string(),
  endDate: z.string(),
  term: ref,
  academicYear: ref,
  classes: z.array(ref),
  progress: z.object({ entered: z.number(), expected: z.number() }),
});

const examSubjectSchema = z.object({
  examSubjectId: z.string(),
  subjectId: z.string(),
  name: z.string(),
  code: z.string(),
  maxMarks: z.number(),
  isCompulsory: z.boolean(),
});

export const examDetailSchema = examSummarySchema.extend({
  compiledAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  subjectsByClass: z.array(z.object({ class: ref, subjects: z.array(examSubjectSchema) })),
});

const cellSchema = z.object({
  score: z.number().nullable(),
  level: z.string().nullable(),
  isAbsent: z.boolean(),
  version: z.number(),
});

export const marksSheetSchema = z.object({
  examination: z.object({
    id: z.string(),
    name: z.string(),
    status: examStatusSchema,
    term: z.string(),
    academicYear: z.string(),
  }),
  class: ref,
  grading: z
    .object({
      name: z.string(),
      levelBased: z.boolean(),
      levels: z.array(z.object({ label: z.string(), descriptor: z.string().nullable() })),
    })
    .nullable(),
  editable: z.boolean(),
  subjects: z.array(examSubjectSchema.extend({ canEdit: z.boolean() })),
  students: z.array(
    z.object({
      studentId: z.string(),
      name: z.string(),
      admissionNumber: z.string(),
      stream: z.string().nullable(),
      marks: z.record(z.string(), cellSchema),
      editableSubjectIds: z.array(z.string()).nullable(),
      total: z.number(),
      maxTotal: z.number(),
      average: z.number(),
      grade: z.string().nullable(),
      isComplete: z.boolean(),
    }),
  ),
  stats: z.object({
    totalStudents: z.number(),
    marksEntered: z.number(),
    marksExpected: z.number(),
    completion: z.number(),
    pendingEntry: z.number(),
    awaitingApproval: z.number(),
  }),
});

const importResultSchema = z.object({
  imported: z.boolean(),
  changes: z.number(),
  overwrites: z.number(),
  problems: z.array(z.object({ row: z.number(), message: z.string() })),
  problemsTruncated: z.boolean(),
});

export const conflictSchema = z.object({
  conflicts: z.array(
    z.object({
      studentId: z.string(),
      subjectId: z.string(),
      current: cellSchema,
      updatedBy: z.string().nullable(),
    }),
  ),
});

export type ExamSummary = z.infer<typeof examSummarySchema>;
export type ExamDetail = z.infer<typeof examDetailSchema>;
export type MarksSheet = z.infer<typeof marksSheetSchema>;
export type SheetCell = z.infer<typeof cellSchema>;
export type SheetSubject = MarksSheet['subjects'][number];
export type SheetStudent = MarksSheet['students'][number];
export type MarksImportResult = z.infer<typeof importResultSchema>;
export type MarksConflict = z.infer<typeof conflictSchema>['conflicts'][number];

export interface MarkEntry {
  studentId: string;
  subjectId: string;
  score?: number | null;
  level?: string | null;
  isAbsent?: boolean;
  version: number;
}

export interface CreateExamInput {
  name: string;
  type: string;
  termId: string;
  startDate: string;
  endDate: string;
  classIds: string[];
  maxMarks: number;
}

export type ExamAction = 'open' | 'compile' | 'reopen' | 'approve' | 'publish';

export const examsApi = {
  list: (): Promise<ExamSummary[]> =>
    apiRequest({ method: 'GET', url: '/examinations' }, z.array(examSummarySchema)),
  get: (id: string): Promise<ExamDetail> =>
    apiRequest({ method: 'GET', url: `/examinations/${id}` }, examDetailSchema),
  create: (data: CreateExamInput): Promise<ExamDetail> =>
    apiRequest({ method: 'POST', url: '/examinations', data }, examDetailSchema),
  delete: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/examinations/${id}` }),
  act: (id: string, action: ExamAction): Promise<ExamDetail> =>
    apiRequest({ method: 'POST', url: `/examinations/${id}/${action}` }, examDetailSchema),
  setMaxMarks: (id: string, examSubjectId: string, maxMarks: number): Promise<ExamDetail> =>
    apiRequest(
      { method: 'PUT', url: `/examinations/${id}/subjects/${examSubjectId}`, data: { maxMarks } },
      examDetailSchema,
    ),

  sheet: (id: string, classId: string, streamId?: string): Promise<MarksSheet> =>
    apiRequest(
      {
        method: 'GET',
        url: `/examinations/${id}/marks`,
        params: { classId, streamId: streamId || undefined },
      },
      marksSheetSchema,
    ),
  saveMarks: (id: string, classId: string, entries: MarkEntry[]): Promise<MarksSheet> =>
    apiRequest(
      { method: 'PUT', url: `/examinations/${id}/marks`, data: { classId, entries } },
      marksSheetSchema,
    ),

  exportMarks: (id: string, classId: string, streamId?: string): Promise<DownloadedFile> =>
    apiDownload(
      {
        url: `/examinations/${id}/marks/export`,
        params: { classId, streamId: streamId || undefined },
      },
      'marks.xlsx',
    ),
  importMarks(
    id: string,
    classId: string,
    file: File,
    dryRun: boolean,
  ): Promise<MarksImportResult> {
    const data = new FormData();
    data.append('file', file);
    return apiRequest(
      {
        method: 'POST',
        url: `/examinations/${id}/marks/import`,
        params: { classId, ...(dryRun ? { dryRun: true } : {}) },
        data,
      },
      importResultSchema,
    );
  },
};

export const EXAM_TYPES = [
  { value: 'OPENING', label: 'Opening Exam' },
  { value: 'MID_TERM', label: 'Mid-Term Exam' },
  { value: 'END_TERM', label: 'End-Term Exam' },
  { value: 'MOCK', label: 'Mock Exam' },
  { value: 'CONTINUOUS_ASSESSMENT', label: 'Continuous Assessment' },
  { value: 'CUSTOM', label: 'Custom Examination' },
];
export const examTypeLabel = (type: string): string =>
  EXAM_TYPES.find((entry) => entry.value === type)?.label ?? type;

export const EXAM_STATUS: Record<
  ExamStatus,
  { label: string; variant: 'neutral' | 'info' | 'warning' | 'primary' | 'success' }
> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  OPEN: { label: 'Marks entry open', variant: 'info' },
  COMPILED: { label: 'Awaiting approval', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'primary' },
  PUBLISHED: { label: 'Published', variant: 'success' },
};
