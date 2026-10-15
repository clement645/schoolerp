<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTextarea from '@/components/ui/AppTextarea.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { MANUAL_METHODS, parseAmount, type PaymentMethod } from './finance.service';

export interface ReasonPayload {
  reason: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
}

/**
 * Confirms a correction to a financial record. Every such correction needs a
 * reason, which is kept on the record; some also need an amount and a method.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    /** Ask for an amount, up to this much. */
    maxAmount?: number;
    /** Ask how the money is returned. */
    withMethod?: boolean;
    action: (payload: ReasonPayload) => Promise<unknown>;
  }>(),
  { tone: 'primary', withMethod: false },
);
const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

const form = reactive({ reason: '', amount: '', method: 'CASH', reference: '' });
const problem = ref('');

const run = useSaveAction((payload: ReasonPayload) => props.action(payload));
watch(open, (isOpen) => {
  if (!isOpen) return;
  Object.assign(form, {
    reason: '',
    amount: props.maxAmount === undefined ? '' : String(props.maxAmount),
    method: 'CASH',
    reference: '',
  });
  problem.value = '';
  run.reset();
});

async function submit(): Promise<void> {
  const amount = props.maxAmount === undefined ? 0 : parseAmount(form.amount);
  if (amount === null)
    problem.value = 'Enter an amount greater than zero, with at most 2 decimal places.';
  else if (props.maxAmount !== undefined && amount > props.maxAmount) {
    problem.value = `The amount cannot be more than ${money(props.maxAmount)}.`;
  } else if (form.reason.trim().length < 3)
    problem.value = 'Give a reason; it is kept on the record.';
  else problem.value = '';
  if (problem.value || amount === null) return;

  const done = await run.run({
    reason: form.reason.trim(),
    amount,
    method: form.method as PaymentMethod,
    reference: form.reference.trim() || null,
  });
  if (done) open.value = false;
}
</script>

<template>
  <AppModal v-model:open="open" :title="props.title" :description="props.description">
    <form id="reason-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || run.error.value">{{ problem || run.error.value }}</AppAlert>
      <AppInput
        v-if="props.maxAmount !== undefined"
        v-model="form.amount"
        label="Amount"
        inputmode="decimal"
        :hint="`Up to ${money(props.maxAmount)}`"
        required
      />
      <div v-if="props.withMethod" class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.method" label="Returned by" :options="MANUAL_METHODS" />
        <AppInput v-model="form.reference" label="Reference" placeholder="Optional" />
      </div>
      <AppTextarea v-model="form.reason" label="Reason" :max-length="300" required data-autofocus />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
      <AppButton
        type="submit"
        form="reason-form"
        :variant="props.tone === 'danger' ? 'danger' : 'primary'"
        :loading="run.pending.value"
      >
        {{ props.confirmLabel }}
      </AppButton>
    </template>
  </AppModal>
</template>
