import { z } from 'zod';
import { paymentSummarySchema } from '@/features/finance/finance.service';
import { apiRequest } from '@/services/http';

export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(['ACADEMIC', 'EXAMINATION', 'HOLIDAY', 'MEETING', 'SPORTS', 'OTHER']),
  visibility: z.enum(['EVERYONE', 'STAFF']),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  location: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const dashboardSchema = z.object({
  term: z
    .object({
      id: z.string(),
      name: z.string(),
      academicYear: z.string(),
      startDate: z.string(),
      endDate: z.string(),
    })
    .nullable(),
  counts: z.object({
    students: z.number().nullable(),
    teachers: z.number().nullable(),
    classes: z.number().nullable(),
  }),
  attendance: z
    .object({
      week: z.array(
        z.object({
          date: z.string(),
          present: z.number(),
          absent: z.number(),
          late: z.number(),
          excused: z.number(),
          rate: z.number().nullable(),
        }),
      ),
      today: z.object({ rate: z.number().nullable(), marked: z.number() }),
    })
    .nullable(),
  performance: z
    .object({
      trend: z.array(
        z.object({
          examination: z.string(),
          date: z.string(),
          mean: z.number(),
          passPercentage: z.number(),
        }),
      ),
      latest: z
        .object({
          examinationId: z.string(),
          name: z.string(),
          status: z.string(),
          meanScore: z.number(),
          passPercentage: z.number(),
        })
        .nullable(),
      meritList: z.array(
        z.object({
          resultId: z.string(),
          rank: z.number().nullable(),
          student: z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() }),
          class: z.string(),
          stream: z.string().nullable(),
          average: z.number(),
          grade: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  finance: z
    .object({
      currency: z.string(),
      collected: z.number(),
      outstanding: z.number(),
      collectionRate: z.number(),
      recentPayments: z.array(paymentSummarySchema),
    })
    .nullable(),
  upcomingEvents: z.array(calendarEventSchema).nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardApi = {
  get: (termId?: string): Promise<Dashboard> =>
    apiRequest(
      { method: 'GET', url: '/dashboard', params: { termId: termId || undefined } },
      dashboardSchema,
    ),
};

export const EVENT_CATEGORY: Record<CalendarEvent['category'], { label: string; tone: string }> = {
  ACADEMIC: { label: 'Academic', tone: 'bg-primary-light text-primary' },
  EXAMINATION: { label: 'Examination', tone: 'bg-info/10 text-info' },
  HOLIDAY: { label: 'Holiday', tone: 'bg-warning/15 text-warning' },
  MEETING: { label: 'Meeting', tone: 'bg-success/10 text-success' },
  SPORTS: { label: 'Sports', tone: 'bg-danger/10 text-danger' },
  OTHER: { label: 'Other', tone: 'bg-fg/5 text-fg-muted' },
};
