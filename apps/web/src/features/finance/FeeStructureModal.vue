<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Plus, Trash2 } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { classesApi } from '@/features/classes/classes.service';
import { academicsApi } from '@/features/school-config/config.service';
import { financeApi, parseAmount, type FeeStructure } from './finance.service';

const ALL_CLASSES = 'all';

const props = defineProps<{ structure: FeeStructure | null }>();
const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

const items = useQuery({
  queryKey: useSchoolQueryKey('finance', 'fee-items'),
  queryFn: financeApi.feeItems,
});
const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
});
const classes = useQuery({ queryKey: useSchoolQueryKey('classes'), queryFn: classesApi.list });

const termOptions = computed(() =>
  (years.data.value ?? []).flatMap((year) =>
    year.terms.map((term) => ({ value: term.id, label: `${term.name}, ${year.name}` })),
  ),
);
const classOptions = computed(() => [
  { value: ALL_CLASSES, label: 'Every class' },
  ...(classes.data.value ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
]);
const itemOptions = computed(() =>
  (items.data.value ?? [])
    .filter((item) => item.isActive || form.lines.some((line) => line.feeItemId === item.id))
    .map((item) => ({ value: item.id, label: item.name })),
);

let nextKey = 0;
const newLine = (feeItemId = '', amount = '') => ({ key: (nextKey += 1), feeItemId, amount });
const form = reactive({
  name: '',
  termId: '',
  classId: ALL_CLASSES,
  lines: [newLine()],
});
const problem = ref('');

watch(open, (isOpen) => {
  if (!isOpen) return;
  const source = props.structure;
  form.name = source?.name ?? '';
  form.termId = source?.term.id ?? '';
  form.classId = source?.class?.id ?? ALL_CLASSES;
  form.lines = source
    ? source.lines.map((line) => newLine(line.feeItemId, String(line.amount)))
    : [newLine()];
  problem.value = '';
  save.reset();
});

const total = computed(() =>
  form.lines.reduce((sum, line) => sum + (parseAmount(line.amount) ?? 0), 0),
);

function validate(): string {
  if (form.name.trim().length < 2) return 'Enter a name for the fee structure.';
  if (!form.termId) return 'Choose the term these fees are for.';
  if (form.lines.some((line) => !line.feeItemId)) return 'Choose a fee item on every line.';
  if (new Set(form.lines.map((line) => line.feeItemId)).size !== form.lines.length) {
    return 'Each fee item can appear only once.';
  }
  if (form.lines.some((line) => parseAmount(line.amount) === null)) {
    return 'Enter each amount as a number greater than zero, with at most 2 decimal places.';
  }
  return '';
}

const save = useSaveAction(() => {
  const data = {
    name: form.name.trim(),
    termId: form.termId,
    classId: form.classId === ALL_CLASSES ? null : form.classId,
    lines: form.lines.map((line) => ({
      feeItemId: line.feeItemId,
      amount: parseAmount(line.amount) ?? 0,
    })),
  };
  return props.structure
    ? financeApi.updateFeeStructure(props.structure.id, data)
    : financeApi.createFeeStructure(data);
});

async function submit(): Promise<void> {
  problem.value = validate();
  if (problem.value) return;
  if (await save.run()) open.value = false;
}
</script>

<template>
  <AppModal
    v-model:open="open"
    size="lg"
    :title="props.structure ? 'Edit fee structure' : 'New fee structure'"
    description="Changes affect invoices raised from now on; invoices already issued keep their amounts."
  >
    <form id="fee-structure-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="structure-error">
        {{ problem || save.error.value }}
      </AppAlert>
      <AppInput
        v-model="form.name"
        label="Name"
        placeholder="e.g. Grade 7 — Term 3 fees"
        required
        data-autofocus
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-model="form.termId"
          label="Term"
          :options="termOptions"
          placeholder="Choose a term"
          required
        />
        <AppSelect v-model="form.classId" label="Applies to" :options="classOptions" />
      </div>

      <fieldset>
        <legend class="mb-2 text-sm font-medium">Charges</legend>
        <div class="space-y-2">
          <div v-for="(line, index) in form.lines" :key="line.key" class="flex items-end gap-2">
            <AppSelect
              v-model="line.feeItemId"
              class="flex-1"
              :label="index === 0 ? 'Fee item' : undefined"
              :aria-label="`Fee item ${index + 1}`"
              :options="itemOptions"
              placeholder="Choose a fee item"
            />
            <AppInput
              v-model="line.amount"
              class="w-36"
              :label="index === 0 ? 'Amount' : undefined"
              :aria-label="`Amount ${index + 1}`"
              inputmode="decimal"
              placeholder="0.00"
            />
            <AppButton
              variant="ghost"
              :disabled="form.lines.length === 1"
              :aria-label="`Remove charge ${index + 1}`"
              @click="form.lines.splice(index, 1)"
            >
              <template #icon><Trash2 class="size-4" aria-hidden="true" /></template>
            </AppButton>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between">
          <AppButton variant="secondary" size="sm" @click="form.lines.push(newLine())">
            <template #icon><Plus class="size-4" aria-hidden="true" /></template>
            Add charge
          </AppButton>
          <p class="text-sm">
            Total per learner:
            <span class="font-semibold tabular-nums" data-testid="structure-total">
              {{ money(total) }}
            </span>
          </p>
        </div>
        <p v-if="itemOptions.length === 0" class="text-fg-muted mt-2 text-sm">
          Add fee items first, on the Fee items tab.
        </p>
      </fieldset>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
      <AppButton type="submit" form="fee-structure-form" :loading="save.pending.value">
        Save fee structure
      </AppButton>
    </template>
  </AppModal>
</template>
