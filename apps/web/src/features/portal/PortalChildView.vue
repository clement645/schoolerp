<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import {
  ArrowLeft,
  CalendarCheck,
  CircleDollarSign,
  Download,
  Eye,
  GraduationCap,
} from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import PdfViewerModal from '@/components/ui/PdfViewerModal.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useFileDownload } from '@/composables/useFileDownload';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { formatRate, statusInfo } from '@/features/attendance/attendance.service';
import MpesaPushModal from '@/features/finance/MpesaPushModal.vue';
import {
  formatMoney,
  STATEMENT_KIND,
  type InvoiceSummary,
} from '@/features/finance/finance.service';
import { ApiRequestError, errorMessage, type DownloadedFile } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate, saveBlob } from '@/utils/format';
import { portalApi, type PortalResult } from './portal.service';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'results', label: 'Results' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'fees', label: 'Fees' },
];

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const studentId = computed(() => String(route.params.id));
const tab = computed({
  get: () => {
    const requested = route.query.tab;
    return TABS.some((entry) => entry.id === requested) ? (requested as string) : 'overview';
  },
  set: (id) => {
    void router.replace({ query: { tab: id === 'overview' ? undefined : id } });
  },
});
const on = (id: string) => computed(() => tab.value === id);

const overview = useQuery({
  queryKey: useSchoolQueryKey('portal', 'overview', studentId),
  queryFn: () => portalApi.overview(studentId.value),
});
const results = useQuery({
  queryKey: useSchoolQueryKey('portal', 'results', studentId),
  queryFn: () => portalApi.results(studentId.value),
  enabled: on('results'),
});
const attendance = useQuery({
  queryKey: useSchoolQueryKey('portal', 'attendance', studentId),
  queryFn: () => portalApi.attendance(studentId.value),
  enabled: on('attendance'),
});
const fees = useQuery({
  queryKey: useSchoolQueryKey('portal', 'fees', studentId),
  queryFn: () => portalApi.fees(studentId.value),
  enabled: on('fees'),
});
const mpesa = useQuery({
  queryKey: useSchoolQueryKey('portal', 'mpesa-config'),
  queryFn: portalApi.mpesaConfig,
  enabled: computed(() => tab.value === 'fees' && auth.can('portal:parent')),
  staleTime: 5 * 60_000,
});

const data = computed(() => overview.data.value);
const notFound = computed(
  () => overview.error.value instanceof ApiRequestError && overview.error.value.status === 404,
);
const money = (amount: number) =>
  formatMoney(amount, fees.data.value?.statement.currency ?? data.value?.fees.currency);
const canPay = computed(() => auth.can('portal:parent') && mpesa.data.value?.configured === true);

// ── Report cards ─────────────────────────────────────────────────────────────
const viewerOpen = ref(false);
const viewer = ref<{ title: string; load: () => Promise<DownloadedFile> } | null>(null);
function preview(result: PortalResult): void {
  const id = studentId.value;
  viewer.value = {
    title: `Report card — ${result.examination}`,
    load: () => portalApi.reportCardPdf(id, result.examinationId),
  };
  viewerOpen.value = true;
}
const downloading = ref<string | null>(null);
const downloadError = ref<string | null>(null);
async function download(result: PortalResult): Promise<void> {
  downloading.value = result.examinationId;
  downloadError.value = null;
  try {
    const file = await portalApi.reportCardPdf(studentId.value, result.examinationId);
    saveBlob(file.blob, file.filename);
  } catch (caught) {
    downloadError.value = errorMessage(caught);
  } finally {
    downloading.value = null;
  }
}

// ── Fee documents ────────────────────────────────────────────────────────────
const files = useFileDownload();
const downloadStatement = () =>
  files.download('statement', () => portalApi.statementPdf(studentId.value));
const downloadInvoice = (invoice: InvoiceSummary) =>
  files.download(invoice.id, () => portalApi.invoicePdf(studentId.value, invoice.id));
const downloadReceipt = (receiptNumber: string) =>
  files.download(receiptNumber, () => portalApi.receiptPdf(studentId.value, receiptNumber));

// ── Paying ───────────────────────────────────────────────────────────────────
const paying = ref(false);
const payFor = ref<{ id: string; number: string; balance: number } | null>(null);
function pay(invoice: InvoiceSummary): void {
  payFor.value = { id: invoice.id, number: invoice.number, balance: invoice.balance };
  paying.value = true;
}
const payer = computed(() =>
  data.value
    ? {
        id: data.value.child.id,
        name: data.value.child.name,
        admissionNumber: data.value.child.admissionNumber,
        class: data.value.child.class,
      }
    : null,
);
</script>

