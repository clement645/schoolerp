<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartColumn,
  Minus,
  Percent,
  TrendingDown,
  TrendingUp,
  Users,
} from '@lucide/vue';
import AppChart from '@/components/charts/AppChart.vue';
import {
  barOption,
  CHART_COLORS,
  donutOption,
  lineOption,
} from '@/components/charts/chart-options';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTable from '@/components/ui/AppTable.vue';
import StatCard from '@/components/ui/StatCard.vue';
import type { TableColumn } from '@/components/ui/table';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import StudentResultModal from './StudentResultModal.vue';
import { EXAM_STATUS, examsApi } from './examinations.service';
import { formatChange, resultsApi, type MeritRow } from './results.service';

const ALL = 'all';

/** The examination whose results are shown; shared with the page so links can preselect it. */
const examId = defineModel<string>('examId', { required: true });

const classId = ref(ALL);
const stream = ref(ALL);

const exams = useQuery({
  queryKey: useSchoolQueryKey('examinations', 'list'),
  queryFn: examsApi.list,
});
// Results exist only once an examination has been compiled.
const compiled = computed(() =>
  (exams.data.value ?? []).filter((exam) => exam.status !== 'DRAFT' && exam.status !== 'OPEN'),
);
const exam = computed(() => compiled.value.find((entry) => entry.id === examId.value) ?? null);
const examOptions = computed(() =>
  compiled.value.map((entry) => ({
    value: entry.id,
    label: `${entry.name} — ${entry.term.name}, ${entry.academicYear.name}`,
  })),
);

// Default to the most recent compiled examination.
watch(
  compiled,
  (list) => {
    if (list.length > 0 && !list.some((entry) => entry.id === examId.value)) {
      const latest = [...list].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
      if (latest) examId.value = latest.id;
    }
  },
  { immediate: true },
);

const classOptions = computed(() => [
  { value: ALL, label: 'All classes' },
  ...(exam.value?.classes ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
]);
const selectedClassId = computed(() => (classId.value === ALL ? '' : classId.value));
const { selectedClass } = useClassOptions(selectedClassId, { activeOnly: false });
const streamOptions = computed(() => [
  { value: ALL, label: 'All streams' },
  ...(selectedClass.value?.streams ?? []).map((entry) => ({
    value: entry.name,
    label: entry.name,
  })),
]);

watch(exam, (current) => {
  if (classId.value !== ALL && !current?.classes.some((entry) => entry.id === classId.value)) {
    classId.value = ALL;
  }
});
watch(classId, () => {
  stream.value = ALL;
});

const filter = computed(() => ({
  examinationId: exam.value?.id ?? '',
  classId: selectedClassId.value || undefined,
  stream: stream.value === ALL ? undefined : stream.value,
}));
const enabled = computed(() => filter.value.examinationId !== '');

const overview = useQuery({
  queryKey: useSchoolQueryKey('results', 'overview', filter),
  queryFn: () => resultsApi.overview(filter.value),
  enabled,
});
const analytics = useQuery({
  queryKey: useSchoolQueryKey('results', 'analytics', filter),
  queryFn: () => resultsApi.analytics(filter.value),
  enabled,
});

const stats = computed(() => overview.data.value?.stats);
const charts = computed(() => analytics.data.value);
const hasResults = computed(() => (stats.value?.studentsExamined ?? 0) > 0);

const subjectChart = computed(() =>
  barOption({
    categories: (charts.value?.subjectPerformance ?? []).map((entry) => entry.subject),
    series: [
      { name: 'Mean', values: (charts.value?.subjectPerformance ?? []).map((e) => e.mean) },
      {
        name: 'Highest',
        values: (charts.value?.subjectPerformance ?? []).map((e) => e.highest),
        color: CHART_COLORS.info,
      },
      {
        name: 'Lowest',
        values: (charts.value?.subjectPerformance ?? []).map((e) => e.lowest),
        color: CHART_COLORS.warning,
      },
    ],
  }),
);
const gradeChart = computed(() =>
  donutOption(
    (charts.value?.gradeDistribution ?? []).map((entry) => ({
      name: entry.grade,
      value: entry.count,
    })),
  ),
);
// One class in view: compare its streams. Otherwise compare classes.
const comparison = computed(() => {
  const streams = charts.value?.streamComparison ?? [];
  const classes = charts.value?.classComparison ?? [];
  if (classes.length <= 1 && streams.length > 1) {
    return {
      title: 'Stream comparison',
      label: 'Mean score of each stream',
      option: barOption({
        categories: streams.map((entry) => entry.stream),
        series: [{ name: 'Mean', values: streams.map((entry) => entry.mean) }],
      }),
      enough: true,
    };
  }
  return {
    title: 'Class comparison',
    label: 'Mean score of each class',
    option: barOption({
      categories: classes.map((entry) => entry.class),
      series: [{ name: 'Mean', values: classes.map((entry) => entry.mean) }],
    }),
    enough: classes.length > 1,
  };
});
const trendChart = computed(() =>
  lineOption({
    categories: (charts.value?.trend ?? []).map((entry) => entry.examination),
    series: [
      { name: 'Mean score', values: (charts.value?.trend ?? []).map((entry) => entry.mean) },
      {
        name: 'Pass rate (%)',
        values: (charts.value?.trend ?? []).map((entry) => entry.passPercentage),
        color: CHART_COLORS.info,
      },
    ],
  }),
);

const columns: TableColumn[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'student', label: 'Student' },
  { key: 'class', label: 'Class' },
  { key: 'average', label: 'Mean score', align: 'right' },
  { key: 'grade', label: 'Grade', align: 'center' },
  { key: 'trend', label: 'Trend' },
  { key: 'status', label: 'Status' },
];

