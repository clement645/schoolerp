import { z } from 'zod';
import { apiRequest } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';

export const tenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  schoolCount: z.number(),
  userCount: z.number(),
  createdAt: z.string(),
});

export type Tenant = z.infer<typeof tenantSchema>;

export const TENANT_PLANS = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'PROFESSIONAL', label: 'Professional' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
];

export interface CreateTenantInput {
  name: string;
  schoolName: string;
  plan: string;
  admin: { email: string; firstName: string; lastName: string; temporaryPassword: string };
}

export const tenantsApi = {
  list: (params: { page: number; pageSize: number }): Promise<Paginated<Tenant>> =>
    apiRequest({ method: 'GET', url: '/platform/tenants', params }, paginatedSchema(tenantSchema)),

  create: (data: CreateTenantInput): Promise<Tenant> =>
    apiRequest({ method: 'POST', url: '/platform/tenants', data }, tenantSchema),

  setStatus: (id: string, status: Tenant['status']): Promise<Tenant> =>
    apiRequest(
      { method: 'PATCH', url: `/platform/tenants/${id}/status`, data: { status } },
      tenantSchema,
    ),
};
