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
import MpesaPushModal from './MpesaPushModal.vue';
import ReasonModal, { type ReasonPayload } from './ReasonModal.vue';
import RecordPaymentModal from './RecordPaymentModal.vue';
import { financeApi, INVOICE_STATUS, methodLabel } from './finance.service';

const props = defineProps<{ invoiceId: string | null; canManage: boolean; mpesaReady: boolean }>();
const open = defineModel<boolean>('open', { required: true });
const { money } = useCurrency();

const invoiceId = computed(() => props.invoiceId ?? '');
const query = useQuery({
  queryKey: useSchoolQueryKey('finance', 'invoice', invoiceId),
  queryFn: () => financeApi.invoice(invoiceId.value),
  enabled: computed(() => open.value && invoiceId.value !== ''),
});
const invoice = computed(() => query.data.value);
const owed = computed(() => invoice.value?.status !== 'VOID' && (invoice.value?.balance ?? 0) > 0);
const student = computed(() =>
  invoice.value ? { ...invoice.value.student, class: invoice.value.class } : null,
);
const target = computed(() =>
  invoice.value
    ? { id: invoice.value.id, number: invoice.value.number, balance: invoice.value.balance }
    : null,
);
const creditable = computed(() =>
  invoice.value ? Math.round((invoice.value.total - invoice.value.credited) * 100) / 100 : 0,
);

const paying = ref(false);
const printing = ref(false);
const loadPdf = () => financeApi.invoicePdf(invoiceId.value);
const prompting = ref(false);
const crediting = ref(false);
const voiding = ref(false);

const credit = ({ amount, reason }: ReasonPayload) =>
  financeApi.creditInvoice(invoiceId.value, amount, reason);
const voidInvoice = ({ reason }: ReasonPayload) => financeApi.voidInvoice(invoiceId.value, reason);
</script>

<template>
  <AppModal
    v-model:open="open"
    size="lg"
    :title="invoice ? `Invoice ${invoice.number}` : 'Invoice'"
    :description="
      invoice
        ? `${invoice.student.name} · ${invoice.student.admissionNumber}${invoice.class ? ` · ${invoice.class}` : ''}`
        : undefined
    "
  >
    <AppAlert v-if="query.isError.value">{{ errorMessage(query.error.value) }}</AppAlert>
    <div v-else-if="!invoice" class="space-y-3" aria-busy="true">
      <AppSkeleton height="2rem" />
      <AppSkeleton height="8rem" />
    </div>
    <div v-else class="space-y-5 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <AppBadge :variant="INVOICE_STATUS[invoice.status].variant" dot>
          {{ INVOICE_STATUS[invoice.status].label }}
        </AppBadge>
        <AppBadge v-if="invoice.isOverdue" variant="danger">Overdue</AppBadge>
        <span class="text-fg-muted">
          Issued {{ formatDate(invoice.issueDate) }} · Due {{ formatDate(invoice.dueDate) }}
          <template v-if="invoice.term"> · {{ invoice.term }}</template>
        </span>
      </div>
      <AppAlert v-if="invoice.status === 'VOID'" tone="info" title="Voided">
        {{ invoice.voidReason }}
      </AppAlert>

      <table class="w-full">
        <caption class="sr-only">
          Invoice lines
        </caption>
        <tbody>
          <tr v-for="(line, index) in invoice.lines" :key="index" class="border-line border-b">
            <th scope="row" class="py-1.5 text-left font-normal">{{ line.description }}</th>
            <td class="py-1.5 text-right tabular-nums">
              {{ line.kind === 'DISCOUNT' ? '−' : '' }}{{ money(line.amount) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" class="pt-2 text-left font-semibold">Total</th>
            <td class="pt-2 text-right font-semibold tabular-nums">{{ money(invoice.total) }}</td>
          </tr>
          <tr v-if="invoice.paid > 0">
            <th scope="row" class="text-fg-muted text-left font-normal">Paid</th>
            <td class="text-right tabular-nums">−{{ money(invoice.paid) }}</td>
          </tr>
          <tr v-if="invoice.credited > 0">
            <th scope="row" class="text-fg-muted text-left font-normal">Credited</th>
            <td class="text-right tabular-nums">−{{ money(invoice.credited) }}</td>
          </tr>
          <tr>
            <th scope="row" class="text-left font-semibold">Balance</th>
            <td class="text-right font-semibold tabular-nums" data-testid="invoice-balance">
              {{ money(invoice.balance) }}
            </td>
          </tr>
        </tfoot>
      </table>

      <section v-if="invoice.payments.length">
        <h3 class="mb-1 text-sm font-semibold">Payments applied</h3>
        <ul>
          <li
            v-for="payment in invoice.payments"
            :key="payment.paymentId"
            class="border-line flex justify-between border-b py-1.5"
          >
            <span>
              {{ payment.receiptNumber }}
              <span class="text-fg-muted">
                · {{ methodLabel(payment.method) }} · {{ formatDate(payment.paidOn) }}
              </span>
            </span>
            <span class="tabular-nums">{{ money(payment.amount) }}</span>
          </li>
        </ul>
      </section>
      <section v-if="invoice.creditNotes.length">
        <h3 class="mb-1 text-sm font-semibold">Credit notes</h3>
        <ul>
          <li
            v-for="note in invoice.creditNotes"
            :key="note.id"
            class="border-line flex justify-between gap-3 border-b py-1.5"
          >
            <span>
              {{ note.number }}
              <span class="text-fg-muted">
                · {{ note.reason }} · {{ formatDateTime(note.createdAt) }}
              </span>
            </span>
            <span class="tabular-nums">{{ money(note.amount) }}</span>
          </li>
        </ul>
      </section>
      <p v-if="invoice.notes" class="text-fg-muted">{{ invoice.notes }}</p>
    </div>

    <template v-if="invoice" #footer>
      <AppButton variant="outline" @click="printing = true">
        <template #icon><FileText class="size-4" aria-hidden="true" /></template>
        PDF
      </AppButton>
      <template v-if="props.canManage && invoice.status !== 'VOID'">
        <AppButton
          v-if="invoice.paid === 0 && invoice.credited === 0"
          variant="danger"
          @click="voiding = true"
        >
          Void
        </AppButton>
        <AppButton v-if="creditable > 0" variant="secondary" @click="crediting = true">
          Credit note
        </AppButton>
        <AppButton v-if="owed && props.mpesaReady" variant="secondary" @click="prompting = true">
          Pay by M-Pesa
        </AppButton>
        <AppButton v-if="owed" @click="paying = true">Record payment</AppButton>
      </template>
    </template>

    <PdfViewerModal
      v-model:open="printing"
      :title="invoice ? `Invoice ${invoice.number}` : 'Invoice'"
      :load="invoice ? loadPdf : null"
    />
    <RecordPaymentModal v-model:open="paying" :student="student" :invoice="target" />
    <MpesaPushModal v-model:open="prompting" :student="student" :invoice="target" />
    <ReasonModal
      v-model:open="crediting"
      title="Issue a credit note"
      description="Reduces what is owed on this invoice. Money already paid beyond the new amount is freed as credit."
      confirm-label="Issue credit note"
      :max-amount="creditable"
      :action="credit"
    />
    <ReasonModal
      v-model:open="voiding"
      title="Void this invoice?"
      description="The invoice is cancelled and kept on record. This cannot be undone."
      confirm-label="Void invoice"
      tone="danger"
      :action="voidInvoice"
    />
  </AppModal>
</template>
