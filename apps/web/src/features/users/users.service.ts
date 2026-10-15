import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';

const roleRefSchema = z.object({ key: z.string(), name: z.string() });

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  mustChangePassword: z.boolean(),
  roles: z.array(roleRefSchema),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const roleSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.object({ key: z.string(), description: z.string() })),
  grantable: z.boolean(),
});

export type User = z.infer<typeof userSchema>;
export type Role = z.infer<typeof roleSchema>;
export type UserStatus = User['status'];

export interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  temporaryPassword: string;
  roles: string[];
}

export const usersApi = {
  list: (params: ListUsersParams): Promise<Paginated<User>> =>
    apiRequest(
      { method: 'GET', url: '/users', params: { ...params, search: params.search || undefined } },
      paginatedSchema(userSchema),
    ),

  create: (data: CreateUserInput): Promise<User> =>
    apiRequest({ method: 'POST', url: '/users', data }, userSchema),

  update: (
    id: string,
    data: Partial<Pick<User, 'firstName' | 'lastName' | 'status'>>,
  ): Promise<User> => apiRequest({ method: 'PATCH', url: `/users/${id}`, data }, userSchema),

  setRoles: (id: string, roles: string[]): Promise<User> =>
    apiRequest({ method: 'PUT', url: `/users/${id}/roles`, data: { roles } }, userSchema),

  resetPassword: (id: string, temporaryPassword: string): Promise<void> =>
    apiSend({ method: 'POST', url: `/users/${id}/reset-password`, data: { temporaryPassword } }),

  listRoles: (): Promise<Role[]> =>
    apiRequest({ method: 'GET', url: '/roles' }, z.array(roleSchema)),
};
