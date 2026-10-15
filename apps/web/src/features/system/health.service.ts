import { z } from 'zod';
import { apiGet, ApiRequestError } from '@/services/http';

const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nullable(),
});

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
    storage: dependencyCheckSchema,
  }),
});

export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;

/**
 * Fetches platform readiness. A degraded platform answers 503 with the report
 * in the error details; that is still a successful *status lookup*, so it is
 * returned as data. Only an unreachable or misbehaving API rejects.
 */
export async function fetchHealth(): Promise<HealthReport> {
  try {
    return await apiGet('/health', healthReportSchema);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 503) {
      const report = healthReportSchema.safeParse(error.details);
      if (report.success) {
        return report.data;
      }
    }
    throw error;
  }
}
