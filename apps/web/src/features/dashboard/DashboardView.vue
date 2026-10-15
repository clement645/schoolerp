<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import {
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  GraduationCap,
  HandCoins,
  School,
  Users,
} from '@lucide/vue';
import AppChart from '@/components/charts/AppChart.vue';
import { barOption, CHART_COLORS, lineOption } from '@/components/charts/chart-options';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { formatMoney, methodLabel } from '@/features/finance/finance.service';
import { academicsApi } from '@/features/school-config/config.service';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDayMonth, formatWeekday } from '@/utils/format';
import { dashboardApi, EVENT_CATEGORY } from './dashboard.service';

const CURRENT = 'current';

const auth = useAuthStore();
const termId = ref(CURRENT);
const selectedTerm = computed(() => (termId.value === CURRENT ? '' : termId.value));

// The term list needs the calendar permission; without it the dashboard
// simply stays on the current term.
const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
  enabled: computed(() => auth.can('calendar:read')),
});
const termOptions = computed(() => [
  { value: CURRENT, label: 'Current term' },
  ...(years.data.value ?? []).flatMap((year) =>
    year.terms.map((term) => ({ value: term.id, label: `${term.name}, ${year.name}` })),
  ),
]);

const dashboard = useQuery({
  queryKey: useSchoolQueryKey('dashboard', selectedTerm),
  queryFn: () => dashboardApi.get(selectedTerm.value),
});
const data = computed(() => dashboard.data.value);
const money = (amount: number) => formatMoney(amount, data.value?.finance?.currency);

const attendanceChart = computed(() => {
  const week = data.value?.attendance?.week ?? [];
  return barOption({
    categories: week.map((day) => `${formatWeekday(day.date)} ${Number(day.date.slice(8))}`),
    series: [
      {
        name: 'Present',
        values: week.map((day) => day.present + day.late),
        color: CHART_COLORS.primary,
      },
      {
        name: 'Absent',
        values: week.map((day) => day.absent + day.excused),
        color: CHART_COLORS.danger,
      },
    ],
  });
});
const attendanceMarked = computed(() =>
  (data.value?.attendance?.week ?? []).some((day) => day.rate !== null),
);
const performanceChart = computed(() => {
  const trend = data.value?.performance?.trend ?? [];
  return lineOption({
    categories: trend.map((entry) => entry.examination),
    series: [
      { name: 'Mean score', values: trend.map((entry) => entry.mean) },
      {
        name: 'Pass rate (%)',
        values: trend.map((entry) => entry.passPercentage),
        color: CHART_COLORS.info,
      },
    ],
  });
});

const eventWhen = (event: { startDate: string; endDate: string; startTime: string | null }) =>
  event.endDate !== event.startDate
    ? `${formatDayMonth(event.startDate)} – ${formatDayMonth(event.endDate)}`
    : `${formatDate(event.startDate)}${event.startTime ? ` · ${event.startTime}` : ''}`;

