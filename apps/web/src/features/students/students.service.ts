import { z } from 'zod';
import { apiRequest, apiSend, http, toApiRequestError } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';

const ref = z.object({ id: z.string(), name: z.string() });

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER']);
export const studentStatusSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'TRANSFERRED',
  'WITHDRAWN',
  'GRADUATED',
]);
export type Gender = z.infer<typeof genderSchema>;
export type StudentStatus = z.infer<typeof studentStatusSchema>;

export const studentSummarySchema = z.object({
  id: z.string(),
  admissionNumber: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  gender: genderSchema,
  dateOfBirth: z.string(),
  admissionDate: z.string(),
  status: studentStatusSchema,
  hasPhoto: z.boolean(),
  class: ref.nullable(),
  stream: ref.nullable(),
});

export const guardianSchema = z.object({
  guardianId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  occupation: z.string().nullable(),
  address: z.string().nullable(),
  relationship: z.string(),
  isPrimary: z.boolean(),
});

export const enrollmentSchema = z.object({
  id: z.string(),
  academicYear: ref,
  class: ref,
  stream: ref.nullable(),
  reason: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
});

export const studentDetailSchema = studentSummarySchema.extend({
  nationality: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  emergencyContactRelationship: z.string().nullable(),
  leftOn: z.string().nullable(),
  leavingReason: z.string().nullable(),
  guardians: z.array(guardianSchema),
  enrollments: z.array(enrollmentSchema),
});

export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  uploadedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type StudentDocument = z.infer<typeof documentSchema>;

export type StudentSummary = z.infer<typeof studentSummarySchema>;
export type StudentDetail = z.infer<typeof studentDetailSchema>;
export type Guardian = z.infer<typeof guardianSchema>;

const importResultSchema = z.object({
  imported: z.boolean(),
  valid: z.number(),
  problems: z.array(z.object({ row: z.number(), message: z.string() })),
  problemsTruncated: z.boolean(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

const promotionResultSchema = z.object({
  promoted: z.number(),
  repeated: z.number(),
  graduated: z.number(),
});
export type PromotionResult = z.infer<typeof promotionResultSchema>;

const guardianMatchSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  students: z.array(z.string()),
});
export type GuardianMatch = z.infer<typeof guardianMatchSchema>;

export interface StudentFilters {
  search?: string;
  classId?: string;
  streamId?: string;
  status?: StudentStatus | '';
  sort?: 'name' | 'admissionNumber' | 'admissionDate' | 'class';
  order?: 'asc' | 'desc';
}
export interface StudentListParams extends StudentFilters {
  page: number;
  pageSize: number;
}

export interface GuardianDetails {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  occupation?: string | null;
  address?: string | null;
}

export interface StudentPersonalInput {
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  gender: Gender;
  nationality: string | null;
  admissionDate: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
}
export interface AdmitStudentInput extends StudentPersonalInput {
  classId: string;
  streamId: string | null;
  guardians: (GuardianDetails & { relationship: string })[];
}

/** Drops empty filters so they are not sent as blank query parameters. */
const clean = (params: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null));

