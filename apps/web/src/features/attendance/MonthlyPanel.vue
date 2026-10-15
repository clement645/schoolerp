<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarDays } from '@lucide/vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { formatWeekday, todayIso } from '@/utils/format';
import { attendanceApi, formatRate, statusInfo, STATUSES } from './attendance.service';

const ALL = 'all';

const classId = ref('');
const streamId = ref(ALL);
const month = ref(todayIso().slice(0, 7));
const monthId = useId();

const { classOptions, streamOptions: streams } = useClassOptions(classId);
const streamOptions = computed(() => [{ value: ALL, label: 'All streams' }, ...streams.value]);
watch(
  classOptions,
  (options) => {
    if (!classId.value && options[0]) classId.value = options[0].value;
  },
  { immediate: true },
);
watch(classId, () => {
  streamId.value = ALL;
});

const query = computed(() => ({
  classId: classId.value,
  streamId: streamId.value === ALL ? '' : streamId.value,
  month: month.value,
}));
const register = useQuery({
  queryKey: useSchoolQueryKey('attendance', 'monthly', query),
  queryFn: () => attendanceApi.monthly(query.value),
  enabled: computed(() => classId.value !== '' && /^\d{4}-\d{2}$/.test(month.value)),
});
const data = computed(() => register.data.value);
</script>

<template>
  <div class="space-y-6">
    <AppCard>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect
          v-model="classId"
          label="Class"
          :options="classOptions"
          placeholder="Choose a class"
        />
        <AppSelect
          v-model="streamId"
          label="Stream"
          :options="streamOptions"
          :disabled="streamOptions.length <= 1"
        />
        <div>
          <label :for="monthId" class="mb-1.5 block text-sm font-medium">Month</label>
          <input :id="monthId" v-model="month" type="month" class="form-control" />
        </div>
      </div>
    </AppCard>

    <AppEmptyState
      v-if="register.isError.value"
      tone="danger"
      title="The register could not be loaded"
      :description="errorMessage(register.error.value)"
    />
    <div v-else-if="register.isPending.value && classId" class="space-y-3" aria-busy="true">
      <AppSkeleton v-for="n in 4" :key="n" height="2.5rem" />
    </div>
    <AppEmptyState
      v-else-if="!data || data.days.length === 0"
      :icon="CalendarDays"
      title="No register for this month"
      description="Nothing was marked for this class in the chosen month."
    />

    <AppCard v-else flush :title="`${data.class.name} — monthly register`">
      <template #actions>
        <ul class="flex flex-wrap gap-3 text-xs" aria-label="Key">
          <li v-for="status in STATUSES" :key="status.value" class="flex items-center gap-1.5">
            <span
              class="inline-flex size-5 items-center justify-center rounded font-semibold"
              :class="status.tone"
              aria-hidden="true"
            >
              {{ status.short }}
            </span>
            {{ status.label }}
          </li>
        </ul>
      </template>
      <div class="relative overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <caption class="sr-only">
            Monthly attendance register
          </caption>
          <thead class="text-fg-muted border-line border-b text-xs">
            <tr>
              <th scope="col" class="bg-surface sticky left-0 z-10 px-5 py-2 text-left font-medium">
                Learner
              </th>
              <th
                v-for="day in data.days"
                :key="day"
                scope="col"
                class="px-1.5 py-2 text-center font-medium"
              >
                <span class="block">{{ formatWeekday(day) }}</span>
                <span class="block tabular-nums">{{ Number(day.slice(8)) }}</span>
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Present</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Absent</th>
              <th scope="col" class="px-5 py-2 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in data.students"
              :key="row.student.id"
              class="border-line border-b last:border-0"
            >
              <th
                scope="row"
                class="bg-surface sticky left-0 z-10 px-5 py-2 text-left font-normal whitespace-nowrap"
              >
                <span class="font-medium">{{ row.student.name }}</span>
                <span class="text-fg-muted block text-xs">{{ row.student.admissionNumber }}</span>
              </th>
              <td v-for="day in data.days" :key="day" class="px-1.5 py-2 text-center">
                <span
                  v-if="row.marks[day]"
                  class="inline-flex size-6 items-center justify-center rounded text-xs font-semibold"
                  :class="statusInfo(row.marks[day]).tone"
                  :title="statusInfo(row.marks[day]).label"
                >
                  {{ statusInfo(row.marks[day]).short }}
                  <span class="sr-only">{{ statusInfo(row.marks[day]).label }}</span>
                </span>
                <span v-else class="text-fg-muted" aria-label="Not marked">·</span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ row.present + row.late }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ row.absent + row.excused }}</td>
              <td class="px-5 py-2 text-right font-medium tabular-nums">
                {{ formatRate(row.rate) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>
  </div>
</template>
