import { z } from 'zod';
import { apiRequest } from '@/services/http';
import { examStatusSchema } from './examinations.service';

const trendSchema = z.object({ direction: z.enum(['up', 'down', 'same']), change: z.number() });

const meritRowSchema = z.object({
  resultId: z.string(),
  rank: z.number().nullable(),
  student: z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() }),
  class: z.string(),
  stream: z.string().nullable(),
  total: z.number(),
  maxTotal: z.number(),
  average: z.number(),
  grade: z.string().nullable(),
  points: z.number().nullable(),
  trend: trendSchema.nullable(),
  isComplete: z.boolean(),
  passed: z.boolean().nullable(),
});

export const resultsOverviewSchema = z.object({
  examination: z.object({
    id: z.string(),
    name: z.string(),
    status: examStatusSchema,
    term: z.string(),
    academicYear: z.string(),
  }),
  stats: z.object({
    studentsExamined: z.number(),
    meanScore: z.number(),
    highestScore: z.number(),
    lowestScore: z.number(),
    passPercentage: z.number(),
  }),
  meritList: z.array(meritRowSchema),
});

export const resultsAnalyticsSchema = z.object({
  subjectPerformance: z.array(
    z.object({
      subject: z.string(),
      code: z.string(),
      mean: z.number(),
      highest: z.number(),
      lowest: z.number(),
      entries: z.number(),
    }),
  ),
  gradeDistribution: z.array(z.object({ grade: z.string(), count: z.number() })),
  classComparison: z.array(
    z.object({
      class: z.string(),
      mean: z.number(),
      passPercentage: z.number(),
      students: z.number(),
    }),
  ),
  streamComparison: z.array(
    z.object({ class: z.string(), stream: z.string(), mean: z.number(), students: z.number() }),
  ),
  trend: z.array(
    z.object({
      examinationId: z.string(),
      examination: z.string(),
      date: z.string(),
      mean: z.number(),
      passPercentage: z.number(),
    }),
  ),
});

export const studentResultSchema = z.object({
  student: z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() }),
  examination: z.string(),
  class: z.string(),
  stream: z.string().nullable(),
  average: z.number(),
  grade: z.string().nullable(),
  classPosition: z.number().nullable(),
  classSize: z.number(),
  subjects: z.array(
    z.object({
      subject: z.string(),
      code: z.string(),
      score: z.number().nullable(),
      maxMarks: z.number(),
      value: z.number().nullable(),
      grade: z.string().nullable(),
      isAbsent: z.boolean(),
      classMean: z.number().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      examination: z.string(),
      date: z.string(),
      average: z.number(),
      grade: z.string().nullable(),
    }),
  ),
});

export type ResultsOverview = z.infer<typeof resultsOverviewSchema>;
export type MeritRow = ResultsOverview['meritList'][number];
export type ResultsAnalytics = z.infer<typeof resultsAnalyticsSchema>;
export type StudentResult = z.infer<typeof studentResultSchema>;

export interface ResultsFilter {
  examinationId: string;
  classId?: string;
  stream?: string;
}

const params = (filter: ResultsFilter) => ({
  examinationId: filter.examinationId,
  classId: filter.classId || undefined,
  stream: filter.stream || undefined,
});

export const resultsApi = {
  overview: (filter: ResultsFilter): Promise<ResultsOverview> =>
    apiRequest({ method: 'GET', url: '/results', params: params(filter) }, resultsOverviewSchema),
  analytics: (filter: ResultsFilter): Promise<ResultsAnalytics> =>
    apiRequest(
      { method: 'GET', url: '/results/analytics', params: params(filter) },
      resultsAnalyticsSchema,
    ),
  student: (examinationId: string, studentId: string): Promise<StudentResult> =>
    apiRequest(
      { method: 'GET', url: `/results/students/${studentId}`, params: { examinationId } },
      studentResultSchema,
    ),
};

/** `+4.5`, `-10`, or `0` — the change in a learner's average. */
export const formatChange = (change: number): string =>
  change > 0 ? `+${change}` : String(change);
