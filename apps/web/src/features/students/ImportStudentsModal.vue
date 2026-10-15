<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Download, FileSpreadsheet } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { saveBlob } from '@/utils/format';
import { IMPORT_COLUMNS, studentsApi, type ImportResult } from './students.service';

const open = defineModel<boolean>('open', { required: true });

const MAX_BYTES = 1_000_000;

const file = ref<File | null>(null);
const report = ref<ImportResult | null>(null);
const done = ref<number | null>(null);
const problem = ref<string | null>(null);

const check = useSaveAction(async () => {
  if (file.value) report.value = await studentsApi.importCsv(file.value, true);
});
const commit = useSaveAction(async () => {
  if (!file.value) return;
  const result = await studentsApi.importCsv(file.value, false);
  // The file could have become invalid since it was checked (e.g. a clash).
  if (result.imported) done.value = result.valid;
  else report.value = result;
});

const busy = computed(() => check.pending.value || commit.pending.value);
const ready = computed(
  () => report.value !== null && report.value.problems.length === 0 && report.value.valid > 0,
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
  if (!/\.csv$/i.test(chosen.name)) {
    problem.value = 'Choose a CSV file. In Excel, use “Save as → CSV (UTF-8)”.';
    return;
  }
  if (chosen.size > MAX_BYTES) {
    problem.value = 'This file is larger than 1 MB. Split it into smaller files.';
    return;
  }
  file.value = chosen;
  await check.run();
}

function downloadTemplate(): void {
  const example =
    'ADM-0001,Amina,Wanjiru,Otieno,2013-04-17,Female,Kenyan,2026-01-05,Grade 7,East,Peter,Otieno,+254700000001,father';
  saveBlob(
    new Blob([`\uFEFF${IMPORT_COLUMNS.join(',')}\r\n${example}\r\n`], { type: 'text/csv' }),
    'students-import-template.csv',
  );
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Import students"
    description="Add many students at once from a spreadsheet saved as CSV."
    size="lg"
    :dismissible="!busy"
  >
    <AppAlert v-if="done !== null" tone="success" data-testid="import-done">
      {{ done }} {{ done === 1 ? 'student was' : 'students were' }} imported into the current
      academic year.
    </AppAlert>

    <div v-else class="space-y-5">
      <ol class="text-fg-muted list-decimal space-y-1 pl-5 text-sm">
        <li>
          Download the template and fill in one student per row. Dates use
          <code class="text-fg">YYYY-MM-DD</code>.
        </li>
        <li>Class and stream names must match the ones on the Classes page.</li>
        <li>Choose the file. It is checked first; nothing is imported until you confirm.</li>
      </ol>

      <div class="flex flex-wrap items-center gap-3">
        <AppButton variant="outline" size="sm" @click="downloadTemplate">
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          Download template
        </AppButton>
        <label
          class="border-line bg-surface hover:bg-surface-muted rounded-control focus-within:outline-primary inline-flex h-8 cursor-pointer items-center gap-1.5 border px-3 text-xs font-medium focus-within:outline-2 focus-within:outline-offset-2"
          :class="{ 'pointer-events-none opacity-60': busy }"
        >
          <FileSpreadsheet class="size-4" aria-hidden="true" />
          {{ file ? 'Choose another file' : 'Choose CSV file' }}
          <input
            type="file"
            accept=".csv,text/csv"
            class="sr-only"
            data-testid="import-file"
            :disabled="busy"
            @change="choose"
          />
        </label>
        <span v-if="file" class="text-fg-muted truncate text-sm">{{ file.name }}</span>
      </div>

      <AppAlert
        v-if="problem || check.error.value || commit.error.value"
        data-testid="import-error"
      >
        {{ problem ?? check.error.value ?? commit.error.value }}
      </AppAlert>
      <p v-else-if="check.pending.value" class="text-fg-muted text-sm" role="status">
        Checking the file…
      </p>

      <template v-if="report">
        <AppAlert v-if="ready" tone="success" data-testid="import-ready">
          {{ report.valid }} {{ report.valid === 1 ? 'student is' : 'students are' }} ready to
          import.
        </AppAlert>
        <template v-else>
          <AppAlert title="Nothing has been imported" data-testid="import-problems">
            Fix the {{ report.problems.length }}{{ report.problemsTruncated ? '+' : '' }}
            {{ report.problems.length === 1 ? 'problem' : 'problems' }} below in your file, then
            choose it again.
          </AppAlert>
          <div class="border-line rounded-control relative max-h-64 overflow-y-auto border">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Problems found in the file
              </caption>
              <thead class="bg-surface-muted text-fg-muted sticky top-0 text-left text-xs">
                <tr>
                  <th scope="col" class="w-20 px-3 py-2 font-semibold">Line</th>
                  <th scope="col" class="px-3 py-2 font-semibold">Problem</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(entry, index) in report.problems"
                  :key="index"
                  class="border-line border-t"
                >
                  <td class="px-3 py-2 tabular-nums">{{ entry.row }}</td>
                  <td class="px-3 py-2">{{ entry.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
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
        data-testid="import-confirm"
        @click="commit.run()"
      >
        {{ ready && report ? `Import ${report.valid} students` : 'Import' }}
      </AppButton>
    </template>
  </AppModal>
</template>
