import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';
import { paginatedSchema } from '@/types/api';

// ── Notifications ────────────────────────────────────────────────────────────

export const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(['ANNOUNCEMENT', 'MESSAGE', 'RESULTS_PUBLISHED', 'SYSTEM']),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string(),
});
export const notificationListSchema = paginatedSchema(notificationSchema).extend({
  unread: z.number(),
});
export type AppNotification = z.infer<typeof notificationSchema>;
export type NotificationList = z.infer<typeof notificationListSchema>;

export const notificationsApi = {
  list: (params: {
    page: number;
    pageSize: number;
    unreadOnly?: boolean;
  }): Promise<NotificationList> =>
    apiRequest(
      {
        method: 'GET',
        url: '/notifications',
        params: { ...params, unreadOnly: params.unreadOnly ? true : undefined },
      },
      notificationListSchema,
    ),
  markRead: (id: string): Promise<void> =>
    apiSend({ method: 'POST', url: `/notifications/${id}/read` }),
  markAllRead: (): Promise<void> => apiSend({ method: 'POST', url: '/notifications/read-all' }),
};

// ── Announcements ────────────────────────────────────────────────────────────

export const audienceSchema = z.enum(['EVERYONE', 'STAFF', 'PARENTS', 'STUDENTS']);
export type Audience = z.infer<typeof audienceSchema>;

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  audience: audienceSchema,
  isPinned: z.boolean(),
  expiresOn: z.string().nullable(),
  isExpired: z.boolean(),
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type Announcement = z.infer<typeof announcementSchema>;

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: Audience;
  isPinned: boolean;
  expiresOn: string | null;
}

export const announcementsApi = {
  list: (): Promise<Announcement[]> =>
    apiRequest({ method: 'GET', url: '/announcements' }, z.array(announcementSchema)),
  create: (data: AnnouncementInput): Promise<Announcement> =>
    apiRequest({ method: 'POST', url: '/announcements', data }, announcementSchema),
  update: (id: string, data: AnnouncementInput): Promise<Announcement> =>
    apiRequest({ method: 'PUT', url: `/announcements/${id}`, data }, announcementSchema),
  remove: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/announcements/${id}` }),
};

export const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'STAFF', label: 'Staff only' },
  { value: 'PARENTS', label: 'Parents only' },
  { value: 'STUDENTS', label: 'Students only' },
];
export const audienceLabel = (audience: Audience): string =>
  AUDIENCES.find((entry) => entry.value === audience)?.label ?? audience;

// ── Messages ─────────────────────────────────────────────────────────────────

const correspondentSchema = z.object({ id: z.string(), name: z.string(), role: z.string() });
export const threadSummarySchema = z.object({
  id: z.string(),
  subject: z.string(),
  participants: z.array(correspondentSchema),
  lastMessage: z
    .object({ body: z.string(), sender: z.string().nullable(), sentAt: z.string() })
    .nullable(),
  hasUnread: z.boolean(),
});
export const threadDetailSchema = z.object({
  id: z.string(),
  subject: z.string(),
  participants: z.array(correspondentSchema),
  messages: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      sender: correspondentSchema.nullable(),
      isMine: z.boolean(),
      sentAt: z.string(),
    }),
  ),
});
export type Correspondent = z.infer<typeof correspondentSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

export const messagesApi = {
  threads: (): Promise<ThreadSummary[]> =>
    apiRequest({ method: 'GET', url: '/messages/threads' }, z.array(threadSummarySchema)),
  thread: (id: string): Promise<ThreadDetail> =>
    apiRequest({ method: 'GET', url: `/messages/threads/${id}` }, threadDetailSchema),
  recipients: (search: string): Promise<Correspondent[]> =>
    apiRequest(
      { method: 'GET', url: '/messages/recipients', params: { search: search || undefined } },
      z.array(correspondentSchema),
    ),
  start: (data: { recipientIds: string[]; subject: string; body: string }): Promise<ThreadDetail> =>
    apiRequest({ method: 'POST', url: '/messages/threads', data }, threadDetailSchema),
  reply: (id: string, body: string): Promise<ThreadDetail> =>
    apiRequest(
      { method: 'POST', url: `/messages/threads/${id}/messages`, data: { body } },
      threadDetailSchema,
    ),
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** `5 minutes ago`, `yesterday`, `3 weeks ago` — how long since a moment. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}