export const studentsApi = {
  list: (params: StudentListParams): Promise<Paginated<StudentSummary>> =>
    apiRequest(
      { method: 'GET', url: '/students', params: clean(params) },
      paginatedSchema(studentSummarySchema),
    ),

  /** Every matching student, fetched page by page (for pick-lists). */
  async listAll(filters: StudentFilters, limit = 500): Promise<StudentSummary[]> {
    const all: StudentSummary[] = [];
    for (let page = 1; all.length < limit; page += 1) {
      const result = await studentsApi.list({ ...filters, page, pageSize: 100 });
      all.push(...result.items);
      if (all.length >= result.total || result.items.length === 0) break;
    }
    return all;
  },

  get: (id: string): Promise<StudentDetail> =>
    apiRequest({ method: 'GET', url: `/students/${id}` }, studentDetailSchema),

  create: (data: AdmitStudentInput): Promise<StudentDetail> =>
    apiRequest({ method: 'POST', url: '/students', data }, studentDetailSchema),

  update: (id: string, data: Partial<StudentPersonalInput>): Promise<StudentDetail> =>
    apiRequest({ method: 'PATCH', url: `/students/${id}`, data }, studentDetailSchema),

  transfer: (
    id: string,
    data: { classId: string; streamId: string | null },
  ): Promise<StudentDetail> =>
    apiRequest({ method: 'POST', url: `/students/${id}/transfer`, data }, studentDetailSchema),

  changeStatus: (
    id: string,
    data: {
      status: StudentStatus;
      effectiveDate?: string;
      reason?: string | null;
      classId?: string;
      streamId?: string | null;
    },
  ): Promise<StudentDetail> =>
    apiRequest({ method: 'POST', url: `/students/${id}/status`, data }, studentDetailSchema),

  promote: (data: {
    fromClassId: string;
    toAcademicYearId: string;
    toClassId: string | null;
    studentIds: string[];
  }): Promise<PromotionResult> =>
    apiRequest({ method: 'POST', url: '/students/promote', data }, promotionResultSchema),

  searchGuardians: (search: string): Promise<GuardianMatch[]> =>
    apiRequest(
      { method: 'GET', url: '/students/guardians', params: { search } },
      z.array(guardianMatchSchema),
    ),

  addGuardian: (
    id: string,
    data: {
      guardianId?: string;
      details?: GuardianDetails;
      relationship: string;
      isPrimary?: boolean;
    },
  ): Promise<StudentDetail> =>
    apiRequest({ method: 'POST', url: `/students/${id}/guardians`, data }, studentDetailSchema),

  updateGuardian: (
    id: string,
    guardianId: string,
    data: { details?: GuardianDetails; relationship?: string; isPrimary?: boolean },
  ): Promise<StudentDetail> =>
    apiRequest(
      { method: 'PATCH', url: `/students/${id}/guardians/${guardianId}`, data },
      studentDetailSchema,
    ),

  removeGuardian: (id: string, guardianId: string): Promise<StudentDetail> =>
    apiRequest(
      { method: 'DELETE', url: `/students/${id}/guardians/${guardianId}` },
      studentDetailSchema,
    ),

  setPhoto(id: string, file: File): Promise<void> {
    const data = new FormData();
    data.append('file', file);
    return apiSend({ method: 'PUT', url: `/students/${id}/photo`, data });
  },

  removePhoto: (id: string): Promise<void> =>
    apiSend({ method: 'DELETE', url: `/students/${id}/photo` }),

  listDocuments: (id: string): Promise<StudentDocument[]> =>
    apiRequest({ method: 'GET', url: `/students/${id}/documents` }, z.array(documentSchema)),

  uploadDocument(
    id: string,
    input: { title: string; category: string; file: File },
  ): Promise<StudentDocument> {
    const data = new FormData();
    data.append('title', input.title);
    data.append('category', input.category);
    data.append('file', input.file);
    return apiRequest({ method: 'POST', url: `/students/${id}/documents`, data }, documentSchema);
  },

  deleteDocument: (id: string, documentId: string): Promise<void> =>
    apiSend({ method: 'DELETE', url: `/students/${id}/documents/${documentId}` }),

  async downloadDocument(id: string, documentId: string): Promise<Blob> {
    try {
      const response = await http.get<Blob>(`/students/${id}/documents/${documentId}/download`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  importCsv(file: File, dryRun: boolean): Promise<ImportResult> {
    const data = new FormData();
    data.append('file', file);
    return apiRequest(
      { method: 'POST', url: '/students/import', params: dryRun ? { dryRun: true } : {}, data },
      importResultSchema,
    );
  },

  /** Downloads the filtered directory. Returns the file and its suggested name. */
  async exportCsv(filters: StudentFilters): Promise<{ blob: Blob; filename: string }> {
    try {
      const response = await http.get<Blob>('/students/export', {
        params: clean(filters),
        responseType: 'blob',
      });
      const disposition = String(response.headers['content-disposition'] ?? '');
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'students.csv';
      return { blob: response.data, filename };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

export const STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  TRANSFERRED: 'Transferred out',
  WITHDRAWN: 'Withdrawn',
  GRADUATED: 'Graduated',
};

export const STATUS_VARIANTS = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  TRANSFERRED: 'neutral',
  WITHDRAWN: 'neutral',
  GRADUATED: 'info',
} as const satisfies Record<StudentStatus, string>;

export const RELATIONSHIP_OPTIONS = [
  { value: 'MOTHER', label: 'Mother' },
  { value: 'FATHER', label: 'Father' },
  { value: 'GUARDIAN', label: 'Guardian' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'OTHER', label: 'Other' },
];

export const ENROLLMENT_REASONS: Record<string, string> = {
  ADMISSION: 'Admitted',
  READMISSION: 'Re-admitted',
  PROMOTION: 'Promoted',
  TRANSFER: 'Moved class or stream',
  REPEAT: 'Repeating the class',
};

export const hasLeft = (status: StudentStatus): boolean =>
  status === 'TRANSFERRED' || status === 'WITHDRAWN' || status === 'GRADUATED';

export const fullName = (person: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}) => [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');

/** Columns of the import template, in order. Must match the API's importer. */
export const IMPORT_COLUMNS = [
  'admission_number',
  'first_name',
  'middle_name',
  'last_name',
  'date_of_birth',
  'gender',
  'nationality',
  'admission_date',
  'class',
  'stream',
  'guardian_first_name',
  'guardian_last_name',
  'guardian_phone',
  'guardian_relationship',
];

export const DOCUMENT_CATEGORIES = [
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'PREVIOUS_SCHOOL', label: 'Previous school' },
  { value: 'IDENTIFICATION', label: 'Identification' },
  { value: 'OTHER', label: 'Other' },
];

/** "1.4 MB", "320 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
