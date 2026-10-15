<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarCheck, Clock, ShieldCheck, UserCheck, UserX } from '@lucide/vue';
import AppChart from '@/components/charts/AppChart.vue';
import { barOption, lineOption } from '@/components/charts/chart-options';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import StatCard from '@/components/ui/StatCard.vue';
import type { TableColumn } from '@/components/ui/table';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { addDaysIso, formatDayMonth, todayIso } from '@/utils/format';
import { attendanceApi, formatRate } from './attendance.service';

const ALL = 'all';

const classId = ref(ALL);
const streamId = ref(ALL);
const to = ref(todayIso());
const from = ref(addDaysIso(todayIso(), -29));

const selectedClassId = computed(() => (classId.value === ALL ? '' : classId.value));
const { classOptions: classes, streamOptions: streams } = useClassOptions(selectedClassId);
const classOptions = computed(() => [{ value: ALL, label: 'All classes' }, ...classes.value]);
const streamOptions = computed(() => [{ value: ALL, label: 'All streams' }, ...streams.value]);
watch(classId, () => {
  streamId.value = ALL;
});

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const rangeError = computed(() => {
  if (!isDate(from.value) || !isDate(to.value)) return 'Choose both dates.';
  if (from.value > to.value) return 'The start date must not be after the end date.';
  return '';
});
const query = computed(() => ({
  classId: selectedClassId.value,
  streamId: streamId.value === ALL ? '' : streamId.value,
  from: from.value,
  to: to.value,
}));

const summary = useQuery({
  queryKey: useSchoolQueryKey('attendance', 'summary', query),
  queryFn: () => attendanceApi.summary(query.value),
  enabled: computed(() => rangeError.value === ''),
});
const data = computed(() => summary.data.value);
const hasMarks = computed(() => (data.value?.totals.marked ?? 0) > 0);

const trend = computed(() =>
  lineOption({
    categories: (data.value?.daily ?? []).map((day) => formatDayMonth(day.date)),
    series: [{ name: 'Attendance', values: (data.value?.daily ?? []).map((day) => day.rate) }],
    max: 100,
    unit: '%',
  }),
);
const comparison = computed(() =>
  barOption({
    categories: (data.value?.byClass ?? []).map((entry) => entry.class),
    series: [{ name: 'Attendance', values: (data.value?.byClass ?? []).map((e) => e.rate) }],
    max: 100,
    unit: '%',
  }),
);

const columns: TableColumn[] = [
  { key: 'student', label: 'Learner' },
  { key: 'stream', label: 'Stream' },
  { key: 'present', label: 'Present', align: 'right' },
  { key: 'late', label: 'Late', align: 'right' },
  { key: 'absent', label: 'Absent', align: 'right' },
  { key: 'excused', label: 'Excused', align: 'right' },
  { key: 'rate', label: 'Attendance', align: 'right' },
];
</script>

<template>
  <div class="space-y-6">
    <AppCard>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AppInput v-model="from" label="From" type="date" :max="to" />
        <AppInput v-model="to" label="To" type="date" :error="rangeError" />
        <AppSelect v-model="classId" label="Class" :options="classOptions" />
        <AppSelect
          v-model="streamId"
          label="Stream"
          :options="streamOptions"
          :disabled="classId === ALL || streamOptions.length <= 1"
        />
      </div>
    </AppCard>

    <AppEmptyState
      v-if="summary.isError.value"
      tone="danger"
      title="The summary could not be loaded"
      :description="errorMessage(summary.error.value)"
    />
    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Attendance" :value="formatRate(data.totals.rate)" :icon="CalendarCheck" />
        <StatCard label="Present" :value="data.totals.present" :icon="UserCheck" tone="success" />
        <StatCard label="Absent" :value="data.totals.absent" :icon="UserX" tone="danger" />
        <StatCard label="Late" :value="data.totals.late" :icon="Clock" tone="warning" />
        <StatCard label="Excused" :value="data.totals.excused" :icon="ShieldCheck" tone="info" />
      </div>

      <AppEmptyState
        v-if="!hasMarks"
        :icon="CalendarCheck"
        title="No attendance recorded"
        description="No register was marked for this selection in the chosen period."
      />
      <template v-else>
        <div class="grid gap-6 xl:grid-cols-2">
          <AppCard title="Daily attendance" subtitle="Share of marked learners who attended">
            <AppChart :option="trend" label="Attendance rate on each day of the period" />
          </AppCard>
          <AppCard title="By class" subtitle="Attendance rate over the period">
            <AppChart
              v-if="data.byClass.length > 1"
              :option="comparison"
              label="Attendance rate of each class over the period"
            />
            <p v-else class="text-fg-muted py-10 text-center text-sm">
              A comparison needs more than one class in the selection.
            </p>
          </AppCard>
        </div>

        <AppCard v-if="classId !== ALL" title="Learners" flush>
          <AppTable
            :columns="columns"
            :rows="data.students"
            :row-key="(row) => row.student.id"
            caption="Attendance by learner"
            empty-title="No learners were marked"
          >
            <template #cell-student="{ row }">
              <p class="font-medium">{{ row.student.name }}</p>
              <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
            </template>
            <template #cell-rate="{ row }">
              <span
                class="font-medium tabular-nums"
                :class="row.rate !== null && row.rate < 75 ? 'text-danger' : undefined"
              >
                {{ formatRate(row.rate) }}
              </span>
            </template>
          </AppTable>
        </AppCard>
        <p v-else class="text-fg-muted text-sm">Choose a class to see each learner's figures.</p>
      </template>
    </template>
  </div>
</template>
