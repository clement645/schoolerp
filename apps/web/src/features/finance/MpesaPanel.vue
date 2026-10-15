<script setup lang="ts">
import { computed, ref } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { Smartphone } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { formatDateTime } from '@/utils/format';
import MpesaPushModal from './MpesaPushModal.vue';
import { financeApi, MPESA_STATUS, type MpesaTransaction } from './finance.service';

const PAGE_SIZE = 20;

const props = defineProps<{ canManage: boolean }>();
const { money } = useCurrency();

const config = useQuery({
  queryKey: useSchoolQueryKey('finance', 'mpesa-config'),
  queryFn: financeApi.mpesaConfig,
});
const page = ref(1);
const params = computed(() => ({ page: page.value, pageSize: PAGE_SIZE }));
const transactions = useQuery({
  queryKey: useSchoolQueryKey('finance', 'mpesa', params),
  queryFn: () => financeApi.mpesaTransactions(params.value),
  placeholderData: keepPreviousData,
  // While a payer still has a prompt open, keep looking for the outcome.
  refetchInterval: (query) =>
    query.state.data?.items.some((item) => item.status === 'PENDING') ? 5000 : false,
});

const columns: TableColumn[] = [
  { key: 'createdAt', label: 'Requested' },
  { key: 'student', label: 'Learner' },
  { key: 'phone', label: 'Phone' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'actions', label: '', align: 'right' },
];

const prompting = ref(false);
const checking = ref<string | null>(null);
const verify = useSaveAction(async (transaction: MpesaTransaction) => {
  checking.value = transaction.id;
  try {
    await financeApi.verifyMpesa(transaction.id);
  } finally {
    checking.value = null;
  }
});
</script>

<template>
  <div class="space-y-4">
    <AppAlert
      v-if="config.data.value && !config.data.value.configured"
      tone="info"
      title="M-Pesa is not set up"
    >
      No M-Pesa credentials are configured for this installation, so payment requests cannot be
      sent. M-Pesa payments cannot be entered by hand: they are only ever credited on Safaricom's
      confirmation.
    </AppAlert>
    <AppAlert
      v-else-if="config.data.value?.environment === 'sandbox'"
      tone="info"
      title="Sandbox mode"
    >
      M-Pesa is connected to Safaricom's test environment. Requests here do not move real money.
    </AppAlert>
    <AppAlert v-if="verify.error.value">{{ verify.error.value }}</AppAlert>

    <AppCard
      title="M-Pesa requests"
      subtitle="Payment prompts sent to phones, and their outcome"
      flush
    >
      <template v-if="props.canManage" #actions>
        <AppButton size="sm" :disabled="!config.data.value?.configured" @click="prompting = true">
          <template #icon><Smartphone class="size-4" aria-hidden="true" /></template>
          Request payment
        </AppButton>
      </template>
      <AppTable
        :columns="columns"
        :rows="transactions.data.value?.items ?? []"
        :row-key="(row) => row.id"
        caption="M-Pesa requests"
        :loading="transactions.isPending.value"
        :error="transactions.isError.value ? errorMessage(transactions.error.value) : null"
        empty-title="No M-Pesa requests yet"
      >
        <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        <template #cell-student="{ row }">
          <p class="font-medium">{{ row.student.name }}</p>
          <p class="text-fg-muted text-xs">
            {{ row.student.admissionNumber
            }}<template v-if="row.invoiceNumber"> · {{ row.invoiceNumber }}</template>
          </p>
        </template>
        <template #cell-amount="{ row }">
          <span class="tabular-nums">{{ money(row.amount) }}</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :variant="MPESA_STATUS[row.status].variant" dot>
            {{ MPESA_STATUS[row.status].label }}
          </AppBadge>
          <p v-if="row.status !== 'SUCCESS' && row.resultDescription" class="text-fg-muted text-xs">
            {{ row.resultDescription }}
          </p>
        </template>
        <template #cell-receipt="{ row }">
          <template v-if="row.receiptNumber">
            {{ row.receiptNumber }}
            <p class="text-fg-muted text-xs">
              {{ row.mpesaReceiptNumber ?? 'M-Pesa receipt pending' }}
            </p>
          </template>
          <span v-else class="text-fg-muted">—</span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            v-if="props.canManage && row.status === 'PENDING'"
            variant="ghost"
            size="sm"
            :loading="checking === row.id"
            @click="verify.run(row)"
          >
            Check status
          </AppButton>
        </template>
      </AppTable>
      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="transactions.data.value?.total ?? 0"
          :disabled="transactions.isFetching.value"
        />
      </template>
    </AppCard>

    <MpesaPushModal v-if="props.canManage" v-model:open="prompting" />
  </div>
</template>
