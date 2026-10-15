import { z } from 'zod';

const clientEnvSchema = z.object({
  /** Absolute URL or same-origin path of the versioned API root. */
  VITE_API_BASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith('/') || /^https?:\/\//.test(value),
      'VITE_API_BASE_URL must be an absolute http(s) URL or a path starting with "/"',
    )
    .default('/api/v1'),
});

export interface ClientEnv {
  apiBaseUrl: string;
}

export function parseClientEnv(raw: Record<string, unknown>): ClientEnv {
  const result = clientEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid web environment configuration: ${issues}`);
  }
  return { apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/+$/, '') };
}

export const env = parseClientEnv(import.meta.env);
