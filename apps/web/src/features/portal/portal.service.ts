import { z } from 'zod';
import {
  studentAttendanceSchema,
  type StudentAttendance,
} from '@/features/attendance/attendance.service';
import {
  invoiceSummarySchema,
  mpesaConfigSchema,
  mpesaTransactionSchema,
  statementSchema,
  type MpesaConfig,
  type MpesaTransaction,
  type StkPushInput,
} from '@/features/finance/finance.service';
import { apiDownload, apiRequest, type DownloadedFile } from '@/services/http';

export const portalChildSchema = z.object({
  id: z.string(),
  name: z.string(),
  admissionNumber: z.string(),
  class: z.string().nullable(),
  stream: z.string().nullable(),
  status: z.string(),
  relationship: z.string(),
});
export const portalResultSchema = z.object({
  examinationId: z.string(),
  examination: z.string(),
  term: z.string(),
  academicYear: z.string(),
  publishedAt: z.string().nullable(),
  average: z.number(),
  grade: z.string().nullable(),
  subjectsSat: z.number(),
});
export const portalOverviewSchema = z.object({
  child: portalChildSchema,
  attendance: z.object({
    rate: z.number().nullable(),
    present: z.number(),
    absent: z.number(),
    late: z.number(),
    excused: z.number(),
  }),
  fees: z.object({ currency: z.string(), balance: z.number(), overdue: z.number() }),
  latestResult: portalResultSchema.nullable(),
});
export const portalFeesSchema = z.object({
  statement: statementSchema,
  outstanding: z.array(invoiceSummarySchema),
});
const position = z.object({ position: z.number(), outOf: z.number() }).nullable();
export const portalReportCardSchema = z.object({
  examination: z.object({
    id: z.string(),
    name: z.string(),
    term: z.string(),
    academicYear: z.string(),
  }),
  levelBased: z.boolean(),
  subjects: z.array(
    z.object({
      subject: z.string(),
      score: z.number().nullable(),
      maxMarks: z.number(),
      percentage: z.number().nullable(),
      grade: z.string().nullable(),
      points: z.number().nullable(),
      isAbsent: z.boolean(),
    }),
  ),
  summary: z.object({
    total: z.number(),
    maxTotal: z.number(),
    average: z.number(),
    grade: z.string().nullable(),
    classPosition: position,
    streamPosition: position,
  }),
  remarks: z.object({ classTeacher: z.string().nullable(), principal: z.string().nullable() }),
});
export const portalAccountsSchema = z.object({
  student: z.object({ email: z.string().nullable() }),
  guardians: z.array(
    z.object({
      guardianId: z.string(),
      name: z.string(),
      relationship: z.string(),
      email: z.string().nullable(),
    }),
  ),
});

export type PortalChild = z.infer<typeof portalChildSchema>;
export type PortalResult = z.infer<typeof portalResultSchema>;
export type PortalOverview = z.infer<typeof portalOverviewSchema>;
export type PortalFees = z.infer<typeof portalFeesSchema>;
export type PortalReportCard = z.infer<typeof portalReportCardSchema>;
export type PortalAccounts = z.infer<typeof portalAccountsSchema>;

const child = (id: string, path = '') => `/portal/children/${id}${path}`;

export const portalApi = {
  children: (): Promise<PortalChild[]> =>
    apiRequest({ method: 'GET', url: '/portal/children' }, z.array(portalChildSchema)),
  overview: (id: string): Promise<PortalOverview> =>
    apiRequest({ method: 'GET', url: child(id) }, portalOverviewSchema),
  results: (id: string): Promise<PortalResult[]> =>
    apiRequest({ method: 'GET', url: child(id, '/results') }, z.array(portalResultSchema)),
  reportCard: (id: string, examinationId: string): Promise<PortalReportCard> =>
    apiRequest(
      { method: 'GET', url: child(id, `/report-cards/${examinationId}`) },
      portalReportCardSchema,
    ),
  reportCardPdf: (id: string, examinationId: string): Promise<DownloadedFile> =>
    apiDownload({ url: child(id, `/report-cards/${examinationId}/pdf`) }, 'report-card.pdf'),
  attendance: (id: string, from?: string, to?: string): Promise<StudentAttendance> =>
    apiRequest(
      { method: 'GET', url: child(id, '/attendance'), params: { from, to } },
      studentAttendanceSchema,
    ),
  fees: (id: string): Promise<PortalFees> =>
    apiRequest({ method: 'GET', url: child(id, '/fees') }, portalFeesSchema),
  statementPdf: (id: string): Promise<DownloadedFile> =>
    apiDownload({ url: child(id, '/statement/pdf') }, 'statement.pdf'),
  invoicePdf: (id: string, invoiceId: string): Promise<DownloadedFile> =>
    apiDownload({ url: child(id, `/invoices/${invoiceId}/pdf`) }, 'invoice.pdf'),
  receiptPdf: (id: string, receiptNumber: string): Promise<DownloadedFile> =>
    apiDownload({ url: child(id, `/receipts/${receiptNumber}/pdf`) }, 'receipt.pdf'),
  mpesaConfig: (): Promise<MpesaConfig> =>
    apiRequest({ method: 'GET', url: '/portal/mpesa/config' }, mpesaConfigSchema),
  pay: ({ studentId, ...data }: StkPushInput): Promise<MpesaTransaction> =>
    apiRequest({ method: 'POST', url: child(studentId, '/mpesa'), data }, mpesaTransactionSchema),
  verifyPayment: (id: string): Promise<MpesaTransaction> =>
    apiRequest({ method: 'POST', url: `/portal/mpesa/${id}/verify` }, mpesaTransactionSchema),
};

export const portalAccountsApi = {
  get: (studentId: string): Promise<PortalAccounts> =>
    apiRequest(
      { method: 'GET', url: `/students/${studentId}/portal-accounts` },
      portalAccountsSchema,
    ),
  linkStudent: (studentId: string, email: string | null): Promise<PortalAccounts> =>
    apiRequest(
      { method: 'PUT', url: `/students/${studentId}/portal-accounts/student`, data: { email } },
      portalAccountsSchema,
    ),
  linkGuardian: (
    studentId: string,
    guardianId: string,
    email: string | null,
  ): Promise<PortalAccounts> =>
    apiRequest(
      {
        method: 'PUT',
        url: `/students/${studentId}/portal-accounts/guardians/${guardianId}`,
        data: { email },
      },
      portalAccountsSchema,
    ),
};
