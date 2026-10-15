import { z } from 'zod';
import { apiDownload, apiRequest, type DownloadedFile } from '@/services/http';
import { examStatusSchema } from './examinations.service';

export const REMARK_MAX_LENGTH = 500;

const rowSchema = z.object({
  student: z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() }),
  class: z.string(),
  stream: z.string().nullable(),
  average: z.number(),
  grade: z.string().nullable(),
  classPosition: z.number().nullable(),
  hasClassTeacherRemarks: z.boolean(),
  hasPrincipalRemarks: z.boolean(),
});

export const reportCardListSchema = z.object({
  examination: z.object({
    id: z.string(),
    name: z.string(),
    status: examStatusSchema,
    term: z.string(),
    academicYear: z.string(),
  }),
  canEdit: z.object({ classTeacherRemarks: z.boolean(), principalRemarks: z.boolean() }),
  rows: z.array(rowSchema),
});

const positionSchema = z.object({ position: z.number(), outOf: z.number() }).nullable();

/** Only what the app reads; the PDF itself is rendered by the server. */
export const reportCardSchema = z.object({
  student: z.object({
    id: z.string(),
    name: z.string(),
    admissionNumber: z.string(),
    class: z.string(),
    stream: z.string().nullable(),
  }),
  examination: z.object({
    id: z.string(),
    name: z.string(),
    term: z.string(),
    academicYear: z.string(),
  }),
  summary: z.object({
    average: z.number(),
    grade: z.string().nullable(),
    classPosition: positionSchema,
    streamPosition: positionSchema,
  }),
  remarks: z.object({ classTeacher: z.string().nullable(), principal: z.string().nullable() }),
  isPublished: z.boolean(),
});

export type ReportCardList = z.infer<typeof reportCardListSchema>;
export type ReportCardRow = ReportCardList['rows'][number];
export type ReportCard = z.infer<typeof reportCardSchema>;

export interface ReportCardFilter {
  classId?: string;
  stream?: string;
}
export interface RemarksInput {
  classTeacherRemarks?: string | null;
  principalRemarks?: string | null;
}

const base = (examinationId: string) => `/examinations/${examinationId}/report-cards`;
const params = (filter: ReportCardFilter) => ({
  classId: filter.classId || undefined,
  stream: filter.stream || undefined,
});

export const reportCardsApi = {
  list: (examinationId: string, filter: ReportCardFilter): Promise<ReportCardList> =>
    apiRequest(
      { method: 'GET', url: base(examinationId), params: params(filter) },
      reportCardListSchema,
    ),
  card: (examinationId: string, studentId: string): Promise<ReportCard> =>
    apiRequest(
      { method: 'GET', url: `${base(examinationId)}/students/${studentId}` },
      reportCardSchema,
    ),
  pdf: (examinationId: string, studentId: string): Promise<DownloadedFile> =>
    apiDownload({ url: `${base(examinationId)}/students/${studentId}/pdf` }, 'report-card.pdf'),
  bulkPdf: (examinationId: string, filter: ReportCardFilter): Promise<DownloadedFile> =>
    apiDownload({ url: `${base(examinationId)}/pdf`, params: params(filter) }, 'report-cards.pdf'),
  saveRemarks: (
    examinationId: string,
    studentId: string,
    data: RemarksInput,
  ): Promise<ReportCard> =>
    apiRequest(
      { method: 'PUT', url: `${base(examinationId)}/students/${studentId}/remarks`, data },
      reportCardSchema,
    ),
};