const TREND = {
  up: { icon: ArrowUpRight, class: 'text-success', word: 'Up' },
  down: { icon: ArrowDownRight, class: 'text-danger', word: 'Down' },
  same: { icon: Minus, class: 'text-fg-muted', word: 'No change' },
} as const;

function statusOf(row: MeritRow): { label: string; variant: 'success' | 'danger' | 'neutral' } {
  if (row.passed === null) return { label: 'Not examined', variant: 'neutral' };
  return row.passed
    ? { label: 'Pass', variant: 'success' }
    : { label: 'Below pass mark', variant: 'danger' };
}

const viewing = ref<string | null>(null);
const viewerOpen = ref(false);
function view(row: MeritRow): void {
  viewing.value = row.student.id;
  viewerOpen.value = true;
}
</script>

<template>
  <div class="space-y-6">
    <AppCard>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect
          v-model="examId"
          label="Examination"
          :options="examOptions"
          placeholder="Choose an examination"
          :disabled="examOptions.length === 0"
        />
        <AppSelect v-model="classId" label="Class" :options="classOptions" :disabled="!exam" />
        <AppSelect
          v-model="stream"
          label="Stream"
          :options="streamOptions"
          :disabled="classId === ALL || streamOptions.length <= 1"
        />
      </div>
    </AppCard>

    <AppEmptyState
      v-if="exams.isError.value"
      tone="danger"
      title="Examinations could not be loaded"
      :description="errorMessage(exams.error.value)"
    />
    <AppEmptyState
      v-else-if="!exams.isPending.value && compiled.length === 0"
      :icon="ChartColumn"
      title="No results yet"
      description="Results appear here once an examination's marks have been compiled."
    />
    <AppEmptyState
      v-else-if="overview.isError.value"
      tone="danger"
      title="Results could not be loaded"
      :description="errorMessage(overview.error.value)"
    />

    <template v-else-if="exam">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="font-medium">{{ exam.name }}</span>
        <AppBadge :variant="EXAM_STATUS[exam.status].variant" dot>
          {{ EXAM_STATUS[exam.status].label }}
        </AppBadge>
        <span v-if="exam.status !== 'PUBLISHED'" class="text-fg-muted">
          Not yet published to parents and students.
        </span>
      </div>

      <div
        v-if="!stats"
        class="grid grid-cols-2 gap-4 lg:grid-cols-5"
        aria-busy="true"
        aria-label="Loading results"
      >
        <AppSkeleton v-for="n in 5" :key="n" height="4.5rem" />
      </div>
      <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Students Examined"
          :value="stats.studentsExamined"
          :icon="Users"
          tone="info"
        />
        <StatCard label="Mean Score" :value="stats.meanScore" :icon="ChartColumn" />
        <StatCard
          label="Highest Score"
          :value="stats.highestScore"
          :icon="TrendingUp"
          tone="success"
        />
        <StatCard
          label="Lowest Score"
          :value="stats.lowestScore"
          :icon="TrendingDown"
          tone="danger"
        />
        <StatCard
          label="Pass Percentage"
          :value="`${stats.passPercentage}%`"
          :icon="Percent"
          tone="warning"
        />
      </div>

      <AppEmptyState
        v-if="stats && !hasResults"
        title="Nobody was examined"
        description="No learner in this selection has a mark in this examination."
      />

      <div v-else-if="charts && hasResults" class="grid gap-6 xl:grid-cols-2">
        <AppCard title="Subject performance" subtitle="Mean, highest and lowest by subject">
          <AppChart :option="subjectChart" label="Mean, highest and lowest score in each subject" />
        </AppCard>
        <AppCard title="Grade distribution" subtitle="Learners by overall grade">
          <AppChart :option="gradeChart" label="Number of learners awarded each overall grade" />
        </AppCard>
        <AppCard :title="comparison.title" subtitle="Mean score">
          <AppChart
            v-if="comparison.enough"
            :option="comparison.option"
            :label="comparison.label"
          />
          <p v-else class="text-fg-muted py-10 text-center text-sm">
            A comparison needs more than one class or stream in the selection.
          </p>
        </AppCard>
        <AppCard title="Trend" subtitle="Across this year's compiled examinations">
          <AppChart
            v-if="charts.trend.length > 1"
            :option="trendChart"
            label="Mean score and pass rate in each examination this year"
          />
          <p v-else class="text-fg-muted py-10 text-center text-sm">
            A trend appears once more than one examination has been compiled this year.
          </p>
        </AppCard>
      </div>

      <AppCard title="Merit list" subtitle="Ranked by mean score within this selection" flush>
        <AppTable
          :columns="columns"
          :rows="overview.data.value?.meritList ?? []"
          :row-key="(row) => row.resultId"
          caption="Merit list"
          :loading="overview.isPending.value"
          empty-title="No results in this selection"
        >
          <template #cell-rank="{ row }">
            <span class="font-semibold tabular-nums">{{ row.rank ?? '—' }}</span>
          </template>
          <template #cell-student="{ row }">
            <button
              type="button"
              class="hover:text-primary text-left font-medium underline-offset-2 hover:underline"
              @click="view(row)"
            >
              {{ row.student.name }}
            </button>
            <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
          </template>
          <template #cell-class="{ row }">
            {{ row.class }}<template v-if="row.stream"> {{ row.stream }}</template>
          </template>
          <template #cell-average="{ row }">
            <span class="tabular-nums">{{ row.rank === null ? '—' : row.average }}</span>
          </template>
          <template #cell-grade="{ row }">
            <AppBadge v-if="row.grade" variant="primary">{{ row.grade }}</AppBadge>
            <span v-else>—</span>
          </template>
          <template #cell-trend="{ row }">
            <span
              v-if="row.trend"
              class="inline-flex items-center gap-1 text-sm tabular-nums"
              :class="TREND[row.trend.direction].class"
            >
              <component :is="TREND[row.trend.direction].icon" class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ TREND[row.trend.direction].word }}</span>
              {{ formatChange(row.trend.change) }}
            </span>
            <span v-else class="text-fg-muted">—</span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :variant="statusOf(row).variant">{{ statusOf(row).label }}</AppBadge>
            <p v-if="row.rank !== null && !row.isComplete" class="text-fg-muted mt-0.5 text-xs">
              Missing a subject
            </p>
          </template>
        </AppTable>
      </AppCard>

      <StudentResultModal
        v-model:open="viewerOpen"
        :examination-id="exam.id"
        :student-id="viewing"
      />
    </template>
  </div>
</template>
