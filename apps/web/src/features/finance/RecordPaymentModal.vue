<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import StudentPicker, { type PickedStudent } from '@/components/ui/StudentPicker.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { todayIso } from '@/utils/format';
import {
  financeApi,
  MANUAL_METHODS,
  parseAmount,
  type PaymentDetail,
  type PaymentMethod,
} from './finance.service';

/** Preset when paying from an invoice; otherwise the cashier chooses the learner. */
const props = defineProps<{
  student?: PickedStudent | null;
  invoice?: { id: string; number: string; balance: number } | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ recorded: [payment: PaymentDetail] }>();
const { money } = useCurrency();

const learner = ref<PickedStudent | null>(null);
const form = reactive({ amount: '', method: 'CASH', reference: '', paidOn: todayIso(), notes: '' });
const problem = ref('');
const receipt = ref<PaymentDetail | null>(null);
const needsReference = computed(() => form.method !== 'CASH');

watch(open, (isOpen) => {
  if (!isOpen) return;
  learner.value = props.student ?? null;
  Object.assign(form, {
    amount: props.invoice ? String(props.invoice.balance) : '',
    method: 'CASH',
    reference: '',
    paidOn: todayIso(),
    notes: '',
  });
  problem.value = '';
  receipt.value = null;
  save.reset();
});

const save = useSaveAction(async () => {
  receipt.value = await financeApi.recordPayment({
    studentId: learner.value?.id ?? '',
    amount: parseAmount(form.amount) ?? 0,
    method: form.method as PaymentMethod,
    reference: needsReference.value ? form.reference.trim() : null,
    paidOn: form.paidOn,
    invoiceId: props.invoice?.id,
    notes: form.notes.trim() || null,
  });
  emit('recorded', receipt.value);
});

async function submit(): Promise<void> {
  if (!learner.value) problem.value = 'Choose the learner the payment is for.';
  else if (parseAmount(form.amount) === null) {
    problem.value = 'Enter an amount greater than zero, with at most 2 decimal places.';
  } else if (needsReference.value && form.reference.trim().length < 3) {
    problem.value =
      'Enter the transaction reference, so the same payment cannot be recorded twice.';
  } else if (!form.paidOn || form.paidOn > todayIso())
    problem.value = 'The payment date cannot be in the future.';
  else problem.value = '';
  if (problem.value) return;
  await save.run();
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Record a payment"
    :description="
      props.invoice
        ? `Towards ${props.invoice.number} · ${money(props.invoice.balance)} outstanding`
        : 'Applied to the learner’s oldest unpaid invoices first.'
    "
  >
    <div v-if="receipt" class="space-y-3" data-testid="payment-receipt">
      <AppAlert tone="success" :title="`Receipt ${receipt.receiptNumber}`">
        {{ money(receipt.amount) }} received from {{ receipt.student.name }}.
      </AppAlert>
      <ul class="text-sm">
        <li
          v-for="line in receipt.allocations"
          :key="line.invoiceId"
          class="flex justify-between py-1"
        >
          <span>Applied to {{ line.invoiceNumber }}</span>
          <span class="tabular-nums">{{ money(line.amount) }}</span>
        </li>
        <li v-if="receipt.unallocated > 0" class="flex justify-between py-1">
          <span>Held as credit on the learner’s account</span>
          <span class="tabular-nums">{{ money(receipt.unallocated) }}</span>
        </li>
      </ul>
    </div>
    <form v-else id="payment-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="payment-error">
        {{ problem || save.error.value }}
      </AppAlert>
      <StudentPicker v-model="learner" :disabled="Boolean(props.student)" required />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="form.amount"
          label="Amount"
          inputmode="decimal"
          placeholder="0.00"
          required
        />
        <AppInput
          v-model="form.paidOn"
          label="Date received"
          type="date"
          :max="todayIso()"
          required
        />
        <AppSelect v-model="form.method" label="Method" :options="MANUAL_METHODS" />
        <AppInput
          v-if="needsReference"
          v-model="form.reference"
          label="Reference"
          hint="Bank, cheque or card transaction number"
          required
        />
      </div>
      <AppInput v-model="form.notes" label="Notes" placeholder="Optional" />
      <p class="text-fg-muted text-xs">
        M-Pesa payments are not entered here: they are recorded automatically when Safaricom
        confirms them.
      </p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">{{
        receipt ? 'Close' : 'Cancel'
      }}</AppButton>
      <AppButton v-if="!receipt" type="submit" form="payment-form" :loading="save.pending.value">
        Record payment
      </AppButton>
    </template>
  </AppModal>
</template>
