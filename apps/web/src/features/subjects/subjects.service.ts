import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';

export const subjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  classCount: z.number(),
});
export type Subject = z.infer<typeof subjectSchema>;

export interface SubjectInput {
  name: string;
  code: string;
  isActive?: boolean;
}

export const subjectsApi = {
  list: (): Promise<Subject[]> =>
    apiRequest({ method: 'GET', url: '/subjects' }, z.array(subjectSchema)),
  create: (data: SubjectInput): Promise<Subject> =>
    apiRequest({ method: 'POST', url: '/subjects', data }, subjectSchema),
  update: (id: string, data: Partial<SubjectInput>): Promise<Subject> =>
    apiRequest({ method: 'PATCH', url: `/subjects/${id}`, data }, subjectSchema),
  delete: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/subjects/${id}` }),
};
