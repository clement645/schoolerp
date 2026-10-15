<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Smartphone } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import StudentPicker, { type PickedStudent } from '@/components/ui/StudentPicker.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import {
  financeApi,
  MPESA_STATUS,
  type MpesaTransaction,
  type StkPushInput,
} from './finance.service';

const props = withDefaults(
  defineProps<{
    student?: PickedStudent | null;
    invoice?: { id: string; number: string; balance: number } | null;
    /** How the request is sent and checked; the parent portal passes its own. */
    push?: (data: StkPushInput) => Promise<MpesaTransaction>;
    verify?: (id: string) => Promise<MpesaTransaction>;
  }>(),
  { push: financeApi.stkPush, verify: financeApi.verifyMpesa },
);
const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

const learner = ref<PickedStudent | null>(null);
const form = reactive({ phone: '', amount: '' });
const problem = ref('');
const request = ref<MpesaTransaction | null>(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  learner.value = props.student ?? null;
  form.phone = '';
  // M-Pesa takes whole shillings; a part-shilling balance is rounded up.
  form.amount = props.invoice ? String(Math.ceil(props.invoice.balance)) : '';
  problem.value = '';
  request.value = null;
  send.reset();
  check.reset();
});

const send = useSaveAction(async () => {
  request.value = await props.push({
    studentId: learner.value?.id ?? '',
    invoiceId: props.invoice?.id,
    phone: form.phone.trim(),
    amount: Number(form.amount),
  });
});
const check = useSaveAction(async () => {
  if (request.value) request.value = await props.verify(request.value.id);
});

async function submit(): Promise<void> {
  if (!learner.value) problem.value = 'Choose the learner the payment is for.';
  else if (!/^(?:\+?254|0)[71]\d{8}$/.test(form.phone.trim())) {
    problem.value = 'Enter a Safaricom number, e.g. 0712 345 678.';
  } else if (!/^[1-9]\d*$/.test(form.amount.trim()) || Number(form.amount) > 250_000) {
    problem.value = 'Enter a whole number of shillings, up to 250,000.';
  } else problem.value = '';
  if (problem.value) return;
  await send.run();
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Request payment by M-Pesa"
    :description="props.invoice ? `Towards ${props.invoice.number}` : undefined"
  >
    <div v-if="request" class="space-y-4" data-testid="mpesa-request">
      <div class="flex items-center gap-3">
        <span
          class="bg-primary-light text-primary flex size-10 items-center justify-center rounded-lg"
        >
          <Smartphone class="size-5" aria-hidden="true" />
        </span>
        <div>
          <p class="font-medium">{{ money(request.amount) }} requested from {{ request.phone }}</p>
          <AppBadge :variant="MPESA_STATUS[request.status].variant" dot>
            {{ MPESA_STATUS[request.status].label }}
          </AppBadge>
        </div>
      </div>
      <AppAlert v-if="check.error.value">{{ check.error.value }}</AppAlert>
      <AppAlert v-if="request.status === 'SUCCESS'" tone="success">
        Payment received<template v-if="request.receiptNumber">
          and recorded as receipt {{ request.receiptNumber }}</template
        >.
      </AppAlert>
      <p v-else-if="request.status === 'PENDING'" class="text-sm">
        A prompt has been sent to the phone. The payment is recorded only when Safaricom confirms it
        — nothing has been credited yet. If the payer has entered their PIN, check the status.
      </p>
      <p v-else class="text-sm">
        The payment did not go through<template v-if="request.resultDescription">
          : {{ request.resultDescription }}</template
        >. Nothing was credited.
      </p>
    </div>
    <form v-else id="mpesa-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || send.error.value" data-testid="mpesa-error">
        {{ problem || send.error.value }}
      </AppAlert>
      <StudentPicker v-model="learner" :disabled="Boolean(props.student)" required />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="form.phone"
          label="Phone to prompt"
          type="tel"
          placeholder="0712 345 678"
          required
        />
        <AppInput
          v-model="form.amount"
          label="Amount (whole shillings)"
          inputmode="numeric"
          required
        />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">{{
        request ? 'Close' : 'Cancel'
      }}</AppButton>
      <AppButton v-if="!request" type="submit" form="mpesa-form" :loading="send.pending.value">
        Send request
      </AppButton>
      <AppButton
        v-else-if="request.status === 'PENDING'"
        :loading="check.pending.value"
        @click="check.run()"
      >
        Check status
      </AppButton>
    </template>
  </AppModal>
</template>
