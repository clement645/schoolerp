<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FileSpreadsheet } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { examsApi, type MarksImportResult } from './examinations.service';

const props = defineProps<{ examId: string; classId: string; className: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ imported: [] }>();

const MAX_BYTES = 2 * 1024 * 1024;

const file = ref<File | null>(null);
const report = ref<MarksImportResult | null>(null);
const done = ref<number | null>(null);
const problem = ref<string | null>(null);

const check = useSaveAction(async () => {
  if (file.value)
    report.value = await examsApi.importMarks(props.examId, props.classId, file.value, true);
});
const commit = useSaveAction(async () => {
  if (!file.value) return;
  const result = await examsApi.importMarks(props.examId, props.classId, file.value, false);
  if (result.imported) {
    done.value = result.changes;
    emit('imported');
  } else {
    report.value = result;
  }
});

const busy = computed(() => check.pending.value || commit.pending.value);
const ready = computed(
  () => report.value !== null && report.value.problems.length === 0 && report.value.changes > 0,
);

function reset(): void {
  file.value = null;
  report.value = null;
  done.value = null;
  problem.value = null;
  check.reset();
  commit.reset();
}
watch(open, (isOpen) => {
  if (isOpen) reset();
});

async function choose(event: Event): Promise<void> {
  const chosen = (event.target as HTMLInputElement).files?.[0] ?? null;
  reset();
  if (!chosen) return;
  if (!/\.xlsx$/i.test(chosen.name))
    problem.value = 'Choose the Excel (.xlsx) file exported from this page.';
  else if (chosen.size > MAX_BYTES) problem.value = 'This file is larger than 2 MB.';
  if (problem.value) return;
  file.value = chosen;
  await check.run();
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Import marks from Excel"
    :description="props.className"
    size="lg"
    :dismissible="!busy"
  >
    <AppAlert v-if="done !== null" tone="success" data-testid="marks-import-done">
      {{ done }} {{ done === 1 ? 'mark was' : 'marks were' }} imported.
    </AppAlert>

    <div v-else class="space-y-4">
      <ol class="text-fg-muted list-decimal space-y-1 pl-5 text-sm">
        <li>Use <strong class="text-fg">Export</strong> to download this class’s sheet.</li>
        <li>
          Fill in the subject columns. Type ABS for an absent learner; leave a cell blank to skip
          it.
        </li>
        <li>Choose the file here. You will see what would change before anything is saved.</li>
      </ol>

      <label
        class="border-line bg-surface hover:bg-surface-muted rounded-control focus-within:outline-primary inline-flex h-9 cursor-pointer items-center gap-2 border px-3 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2"
        :class="{ 'pointer-events-none opacity-60': busy }"
      >
        <FileSpreadsheet class="size-4" aria-hidden="true" />
        {{ file ? file.name : 'Choose Excel file' }}
        <input
          type="file"
          accept=".xlsx"
          class="sr-only"
          data-testid="marks-import-file"
          :disabled="busy"
          @change="choose"
        />
      </label>

      <AppAlert
        v-if="problem || check.error.value || commit.error.value"
        data-testid="marks-import-error"
      >
        {{ problem ?? check.error.value ?? commit.error.value }}
      </AppAlert>
      <p v-else-if="check.pending.value" class="text-fg-muted text-sm" role="status">
        Checking the file…
      </p>

      <template v-if="report">
        <AppAlert v-if="ready" tone="success" data-testid="marks-import-ready">
          {{ report.changes }} {{ report.changes === 1 ? 'mark' : 'marks' }} will be saved.
          <template v-if="report.overwrites > 0">
            {{ report.overwrites }} of them will replace a mark that is already entered.
          </template>
        </AppAlert>
        <AppAlert v-else-if="report.problems.length === 0" tone="info">
          This file contains no changes to the marks already entered.
        </AppAlert>
        <template v-else>
          <AppAlert title="Nothing has been imported" data-testid="marks-import-problems">
            Fix the {{ report.problems.length }}{{ report.problemsTruncated ? '+' : '' }}
            {{ report.problems.length === 1 ? 'problem' : 'problems' }} below and choose the file
            again.
          </AppAlert>
          <ul
            class="border-line divide-line rounded-control relative max-h-56 divide-y overflow-y-auto border text-sm"
          >
            <li v-for="(entry, index) in report.problems" :key="index" class="flex gap-3 px-3 py-2">
              <span class="text-fg-muted w-14 shrink-0 tabular-nums">Row {{ entry.row }}</span>
              <span>{{ entry.message }}</span>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <template #footer>
      <AppButton variant="outline" :disabled="busy" @click="open = false">
        {{ done !== null ? 'Close' : 'Cancel' }}
      </AppButton>
      <AppButton
        v-if="done === null"
        :disabled="!ready"
        :loading="commit.pending.value"
        data-testid="marks-import-confirm"
        @click="commit.run()"
      >
        Import marks
      </AppButton>
    </template>
  </AppModal>
</template>
