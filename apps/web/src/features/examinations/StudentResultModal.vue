<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppChart from '@/components/charts/AppChart.vue';
import { lineOption, radarOption } from '@/components/charts/chart-options';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { resultsApi } from './results.service';

const props = defineProps<{ examinationId: string; studentId: string | null }>();
const open = defineModel<boolean>('open', { required: true });

const studentId = computed(() => props.studentId ?? '');
const examinationId = computed(() => props.examinationId);
const result = useQuery({
  queryKey: useSchoolQueryKey('results', 'student', examinationId, studentId),
  queryFn: () => resultsApi.student(props.examinationId, studentId.value),
  enabled: computed(() => open.value && studentId.value !== ''),
});
const data = computed(() => result.data.value);

// Levels awarded directly are compared on points; everything else on percent.
const scale = computed(() => {
  const subjects = data.value?.subjects ?? [];
  const percent = subjects.some((subject) => subject.score !== null);
  const highest = Math.max(0, ...subjects.map((s) => Math.max(s.value ?? 0, s.classMean ?? 0)));
  return percent ? { max: 100, unit: '%' } : { max: Math.max(4, Math.ceil(highest)), unit: ' pts' };
});

const radar = computed(() =>
  radarOption({
    axes: (data.value?.subjects ?? []).map((subject) => subject.subject),
    max: scale.value.max,
    series: [
      {
        name: data.value?.student.name ?? 'Learner',
        values: (data.value?.subjects ?? []).map((subject) => subject.value),
      },
      {
        name: 'Class mean',
        values: (data.value?.subjects ?? []).map((subject) => subject.classMean),
      },
    ],
  }),
);
const history = computed(() =>
  lineOption({
    categories: (data.value?.history ?? []).map((entry) => entry.examination),
    series: [{ name: 'Average', values: (data.value?.history ?? []).map((e) => e.average) }],
    max: scale.value.unit === '%' ? 100 : undefined,
    unit: scale.value.unit === '%' ? '%' : '',
  }),
);
</script>

<template>
  <AppModal
    v-model:open="open"
    size="xl"
    :title="data?.student.name ?? 'Learner result'"
    :description="
      data
        ? `${data.examination} · ${data.class}${data.stream ? ` ${data.stream}` : ''} · Adm. ${data.student.admissionNumber}`
        : undefined
    "
  >
    <AppAlert v-if="result.isError.value">{{ errorMessage(result.error.value) }}</AppAlert>
    <div v-else-if="!data" class="space-y-3" aria-busy="true">
      <AppSkeleton height="2.5rem" />
      <AppSkeleton height="16rem" />
    </div>
    <div v-else class="space-y-6">
      <dl class="grid grid-cols-3 gap-3 text-center">
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Average</dt>
          <dd class="text-lg font-semibold tabular-nums">{{ data.average }}</dd>
        </div>
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Grade</dt>
          <dd class="text-lg font-semibold">{{ data.grade ?? '—' }}</dd>
        </div>
        <div class="bg-surface-muted rounded-control p-3">
          <dt class="text-fg-muted text-xs">Class position</dt>
          <dd class="text-lg font-semibold tabular-nums">
            {{ data.classPosition ? `${data.classPosition} of ${data.classSize}` : '—' }}
          </dd>
        </div>
      </dl>

      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 class="mb-2 text-sm font-semibold">Subjects against the class</h3>
          <AppChart
            v-if="data.subjects.length >= 3"
            :option="radar"
            :label="`${data.student.name}'s subject scores compared with the class mean`"
          />
          <table class="mt-2 w-full text-sm">
            <caption class="sr-only">
              Subject scores and class means
            </caption>
            <thead class="text-fg-muted text-left text-xs">
              <tr>
                <th scope="col" class="py-1 font-medium">Subject</th>
                <th scope="col" class="py-1 text-right font-medium">Score</th>
                <th scope="col" class="py-1 text-right font-medium">Grade</th>
                <th scope="col" class="py-1 text-right font-medium">Class mean</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="subject in data.subjects" :key="subject.code" class="border-line border-t">
                <th scope="row" class="py-1.5 text-left font-normal">{{ subject.subject }}</th>
                <td class="py-1.5 text-right tabular-nums">
                  <template v-if="subject.isAbsent">Absent</template>
                  <template v-else-if="subject.score !== null">
                    {{ subject.score }}/{{ subject.maxMarks }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="py-1.5 text-right">{{ subject.grade ?? '—' }}</td>
                <td class="py-1.5 text-right tabular-nums">
                  {{ subject.classMean === null ? '—' : `${subject.classMean}${scale.unit}` }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 class="mb-2 text-sm font-semibold">Progress across examinations</h3>
          <AppChart
            v-if="data.history.length > 1"
            :option="history"
            :label="`${data.student.name}'s average in each examination`"
          />
          <p v-else class="text-fg-muted text-sm">
            A trend appears once this learner has results in more than one examination.
          </p>
        </div>
      </div>
    </div>
  </AppModal>
</template>