<template>
  <div class="space-y-6">
    <RouterLink
      v-if="auth.can('portal:parent')"
      :to="{ name: 'portal' }"
      class="text-fg-muted hover:text-fg inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft class="size-4" aria-hidden="true" /> All children
    </RouterLink>

    <AppEmptyState
      v-if="notFound"
      title="Record not found"
      description="This record does not exist, or is not linked to your account."
    />
    <AppEmptyState
      v-else-if="overview.isError.value"
      tone="danger"
      title="The record could not be loaded"
      :description="errorMessage(overview.error.value)"
    />
    <div v-else-if="!data" class="space-y-4" aria-busy="true">
      <AppSkeleton height="3rem" width="50%" />
      <AppSkeleton height="6rem" />
    </div>

    <template v-else>
      <header>
        <h1>{{ data.child.name }}</h1>
        <p class="text-fg-muted mt-1 text-sm">
          {{ data.child.admissionNumber }} · {{ data.child.class ?? 'Not placed'
          }}<template v-if="data.child.stream"> {{ data.child.stream }}</template>
        </p>
      </header>

      <AppTabs v-model="tab" :tabs="TABS" label="Record sections" />

      <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
        <!-- Overview -->
        <div v-if="tab === 'overview'" class="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Latest result"
            :value="
              data.latestResult
                ? `${data.latestResult.average} · ${data.latestResult.grade ?? '—'}`
                : '—'
            "
            :icon="GraduationCap"
            :hint="data.latestResult?.examination ?? 'No published results yet'"
          />
          <StatCard
            label="Attendance, last 30 days"
            :value="formatRate(data.attendance.rate)"
            :icon="CalendarCheck"
            tone="success"
            :hint="
              data.attendance.rate === null
                ? 'No register taken'
                : `${data.attendance.absent + data.attendance.excused} days absent, ${data.attendance.late} late`
            "
          />
          <StatCard
            :label="data.fees.balance < 0 ? 'Fees in credit' : 'Fees balance'"
            :value="formatMoney(Math.abs(data.fees.balance), data.fees.currency)"
            :icon="CircleDollarSign"
            :tone="data.fees.overdue > 0 ? 'danger' : 'info'"
            :hint="
              data.fees.overdue > 0
                ? `${formatMoney(data.fees.overdue, data.fees.currency)} overdue`
                : undefined
            "
          />
        </div>

        <!-- Results -->
        <AppCard
          v-else-if="tab === 'results'"
          title="Results"
          subtitle="Results appear here once the school publishes them."
          flush
        >
          <div v-if="downloadError" class="px-5 pt-4">
            <AppAlert>{{ downloadError }}</AppAlert>
          </div>
          <p v-if="results.isError.value" class="text-danger p-5 text-sm" role="alert">
            {{ errorMessage(results.error.value) }}
          </p>
          <div v-else-if="!results.data.value" class="space-y-2 p-5" aria-busy="true">
            <AppSkeleton v-for="n in 2" :key="n" height="3rem" />
          </div>
          <AppEmptyState
            v-else-if="results.data.value.length === 0"
            title="No published results yet"
          />
          <ul v-else class="divide-line divide-y">
            <li
              v-for="result in results.data.value"
              :key="result.examinationId"
              class="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div class="text-sm">
                <p class="font-medium">{{ result.examination }}</p>
                <p class="text-fg-muted">{{ result.term }}, {{ result.academicYear }}</p>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-sm tabular-nums">Mean {{ result.average }}</span>
                <AppBadge v-if="result.grade" variant="primary">{{ result.grade }}</AppBadge>
                <AppButton
                  variant="secondary"
                  size="sm"
                  :aria-label="`View the ${result.examination} report card`"
                  @click="preview(result)"
                >
                  <template #icon><Eye class="size-4" aria-hidden="true" /></template>
                  Report card
                </AppButton>
                <AppButton
                  variant="ghost"
                  size="sm"
                  :aria-label="`Download the ${result.examination} report card`"
                  :loading="downloading === result.examinationId"
                  @click="download(result)"
                >
                  <template #icon><Download class="size-4" aria-hidden="true" /></template>
                  PDF
                </AppButton>
              </div>
            </li>
          </ul>
        </AppCard>

        <!-- Attendance -->
        <AppCard
          v-else-if="tab === 'attendance'"
          title="Attendance"
          subtitle="The last 90 days"
          flush
        >
          <p v-if="attendance.isError.value" class="text-danger p-5 text-sm" role="alert">
            {{ errorMessage(attendance.error.value) }}
          </p>
          <div v-else-if="!attendance.data.value" class="space-y-2 p-5" aria-busy="true">
            <AppSkeleton v-for="n in 3" :key="n" height="2rem" />
          </div>
          <AppEmptyState
            v-else-if="attendance.data.value.records.length === 0"
            title="No attendance recorded"
            description="Nothing has been marked for this period."
          />
          <template v-else>
            <p class="border-line border-b px-5 py-3 text-sm">
              Attended <strong>{{ formatRate(attendance.data.value.totals.rate) }}</strong> of
              {{ attendance.data.value.totals.marked }} days marked ·
              {{ attendance.data.value.totals.absent }} absent ·
              {{ attendance.data.value.totals.late }} late ·
              {{ attendance.data.value.totals.excused }} excused
            </p>
            <ul class="divide-line divide-y text-sm">
              <li
                v-for="record in attendance.data.value.records"
                :key="record.date"
                class="flex items-center justify-between gap-3 px-5 py-2.5"
              >
                <span>
                  {{ formatDate(record.date) }}
                  <span v-if="record.note" class="text-fg-muted">· {{ record.note }}</span>
                </span>
                <AppBadge :variant="statusInfo(record.status).variant">
                  {{ statusInfo(record.status).label }}
                </AppBadge>
              </li>
            </ul>
          </template>
        </AppCard>

        <!-- Fees -->
        <div v-else class="space-y-6">
          <p v-if="fees.isError.value" class="text-danger text-sm" role="alert">
            {{ errorMessage(fees.error.value) }}
          </p>
          <div v-else-if="!fees.data.value" class="space-y-2" aria-busy="true">
            <AppSkeleton v-for="n in 3" :key="n" height="3rem" />
          </div>
          <template v-else>
            <AppAlert v-if="files.error.value">{{ files.error.value }}</AppAlert>
            <AppCard title="Invoices to pay" flush>
              <AppEmptyState
                v-if="fees.data.value.outstanding.length === 0"
                title="Nothing to pay"
                description="There are no unpaid invoices on this account."
              />
              <ul v-else class="divide-line divide-y">
                <li
                  v-for="invoice in fees.data.value.outstanding"
                  :key="invoice.id"
                  class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
                >
                  <div>
                    <p class="font-medium">
                      {{ invoice.number }}
                      <AppBadge v-if="invoice.isOverdue" variant="danger" class="ml-1"
                        >Overdue</AppBadge
                      >
                    </p>
                    <p class="text-fg-muted">
                      {{ invoice.term ?? 'One-off charge' }} · Due {{ formatDate(invoice.dueDate) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="font-semibold tabular-nums">{{ money(invoice.balance) }}</span>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      :aria-label="`Download invoice ${invoice.number}`"
                      :loading="files.pending.value === invoice.id"
                      @click="downloadInvoice(invoice)"
                    >
                      <template #icon><Download class="size-4" aria-hidden="true" /></template>
                      PDF
                    </AppButton>
                    <AppButton v-if="canPay" size="sm" @click="pay(invoice)"
                      >Pay by M-Pesa</AppButton
                    >
                  </div>
                </li>
              </ul>
              <p
                v-if="
                  auth.can('portal:parent') &&
                  mpesa.data.value &&
                  !mpesa.data.value.configured &&
                  fees.data.value.outstanding.length
                "
                class="text-fg-muted border-line border-t px-5 py-3 text-sm"
              >
                Online payment is not available for this school. Please pay at the school office.
              </p>
            </AppCard>

            <AppCard title="Statement" subtitle="Every charge and payment on this account" flush>
              <template #actions>
                <AppButton
                  variant="outline"
                  size="sm"
                  :loading="files.pending.value === 'statement'"
                  @click="downloadStatement"
                >
                  <template #icon><Download class="size-4" aria-hidden="true" /></template>
                  Statement PDF
                </AppButton>
              </template>
              <div class="relative overflow-x-auto">
                <table class="w-full text-sm">
                  <caption class="sr-only">
                    Statement of account
                  </caption>
                  <thead class="text-fg-muted border-line border-b text-left text-xs uppercase">
                    <tr>
                      <th scope="col" class="px-5 py-2 font-medium">Date</th>
                      <th scope="col" class="px-3 py-2 font-medium">Entry</th>
                      <th scope="col" class="px-3 py-2 text-right font-medium">Charged</th>
                      <th scope="col" class="px-3 py-2 text-right font-medium">Paid</th>
                      <th scope="col" class="px-5 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(line, index) in fees.data.value.statement.lines"
                      :key="index"
                      class="border-line border-b last:border-0"
                    >
                      <td class="px-5 py-2 whitespace-nowrap">{{ formatDate(line.date) }}</td>
                      <td class="px-3 py-2">
                        {{ STATEMENT_KIND[line.kind] }}
                        <button
                          v-if="line.kind === 'PAYMENT'"
                          type="button"
                          class="text-primary block text-xs hover:underline"
                          :aria-label="`Download receipt ${line.reference}`"
                          @click="downloadReceipt(line.reference)"
                        >
                          {{ line.reference }} · receipt
                        </button>
                        <span v-else class="text-fg-muted block text-xs">{{ line.reference }}</span>
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums">
                        {{ line.debit ? money(line.debit) : '' }}
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums">
                        {{ line.credit ? money(line.credit) : '' }}
                      </td>
                      <td class="px-5 py-2 text-right font-medium tabular-nums">
                        {{ money(line.balance) }}
                      </td>
                    </tr>
                    <tr v-if="fees.data.value.statement.lines.length === 0">
                      <td colspan="5" class="text-fg-muted px-5 py-6 text-center">
                        Nothing has been charged to this account yet.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </AppCard>
          </template>
        </div>
      </section>

      <PdfViewerModal
        v-model:open="viewerOpen"
        :title="viewer?.title ?? 'Report card'"
        :load="viewer?.load ?? null"
      />
      <MpesaPushModal
        v-model:open="paying"
        :student="payer"
        :invoice="payFor"
        :push="portalApi.pay"
        :verify="portalApi.verifyPayment"
      />
    </template>
  </div>
</template>
