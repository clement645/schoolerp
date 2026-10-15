<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  AlertTriangle,
  Banknote,
  Download,
  CircleDollarSign,
  HandCoins,
  Percent,
  Wallet,
} from '@lucide/vue';
import AppChart from '@/components/charts/AppChart.vue';
import { barOption, CHART_COLORS, donutOption } from '@/components/charts/chart-options';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import StatCard from '@/components/ui/StatCard.vue';
import StudentPicker, { type PickedStudent } from '@/components/ui/StudentPicker.vue';
import { useFileDownload } from '@/composables/useFileDownload';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { academicsApi } from '@/features/school-config/config.service';
import { errorMessage } from '@/services/http';
import { formatDate } from '@/utils/format';
import { financeApi, formatMoney, methodLabel, STATEMENT_KIND } from './finance.service';

const ALL = 'all';

const termId = ref(ALL);
const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
});
const termOptions = computed(() => [
  { value: ALL, label: 'All terms' },
  ...(years.data.value ?? []).flatMap((year) =>
    year.terms.map((term) => ({ value: term.id, label: `${term.name}, ${year.name}` })),
  ),
]);
const selectedTerm = computed(() => (termId.value === ALL ? '' : termId.value));

const summary = useQuery({
  queryKey: useSchoolQueryKey('finance', 'summary', selectedTerm),
  queryFn: () => financeApi.summary(selectedTerm.value || undefined),
});
const data = computed(() => summary.data.value);
const money = (amount: number) => formatMoney(amount, data.value?.currency);

const monthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const monthly = computed(() =>
  barOption({
    categories: (data.value?.monthly ?? []).map((entry) =>
      monthLabel.format(new Date(`${entry.month}-01T00:00:00Z`)),
    ),
    series: [
      { name: 'Collected', values: (data.value?.monthly ?? []).map((entry) => entry.amount) },
    ],
  }),
);
const methods = computed(() =>
  donutOption(
    (data.value?.byMethod ?? []).map((entry) => ({
      name: methodLabel(entry.method),
      value: entry.amount,
    })),
  ),
);
const classes = computed(() =>
  barOption({
    categories: (data.value?.byClass ?? []).map((entry) => entry.class),
    series: [
      { name: 'Invoiced', values: (data.value?.byClass ?? []).map((entry) => entry.invoiced) },
      {
        name: 'Outstanding',
        values: (data.value?.byClass ?? []).map((entry) => entry.outstanding),
        color: CHART_COLORS.danger,
      },
    ],
  }),
);

