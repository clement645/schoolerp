import { useQuery } from '@tanstack/vue-query';
import { computed, type ComputedRef } from 'vue';
import { formatMoney } from '@/features/finance/finance.service';
import { policiesApi } from '@/features/school-config/config.service';
import { useSchoolQueryKey } from './useSchoolQueryKey';

/** The school's currency, and a formatter for amounts in it. */
export function useCurrency(): {
  currency: ComputedRef<string>;
  money: (amount: number) => string;
} {
  const policies = useQuery({
    queryKey: useSchoolQueryKey('policies'),
    queryFn: policiesApi.get,
    staleTime: 5 * 60_000,
  });
  const currency = computed(() => policies.data.value?.currency ?? 'KES');
  return { currency, money: (amount) => formatMoney(amount, currency.value) };
}
