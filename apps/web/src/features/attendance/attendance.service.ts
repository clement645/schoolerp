import { z } from 'zod';
import { apiRequest } from '@/services/http';

export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

const studentRef = z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() });
const tally = {
  present: z.number(),
  absent: z.number(),
  late: z.number(),
  excused: z.number(),
  marked: z.number(),
  rate: z.number().nullable(),
};
const tallySchema = z.object(tally);

export const registerSchema = z.object({
  class: z.object({ id: z.string(), name: z.string() }),
  date: z.string(),
  lastMarkedAt: z.string().nullable(),
  students: z.array(
    z.object({
      student: studentRef,
      stream: z.string().nullable(),
      status: attendanceStatusSchema.nullable(),
      note: z.string().nullable(),
    }),
  ),
  summary: z.object({ ...tally, unmarked: z.number() }),
});

export const attendanceSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: tallySchema,
  daily: z.array(z.object({ ...tally, date: z.string() })),
  byClass: z.array(
    z.object({
      classId: z.string(),
      class: z.string(),
      rate: z.number().nullable(),
      marked: z.number(),
    }),
  ),
  students: z.array(z.object({ ...tally, student: studentRef, stream: z.string().nullable() })),
});

export const monthlyRegisterSchema = z.object({
  month: z.string(),
  class: z.object({ id: z.string(), name: z.string() }),
  days: z.array(z.string()),
  students: z.array(
    z.object({
      ...tally,
      student: studentRef,
      stream: z.string().nullable(),
      marks: z.record(z.string(), attendanceStatusSchema),
    }),
  ),
});

export const studentAttendanceSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: tallySchema,
  records: z.array(
    z.object({ date: z.string(), status: attendanceStatusSchema, note: z.string().nullable() }),
  ),
});

export type Register = z.infer<typeof registerSchema>;
export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>;
export type MonthlyRegister = z.infer<typeof monthlyRegisterSchema>;
export type StudentAttendance = z.infer<typeof studentAttendanceSchema>;
export type Tally = z.infer<typeof tallySchema>;

export interface RegisterQuery {
  classId: string;
  streamId?: string;
  date: string;
}
export interface AttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
  note?: string | null;
}
export interface RangeQuery {
  classId?: string;
  streamId?: string;
  from: string;
  to: string;
}

const clean = <T extends object>(query: T): T =>
  Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '')) as T;

export const attendanceApi = {
  register: (query: RegisterQuery): Promise<Register> =>
    apiRequest(
      { method: 'GET', url: '/attendance/register', params: clean(query) },
      registerSchema,
    ),
  mark: (query: RegisterQuery, records: AttendanceEntry[]): Promise<Register> =>
    apiRequest(
      { method: 'PUT', url: '/attendance/register', data: { ...clean(query), records } },
      registerSchema,
    ),
  summary: (query: RangeQuery): Promise<AttendanceSummary> =>
    apiRequest(
      { method: 'GET', url: '/attendance/summary', params: clean(query) },
      attendanceSummarySchema,
    ),
  monthly: (query: {
    classId: string;
    streamId?: string;
    month: string;
  }): Promise<MonthlyRegister> =>
    apiRequest(
      { method: 'GET', url: '/attendance/monthly', params: clean(query) },
      monthlyRegisterSchema,
    ),
  student: (studentId: string, from: string, to: string): Promise<StudentAttendance> =>
    apiRequest(
      { method: 'GET', url: `/attendance/students/${studentId}`, params: { from, to } },
      studentAttendanceSchema,
    ),
};

export const STATUSES: {
  value: AttendanceStatus;
  label: string;
  /** One letter, used in the monthly register. */
  short: string;
  /** Classes for a selected toggle or a register cell. */
  tone: string;
  variant: 'success' | 'danger' | 'warning' | 'info';
}[] = [
  {
    value: 'PRESENT',
    label: 'Present',
    short: 'P',
    tone: 'bg-success/15 text-success',
    variant: 'success',
  },
  {
    value: 'ABSENT',
    label: 'Absent',
    short: 'A',
    tone: 'bg-danger/15 text-danger',
    variant: 'danger',
  },
  {
    value: 'LATE',
    label: 'Late',
    short: 'L',
    tone: 'bg-warning/20 text-warning',
    variant: 'warning',
  },
  { value: 'EXCUSED', label: 'Excused', short: 'E', tone: 'bg-info/15 text-info', variant: 'info' },
];

export const statusInfo = (status: AttendanceStatus) =>
  STATUSES.find((entry) => entry.value === status) ?? STATUSES[0]!;

/** `66.67%`, or a dash when nothing was marked. */
export const formatRate = (rate: number | null): string => (rate === null ? '—' : `${rate}%`);
