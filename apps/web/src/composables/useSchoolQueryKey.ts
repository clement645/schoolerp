import { computed, type ComputedRef } from 'vue';
import { useSchoolStore } from '@/stores/school';

/** Root of every cached query that belongs to a school. */
export const SCHOOL_QUERY_ROOT = 'school';

/**
 * Builds a query key that includes the active school, so cached data for one
 * school is never shown after switching to another.
 */
export function useSchoolQueryKey(...parts: readonly unknown[]): ComputedRef<readonly unknown[]> {
  const school = useSchoolStore();
  return computed(() => [SCHOOL_QUERY_ROOT, school.activeSchoolId, ...parts]);
}
