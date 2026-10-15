<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Check, Download, Eye, FileText, PenLine } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import PdfViewerModal from '@/components/ui/PdfViewerModal.vue';
import type { TableColumn } from '@/components/ui/table';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage, type DownloadedFile } from '@/services/http';
import { saveBlob } from '@/utils/format';
import RemarksModal from './RemarksModal.vue';
import { EXAM_STATUS, examsApi } from './examinations.service';
import { reportCardsApi, type ReportCardRow } from './report-cards.service';

const ALL = 'all';

const examId = defineModel<string>('examId', { required: true });
const classId = ref(ALL);
const stream = ref(ALL);

const exams = useQuery({
  queryKey: useSchoolQueryKey('examinations', 'list'),
  queryFn: examsApi.list,
});
// Report cards exist only once an examination has been compiled.
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
  classId: selectedClassId.value || undefined,
  stream: stream.value === ALL ? undefined : stream.value,
}));
const activeExamId = computed(() => exam.value?.id ?? '');

const list = useQuery({
  queryKey: useSchoolQueryKey('report-cards', 'list', activeExamId, filter),
  queryFn: () => reportCardsApi.list(activeExamId.value, filter.value),
  enabled: computed(() => activeExamId.value !== ''),
});
const rows = computed(() => list.data.value?.rows ?? []);
const canEdit = computed(
  () => list.data.value?.canEdit ?? { classTeacherRemarks: false, principalRemarks: false },
);
const canWriteRemarks = computed(
  () => canEdit.value.classTeacherRemarks || canEdit.value.principalRemarks,
);

const columns: TableColumn[] = [
  { key: 'student', label: 'Student' },
  { key: 'class', label: 'Class' },
  { key: 'average', label: 'Mean score', align: 'right' },
  { key: 'grade', label: 'Grade', align: 'center' },
  { key: 'position', label: 'Position', align: 'center' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'actions', label: '', align: 'right' },
];

// ── Preview, download and print ──────────────────────────────────────────────
const viewerOpen = ref(false);
const viewer = ref<{
  title: string;
  description?: string;
  load: () => Promise<DownloadedFile>;
} | null>(null);

function preview(row: ReportCardRow): void {
  const id = activeExamId.value;
  viewer.value = {
    title: `Report card — ${row.student.name}`,
    description: exam.value?.name,
    load: () => reportCardsApi.pdf(id, row.student.id),
  };
  viewerOpen.value = true;
}
function previewAll(): void {
  const id = activeExamId.value;
  const selection = { ...filter.value };
  viewer.value = {
    title: `Report cards — ${rows.value.length} learners`,
    description: 'One page per learner, ready to print.',
    load: () => reportCardsApi.bulkPdf(id, selection),
  };
  viewerOpen.value = true;
}

const downloading = ref<string | null>(null);
const downloadError = ref<string | null>(null);
async function download(key: string, fetch: () => Promise<DownloadedFile>): Promise<void> {
  downloading.value = key;
  downloadError.value = null;
  try {
    const file = await fetch();
    saveBlob(file.blob, file.filename);
  } catch (caught) {
    downloadError.value = errorMessage(caught);
  } finally {
    downloading.value = null;
  }
}
const downloadOne = (row: ReportCardRow) =>
  download(row.student.id, () => reportCardsApi.pdf(activeExamId.value, row.student.id));
const downloadAll = () =>
  download('all', () => reportCardsApi.bulkPdf(activeExamId.value, filter.value));

