<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import ExamSubjectsModal from './ExamSubjectsModal.vue';
import {
  EXAM_STATUS,
  examsApi,
  examTypeLabel,
  type ExamAction,
  type ExamSummary,
} from './examinations.service';

const emit = defineEmits<{ 'enter-marks': [exam: ExamSummary] }>();

const auth = useAuthStore();
const canManage = computed(() => auth.can('examinations:manage'));

const exams = useQuery({
  queryKey: useSchoolQueryKey('examinations', 'list'),
  queryFn: examsApi.list,
});

const columns: TableColumn[] = [
  { key: 'name', label: 'Examination' },
  { key: 'term', label: 'Term' },
  { key: 'dates', label: 'Dates' },
  { key: 'classes', label: 'Classes' },
  { key: 'progress', label: 'Marks entered' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

interface Step {
  action: ExamAction | 'delete';
  label: string;
  title: string;
  explanation: string;
  tone: 'primary' | 'danger';
}

const STEPS: Record<ExamAction | 'delete', Omit<Step, 'action'>> = {
  open: {
    label: 'Open for marks',
    title: 'Open for marks entry?',
    explanation: 'Teachers will be able to enter marks for the subjects they teach.',
    tone: 'primary',
  },
  compile: {
    label: 'Compile results',
    title: 'Compile results?',
    explanation:
      'Marks entry closes and totals, grades and positions are calculated from the marks entered. You can reopen it if something needs correcting.',
    tone: 'primary',
  },
  reopen: {
    label: 'Reopen',
    title: 'Reopen for marks entry?',
    explanation:
      'Marks can be changed again. Any approval is withdrawn, and results must be compiled again afterwards.',
    tone: 'primary',
  },
  approve: {
    label: 'Approve',
    title: 'Approve these results?',
    explanation: 'Approval confirms the compiled results are correct and ready to publish.',
    tone: 'primary',
  },
  publish: {
    label: 'Publish',
    title: 'Publish these results?',
    explanation:
      'Results are released and permanently locked. Marks and results can never be changed after this.',
    tone: 'danger',
  },
  delete: {
    label: 'Delete',
    title: 'Delete examination?',
    explanation: 'It will be removed. An examination with marks entered cannot be deleted.',
    tone: 'danger',
  },
};

/** The workflow steps this user can take on an examination in its current state. */
function stepsFor(exam: ExamSummary): Step[] {
  const allowed: (ExamAction | 'delete')[] = [];
  const manage = canManage.value;
  switch (exam.status) {
    case 'DRAFT':
      if (manage) allowed.push('open', 'delete');
      break;
    case 'OPEN':
      if (manage) allowed.push('compile');
      break;
    case 'COMPILED':
      if (auth.can('results:approve')) allowed.push('approve');
      if (manage) allowed.push('reopen');
      break;
    case 'APPROVED':
      if (auth.can('results:publish')) allowed.push('publish');
      if (manage) allowed.push('reopen');
      break;
    default:
  }
  return allowed.map((action) => ({ action, ...STEPS[action] }));
}

const pending = ref<{ exam: ExamSummary; step: Step } | null>(null);
const run = useSaveAction(({ exam, step }: { exam: ExamSummary; step: Step }) =>
  step.action === 'delete' ? examsApi.delete(exam.id) : examsApi.act(exam.id, step.action),
);
function ask(exam: ExamSummary, step: Step): void {
  run.reset();
  pending.value = { exam, step };
}
async function confirm(): Promise<void> {
  if (pending.value && (await run.run(pending.value))) pending.value = null;
}

const viewing = ref<ExamSummary | null>(null);
const percent = (exam: ExamSummary) =>
  exam.progress.expected === 0
    ? 0
    : Math.round((exam.progress.entered / exam.progress.expected) * 100);
</script>

<template>
  <AppCard flush>
    <AppTable
      caption="Examinations"
      :columns="columns"
      :rows="exams.data.value ?? []"
      :row-key="(exam: ExamSummary) => exam.id"
      :loading="exams.isPending.value"
      :error="exams.isError.value ? errorMessage(exams.error.value) : null"
      empty-title="No examinations yet"
      :empty-description="canManage ? 'Create an examination to start entering marks.' : undefined"
    >
      <template #cell-name="{ row }">
        <p class="font-medium">{{ row.name }}</p>
        <p class="text-fg-muted text-xs">{{ examTypeLabel(row.type) }}</p>
      </template>
      <template #cell-term="{ row }">
        <span class="whitespace-nowrap">{{ row.term.name }}, {{ row.academicYear.name }}</span>
      </template>
      <template #cell-dates="{ row }">
        <span class="text-fg-muted whitespace-nowrap">
          {{ formatDate(row.startDate) }} – {{ formatDate(row.endDate) }}
        </span>
      </template>
      <template #cell-classes="{ row }">
        <span class="text-fg-muted">{{ row.classes.map((entry) => entry.name).join(', ') }}</span>
      </template>
      <template #cell-progress="{ row }">
        <div class="w-32">
          <div
            class="bg-fg/10 h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            :aria-valuenow="percent(row)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`Marks entered for ${row.name}`"
          >
            <div class="bg-primary h-full rounded-full" :style="{ width: `${percent(row)}%` }" />
          </div>
          <p class="text-fg-muted mt-1 text-xs tabular-nums">
            {{ row.progress.entered }} of {{ row.progress.expected }} ({{ percent(row) }}%)
          </p>
        </div>
      </template>
      <template #cell-status="{ row }">
        <AppBadge :variant="EXAM_STATUS[row.status].variant" dot>
          {{ EXAM_STATUS[row.status].label }}
        </AppBadge>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex flex-wrap justify-end gap-2">
          <AppButton
            v-if="row.status !== 'DRAFT'"
            size="sm"
            :variant="row.status === 'OPEN' ? 'primary' : 'outline'"
            :aria-label="`${row.status === 'OPEN' ? 'Enter' : 'View'} marks for ${row.name}`"
            @click="emit('enter-marks', row)"
          >
            {{ row.status === 'OPEN' && auth.can('marks:enter') ? 'Enter marks' : 'View marks' }}
          </AppButton>
          <AppButton
            v-for="step in stepsFor(row)"
            :key="step.action"
            size="sm"
            :variant="step.action === 'delete' ? 'ghost' : 'outline'"
            :aria-label="`${step.label}: ${row.name}`"
            @click="ask(row, step)"
          >
            {{ step.label }}
          </AppButton>
          <AppButton
            size="sm"
            variant="ghost"
            :aria-label="`Subjects of ${row.name}`"
            @click="viewing = row"
          >
            Subjects
          </AppButton>
        </div>
      </template>
      <template #error-action>
        <AppButton size="sm" variant="outline" @click="exams.refetch()">Try again</AppButton>
      </template>
    </AppTable>
  </AppCard>

  <ExamSubjectsModal :exam="viewing" :can-manage="canManage" @close="viewing = null" />

  <AppConfirmDialog
    :open="pending !== null"
    :title="pending?.step.title ?? ''"
    :confirm-label="pending?.step.label ?? ''"
    :tone="pending?.step.tone"
    :loading="run.pending.value"
    :error="run.error.value"
    @confirm="confirm"
    @cancel="pending = null"
  >
    <p class="font-medium">{{ pending?.exam.name }}</p>
    <p class="text-fg-muted mt-1">{{ pending?.step.explanation }}</p>
  </AppConfirmDialog>
</template>
