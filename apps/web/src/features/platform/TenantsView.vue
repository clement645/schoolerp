<script setup lang="ts">
import { ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { errorMessage } from '@/services/http';
import { formatDateTime } from '@/utils/format';
import CreateTenantModal from './CreateTenantModal.vue';
import { TENANT_PLANS, tenantsApi, type Tenant } from './tenants.service';

const PAGE_SIZE = 20;

const columns: TableColumn[] = [
  { key: 'name', label: 'Tenant' },
  { key: 'plan', label: 'Plan' },
  { key: 'schoolCount', label: 'Schools', align: 'right' },
  { key: 'userCount', label: 'Users', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Created' },
  { key: 'actions', label: '', align: 'right' },
];

const planLabel = (plan: string) => TENANT_PLANS.find((p) => p.value === plan)?.label ?? plan;

const page = ref(1);
const tenants = useQuery({
  queryKey: ['tenants', { page }],
  queryFn: () => tenantsApi.list({ page: page.value, pageSize: PAGE_SIZE }),
  placeholderData: keepPreviousData,
});

const creating = ref(false);
/** The tenant whose status change is awaiting confirmation. */
const confirming = ref<Tenant | null>(null);
const failure = ref<string | null>(null);

const queryClient = useQueryClient();
const changeStatus = useMutation({
  mutationFn: (tenant: Tenant) =>
    tenantsApi.setStatus(tenant.id, tenant.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'),
  onSuccess: async () => {
    confirming.value = null;
    await queryClient.invalidateQueries({ queryKey: ['tenants'] });
  },
  onError: (error) => {
    failure.value = errorMessage(error);
  },
});

function askToChangeStatus(tenant: Tenant): void {
  failure.value = null;
  confirming.value = tenant;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Tenants</h1>
        <p class="text-fg-muted mt-1 text-sm">
          School accounts on the platform. Each tenant's data is isolated from every other.
        </p>
      </div>
      <AppButton @click="creating = true">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add tenant
      </AppButton>
    </header>

    <AppCard flush>
      <AppTable
        caption="Tenants"
        :columns="columns"
        :rows="tenants.data.value?.items ?? []"
        :row-key="(tenant: Tenant) => tenant.id"
        :loading="tenants.isPending.value"
        :error="tenants.isError.value ? errorMessage(tenants.error.value) : null"
        empty-title="No tenants yet"
        empty-description="Add the first school account to get started."
      >
        <template #cell-name="{ row }">
          <p class="font-medium">{{ row.name }}</p>
          <p class="text-fg-muted text-xs">{{ row.slug }}</p>
        </template>
        <template #cell-plan="{ row }">{{ planLabel(row.plan) }}</template>
        <template #cell-status="{ row }">
          <AppBadge :variant="row.status === 'ACTIVE' ? 'success' : 'warning'" dot>
            {{ row.status === 'ACTIVE' ? 'Active' : 'Suspended' }}
          </AppBadge>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="text-fg-muted whitespace-nowrap">{{ formatDateTime(row.createdAt) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            variant="outline"
            size="sm"
            :aria-label="`${row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${row.name}`"
            @click="askToChangeStatus(row)"
          >
            {{ row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate' }}
          </AppButton>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="tenants.refetch()">Try again</AppButton>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="tenants.data.value?.total ?? 0"
          :disabled="tenants.isFetching.value"
        />
      </template>
    </AppCard>

    <CreateTenantModal v-model:open="creating" />

    <AppModal
      :open="confirming !== null"
      :title="confirming?.status === 'ACTIVE' ? 'Suspend tenant?' : 'Reactivate tenant?'"
      size="sm"
      @update:open="confirming = null"
    >
      <AppAlert v-if="failure" class="mb-4">{{ failure }}</AppAlert>
      <p v-if="confirming?.status === 'ACTIVE'" class="text-sm">
        Everyone at <strong>{{ confirming.name }}</strong> is signed out immediately and cannot sign
        in until the tenant is reactivated. No data is deleted.
      </p>
      <p v-else-if="confirming" class="text-sm">
        Users at <strong>{{ confirming.name }}</strong> will be able to sign in again.
      </p>
      <template #footer>
        <AppButton
          variant="outline"
          :disabled="changeStatus.isPending.value"
          @click="confirming = null"
        >
          Cancel
        </AppButton>
        <AppButton
          :variant="confirming?.status === 'ACTIVE' ? 'danger' : 'primary'"
          :loading="changeStatus.isPending.value"
          @click="confirming && changeStatus.mutate(confirming)"
        >
          {{ confirming?.status === 'ACTIVE' ? 'Suspend' : 'Reactivate' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
