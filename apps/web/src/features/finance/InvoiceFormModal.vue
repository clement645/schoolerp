<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import StudentPicker, { type PickedStudent } from '@/components/ui/StudentPicker.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { addDaysIso, todayIso } from '@/utils/format';
import { financeApi, parseAmount } from './finance.service';

const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

let nextKey = 0;
const newLine = () => ({ key: (nextKey += 1), description: '', amount: '' });
const student = ref<PickedStudent | null>(null);
const form = reactive({ dueDate: '', notes: '', lines: [newLine()] });
const problem = ref('');

watch(open, (isOpen) => {
  if (!isOpen) return;
  student.value = null;
  form.dueDate = addDaysIso(todayIso(), 30);
  form.notes = '';
  form.lines = [newLine()];
  problem.value = '';
  save.reset();
});
const total = computed(() =>
  form.lines.reduce((sum, line) => sum + (parseAmount(line.amount) ?? 0), 0),
);

const save = useSaveAction(() =>
  financeApi.createInvoice({
    studentId: student.value?.id ?? '',
    dueDate: form.dueDate,
    notes: form.notes.trim() || null,
    lines: form.lines.map((line) => ({
      description: line.description.trim(),
      amount: parseAmount(line.amount) ?? 0,
    })),
  }),
);

async function submit(): Promise<void> {
  if (!student.value) problem.value = 'Choose the learner to invoice.';
  else if (form.lines.some((line) => line.description.trim().length < 2)) {
    problem.value = 'Describe every charge.';
  } else if (form.lines.some((line) => parseAmount(line.amount) === null)) {
    problem.value =
      'Enter each amount as a number greater than zero, with at most 2 decimal places.';
  } else if (!form.dueDate || form.dueDate < todayIso()) {
    problem.value = 'Choose a due date that is today or later.';
  } else problem.value = '';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}
</script>

<template>
  <AppModal
    v-model:open="open"
    size="lg"
    title="New invoice"
    description="For a one-off charge to one learner. Their standing discounts are applied, and any credit they hold goes towards it."
  >
    <form id="invoice-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="invoice-error">
        {{ problem || save.error.value }}
      </AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <StudentPicker v-model="student" required />
        <AppInput v-model="form.dueDate" label="Due date" type="date" required />
      </div>
      <fieldset>
        <legend class="mb-2 text-sm font-medium">Charges</legend>
        <div class="space-y-2">
          <div v-for="(line, index) in form.lines" :key="line.key" class="flex items-end gap-2">
            <AppInput
              v-model="line.description"
              class="flex-1"
              :label="index === 0 ? 'Description' : undefined"
              :aria-label="`Description ${index + 1}`"
              placeholder="e.g. Educational trip"
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
            Total before discounts:
            <span class="font-semibold tabular-nums">{{ money(total) }}</span>
          </p>
        </div>
      </fieldset>
      <AppInput v-model="form.notes" label="Notes" placeholder="Optional" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
      <AppButton type="submit" form="invoice-form" :loading="save.pending.value">
        Issue invoice
      </AppButton>
    </template>
  </AppModal>
</template>
