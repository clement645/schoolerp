<script setup lang="ts">
import { computed, ref } from 'vue';
import { FileText } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import PdfViewerModal from '@/components/ui/PdfViewerModal.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { formatDate, formatDateTime } from '@/utils/format';
import ReasonModal, { type ReasonPayload } from './ReasonModal.vue';
import { financeApi, methodLabel } from './finance.service';

const props = defineProps<{ paymentId: string | null; canManage: boolean }>();
const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

const paymentId = computed(() => props.paymentId ?? '');
const query = useQuery({
  queryKey: useSchoolQueryKey('finance', 'payment', paymentId),
  queryFn: () => financeApi.payment(paymentId.value),
  enabled: computed(() => open.value && paymentId.value !== ''),
});
const payment = computed(() => query.data.value);

const reversing = ref(false);
const printing = ref(false);
const loadReceipt = () => financeApi.receiptPdf(paymentId.value);
const refunding = ref(false);
const reverse = ({ reason }: ReasonPayload) => financeApi.reversePayment(paymentId.value, reason);
const refund = ({ amount, method, reference, reason }: ReasonPayload) =>
  financeApi.refundPayment(paymentId.value, { amount, method, reference, reason });
</script>

<template>
  <AppModal
    v-model:open="open"
    size="lg"
    :title="payment ? `Receipt ${payment.receiptNumber}` : 'Payment'"
    :description="
      payment ? `${payment.student.name} · ${payment.student.admissionNumber}` : undefined
    "
  >
    <AppAlert v-if="query.isError.value">{{ errorMessage(query.error.value) }}</AppAlert>
    <div v-else-if="!payment" class="space-y-3" aria-busy="true">
      <AppSkeleton height="2rem" />
      <AppSkeleton height="6rem" />
    </div>
    <div v-else class="space-y-5 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <AppBadge :variant="payment.status === 'COMPLETED' ? 'success' : 'neutral'" dot>
          {{ payment.status === 'COMPLETED' ? 'Completed' : 'Reversed' }}
        </AppBadge>
        <span class="text-fg-muted">
          {{ methodLabel(payment.method) }}
          <template v-if="payment.reference"> · {{ payment.reference }}</template>
          · Received {{ formatDate(payment.paidOn) }}
        </span>
      </div>
      <AppAlert v-if="payment.status === 'REVERSED'" tone="info" title="Reversed">
        {{ payment.reversalReason }}
        <template v-if="payment.reversedAt"> ({{ formatDateTime(payment.reversedAt) }})</template>
      </AppAlert>

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Amount</dt>
          <dd class="font-semibold tabular-nums">{{ money(payment.amount) }}</dd>
        </div>
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Applied to invoices</dt>
          <dd class="font-semibold tabular-nums">{{ money(payment.allocated) }}</dd>
        </div>
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Refunded</dt>
          <dd class="font-semibold tabular-nums">{{ money(payment.refunded) }}</dd>
        </div>
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Unallocated credit</dt>
          <dd class="font-semibold tabular-nums" data-testid="payment-unallocated">
            {{ money(payment.unallocated) }}
          </dd>
        </div>
      </dl>

      <section v-if="payment.allocations.length">
        <h3 class="mb-1 text-sm font-semibold">Applied to</h3>
        <ul>
          <li
            v-for="line in payment.allocations"
            :key="line.invoiceId"
            class="border-line flex justify-between border-b py-1.5"
          >
            <span>{{ line.invoiceNumber }}</span>
            <span class="tabular-nums">{{ money(line.amount) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="payment.refunds.length">
        <h3 class="mb-1 text-sm font-semibold">Refunds</h3>
        <ul>
          <li
            v-for="entry in payment.refunds"
            :key="entry.id"
            class="border-line flex justify-between gap-3 border-b py-1.5"
          >
            <span>
              {{ entry.number }}
              <span class="text-fg-muted">
                · {{ methodLabel(entry.method) }} · {{ entry.reason }} ·
                {{ formatDate(entry.refundedOn) }}
              </span>
            </span>
            <span class="tabular-nums">{{ money(entry.amount) }}</span>
          </li>
        </ul>
      </section>
      <p v-if="payment.notes" class="text-fg-muted">{{ payment.notes }}</p>
    </div>

    <template v-if="payment" #footer>
      <AppButton variant="outline" @click="printing = true">
        <template #icon><FileText class="size-4" aria-hidden="true" /></template>
        Receipt
      </AppButton>
      <template v-if="props.canManage && payment.status === 'COMPLETED'">
        <AppButton v-if="payment.refunded === 0" variant="danger" @click="reversing = true">
          Reverse payment
        </AppButton>
        <AppButton v-if="payment.unallocated > 0" variant="secondary" @click="refunding = true">
          Refund credit
        </AppButton>
      </template>
    </template>

    <PdfViewerModal
      v-model:open="printing"
      :title="payment ? `Receipt ${payment.receiptNumber}` : 'Receipt'"
      :load="payment ? loadReceipt : null"
    />

    <ReasonModal
      v-model:open="reversing"
      title="Reverse this payment?"
      description="For a payment recorded in error. Its invoices return to unpaid; the receipt stays on record, marked reversed."
      confirm-label="Reverse payment"
      tone="danger"
      :action="reverse"
    />
    <ReasonModal
      v-model:open="refunding"
      title="Refund unallocated credit"
      description="Returns money that settles no invoice."
      confirm-label="Record refund"
      :max-amount="payment?.unallocated ?? 0"
      with-method
      :action="refund"
    />
  </AppModal>
</template>
