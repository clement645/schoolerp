<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { useEventListener } from '@vueuse/core';
import {
  CircleCheck,
  ClipboardCheck,
  Clock,
  Download,
  Hourglass,
  Percent,
  Save,
  TriangleAlert,
  Upload,
  Users,
} from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { SCHOOL_QUERY_ROOT, useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { ApiRequestError, errorMessage } from '@/services/http';
import { saveBlob } from '@/utils/format';
import MarksImportModal from './MarksImportModal.vue';
import {
  conflictSchema,
  EXAM_STATUS,
  examsApi,
  type MarksConflict,
  type MarksSheet,
  type SheetStudent,
  type SheetSubject,
} from './examinations.service';
import { cellKey, cellText, isUnchanged, parseCell, toEntry, type CellRules } from './marks-grid';

const ALL_STREAMS = 'all';

/** The examination whose marks are shown; shared with the page so links can preselect it. */
const examId = defineModel<string>('examId', { required: true });

const queryClient = useQueryClient();
const classId = ref('');
const stream = ref(ALL_STREAMS);

const exams = useQuery({
  queryKey: useSchoolQueryKey('examinations', 'list'),
  queryFn: examsApi.list,
});
// A draft examination has no marks sheet yet.
const available = computed(() =>
  (exams.data.value ?? []).filter((exam) => exam.status !== 'DRAFT'),
);
const exam = computed(() => available.value.find((entry) => entry.id === examId.value) ?? null);
const examOptions = computed(() =>
  available.value.map((entry) => ({
    value: entry.id,
    label: `${entry.name} — ${entry.term.name}, ${entry.academicYear.name}`,
  })),
);
const classOptions = computed(() =>
  (exam.value?.classes ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
);

// Keep the class valid for the chosen examination, defaulting to its first.
watch(
  exam,
  (current) => {
    if (!current?.classes.some((entry) => entry.id === classId.value)) {
      classId.value = current?.classes[0]?.id ?? '';
    }
  },
  { immediate: true },
);

const sheetKey = useSchoolQueryKey('examinations', 'marks', examId, classId);
// The whole class is always loaded and streams are filtered here, so marks
// typed for one stream are still held while another is on screen.
const sheet = useQuery({
  queryKey: sheetKey,
  queryFn: () => examsApi.sheet(examId.value, classId.value),
  enabled: computed(() => examId.value !== '' && classId.value !== ''),
  staleTime: 0,
});

const streamOptions = computed(() => {
  const names = [
    ...new Set((sheet.data.value?.students ?? []).flatMap((s) => (s.stream ? [s.stream] : []))),
  ];
  return [
    { value: ALL_STREAMS, label: 'All streams' },
    ...names.sort().map((name) => ({ value: name, label: name })),
  ];
});
const visibleStudents = computed(() =>
  (sheet.data.value?.students ?? []).filter(
    (student) => stream.value === ALL_STREAMS || student.stream === stream.value,
  ),
);

// ── Editing ──────────────────────────────────────────────────────────────────

/** Text typed into cells that differs from what is stored, by cell. */
const drafts = reactive(new Map<string, string>());
/** Cells another person changed while this user was editing them. */
const conflicts = reactive(new Map<string, MarksConflict>());

const rulesFor = (subject: SheetSubject): CellRules => ({
  maxMarks: subject.maxMarks,
  levelBased: sheet.data.value?.grading?.levelBased ?? false,
  levels: sheet.data.value?.grading?.levels.map((level) => level.label) ?? [],
});

const levelOptions = computed(() => [
  ...(sheet.data.value?.grading?.levels ?? []).map((level) => level.label),
  'ABS',
]);

function canEdit(student: SheetStudent, subject: SheetSubject): boolean {
  if (!sheet.data.value?.editable || !subject.canEdit) return false;
  return (
    student.editableSubjectIds === null || student.editableSubjectIds.includes(subject.subjectId)
  );
}

const shown = (student: SheetStudent, subject: SheetSubject): string =>
  drafts.get(cellKey(student.studentId, subject.subjectId)) ??
  cellText(student.marks[subject.subjectId]);

function onInput(student: SheetStudent, subject: SheetSubject, text: string): void {
  const key = cellKey(student.studentId, subject.subjectId);
  if (isUnchanged(parseCell(text, rulesFor(subject)), student.marks[subject.subjectId]))
    drafts.delete(key);
  else drafts.set(key, text);
  justSaved.value = false;
}

/** Why a cell's current input cannot be saved, if it cannot. */
function problemOf(student: SheetStudent, subject: SheetSubject): string | null {
  const draft = drafts.get(cellKey(student.studentId, subject.subjectId));
  if (draft === undefined) return null;
  const parsed = parseCell(draft, rulesFor(subject));
  return parsed.kind === 'invalid' ? parsed.reason : null;
}

const isMissing = (student: SheetStudent, subject: SheetSubject): boolean =>
  subject.isCompulsory && shown(student, subject).trim() === '';

const rowIsDirty = (student: SheetStudent): boolean =>
  (sheet.data.value?.subjects ?? []).some((subject) =>
    drafts.has(cellKey(student.studentId, subject.subjectId)),
  );

/** Every pending change across the class, ready to send. */
const pending = computed(() => {
  const entries = [];
  let invalid = 0;
  for (const student of sheet.data.value?.students ?? []) {
    for (const subject of sheet.data.value?.subjects ?? []) {
      const draft = drafts.get(cellKey(student.studentId, subject.subjectId));
      if (draft === undefined) continue;
      const parsed = parseCell(draft, rulesFor(subject));
      if (parsed.kind === 'invalid') invalid += 1;
      else
        entries.push(
          toEntry(student.studentId, subject.subjectId, parsed, student.marks[subject.subjectId]),
        );
    }
  }
  return { entries, invalid };
});

function cellClass(student: SheetStudent, subject: SheetSubject): string {
  const key = cellKey(student.studentId, subject.subjectId);
  if (problemOf(student, subject)) return 'border-danger bg-danger/5 text-danger';
  if (conflicts.has(key)) return 'border-warning bg-warning/10';
  if (drafts.has(key)) return 'border-info bg-info/5';
  if (isMissing(student, subject)) return 'border-warning/50 bg-warning/5';
  return 'border-transparent bg-transparent';
}

/** Moves focus up or down the same column, spreadsheet-style. */
function move(event: KeyboardEvent, row: number, column: number, step: number): void {
  const target = document.querySelector<HTMLElement>(`[data-cell="${row + step}:${column}"]`);
  if (!target) return;
  event.preventDefault();
  target.focus();
  if (target instanceof HTMLInputElement) target.select();
}

// ── Saving ───────────────────────────────────────────────────────────────────

const saving = ref(false);
const saveError = ref<string | null>(null);
const justSaved = ref(false);
const savedCount = ref(0);

async function save(): Promise<void> {
  const { entries, invalid } = pending.value;
  if (entries.length === 0 || invalid > 0 || saving.value) return;
  saving.value = true;
  saveError.value = null;
  conflicts.clear();
  try {
    const updated = await examsApi.saveMarks(examId.value, classId.value, entries);
    queryClient.setQueryData(sheetKey.value, updated);
    drafts.clear();
    savedCount.value = entries.length;
    justSaved.value = true;
    // Progress shown on the examinations list has changed.
    void queryClient.invalidateQueries({
      queryKey: [SCHOOL_QUERY_ROOT],
      predicate: (query) => query.queryKey.includes('list'),
    });
  } catch (error) {
    const conflict =
      error instanceof ApiRequestError && error.code === 'MARKS_CONFLICT'
        ? conflictSchema.safeParse(error.details)
        : null;
    if (conflict?.success) {
      for (const entry of conflict.data.conflicts) {
        conflicts.set(cellKey(entry.studentId, entry.subjectId), entry);
      }
      // Reload so every cell carries its current value and version; what the
      // user typed is kept on top of it.
      await sheet.refetch();
    }
    saveError.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

/** Gives up this user's edits to the conflicting cells, taking the other person's. */
function useTheirValues(): void {
  for (const key of conflicts.keys()) drafts.delete(key);
  conflicts.clear();
  saveError.value = null;
}
/** Keeps this user's edits; the next save is based on the reloaded versions. */
function keepMyValues(): void {
  conflicts.clear();
  saveError.value = null;
}

const conflictNote = (student: SheetStudent, subject: SheetSubject): string | null => {
  const conflict = conflicts.get(cellKey(student.studentId, subject.subjectId));
  if (!conflict) return null;
  const theirs = cellText(conflict.current) || 'blank';
  return `${conflict.updatedBy ?? 'Someone else'} changed this to ${theirs} while you were editing.`;
};

// ── Leaving with unsaved work ────────────────────────────────────────────────

const hasUnsaved = computed(() => drafts.size > 0);
const DISCARD = 'You have marks that are not saved yet. Leave and lose them?';

onBeforeRouteLeave(() => !hasUnsaved.value || window.confirm(DISCARD));
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (hasUnsaved.value) event.preventDefault();
});

// Changing examination or class abandons the grid being edited.
function switchTo(target: 'exam' | 'class', value: string): void {
  if (hasUnsaved.value && !window.confirm(DISCARD)) return;
  drafts.clear();
  conflicts.clear();
  saveError.value = null;
  justSaved.value = false;
  stream.value = ALL_STREAMS;
  if (target === 'exam') examId.value = value;
  else classId.value = value;
}

// ── Excel ────────────────────────────────────────────────────────────────────

const importing = ref(false);
const exporting = ref(false);
const exportError = ref<string | null>(null);
async function exportSheet(): Promise<void> {
  exporting.value = true;
  exportError.value = null;
  try {
    const { blob, filename } = await examsApi.exportMarks(examId.value, classId.value);
    saveBlob(blob, filename);
  } catch (error) {
    exportError.value = errorMessage(error);
  } finally {
    exporting.value = false;
  }
}

const stats = computed(() => {
  const s: MarksSheet['stats'] | undefined = sheet.data.value?.stats;
  return [
    {
      label: 'Total Students',
      value: s?.totalStudents ?? 0,
      icon: Users,
      tone: 'bg-info/10 text-info',
    },
    {
      label: 'Marks Entered',
      value: s?.marksEntered ?? 0,
      icon: ClipboardCheck,
      tone: 'bg-success/10 text-success',
    },
    {
      label: 'Completion',
      value: `${s?.completion ?? 0}%`,
      icon: Percent,
      tone: 'bg-primary-light text-primary',
    },
    {
      label: 'Pending Entry',
      value: s?.pendingEntry ?? 0,
      icon: Clock,
      tone: 'bg-warning/15 text-warning',
    },
    {
      label: 'Awaiting Approval',
      value: s?.awaitingApproval ?? 0,
      icon: Hourglass,
      tone: 'bg-danger/10 text-danger',
    },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <AppCard>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect
          :model-value="examId"
          :options="examOptions"
          label="Examination"
          :placeholder="examOptions.length ? 'Select examination' : 'No examinations open'"
          @update:model-value="switchTo('exam', $event)"
        />
        <AppSelect
          :model-value="classId"
          :options="classOptions"
          label="Class"
          placeholder="Select class"
          :disabled="classOptions.length === 0"
          @update:model-value="switchTo('class', $event)"
        />
        <AppSelect
          v-model="stream"
          :options="streamOptions"
          label="Stream"
          :disabled="streamOptions.length <= 1"
        />
      </div>
    </AppCard>

    <AppCard v-if="!exam">
      <AppEmptyState
        :icon="ClipboardCheck"
        title="Choose an examination"
        description="Marks can be entered once an examination has been opened for marks entry."
      />
    </AppCard>

    <template v-else>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <li
          v-for="stat in stats"
          :key="stat.label"
          class="bg-surface border-line rounded-card shadow-card flex items-center gap-3 border p-4"
          :data-testid="`stat-${stat.label}`"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            :class="stat.tone"
          >
            <component :is="stat.icon" class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-fg-muted truncate text-xs">{{ stat.label }}</p>
            <p class="text-xl leading-tight font-semibold tabular-nums">{{ stat.value }}</p>
          </div>
        </li>
      </ul>

      <AppAlert
        v-if="saveError"
        data-testid="marks-error"
        :title="conflicts.size > 0 ? 'Marks were changed by someone else' : undefined"
      >
        {{ saveError }}
        <div v-if="conflicts.size > 0" class="mt-2 flex flex-wrap gap-2">
          <AppButton size="sm" variant="outline" @click="useTheirValues"
            >Use their values</AppButton
          >
          <AppButton size="sm" variant="outline" @click="keepMyValues">Keep my values</AppButton>
        </div>
      </AppAlert>
      <AppAlert v-if="exportError">{{ exportError }}</AppAlert>

      <AppCard flush>
        <template #header>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base leading-tight">{{ sheet.data.value?.class.name ?? 'Marks' }}</h2>
              <AppBadge :variant="EXAM_STATUS[exam.status].variant" dot>
                {{ EXAM_STATUS[exam.status].label }}
              </AppBadge>
            </div>
            <p class="text-fg-muted mt-0.5 text-sm">
              {{ exam.name }} · {{ exam.term.name }}, {{ exam.academicYear.name }}
              <template v-if="sheet.data.value?.grading">
                · graded by {{ sheet.data.value.grading.name }}</template
              >
            </p>
          </div>
        </template>
        <template #actions>
          <span v-if="saving" class="text-fg-muted text-sm" role="status">
            Saving {{ pending.entries.length }}
            {{ pending.entries.length === 1 ? 'mark' : 'marks' }}…
          </span>
          <span v-else-if="hasUnsaved" class="text-info text-sm" data-testid="unsaved-count">
            {{ drafts.size }} unsaved {{ drafts.size === 1 ? 'change' : 'changes' }}
          </span>
          <span
            v-else-if="justSaved"
            class="text-success inline-flex items-center gap-1 text-sm"
            role="status"
            data-testid="saved-note"
          >
            <CircleCheck class="size-4" aria-hidden="true" />
            {{ savedCount }} {{ savedCount === 1 ? 'mark' : 'marks' }} saved
          </span>
          <AppButton
            variant="outline"
            size="sm"
            :loading="exporting"
            :disabled="!sheet.data.value"
            @click="exportSheet"
          >
            <template #icon><Download class="size-3.5" aria-hidden="true" /></template>
            Export
          </AppButton>
          <AppButton
            v-if="sheet.data.value?.editable"
            variant="outline"
            size="sm"
            :disabled="hasUnsaved"
            :title="hasUnsaved ? 'Save your changes before importing' : undefined"
            @click="importing = true"
          >
            <template #icon><Upload class="size-3.5" aria-hidden="true" /></template>
            Import
          </AppButton>
          <AppButton
            v-if="sheet.data.value?.editable"
            size="sm"
            :loading="saving"
            :disabled="pending.entries.length === 0 || pending.invalid > 0"
            data-testid="save-marks"
            @click="save"
          >
            <template #icon><Save class="size-3.5" aria-hidden="true" /></template>
            Save Marks
          </AppButton>
        </template>

        <div v-if="sheet.isPending.value" class="space-y-2 p-5" aria-busy="true">
          <AppSkeleton v-for="n in 6" :key="n" height="2.25rem" />
        </div>
        <AppEmptyState
          v-else-if="sheet.isError.value"
          tone="danger"
          :icon="TriangleAlert"
          title="Unable to load the marks sheet"
          :description="errorMessage(sheet.error.value)"
          role="alert"
        >
          <AppButton size="sm" variant="outline" @click="sheet.refetch()">Try again</AppButton>
        </AppEmptyState>
        <AppEmptyState
          v-else-if="visibleStudents.length === 0"
          :icon="Users"
          title="No students to show"
          description="There are no students in this class, or none in a class you are assigned to teach."
        />

        <div v-else class="relative overflow-x-auto">
          <table class="w-full min-w-max border-collapse text-sm">
            <caption class="sr-only">
              Marks for
              {{
                sheet.data.value?.class.name
              }}
            </caption>
            <thead>
              <tr class="border-line bg-surface-muted text-fg-muted border-b text-xs">
                <th
                  scope="col"
                  class="bg-surface-muted sticky left-0 z-10 px-4 py-2.5 text-left font-semibold uppercase"
                >
                  Student
                </th>
                <th
                  v-for="subject in sheet.data.value?.subjects"
                  :key="subject.subjectId"
                  scope="col"
                  class="px-2 py-2.5 text-center font-semibold"
                  :title="subject.name"
                >
                  <span class="block uppercase">{{ subject.name }}</span>
                  <span class="font-normal normal-case">
                    <template v-if="!sheet.data.value?.grading?.levelBased"
                      >out of {{ subject.maxMarks }}</template
                    >
                    <template v-if="!subject.isCompulsory"> · elective</template>
                  </span>
                </th>
                <th scope="col" class="px-3 py-2.5 text-right font-semibold uppercase">Total</th>
                <th scope="col" class="px-3 py-2.5 text-right font-semibold uppercase">Average</th>
                <th scope="col" class="px-4 py-2.5 text-center font-semibold uppercase">Grade</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(student, row) in visibleStudents"
                :key="student.studentId"
                class="border-line border-b last:border-b-0"
                :data-testid="`row-${student.admissionNumber}`"
              >
                <th
                  scope="row"
                  class="bg-surface sticky left-0 z-10 px-4 py-1.5 text-left font-normal"
                >
                  <span class="block font-medium whitespace-nowrap">{{ student.name }}</span>
                  <span class="text-fg-muted text-xs">
                    {{ student.admissionNumber
                    }}<template v-if="student.stream"> · {{ student.stream }}</template>
                  </span>
                </th>
                <td
                  v-for="(subject, column) in sheet.data.value?.subjects"
                  :key="subject.subjectId"
                  class="px-1 py-1 text-center"
                >
                  <template v-if="canEdit(student, subject)">
                    <select
                      v-if="sheet.data.value?.grading?.levelBased"
                      class="rounded-control focus:border-primary focus:ring-primary/20 h-9 w-20 border px-1 text-center text-sm tabular-nums focus:ring-2 focus:outline-none"
                      :class="cellClass(student, subject)"
                      :value="shown(student, subject).toUpperCase()"
                      :data-cell="`${row}:${column}`"
                      :aria-label="`${subject.name} for ${student.name}`"
                      :title="conflictNote(student, subject) ?? undefined"
                      @change="
                        onInput(student, subject, ($event.target as HTMLSelectElement).value)
                      "
                      @keydown.enter="move($event, row, column, 1)"
                    >
                      <option value="">—</option>
                      <option v-for="level in levelOptions" :key="level" :value="level">
                        {{ level }}
                      </option>
                    </select>
                    <input
                      v-else
                      class="rounded-control focus:border-primary focus:ring-primary/20 h-9 w-20 border px-2 text-center text-sm tabular-nums focus:ring-2 focus:outline-none"
                      :class="cellClass(student, subject)"
                      :value="shown(student, subject)"
                      :data-cell="`${row}:${column}`"
                      inputmode="decimal"
                      autocomplete="off"
                      :aria-label="`${subject.name} for ${student.name}`"
                      :aria-invalid="problemOf(student, subject) ? 'true' : undefined"
                      :title="
                        problemOf(student, subject) ?? conflictNote(student, subject) ?? undefined
                      "
                      @input="onInput(student, subject, ($event.target as HTMLInputElement).value)"
                      @keydown.enter="move($event, row, column, 1)"
                      @keydown.down="move($event, row, column, 1)"
                      @keydown.up="move($event, row, column, -1)"
                    />
                  </template>
                  <span
                    v-else
                    class="inline-block min-w-12 tabular-nums"
                    :class="{ 'text-fg-muted': !shown(student, subject) }"
                  >
                    {{ shown(student, subject) || '—' }}
                  </span>
                </td>
                <td
                  class="px-3 py-1.5 text-right tabular-nums"
                  :class="{ 'text-fg-muted': rowIsDirty(student) }"
                >
                  {{ student.total }}
                </td>
                <td
                  class="px-3 py-1.5 text-right tabular-nums"
                  :class="{ 'text-fg-muted': rowIsDirty(student) }"
                >
                  {{ student.average.toFixed(1) }}
                </td>
                <td class="px-4 py-1.5 text-center">
                  <span
                    v-if="rowIsDirty(student)"
                    class="text-info text-xs"
                    title="Recalculated when you save"
                  >
                    unsaved
                  </span>
                  <AppBadge
                    v-else-if="student.grade"
                    :variant="student.isComplete ? 'primary' : 'warning'"
                  >
                    {{ student.grade }}
                  </AppBadge>
                  <span v-else class="text-fg-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="sheet.data.value && visibleStudents.length > 0" #footer>
          <p class="text-fg-muted text-xs">
            <template v-if="sheet.data.value.editable">
              Type a score, or ABS for an absent learner. Use ↑ ↓ or Enter to move between rows.
              Totals, averages and grades are calculated by the server when you save.
            </template>
            <template v-else-if="exam.status === 'OPEN'"
              >You can view these marks but not change them.</template
            >
            <template v-else>Marks entry is closed for this examination.</template>
            <span class="ml-1">
              <span
                class="border-warning/50 bg-warning/5 mx-1 inline-block size-3 rounded-sm border align-middle"
              />missing
              <span
                class="border-info bg-info/5 mx-1 ml-3 inline-block size-3 rounded-sm border align-middle"
              />unsaved
              <span
                class="border-danger bg-danger/5 mx-1 ml-3 inline-block size-3 rounded-sm border align-middle"
              />invalid
            </span>
          </p>
        </template>
      </AppCard>
    </template>

    <MarksImportModal
      v-if="exam && classId"
      v-model:open="importing"
      :exam-id="examId"
      :class-id="classId"
      :class-name="sheet.data.value?.class.name ?? ''"
      @imported="sheet.refetch()"
    />
  </div>
</template>