const nothingToShow = computed(
  () =>
    data.value !== undefined &&
    Object.values(data.value.counts).every((count) => count === null) &&
    !data.value.attendance &&
    !data.value.performance &&
    !data.value.finance &&
    !data.value.upcomingEvents,
);
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Dashboard</h1>
        <p class="text-fg-muted mt-1 text-sm">
          <template v-if="data?.term">
            {{ data.term.name }}, {{ data.term.academicYear }} ·
            {{ formatDate(data.term.startDate) }} – {{ formatDate(data.term.endDate) }}
          </template>
          <template v-else-if="data">No academic term has been set up yet.</template>
          <template v-else>Welcome back, {{ auth.user?.firstName }}.</template>
        </p>
      </div>
      <AppSelect
        v-if="termOptions.length > 1"
        v-model="termId"
        class="w-56"
        aria-label="Academic year and term"
        :options="termOptions"
      />
    </header>

    <AppEmptyState
      v-if="dashboard.isError.value"
      tone="danger"
      title="The dashboard could not be loaded"
      :description="errorMessage(dashboard.error.value)"
    />
    <div v-else-if="!data" class="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-busy="true">
      <AppSkeleton v-for="n in 6" :key="n" height="4.5rem" />
    </div>
    <AppEmptyState
      v-else-if="nothingToShow"
      title="Nothing to show here yet"
      description="Your account has no access to the school's records. Ask an administrator if that is unexpected."
    />

    <template v-else>
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-3" data-testid="dashboard-stats">
        <StatCard
          v-if="data.counts.students !== null"
          label="Students"
          :value="data.counts.students"
          :icon="Users"
          tone="info"
          hint="Active learners"
        />
        <StatCard
          v-if="data.counts.teachers !== null"
          label="Teachers"
          :value="data.counts.teachers"
          :icon="GraduationCap"
        />
        <StatCard
          v-if="data.counts.classes !== null"
          label="Classes"
          :value="data.counts.classes"
          :icon="School"
          tone="warning"
        />
        <StatCard
          v-if="data.attendance"
          label="Attendance today"
          :value="data.attendance.today.rate === null ? '—' : `${data.attendance.today.rate}%`"
          :icon="CalendarCheck"
          tone="success"
          :hint="
            data.attendance.today.marked
              ? `${data.attendance.today.marked} learners marked`
              : 'No register taken yet'
          "
        />
        <StatCard
          v-if="data.finance"
          label="Fees collected"
          :value="money(data.finance.collected)"
          :icon="HandCoins"
          tone="success"
          :hint="`${data.finance.collectionRate}% of what was invoiced`"
        />
        <StatCard
          v-if="data.finance"
          label="Fees outstanding"
          :value="money(data.finance.outstanding)"
          :icon="CircleDollarSign"
          tone="danger"
        />
      </div>

      <div class="grid gap-6 xl:grid-cols-2">
        <AppCard v-if="data.attendance" title="Attendance this week" subtitle="The last seven days">
          <AppChart
            v-if="attendanceMarked"
            :option="attendanceChart"
            label="Learners present and absent on each of the last seven days"
          />
          <p v-else class="text-fg-muted py-16 text-center text-sm">
            No register has been taken in the last seven days.
          </p>
        </AppCard>

        <AppCard
          v-if="data.performance"
          title="Performance"
          :subtitle="
            data.performance.latest
              ? `Latest: ${data.performance.latest.name} · mean ${data.performance.latest.meanScore}`
              : 'Across this year’s compiled examinations'
          "
        >
          <AppChart
            v-if="data.performance.trend.length > 1"
            :option="performanceChart"
            label="Mean score and pass rate in each compiled examination this year"
          />
          <p v-else-if="data.performance.latest" class="text-fg-muted py-16 text-center text-sm">
            {{ data.performance.latest.name }}: mean {{ data.performance.latest.meanScore }}, pass
            rate {{ data.performance.latest.passPercentage }}%. A trend appears once a second
            examination is compiled.
          </p>
          <p v-else class="text-fg-muted py-16 text-center text-sm">
            No examination has been compiled this term.
          </p>
        </AppCard>

        <AppCard
          v-if="data.performance"
          title="Merit list"
          subtitle="Top learners in the latest examination"
        >
          <ol v-if="data.performance.meritList.length" class="text-sm">
            <li
              v-for="row in data.performance.meritList"
              :key="row.resultId"
              class="border-line flex items-center gap-3 border-b py-2 last:border-0"
            >
              <span
                class="bg-primary-light text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              >
                {{ row.rank }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ row.student.name }}</span>
                <span class="text-fg-muted block text-xs">
                  {{ row.class }}<template v-if="row.stream"> {{ row.stream }}</template>
                </span>
              </span>
              <span class="tabular-nums">{{ row.average }}</span>
              <AppBadge v-if="row.grade" variant="primary">{{ row.grade }}</AppBadge>
            </li>
          </ol>
          <p v-else class="text-fg-muted py-10 text-center text-sm">No results to rank yet.</p>
          <RouterLink
            v-if="data.performance.latest"
            :to="{
              name: 'examinations',
              query: { tab: 'results', exam: data.performance.latest.examinationId },
            }"
            class="text-primary mt-3 inline-block text-sm font-medium hover:underline"
          >
            View all results
          </RouterLink>
        </AppCard>

        <AppCard v-if="data.finance" title="Recent fee payments">
          <ul v-if="data.finance.recentPayments.length" class="text-sm">
            <li
              v-for="payment in data.finance.recentPayments"
              :key="payment.id"
              class="border-line flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ payment.student.name }}</span>
                <span class="text-fg-muted block text-xs">
                  {{ payment.receiptNumber }} · {{ methodLabel(payment.method) }} ·
                  {{ formatDate(payment.paidOn) }}
                </span>
              </span>
              <span
                class="font-medium tabular-nums"
                :class="{ 'text-fg-muted line-through': payment.status === 'REVERSED' }"
              >
                {{ money(payment.amount) }}
              </span>
            </li>
          </ul>
          <p v-else class="text-fg-muted py-10 text-center text-sm">No payments recorded yet.</p>
          <RouterLink
            :to="{ name: 'payments' }"
            class="text-primary mt-3 inline-block text-sm font-medium hover:underline"
          >
            View all payments
          </RouterLink>
        </AppCard>

        <AppCard v-if="data.upcomingEvents" title="Upcoming events">
          <ul v-if="data.upcomingEvents.length" class="text-sm">
            <li
              v-for="event in data.upcomingEvents"
              :key="event.id"
              class="border-line flex items-start gap-3 border-b py-2 last:border-0"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                :class="EVENT_CATEGORY[event.category].tone"
              >
                <CalendarDays class="size-4" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ event.title }}</span>
                <span class="text-fg-muted block text-xs">
                  {{ eventWhen(event) }} · {{ EVENT_CATEGORY[event.category].label
                  }}<template v-if="event.location"> · {{ event.location }}</template>
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-fg-muted py-10 text-center text-sm">
            Nothing is on the calendar for the coming months.
          </p>
        </AppCard>
      </div>
    </template>
  </div>
</template>
