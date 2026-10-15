<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
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
import type { TableColumn } from '@/components/ui/table';
import { useCurrency } from '@/composables/useCurrency';
import { useFileDownload } from '@/composables/useFileDownload';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { classesApi } from '@/features/classes/classes.service';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import InvoiceDetailModal from './InvoiceDetailModal.vue';
import InvoiceFormModal from './InvoiceFormModal.vue';
import {
  financeApi,
  INVOICE_STATUS,
  type InvoiceFilter,
  type InvoiceSummary,
} from './finance.service';

const PAGE_SIZE = 20;
const ALL = 'all';

const auth = useAuthStore();
const route = useRoute();
const { money } = useCurrency();
const canManage = computed(() => auth.can('finance:manage'));
const exporting = useFileDownload();
function exportCsv(): void {
  const { status, classId, search } = params.value;
  void exporting.download('csv', () => financeApi.exportInvoices({ status, classId, search }));
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '');
const debouncedSearch = refDebounced(search, 300);
const status = ref<string>(typeof route.query.status === 'string' ? route.query.status : ALL);
const classId = ref(ALL);
const page = ref(1);
watch([debouncedSearch, status, classId], () => {
  page.value = 1;
});

const STATUS_OPTIONS = [
  { value: ALL, label: 'All invoices' },
  { value: 'OUTSTANDING', label: 'Outstanding' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];
const classes = useQuery({ queryKey: useSchoolQueryKey('classes'), queryFn: classesApi.list });
const classOptions = computed(() => [
  { value: ALL, label: 'All classes' },
  ...(classes.data.value ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
]);

const params = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  status: (status.value === ALL ? '' : status.value) as InvoiceFilter,
  classId: classId.value === ALL ? '' : classId.value,
  search: debouncedSearch.value.trim(),
}));
const invoices = useQuery({
  queryKey: useSchoolQueryKey('finance', 'invoices', params),
  queryFn: () => financeApi.invoices(params.value),
  placeholderData: keepPreviousData,
});
const mpesa = useQuery({
  queryKey: useSchoolQueryKey('finance', 'mpesa-config'),
  queryFn: financeApi.mpesaConfig,
  staleTime: 5 * 60_000,
});

const columns: TableColumn[] = [
  { key: 'number', label: 'Invoice' },
  { key: 'student', label: 'Learner' },
  { key: 'dueDate', label: 'Due' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right' },
  { key: 'status', label: 'Status' },
];

const creating = ref(false);
const viewing = ref<string | null>(null);
const viewerOpen = ref(false);
function view(invoice: InvoiceSummary): void {
  viewing.value = invoice.id;
  viewerOpen.value = true;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Invoices</h1>
        <p class="text-fg-muted mt-1 text-sm">
          What each learner has been charged, and what is still owed.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton
          variant="outline"
          :loading="exporting.pending.value === 'csv'"
          @click="exportCsv"
        >
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          Export CSV
        </AppButton>
        <AppButton v-if="canManage" @click="creating = true">
          <template #icon><Plus class="size-4" aria-hidden="true" /></template>
          New invoice
        </AppButton>
      </div>
    </header>
    <AppAlert v-if="exporting.error.value">{{ exporting.error.value }}</AppAlert>

    <AppCard flush>
      <template #header>
        <div class="grid w-full gap-3 sm:grid-cols-3">
          <AppInput
            v-model="search"
            type="search"
            aria-label="Search invoices"
            placeholder="Invoice number, name or admission number"
          >
            <template #leading><Search class="size-4" aria-hidden="true" /></template>
          </AppInput>
          <AppSelect v-model="status" aria-label="Status" :options="STATUS_OPTIONS" />
          <AppSelect v-model="classId" aria-label="Class" :options="classOptions" />
        </div>
      </template>

      <AppTable
        :columns="columns"
        :rows="invoices.data.value?.items ?? []"
        :row-key="(row) => row.id"
        caption="Invoices"
        :loading="invoices.isPending.value"
        :error="invoices.isError.value ? errorMessage(invoices.error.value) : null"
        empty-title="No invoices match"
        empty-description="Raise invoices for a class from the Fee Structure page, or create one here."
      >
        <template #cell-number="{ row }">
          <button
            type="button"
            class="text-primary font-medium underline-offset-2 hover:underline"
            @click="view(row)"
          >
            {{ row.number }}
          </button>
          <p class="text-fg-muted text-xs">{{ row.term ?? 'One-off' }}</p>
        </template>
        <template #cell-student="{ row }">
          <p class="font-medium">{{ row.student.name }}</p>
          <p class="text-fg-muted text-xs">
            {{ row.student.admissionNumber
            }}<template v-if="row.class"> · {{ row.class }}</template>
          </p>
        </template>
        <template #cell-dueDate="{ row }">{{ formatDate(row.dueDate) }}</template>
        <template #cell-total="{ row }">
          <span class="tabular-nums">{{ money(row.total) }}</span>
        </template>
        <template #cell-balance="{ row }">
          <span class="font-medium tabular-nums">{{ money(row.balance) }}</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :variant="INVOICE_STATUS[row.status].variant" dot>
            {{ INVOICE_STATUS[row.status].label }}
          </AppBadge>
          <AppBadge v-if="row.isOverdue" variant="danger" class="ml-1">Overdue</AppBadge>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="invoices.data.value?.total ?? 0"
          :disabled="invoices.isFetching.value"
        />
      </template>
    </AppCard>

    <InvoiceFormModal v-if="canManage" v-model:open="creating" />
    <InvoiceDetailModal
      v-model:open="viewerOpen"
      :invoice-id="viewing"
      :can-manage="canManage"
      :mpesa-ready="mpesa.data.value?.configured ?? false"
    />
  </div>
</template>
