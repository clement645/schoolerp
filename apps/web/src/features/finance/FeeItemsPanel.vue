<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { financeApi, type FeeItem } from './finance.service';

const props = defineProps<{ canManage: boolean }>();

const items = useQuery({
  queryKey: useSchoolQueryKey('finance', 'fee-items'),
  queryFn: financeApi.feeItems,
});

const columns: TableColumn[] = [
  { key: 'name', label: 'Fee item' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

const open = ref(false);
const editing = ref<FeeItem | null>(null);
const form = reactive({ name: '', description: '' });
const nameError = ref('');

function start(item: FeeItem | null): void {
  editing.value = item;
  form.name = item?.name ?? '';
  form.description = item?.description ?? '';
  nameError.value = '';
  save.reset();
  open.value = true;
}

const save = useSaveAction(() => {
  const data = { name: form.name.trim(), description: form.description.trim() || null };
  return editing.value
    ? financeApi.updateFeeItem(editing.value.id, data)
    : financeApi.createFeeItem(data);
});
const toggle = useSaveAction((item: FeeItem) =>
  financeApi.updateFeeItem(item.id, { isActive: !item.isActive }),
);

async function submit(): Promise<void> {
  if (form.name.trim().length < 2) {
    nameError.value = 'Enter a name of at least 2 characters.';
    return;
  }
  nameError.value = '';
  if (await save.run()) open.value = false;
}
</script>

<template>
  <AppCard title="Fee items" subtitle="The kinds of charge that make up a fee structure" flush>
    <template v-if="props.canManage" #actions>
      <AppButton size="sm" @click="start(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add fee item
      </AppButton>
    </template>
    <div v-if="toggle.error.value" class="px-5 pt-4">
      <AppAlert>{{ toggle.error.value }}</AppAlert>
    </div>
    <AppTable
      :columns="columns"
      :rows="items.data.value ?? []"
      :row-key="(row) => row.id"
      caption="Fee items"
      :loading="items.isPending.value"
      :error="items.isError.value ? errorMessage(items.error.value) : null"
      empty-title="No fee items yet"
      empty-description="Add items such as Tuition, Lunch or Transport, then build fee structures from them."
    >
      <template #cell-name="{ row }">
        <span class="font-medium">{{ row.name }}</span>
      </template>
      <template #cell-status="{ row }">
        <AppBadge :variant="row.isActive ? 'success' : 'neutral'">
          {{ row.isActive ? 'Active' : 'Inactive' }}
        </AppBadge>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="props.canManage" class="flex justify-end gap-1">
          <AppButton variant="ghost" size="sm" @click="start(row)">Edit</AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            :disabled="toggle.pending.value"
            @click="toggle.run(row)"
          >
            {{ row.isActive ? 'Deactivate' : 'Activate' }}
          </AppButton>
        </div>
      </template>
    </AppTable>

    <AppModal v-model:open="open" :title="editing ? 'Edit fee item' : 'Add fee item'">
      <form id="fee-item-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="save.error.value">{{ save.error.value }}</AppAlert>
        <AppInput v-model="form.name" label="Name" :error="nameError" required data-autofocus />
        <AppInput v-model="form.description" label="Description" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="fee-item-form" :loading="save.pending.value">Save</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
