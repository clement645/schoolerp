import { QueryClient } from '@tanstack/vue-query';
import { toApiRequestError } from './http';

const MAX_NETWORK_RETRIES = 2;

/**
 * The application's query client. Only failures to reach the server are
 * retried: a response such as 403 or 404 will not change on a second attempt,
 * and retrying it just delays telling the user.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          toApiRequestError(error).status === null && failureCount < MAX_NETWORK_RETRIES,
        staleTime: 30_000,
      },
    },
  });
}
