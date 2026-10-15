<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import { useAuthStore } from '@/stores/auth';
import CreateExamModal from './CreateExamModal.vue';
import ExamsListPanel from './ExamsListPanel.vue';
import MarksCompilationPanel from './MarksCompilationPanel.vue';
import ReportCardsPanel from './ReportCardsPanel.vue';
import type { ExamSummary } from './examinations.service';

// Charts are heavy; they load only when the Results tab is opened.
const ResultsPanel = defineAsyncComponent(() => import('./ResultsPanel.vue'));

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const TABS = computed(() => [
  { id: 'examinations', label: 'Examinations' },
  { id: 'marks', label: 'Marks Compilation' },
  ...(auth.can('results:read')
    ? [
        { id: 'results', label: 'Results' },
        { id: 'report-cards', label: 'Report Cards' },
      ]
    : []),
  // Planned, not built: shown so the product's shape is clear, but not openable.
  { id: 'ai-compare', label: 'AI Compare', disabled: true, note: 'Not available' },
]);

// The tab and the chosen examination live in the URL, so a reload or a shared
// link returns to the same marks sheet.
const tab = computed({
  get: () => {
    const requested = route.query.tab;
    return TABS.value.some((entry) => entry.id === requested && !('disabled' in entry))
      ? (requested as string)
      : 'examinations';
  },
  set: (id) => {
    void router.replace({ query: { ...route.query, tab: id === 'examinations' ? undefined : id } });
  },
});
const examId = computed({
  get: () => (typeof route.query.exam === 'string' ? route.query.exam : ''),
  set: (id) => {
    void router.replace({ query: { ...route.query, exam: id || undefined } });
  },
});

function enterMarks(exam: ExamSummary): void {
  void router.replace({ query: { tab: 'marks', exam: exam.id } });
}

const creating = ref(false);
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Examination Management</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Create examinations, enter marks, compile results, and export reports.
        </p>
      </div>
      <AppButton v-if="auth.can('examinations:manage')" @click="creating = true">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Create Exam
      </AppButton>
    </header>

    <AppTabs v-model="tab" :tabs="TABS" label="Examination sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <ExamsListPanel v-if="tab === 'examinations'" @enter-marks="enterMarks" />
      <MarksCompilationPanel v-else-if="tab === 'marks'" v-model:exam-id="examId" />
      <ResultsPanel v-else-if="tab === 'results'" v-model:exam-id="examId" />
      <ReportCardsPanel v-else v-model:exam-id="examId" />
    </section>

    <CreateExamModal v-if="auth.can('examinations:manage')" v-model:open="creating" />
  </div>
</template>
