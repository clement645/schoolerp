import { useQueryClient } from '@tanstack/vue-query';
import { ref, type Ref } from 'vue';
import { errorMessage } from '@/services/http';
import { SCHOOL_QUERY_ROOT } from './useSchoolQueryKey';

export interface SaveAction<TArgs extends unknown[]> {
  /** Runs the action; resolves to whether it succeeded. */
  run: (...args: TArgs) => Promise<boolean>;
  pending: Ref<boolean>;
  /** Message from the last failed attempt, cleared on the next one. */
  error: Ref<string | null>;
  reset: () => void;
}

/**
 * Wraps a change to school configuration: tracks progress, captures a
 * user-facing error message, and refreshes cached school data on success.
 */
export function useSaveAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<unknown>,
): SaveAction<TArgs> {
  const queryClient = useQueryClient();
  const pending = ref(false);
  const error = ref<string | null>(null);

  async function run(...args: TArgs): Promise<boolean> {
    pending.value = true;
    error.value = null;
    try {
      await action(...args);
      await queryClient.invalidateQueries({ queryKey: [SCHOOL_QUERY_ROOT] });
      return true;
    } catch (caught) {
      error.value = errorMessage(caught);
      return false;
    } finally {
      pending.value = false;
    }
  }

  return {
    run,
    pending,
    error,
    reset: () => {
      error.value = null;
    },
  };
}
