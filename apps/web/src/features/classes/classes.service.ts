import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';

export const streamSchema = z.object({
  id: z.string(),
  classId: z.string(),
  name: z.string(),
  capacity: z.number().nullable(),
});
export const classSubjectSchema = z.object({
  subjectId: z.string(),
  name: z.string(),
  code: z.string(),
  isCompulsory: z.boolean(),
});
export const classSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number(),
  isActive: z.boolean(),
  gradingScheme: z.object({ id: z.string(), name: z.string() }).nullable(),
  streams: z.array(streamSchema),
  subjects: z.array(classSubjectSchema),
});
export type Stream = z.infer<typeof streamSchema>;
export type SchoolClass = z.infer<typeof classSchema>;

export interface ClassInput {
  name: string;
  level: number;
  gradingSchemeId: string | null;
  isActive?: boolean;
}
export interface StreamInput {
  name: string;
  capacity: number | null;
}

export const classesApi = {
  list: (): Promise<SchoolClass[]> =>
    apiRequest({ method: 'GET', url: '/classes' }, z.array(classSchema)),
  create: (data: ClassInput): Promise<SchoolClass> =>
    apiRequest({ method: 'POST', url: '/classes', data }, classSchema),
  update: (id: string, data: Partial<ClassInput>): Promise<SchoolClass> =>
    apiRequest({ method: 'PATCH', url: `/classes/${id}`, data }, classSchema),
  delete: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/classes/${id}` }),
  setSubjects: (
    id: string,
    subjects: { subjectId: string; isCompulsory: boolean }[],
  ): Promise<SchoolClass> =>
    apiRequest({ method: 'PUT', url: `/classes/${id}/subjects`, data: { subjects } }, classSchema),
  createStream: (classId: string, data: StreamInput): Promise<Stream> =>
    apiRequest({ method: 'POST', url: `/classes/${classId}/streams`, data }, streamSchema),
  updateStream: (id: string, data: StreamInput): Promise<Stream> =>
    apiRequest({ method: 'PATCH', url: `/streams/${id}`, data }, streamSchema),
  deleteStream: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/streams/${id}` }),
};
