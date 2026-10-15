<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { Download, Plus, Search } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import type { TableColumn } from '@/components/ui/table';
import { useCurrency } from '@/composables/useCurrency';
import { useFileDownload } from '@/composables/useFileDownload';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import MpesaPanel from './MpesaPanel.vue';
import PaymentDetailModal from './PaymentDetailModal.vue';
import RecordPaymentModal from './RecordPaymentModal.vue';
import {
  financeApi,
  methodLabel,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentSummary,
} from './finance.service';

const PAGE_SIZE = 20;
const ALL = 'all';
const TABS = [
  { id: 'payments', label: 'Payments' },
  { id: 'mpesa', label: 'M-Pesa requests' },
];

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { money } = useCurrency();
const canManage = computed(() => auth.can('finance:manage'));
const exporting = useFileDownload();
function exportCsv(): void {
  const { method, status, search } = params.value;
  void exporting.download('csv', () => financeApi.exportPayments({ method, status, search }));
}

const tab = computed({
  get: () => (route.query.tab === 'mpesa' ? 'mpesa' : 'payments'),
  set: (id) => {
    void router.replace({ query: { tab: id === 'payments' ? undefined : id } });
  },
});

const search = ref('');
const debouncedSearch = refDebounced(search, 300);
const method = ref(ALL);
const status = ref(ALL);
const page = ref(1);
watch([debouncedSearch, method, status], () => {
  page.value = 1;
});

const params = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  method: (method.value === ALL ? '' : method.value) as PaymentMethod | '',
  status: (status.value === ALL ? '' : status.value) as 'COMPLETED' | 'REVERSED' | '',
  search: debouncedSearch.value.trim(),
}));
const payments = useQuery({
  queryKey: useSchoolQueryKey('finance', 'payments', params),
  queryFn: () => financeApi.payments(params.value),
  placeholderData: keepPreviousData,
});

const columns: TableColumn[] = [
  { key: 'receiptNumber', label: 'Receipt' },
  { key: 'student', label: 'Learner' },
  { key: 'paidOn', label: 'Date' },
  { key: 'method', label: 'Method' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status' },
];

const recording = ref(false);
const viewing = ref<string | null>(null);
const viewerOpen = ref(false);
function view(payment: PaymentSummary): void {
  viewing.value = payment.id;
  viewerOpen.value = true;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Payments</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Money received, the invoices it settled, and any reversals or refunds.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton
          v-if="tab === 'payments'"
          variant="outline"
          :loading="exporting.pending.value === 'csv'"
          @click="exportCsv"
        >
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          Export CSV
        </AppButton>
        <AppButton v-if="canManage" @click="recording = true">
          <template #icon><Plus class="size-4" aria-hidden="true" /></template>
          Record payment
        </AppButton>
      </div>
    </header>
    <AppAlert v-if="exporting.error.value">{{ exporting.error.value }}</AppAlert>

    <AppTabs v-model="tab" :tabs="TABS" label="Payment sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <MpesaPanel v-if="tab === 'mpesa'" :can-manage="canManage" />
      <AppCard v-else flush>
        <template #header>
          <div class="grid w-full gap-3 sm:grid-cols-3">
            <AppInput
              v-model="search"
              type="search"
              aria-label="Search payments"
              placeholder="Receipt, reference, name or admission number"
            >
              <template #leading><Search class="size-4" aria-hidden="true" /></template>
            </AppInput>
            <AppSelect
              v-model="method"
              aria-label="Method"
              :options="[{ value: ALL, label: 'All methods' }, ...PAYMENT_METHODS]"
            />
            <AppSelect
              v-model="status"
              aria-label="Status"
              :options="[
                { value: ALL, label: 'All payments' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'REVERSED', label: 'Reversed' },
              ]"
            />
          </div>
        </template>

        <AppTable
          :columns="columns"
          :rows="payments.data.value?.items ?? []"
          :row-key="(row) => row.id"
          caption="Payments"
          :loading="payments.isPending.value"
          :error="payments.isError.value ? errorMessage(payments.error.value) : null"
          empty-title="No payments match"
        >
          <template #cell-receiptNumber="{ row }">
            <button
              type="button"
              class="text-primary font-medium underline-offset-2 hover:underline"
              @click="view(row)"
            >
              {{ row.receiptNumber }}
            </button>
          </template>
          <template #cell-student="{ row }">
            <p class="font-medium">{{ row.student.name }}</p>
            <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
          </template>
          <template #cell-paidOn="{ row }">{{ formatDate(row.paidOn) }}</template>
          <template #cell-method="{ row }">
            {{ methodLabel(row.method) }}
            <p v-if="row.reference" class="text-fg-muted text-xs">{{ row.reference }}</p>
          </template>
          <template #cell-amount="{ row }">
            <span
              class="font-medium tabular-nums"
              :class="{ 'line-through': row.status === 'REVERSED' }"
            >
              {{ money(row.amount) }}
            </span>
            <p v-if="row.unallocated > 0" class="text-fg-muted text-xs">
              {{ money(row.unallocated) }} unallocated
            </p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :variant="row.status === 'COMPLETED' ? 'success' : 'neutral'" dot>
              {{ row.status === 'COMPLETED' ? 'Completed' : 'Reversed' }}
            </AppBadge>
          </template>
        </AppTable>

        <template #footer>
          <AppPagination
            v-model:page="page"
            :page-size="PAGE_SIZE"
            :total="payments.data.value?.total ?? 0"
            :disabled="payments.isFetching.value"
          />
        </template>
      </AppCard>
    </section>

    <RecordPaymentModal v-if="canManage" v-model:open="recording" />
    <PaymentDetailModal v-model:open="viewerOpen" :payment-id="viewing" :can-manage="canManage" />
  </div>
</template>