// ── A learner's statement ────────────────────────────────────────────────────
const student = ref<PickedStudent | null>(null);
const exporting = useFileDownload();
function downloadStatement(kind: 'pdf' | 'csv'): void {
  const id = student.value?.id;
  if (!id) return;
  const range = [from.value || undefined, to.value || undefined] as const;
  void exporting.download(kind, () =>
    kind === 'pdf' ? financeApi.statementPdf(id, ...range) : financeApi.statementCsv(id, ...range),
  );
}
const from = ref('');
const to = ref('');
const studentId = computed(() => student.value?.id ?? '');
const statement = useQuery({
  queryKey: useSchoolQueryKey('finance', 'statement', studentId, from, to),
  queryFn: () =>
    financeApi.statement(studentId.value, from.value || undefined, to.value || undefined),
  enabled: computed(() => studentId.value !== ''),
});
const account = computed(() => statement.data.value);
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Financial Reports</h1>
        <p class="text-fg-muted mt-1 text-sm">
          What has been invoiced and collected, what is outstanding, and each learner's account.
        </p>
      </div>
      <AppSelect v-model="termId" class="w-56" aria-label="Term" :options="termOptions" />
    </header>

    <AppEmptyState
      v-if="summary.isError.value"
      tone="danger"
      title="The report could not be loaded"
      :description="errorMessage(summary.error.value)"
    />
    <div v-else-if="!data" class="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-busy="true">
      <AppSkeleton v-for="n in 6" :key="n" height="4.5rem" />
    </div>
    <template v-else>
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Invoiced"
          :value="money(data.totals.invoiced)"
          :icon="Banknote"
          tone="info"
          :hint="data.totals.credited ? `${money(data.totals.credited)} credited` : undefined"
        />
        <StatCard
          label="Collected"
          :value="money(data.totals.collected)"
          :icon="HandCoins"
          tone="success"
        />
        <StatCard
          label="Outstanding"
          :value="money(data.totals.outstanding)"
          :icon="CircleDollarSign"
          tone="warning"
        />
        <StatCard
          label="Overdue"
          :value="money(data.totals.overdue)"
          :icon="AlertTriangle"
          tone="danger"
          :hint="`${data.totals.overdueInvoices} ${data.totals.overdueInvoices === 1 ? 'invoice' : 'invoices'}`"
        />
        <StatCard
          label="Collection rate"
          :value="`${data.totals.collectionRate}%`"
          :icon="Percent"
        />
        <StatCard
          label="Unallocated credit"
          :value="money(data.totals.unallocated)"
          :icon="Wallet"
          tone="info"
          hint="Received, not yet applied to an invoice"
        />
      </div>

      <AppEmptyState
        v-if="data.totals.invoiced === 0 && data.byMethod.length === 0"
        title="Nothing to report yet"
        description="Figures appear once invoices are raised and payments recorded."
      />
      <template v-else>
        <div class="grid gap-6 xl:grid-cols-2">
          <AppCard
            title="Collections"
            subtitle="Received in each of the last six months, net of refunds"
          >
            <AppChart :option="monthly" label="Amount collected in each of the last six months" />
          </AppCard>
          <AppCard title="By payment method" subtitle="All completed payments, net of refunds">
            <AppChart
              v-if="data.byMethod.length"
              :option="methods"
              label="Share of collections by payment method"
            />
            <p v-else class="text-fg-muted py-10 text-center text-sm">No payments recorded yet.</p>
          </AppCard>
          <AppCard title="By class" subtitle="Invoiced against outstanding">
            <AppChart
              v-if="data.byClass.length"
              :option="classes"
              label="Amount invoiced and amount outstanding for each class"
            />
            <p v-else class="text-fg-muted py-10 text-center text-sm">No invoices raised yet.</p>
          </AppCard>
          <AppCard title="Largest balances" subtitle="Learners owing the most">
            <ol v-if="data.topBalances.length" class="text-sm">
              <li
                v-for="entry in data.topBalances"
                :key="entry.student.id"
                class="border-line flex items-center justify-between border-b py-2 last:border-0"
              >
                <span>
                  <span class="font-medium">{{ entry.student.name }}</span>
                  <span class="text-fg-muted">
                    · {{ entry.student.admissionNumber
                    }}<template v-if="entry.class"> · {{ entry.class }}</template>
                  </span>
                </span>
                <span class="font-medium tabular-nums">{{ money(entry.balance) }}</span>
              </li>
            </ol>
            <p v-else class="text-fg-muted py-10 text-center text-sm">Nobody owes anything.</p>
          </AppCard>
        </div>
      </template>
    </template>

    <AppCard
      title="Learner statement"
      subtitle="Every invoice, payment, credit and refund, in the order it was posted"
    >
      <template v-if="student" #actions>
        <AppButton
          variant="outline"
          size="sm"
          :loading="exporting.pending.value === 'pdf'"
          @click="downloadStatement('pdf')"
        >
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          PDF
        </AppButton>
        <AppButton
          variant="outline"
          size="sm"
          :loading="exporting.pending.value === 'csv'"
          @click="downloadStatement('csv')"
        >
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          CSV
        </AppButton>
      </template>
      <p v-if="exporting.error.value" class="text-danger mb-3 text-sm" role="alert">
        {{ exporting.error.value }}
      </p>
      <div class="grid gap-4 sm:grid-cols-3">
        <StudentPicker v-model="student" />
        <AppInput v-model="from" label="From" type="date" :max="to || undefined" />
        <AppInput v-model="to" label="To" type="date" :min="from || undefined" />
      </div>

      <p v-if="!student" class="text-fg-muted mt-4 text-sm">
        Choose a learner to see their account.
      </p>
      <p v-else-if="statement.isError.value" class="text-danger mt-4 text-sm" role="alert">
        {{ errorMessage(statement.error.value) }}
      </p>
      <div v-else-if="!account" class="mt-4 space-y-2" aria-busy="true">
        <AppSkeleton v-for="n in 3" :key="n" height="2rem" />
      </div>
      <div v-else class="mt-4">
        <p class="mb-3 text-sm">
          <template v-if="account.closingBalance > 0">
            Owes <strong>{{ formatMoney(account.closingBalance, account.currency) }}</strong>
          </template>
          <template v-else-if="account.closingBalance < 0">
            In credit by
            <strong>{{ formatMoney(-account.closingBalance, account.currency) }}</strong>
          </template>
          <template v-else>Account is settled.</template>
          <span class="text-fg-muted">
            · Invoiced {{ formatMoney(account.totals.invoiced, account.currency) }} · Paid
            {{ formatMoney(account.totals.paid, account.currency) }}
          </span>
        </p>
        <div class="relative overflow-x-auto">
          <table class="w-full text-sm" data-testid="statement">
            <caption class="sr-only">
              Statement of account
            </caption>
            <thead class="text-fg-muted border-line border-b text-left text-xs uppercase">
              <tr>
                <th scope="col" class="py-2 pr-3 font-medium">Date</th>
                <th scope="col" class="py-2 pr-3 font-medium">Entry</th>
                <th scope="col" class="py-2 pr-3 font-medium">Details</th>
                <th scope="col" class="py-2 pr-3 text-right font-medium">Charged</th>
                <th scope="col" class="py-2 pr-3 text-right font-medium">Received</th>
                <th scope="col" class="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="account.openingBalance !== 0" class="border-line border-b">
                <td colspan="5" class="text-fg-muted py-2">Balance brought forward</td>
                <td class="py-2 text-right tabular-nums">
                  {{ formatMoney(account.openingBalance, account.currency) }}
                </td>
              </tr>
              <tr v-for="(line, index) in account.lines" :key="index" class="border-line border-b">
                <td class="py-2 pr-3 whitespace-nowrap">{{ formatDate(line.date) }}</td>
                <td class="py-2 pr-3 whitespace-nowrap">
                  {{ STATEMENT_KIND[line.kind] }}
                  <span class="text-fg-muted block text-xs">{{ line.reference }}</span>
                </td>
                <td class="text-fg-muted py-2 pr-3">{{ line.description }}</td>
                <td class="py-2 pr-3 text-right tabular-nums">
                  {{ line.debit ? formatMoney(line.debit, account.currency) : '' }}
                </td>
                <td class="py-2 pr-3 text-right tabular-nums">
                  {{ line.credit ? formatMoney(line.credit, account.currency) : '' }}
                </td>
                <td class="py-2 text-right font-medium tabular-nums">
                  {{ formatMoney(line.balance, account.currency) }}
                </td>
              </tr>
              <tr v-if="account.lines.length === 0">
                <td colspan="6" class="text-fg-muted py-6 text-center">
                  Nothing was posted to this account in the chosen period.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </AppCard>
  </div>
</template>
