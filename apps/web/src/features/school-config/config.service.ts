import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';

// ── School profile ───────────────────────────────────────────────────────────

export const schoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  motto: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  county: z.string().nullable(),
  country: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  hasLogo: z.boolean(),
});
export type School = z.infer<typeof schoolSchema>;
export type SchoolUpdate = Partial<Omit<School, 'id' | 'hasLogo'>>;

export const schoolApi = {
  get: (): Promise<School> => apiRequest({ method: 'GET', url: '/school' }, schoolSchema),
  update: (data: SchoolUpdate): Promise<School> =>
    apiRequest({ method: 'PATCH', url: '/school', data }, schoolSchema),
  setLogo(file: File): Promise<void> {
    const data = new FormData();
    data.append('file', file);
    return apiSend({ method: 'PUT', url: '/school/logo', data });
  },
  removeLogo: (): Promise<void> => apiSend({ method: 'DELETE', url: '/school/logo' }),
};

// ── Results policies ────────────────────────────────────────────────────────

export const schoolPoliciesSchema = z.object({
  passMark: z.number(),
  rankingPolicy: z.enum(['COMPETITION', 'DENSE']),
  showClassPosition: z.boolean(),
  showStreamPosition: z.boolean(),
  currency: z.string(),
});
export type SchoolPolicies = z.infer<typeof schoolPoliciesSchema>;

export const policiesApi = {
  get: (): Promise<SchoolPolicies> =>
    apiRequest({ method: 'GET', url: '/school/settings' }, schoolPoliciesSchema),
  update: (data: Partial<SchoolPolicies>): Promise<SchoolPolicies> =>
    apiRequest({ method: 'PUT', url: '/school/settings', data }, schoolPoliciesSchema),
};

// ── Academic years and terms ─────────────────────────────────────────────────

export const termSchema = z.object({
  id: z.string(),
  academicYearId: z.string(),
  name: z.string(),
  sequence: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
});
export const academicYearSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
  terms: z.array(termSchema),
});
export type Term = z.infer<typeof termSchema>;
export type AcademicYear = z.infer<typeof academicYearSchema>;

export interface YearInput {
  name: string;
  startDate: string;
  endDate: string;
}
export interface TermInput extends YearInput {
  sequence: number;
}

export const academicsApi = {
  listYears: (): Promise<AcademicYear[]> =>
    apiRequest({ method: 'GET', url: '/academic-years' }, z.array(academicYearSchema)),
  createYear: (data: YearInput): Promise<AcademicYear> =>
    apiRequest({ method: 'POST', url: '/academic-years', data }, academicYearSchema),
  updateYear: (id: string, data: YearInput): Promise<AcademicYear> =>
    apiRequest({ method: 'PATCH', url: `/academic-years/${id}`, data }, academicYearSchema),
  setCurrentYear: (id: string): Promise<AcademicYear> =>
    apiRequest({ method: 'POST', url: `/academic-years/${id}/set-current` }, academicYearSchema),
  deleteYear: (id: string): Promise<void> =>
    apiSend({ method: 'DELETE', url: `/academic-years/${id}` }),
  createTerm: (yearId: string, data: TermInput): Promise<Term> =>
    apiRequest({ method: 'POST', url: `/academic-years/${yearId}/terms`, data }, termSchema),
  updateTerm: (id: string, data: TermInput): Promise<Term> =>
    apiRequest({ method: 'PATCH', url: `/terms/${id}`, data }, termSchema),
  setCurrentTerm: (id: string): Promise<Term> =>
    apiRequest({ method: 'POST', url: `/terms/${id}/set-current` }, termSchema),
  deleteTerm: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/terms/${id}` }),
};

// ── Grading schemes ──────────────────────────────────────────────────────────

export const schemeTypeSchema = z.enum(['PERCENTAGE', 'COMPETENCY']);
export type SchemeType = z.infer<typeof schemeTypeSchema>;

export const gradeBoundarySchema = z.object({
  id: z.string(),
  label: z.string(),
  descriptor: z.string().nullable(),
  minScore: z.number().nullable(),
  upperLimit: z.number().nullable(),
  points: z.number().nullable(),
});
export const gradingSchemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: schemeTypeSchema,
  description: z.string().nullable(),
  isDefault: z.boolean(),
  classCount: z.number(),
  boundaries: z.array(gradeBoundarySchema),
});
export type GradeBoundary = z.infer<typeof gradeBoundarySchema>;
export type GradingScheme = z.infer<typeof gradingSchemeSchema>;

export interface BoundaryInput {
  label: string;
  descriptor: string | null;
  minScore: number | null;
  points: number | null;
}
export interface GradingSchemeInput {
  name: string;
  type: SchemeType;
  description: string | null;
  boundaries: BoundaryInput[];
}

export const gradingApi = {
  list: (): Promise<GradingScheme[]> =>
    apiRequest({ method: 'GET', url: '/grading-schemes' }, z.array(gradingSchemeSchema)),
  create: (data: GradingSchemeInput): Promise<GradingScheme> =>
    apiRequest({ method: 'POST', url: '/grading-schemes', data }, gradingSchemeSchema),
  replace: (id: string, data: GradingSchemeInput): Promise<GradingScheme> =>
    apiRequest({ method: 'PUT', url: `/grading-schemes/${id}`, data }, gradingSchemeSchema),
  setDefault: (id: string): Promise<GradingScheme> =>
    apiRequest({ method: 'POST', url: `/grading-schemes/${id}/set-default` }, gradingSchemeSchema),
  delete: (id: string): Promise<void> =>
    apiSend({ method: 'DELETE', url: `/grading-schemes/${id}` }),
};

/** "80 – 100", "75 – below 80", or a dash for levels awarded directly. */
export function describeRange(boundary: Pick<GradeBoundary, 'minScore' | 'upperLimit'>): string {
  if (boundary.minScore === null) return '—';
  return boundary.upperLimit === null
    ? `${boundary.minScore} – 100`
    : `${boundary.minScore} – below ${boundary.upperLimit}`;
}

/**
 * Starting points an administrator can adapt. They are examples, not national
 * standards: every school confirms its own scale.
 */
export const SCHEME_TEMPLATES: { id: string; label: string; scheme: GradingSchemeInput }[] = [
  {
    id: 'percentage-12',
    label: 'Percentage — 12 letter grades (A to E)',
    scheme: {
      name: 'Percentage grades',
      type: 'PERCENTAGE',
      description: null,
      boundaries: (
        [
          ['A', 80, 12],
          ['A-', 75, 11],
          ['B+', 70, 10],
          ['B', 65, 9],
          ['B-', 60, 8],
          ['C+', 55, 7],
          ['C', 50, 6],
          ['C-', 45, 5],
          ['D+', 40, 4],
          ['D', 35, 3],
          ['D-', 30, 2],
          ['E', 0, 1],
        ] as const
      ).map(([label, minScore, points]) => ({ label, descriptor: null, minScore, points })),
    },
  },
  {
    id: 'competency-4',
    label: 'Competency-based — 4 performance levels',
    scheme: {
      name: 'Competency levels',
      type: 'COMPETENCY',
      description: null,
      boundaries: (
        [
          ['EE', 'Exceeding Expectation', 4],
          ['ME', 'Meeting Expectation', 3],
          ['AE', 'Approaching Expectation', 2],
          ['BE', 'Below Expectation', 1],
        ] as const
      ).map(([label, descriptor, points]) => ({ label, descriptor, minScore: null, points })),
    },
  },
];
