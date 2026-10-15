import { useQuery } from '@tanstack/vue-query';
import { fetchHealth } from './health.service';

export const HEALTH_REFRESH_INTERVAL_MS = 15_000;

export function useHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFRESH_INTERVAL_MS,
    retry: false,
  });
}
