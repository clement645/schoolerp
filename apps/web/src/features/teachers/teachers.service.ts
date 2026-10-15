import { z } from 'zod';
import { apiRequest } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';
import { genderSchema } from '@/features/students/students.service';

const ref = z.object({ id: z.string(), name: z.string() });

export const assignmentSchema = z.object({
  id: z.string(),
  kind: z.enum(['SUBJECT_TEACHER', 'CLASS_TEACHER']),
  academicYear: ref.extend({ isCurrent: z.boolean() }),
  class: ref,
  stream: ref.nullable(),
  subject: ref.extend({ code: z.string() }).nullable(),
});

export const teacherSummarySchema = z.object({
  id: z.string(),
  staffNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gender: genderSchema.nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  user: z.object({ id: z.string(), email: z.string() }).nullable(),
});

export const teacherDetailSchema = teacherSummarySchema.extend({
  registrationNumber: z.string().nullable(),
  employmentDate: z.string().nullable(),
  assignments: z.array(assignmentSchema),
});

const workloadSchema = z.object({
  academicYear: ref.nullable(),
  rows: z.array(
    z.object({
      teacher: z.object({ id: z.string(), name: z.string(), staffNumber: z.string() }),
      teachingAssignments: z.number(),
      subjects: z.array(z.string()),
      classes: z.array(z.string()),
      classTeacherOf: z.array(z.string()),
    }),
  ),
});

const linkableUserSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });

export type Assignment = z.infer<typeof assignmentSchema>;
export type TeacherSummary = z.infer<typeof teacherSummarySchema>;
export type TeacherDetail = z.infer<typeof teacherDetailSchema>;
export type Workload = z.infer<typeof workloadSchema>;
export type LinkableUser = z.infer<typeof linkableUserSchema>;

export interface TeacherInput {
  staffNumber: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  employmentDate: string | null;
  userId: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface AssignmentInput {
  kind: 'SUBJECT_TEACHER' | 'CLASS_TEACHER';
  classId: string;
  streamId: string | null;
  subjectId: string | null;
}

export const teachersApi = {
  list: (params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: string;
  }): Promise<Paginated<TeacherSummary>> =>
    apiRequest(
      {
        method: 'GET',
        url: '/teachers',
        params: {
          ...params,
          search: params.search || undefined,
          status: params.status || undefined,
        },
      },
      paginatedSchema(teacherSummarySchema),
    ),
  get: (id: string): Promise<TeacherDetail> =>
    apiRequest({ method: 'GET', url: `/teachers/${id}` }, teacherDetailSchema),
  create: (data: TeacherInput): Promise<TeacherDetail> =>
    apiRequest({ method: 'POST', url: '/teachers', data }, teacherDetailSchema),
  update: (id: string, data: Partial<TeacherInput>): Promise<TeacherDetail> =>
    apiRequest({ method: 'PATCH', url: `/teachers/${id}`, data }, teacherDetailSchema),
  linkableUsers: (): Promise<LinkableUser[]> =>
    apiRequest({ method: 'GET', url: '/teachers/linkable-users' }, z.array(linkableUserSchema)),
  workload: (): Promise<Workload> =>
    apiRequest({ method: 'GET', url: '/teachers/workload' }, workloadSchema),
  addAssignment: (id: string, data: AssignmentInput): Promise<TeacherDetail> =>
    apiRequest({ method: 'POST', url: `/teachers/${id}/assignments`, data }, teacherDetailSchema),
  removeAssignment: (id: string, assignmentId: string): Promise<TeacherDetail> =>
    apiRequest(
      { method: 'DELETE', url: `/teachers/${id}/assignments/${assignmentId}` },
      teacherDetailSchema,
    ),
};

/** "Grade 7 East", or just "Grade 7" for a whole class. */
export const placementLabel = (assignment: Pick<Assignment, 'class' | 'stream'>): string =>
  assignment.stream ? `${assignment.class.name} ${assignment.stream.name}` : assignment.class.name;