// ── Remarks ──────────────────────────────────────────────────────────────────
const remarksOpen = ref(false);
const remarksFor = ref<string | null>(null);
function editRemarks(row: ReportCardRow): void {
  remarksFor.value = row.student.id;
  remarksOpen.value = true;
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
      :icon="FileText"
      title="No report cards yet"
      description="Report cards are produced from an examination's compiled results."
    />

    <template v-else-if="exam">
      <AppAlert v-if="exam.status !== 'PUBLISHED'" tone="info" title="Provisional">
        These results are not published yet. Report cards are marked provisional, and parents and
        students cannot see them until the results are published.
      </AppAlert>
      <AppAlert v-if="downloadError">{{ downloadError }}</AppAlert>

      <AppCard flush>
        <template #header>
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-base font-semibold">{{ exam.name }}</h2>
            <AppBadge :variant="EXAM_STATUS[exam.status].variant" dot>
              {{ EXAM_STATUS[exam.status].label }}
            </AppBadge>
          </div>
        </template>
        <template #actions>
          <AppButton
            variant="secondary"
            size="sm"
            :disabled="rows.length === 0"
            @click="previewAll"
          >
            <template #icon><Eye class="size-4" aria-hidden="true" /></template>
            Preview all
          </AppButton>
          <AppButton
            size="sm"
            :disabled="rows.length === 0"
            :loading="downloading === 'all'"
            @click="downloadAll"
          >
            <template #icon><Download class="size-4" aria-hidden="true" /></template>
            Download all (PDF)
          </AppButton>
        </template>

        <AppTable
          :columns="columns"
          :rows="rows"
          :row-key="(row) => row.student.id"
          caption="Report cards"
          :loading="list.isPending.value"
          :error="list.isError.value ? errorMessage(list.error.value) : null"
          empty-title="No report cards in this selection"
        >
          <template #cell-student="{ row }">
            <p class="font-medium">{{ row.student.name }}</p>
            <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
          </template>
          <template #cell-class="{ row }">
            {{ row.class }}<template v-if="row.stream"> {{ row.stream }}</template>
          </template>
          <template #cell-average="{ row }">
            <span class="tabular-nums">{{ row.grade ? row.average : '—' }}</span>
          </template>
          <template #cell-grade="{ row }">
            <AppBadge v-if="row.grade" variant="primary">{{ row.grade }}</AppBadge>
            <span v-else>—</span>
          </template>
          <template #cell-position="{ row }">
            <span class="tabular-nums">{{ row.classPosition ?? '—' }}</span>
          </template>
          <template #cell-remarks="{ row }">
            <div class="flex flex-wrap gap-1">
              <AppBadge :variant="row.hasClassTeacherRemarks ? 'success' : 'neutral'">
                <Check v-if="row.hasClassTeacherRemarks" class="mr-1 size-3" aria-hidden="true" />
                Teacher<span class="sr-only">
                  {{ row.hasClassTeacherRemarks ? ' remarks written' : ' remarks missing' }}</span
                >
              </AppBadge>
              <AppBadge :variant="row.hasPrincipalRemarks ? 'success' : 'neutral'">
                <Check v-if="row.hasPrincipalRemarks" class="mr-1 size-3" aria-hidden="true" />
                Principal<span class="sr-only">
                  {{ row.hasPrincipalRemarks ? ' remarks written' : ' remarks missing' }}</span
                >
              </AppBadge>
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton
                v-if="canWriteRemarks"
                variant="ghost"
                size="sm"
                :aria-label="`Write remarks for ${row.student.name}`"
                @click="editRemarks(row)"
              >
                <template #icon><PenLine class="size-4" aria-hidden="true" /></template>
                Remarks
              </AppButton>
              <AppButton
                variant="ghost"
                size="sm"
                :aria-label="`Preview ${row.student.name}'s report card`"
                @click="preview(row)"
              >
                <template #icon><Eye class="size-4" aria-hidden="true" /></template>
                Preview
              </AppButton>
              <AppButton
                variant="ghost"
                size="sm"
                :aria-label="`Download ${row.student.name}'s report card`"
                :loading="downloading === row.student.id"
                @click="downloadOne(row)"
              >
                <template #icon><Download class="size-4" aria-hidden="true" /></template>
                PDF
              </AppButton>
            </div>
          </template>
        </AppTable>
      </AppCard>

      <PdfViewerModal
        v-model:open="viewerOpen"
        :title="viewer?.title ?? 'Report card'"
        :description="viewer?.description"
        :load="viewer?.load ?? null"
      />
      <RemarksModal
        v-model:open="remarksOpen"
        :examination-id="exam.id"
        :student-id="remarksFor"
        :can-edit="canEdit"
      />
    </template>
  </div>
</template>
