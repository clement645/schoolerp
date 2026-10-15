<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import StudentPicker, { type PickedStudent } from '@/components/ui/StudentPicker.vue';
import type { TableColumn } from '@/components/ui/table';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { financeApi, parseAmount, type Discount } from './finance.service';

const WHOLE_INVOICE = 'all';

const props = defineProps<{ canManage: boolean }>();
const { money } = useCurrency();

const discounts = useQuery({
  queryKey: useSchoolQueryKey('finance', 'discounts'),
  queryFn: () => financeApi.discounts(),
});
const items = useQuery({
  queryKey: useSchoolQueryKey('finance', 'fee-items'),
  queryFn: financeApi.feeItems,
});
const itemOptions = computed(() => [
  { value: WHOLE_INVOICE, label: 'The whole invoice' },
  ...(items.data.value ?? [])
    .filter((item) => item.isActive)
    .map((item) => ({ value: item.id, label: `${item.name} only` })),
]);

const columns: TableColumn[] = [
  { key: 'student', label: 'Learner' },
  { key: 'name', label: 'Discount' },
  { key: 'value', label: 'Value', align: 'right' },
  { key: 'applies', label: 'Applies to' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const valueOf = (discount: Discount): string =>
  discount.kind === 'PERCENTAGE' ? `${discount.value}%` : money(discount.value);

const open = ref(false);
const student = ref<PickedStudent | null>(null);
const form = reactive({
  name: '',
  category: 'DISCOUNT',
  kind: 'PERCENTAGE',
  value: '',
  feeItemId: WHOLE_INVOICE,
});
const problem = ref('');

function start(): void {
  student.value = null;
  Object.assign(form, {
    name: '',
    category: 'DISCOUNT',
    kind: 'PERCENTAGE',
    value: '',
    feeItemId: WHOLE_INVOICE,
  });
  problem.value = '';
  save.reset();
  open.value = true;
}
const save = useSaveAction(() =>
  financeApi.createDiscount({
    studentId: student.value?.id ?? '',
    name: form.name.trim(),
    category: form.category as Discount['category'],
    kind: form.kind as Discount['kind'],
    value: parseAmount(form.value) ?? 0,
    feeItemId: form.feeItemId === WHOLE_INVOICE ? null : form.feeItemId,
  }),
);
const toggle = useSaveAction((discount: Discount) =>
  financeApi.setDiscountActive(discount.id, !discount.isActive),
);

async function submit(): Promise<void> {
  const value = parseAmount(form.value);
  if (!student.value) problem.value = 'Choose the learner.';
  else if (form.name.trim().length < 2) problem.value = 'Enter a name, e.g. Sibling discount.';
  else if (value === null) problem.value = 'Enter a value greater than zero.';
  else if (form.kind === 'PERCENTAGE' && value > 100)
    problem.value = 'A percentage cannot exceed 100.';
  else problem.value = '';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}
</script>

<template>
  <AppCard
    title="Discounts and scholarships"
    subtitle="Applied automatically whenever the learner is invoiced"
    flush
  >
    <template v-if="props.canManage" #actions>
      <AppButton size="sm" @click="start">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Grant discount
      </AppButton>
    </template>
    <div v-if="toggle.error.value" class="px-5 pt-4">
      <AppAlert>{{ toggle.error.value }}</AppAlert>
    </div>
    <AppTable
      :columns="columns"
      :rows="discounts.data.value ?? []"
      :row-key="(row) => row.id"
      caption="Discounts and scholarships"
      :loading="discounts.isPending.value"
      :error="discounts.isError.value ? errorMessage(discounts.error.value) : null"
      empty-title="No discounts or scholarships"
    >
      <template #cell-student="{ row }">
        <p class="font-medium">{{ row.student.name }}</p>
        <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
      </template>
      <template #cell-name="{ row }">
        {{ row.name }}
        <AppBadge v-if="row.category === 'SCHOLARSHIP'" variant="primary" class="ml-1">
          Scholarship
        </AppBadge>
      </template>
      <template #cell-value="{ row }">
        <span class="tabular-nums">{{ valueOf(row) }}</span>
      </template>
      <template #cell-applies="{ row }">{{ row.feeItem?.name ?? 'Whole invoice' }}</template>
      <template #cell-status="{ row }">
        <AppBadge :variant="row.isActive ? 'success' : 'neutral'">
          {{ row.isActive ? 'Active' : 'Ended' }}
        </AppBadge>
      </template>
      <template #cell-actions="{ row }">
        <AppButton
          v-if="props.canManage"
          variant="ghost"
          size="sm"
          :disabled="toggle.pending.value"
          @click="toggle.run(row)"
        >
          {{ row.isActive ? 'End' : 'Reinstate' }}
        </AppButton>
      </template>
    </AppTable>

    <AppModal
      v-model:open="open"
      title="Grant a discount or scholarship"
      description="It applies to invoices raised from now on, not to invoices already issued."
    >
      <form id="discount-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="problem || save.error.value">{{ problem || save.error.value }}</AppAlert>
        <StudentPicker v-model="student" required />
        <AppInput v-model="form.name" label="Name" placeholder="e.g. Sibling discount" required />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect
            v-model="form.category"
            label="Type"
            :options="[
              { value: 'DISCOUNT', label: 'Discount' },
              { value: 'SCHOLARSHIP', label: 'Scholarship' },
            ]"
          />
          <AppSelect v-model="form.feeItemId" label="Applies to" :options="itemOptions" />
          <AppSelect
            v-model="form.kind"
            label="Calculated as"
            :options="[
              { value: 'PERCENTAGE', label: 'A percentage' },
              { value: 'FIXED', label: 'A fixed amount' },
            ]"
          />
          <AppInput
            v-model="form.value"
            :label="form.kind === 'PERCENTAGE' ? 'Percentage' : 'Amount'"
            inputmode="decimal"
            required
          />
        </div>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="discount-form" :loading="save.pending.value"
          >Grant</AppButton
        >
      </template>
    </AppModal>
  </AppCard>
</template>
