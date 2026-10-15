import { z } from 'zod';
import { apiRequest } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';

export const auditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  actor: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  byPlatformStaff: z.boolean(),
  ipAddress: z.string().nullable(),
  details: z.unknown(),
  createdAt: z.string(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditApi = {
  list: (params: {
    page: number;
    pageSize: number;
    action?: string;
  }): Promise<Paginated<AuditLog>> =>
    apiRequest(
      {
        method: 'GET',
        url: '/audit-logs',
        params: { ...params, action: params.action || undefined },
      },
      paginatedSchema(auditLogSchema),
    ),
};

const ACTION_LABELS: Record<string, string> = {
  'auth.login.succeeded': 'Signed in',
  'auth.login.failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.refresh.reuse_detected': 'Session token replay detected',
  'auth.password.changed': 'Password changed',
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.roles.changed': 'User roles changed',
  'user.password.reset': 'User password reset',
  'student.created': 'Student admitted',
  'student.updated': 'Student details updated',
  'student.transferred': 'Student moved class',
  'student.status.changed': 'Student status changed',
  'student.promoted': 'Student promoted',
  'student.guardian.added': 'Guardian added',
  'student.guardian.updated': 'Guardian updated',
  'student.guardian.removed': 'Guardian removed',
  'student.photo.updated': 'Student photo updated',
  'student.photo.removed': 'Student photo removed',
  'student.document.uploaded': 'Document uploaded',
  'student.document.downloaded': 'Document downloaded',
  'student.document.deleted': 'Document deleted',
  'school.logo.updated': 'School logo updated',
  'school.logo.removed': 'School logo removed',
  'marks.saved': 'Marks saved',
  'marks.imported': 'Marks imported',
  'marks.exported': 'Marks exported',
  'examination.opened': 'Examination opened for marks',
  'examination.compiled': 'Results compiled',
  'examination.reopened': 'Examination reopened',
  'examination.approved': 'Results approved',
  'examination.published': 'Results published',
  'students.imported': 'Students imported',
  'students.exported': 'Students exported',
  'teacher.created': 'Teacher added',
  'teacher.updated': 'Teacher updated',
  'teacher.assignment.added': 'Teacher assignment added',
  'teacher.assignment.removed': 'Teacher assignment removed',
  'tenant.created': 'Tenant created',
  'tenant.status.changed': 'Tenant status changed',
};

const RESOURCE_LABELS: Record<string, string> = {
  school: 'School profile',
  academic_year: 'Academic year',
  term: 'Term',
  class: 'Class',
  stream: 'Stream',
  subject: 'Subject',
  grading_scheme: 'Grading scheme',
  examination: 'Examination',
};

const VERB_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  set_current: 'made current',
  set_default: 'made default',
  'subjects.changed': 'subjects changed',
};

/** A readable name for an audit event, e.g. "Grading scheme made default". */
export function describeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;

  const [resource = '', ...rest] = action.split('.');
  const noun = RESOURCE_LABELS[resource];
  const verb = VERB_LABELS[rest.join('.')];
  return noun && verb ? `${noun} ${verb}` : action;
}

/** Events that warrant attention when scanning the log. */
export const isAlertAction = (action: string): boolean =>
  action === 'auth.login.failed' || action === 'auth.refresh.reuse_detected';
