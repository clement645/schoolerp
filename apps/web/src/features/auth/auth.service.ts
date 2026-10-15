import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';

export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  mustChangePassword: z.boolean(),
  roles: z.array(z.object({ key: z.string(), name: z.string() })),
  permissions: z.array(z.string()),
  tenant: z.object({ id: z.string(), name: z.string(), plan: z.string() }).nullable(),
  schools: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const sessionSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
  user: userProfileSchema,
});

export type UserProfile = z.infer<typeof userProfileSchema>;
export type Session = z.infer<typeof sessionSchema>;

// The session endpoints authenticate with credentials or the refresh cookie,
// never the access token, and must not trigger refresh-and-retry themselves.
const session = { skipAuth: true } as const;

export const authApi = {
  login: (email: string, password: string): Promise<Session> =>
    apiRequest(
      { ...session, method: 'POST', url: '/auth/login', data: { email, password } },
      sessionSchema,
    ),

  refresh: (): Promise<Session> =>
    apiRequest({ ...session, method: 'POST', url: '/auth/refresh' }, sessionSchema),

  logout: (): Promise<void> => apiSend({ ...session, method: 'POST', url: '/auth/logout' }),

  changePassword: (currentPassword: string, newPassword: string): Promise<Session> =>
    apiRequest(
      { method: 'POST', url: '/auth/change-password', data: { currentPassword, newPassword } },
      sessionSchema,
    ),
};
