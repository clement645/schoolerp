<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { CalendarCheck, CheckCheck, Clock, Save, UserCheck, UserX, Users } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import StatCard from '@/components/ui/StatCard.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { SCHOOL_QUERY_ROOT, useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDateTime, todayIso } from '@/utils/format';
import {
  attendanceApi,
  formatRate,
  STATUSES,
  type AttendanceEntry,
  type AttendanceStatus,
} from './attendance.service';

const ALL = 'all';

const auth = useAuthStore();
const queryClient = useQueryClient();
const canMark = computed(() => auth.can('attendance:mark'));

const classId = ref('');
const streamId = ref(ALL);
const date = ref(todayIso());
const { classes, classOptions, streamOptions: streams } = useClassOptions(classId);
const streamOptions = computed(() => [{ value: ALL, label: 'All streams' }, ...streams.value]);

// Default to the first class once classes load.
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
  date: date.value,
}));
const ready = computed(() => classId.value !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date.value));
const isFuture = computed(() => date.value > todayIso());

const registerKey = useSchoolQueryKey('attendance', 'register', query);
const register = useQuery({
  queryKey: registerKey,
  queryFn: () => attendanceApi.register(query.value),
  enabled: ready,
  staleTime: 0,
});

// ── Unsaved marks ────────────────────────────────────────────────────────────
// What the person has changed but not yet saved, by learner.
const draft = reactive(new Map<string, { status: AttendanceStatus; note: string }>());
watch(query, () => draft.clear(), { deep: true });

const rows = computed(() =>
  (register.data.value?.students ?? []).map((row) => {
    const pending = draft.get(row.student.id);
    return {
      ...row,
      status: pending?.status ?? row.status,
      note: pending?.note ?? row.note ?? '',
      changed: pending !== undefined,
    };
  }),
);
const unsaved = computed(() => draft.size);

function setStatus(studentId: string, status: AttendanceStatus): void {
  const saved = register.data.value?.students.find((row) => row.student.id === studentId);
  const note = draft.get(studentId)?.note ?? saved?.note ?? '';
  if (saved?.status === status && (saved.note ?? '') === note) draft.delete(studentId);
  else draft.set(studentId, { status, note });
}
function setNote(studentId: string, note: string): void {
  const row = rows.value.find((entry) => entry.student.id === studentId);
  // A note belongs to a mark: without a status there is nothing to attach it to.
  if (!row?.status) return;
  const saved = register.data.value?.students.find((entry) => entry.student.id === studentId);
  if (saved?.status === row.status && (saved.note ?? '') === note.trim()) draft.delete(studentId);
  else draft.set(studentId, { status: row.status, note });
}
function markRestPresent(): void {
  for (const row of rows.value) {
    if (!row.status) draft.set(row.student.id, { status: 'PRESENT', note: '' });
  }
}
const unmarked = computed(() => rows.value.filter((row) => !row.status).length);

const counts = computed(() => {
  const tally = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const row of rows.value) if (row.status) tally[row.status] += 1;
  const marked = rows.value.length - unmarked.value;
  return {
    ...tally,
    rate: marked === 0 ? null : Math.round(((tally.PRESENT + tally.LATE) / marked) * 10000) / 100,
  };
});

// ── Saving ───────────────────────────────────────────────────────────────────
const saving = ref(false);
const saveError = ref<string | null>(null);
const savedAt = ref<string | null>(null);

async function save(): Promise<void> {
  if (draft.size === 0) return;
  saving.value = true;
  saveError.value = null;
  const records: AttendanceEntry[] = [...draft].map(([studentId, entry]) => ({
    studentId,
    status: entry.status,
    note: entry.note.trim() || null,
  }));
  try {
    const updated = await attendanceApi.mark(query.value, records);
    draft.clear();
    queryClient.setQueryData(registerKey.value, updated);
    savedAt.value = new Date().toISOString();
    await queryClient.invalidateQueries({ queryKey: [SCHOOL_QUERY_ROOT] });
  } catch (caught) {
    saveError.value = errorMessage(caught);
  } finally {
    saving.value = false;
  }
}
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
        <AppInput v-model="date" label="Date" type="date" :max="todayIso()" />
      </div>
    </AppCard>

    <AppAlert v-if="isFuture" tone="info">
      Attendance cannot be recorded for a future date.
    </AppAlert>

    <AppEmptyState
      v-if="classes.isError.value"
      tone="danger"
      title="Classes could not be loaded"
      :description="errorMessage(classes.error.value)"
    />
    <div v-else-if="classes.isPending.value" class="space-y-3" aria-busy="true">
      <AppSkeleton v-for="n in 3" :key="n" height="2.5rem" />
    </div>
    <AppEmptyState
      v-else-if="classOptions.length === 0"
      :icon="CalendarCheck"
      title="No classes yet"
      description="Create classes and admit students before taking a register."
    />
    <AppEmptyState
      v-else-if="register.isError.value"
      tone="danger"
      title="The register could not be loaded"
      :description="errorMessage(register.error.value)"
    />

    <template v-else>
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Learners" :value="rows.length" :icon="Users" tone="info" />
        <StatCard label="Present" :value="counts.PRESENT" :icon="UserCheck" tone="success" />
        <StatCard label="Absent" :value="counts.ABSENT" :icon="UserX" tone="danger" />
        <StatCard label="Late" :value="counts.LATE" :icon="Clock" tone="warning" />
        <StatCard
          label="Attendance"
          :value="formatRate(counts.rate)"
          :icon="CalendarCheck"
          :hint="counts.EXCUSED ? `${counts.EXCUSED} excused` : undefined"
        />
      </div>

      <AppCard flush>
        <template #header>
          <div>
            <h2 class="text-base font-semibold">
              {{ register.data.value?.class.name ?? 'Register' }} · {{ formatDate(date) }}
            </h2>
            <p class="text-fg-muted text-sm">
              <template v-if="register.data.value?.lastMarkedAt">
                Last marked {{ formatDateTime(register.data.value.lastMarkedAt) }}
              </template>
              <template v-else>Not marked yet</template>
              <span v-if="unsaved" class="text-warning font-medium" data-testid="unsaved">
                · {{ unsaved }} unsaved {{ unsaved === 1 ? 'change' : 'changes' }}
              </span>
            </p>
          </div>
        </template>
        <template v-if="canMark" #actions>
          <AppButton
            variant="secondary"
            size="sm"
            :disabled="unmarked === 0 || isFuture"
            @click="markRestPresent"
          >
            <template #icon><CheckCheck class="size-4" aria-hidden="true" /></template>
            Mark the rest present
          </AppButton>
          <AppButton
            size="sm"
            :disabled="unsaved === 0 || isFuture"
            :loading="saving"
            @click="save"
          >
            <template #icon><Save class="size-4" aria-hidden="true" /></template>
            Save register
          </AppButton>
        </template>

        <div class="px-5 pt-4">
          <AppAlert v-if="saveError">{{ saveError }}</AppAlert>
          <AppAlert v-else-if="savedAt && unsaved === 0" tone="success">Register saved.</AppAlert>
        </div>

        <div v-if="register.isPending.value" class="space-y-3 p-5" aria-busy="true">
          <AppSkeleton v-for="n in 5" :key="n" height="2.5rem" />
        </div>
        <AppEmptyState
          v-else-if="rows.length === 0"
          title="No learners"
          description="No active learners are placed in this class or stream."
        />
        <div v-else class="relative overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Attendance register
            </caption>
            <thead class="text-fg-muted border-line border-b text-left text-xs uppercase">
              <tr>
                <th scope="col" class="px-5 py-3 font-medium">Learner</th>
                <th scope="col" class="px-3 py-3 font-medium">Stream</th>
                <th scope="col" class="px-3 py-3 font-medium">Status</th>
                <th scope="col" class="px-5 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.student.id"
                class="border-line border-b last:border-0"
                :class="{ 'bg-warning/5': row.changed }"
                :data-testid="`register-${row.student.admissionNumber}`"
              >
                <th scope="row" class="px-5 py-2.5 text-left font-normal">
                  <p class="font-medium">{{ row.student.name }}</p>
                  <p class="text-fg-muted text-xs">{{ row.student.admissionNumber }}</p>
                </th>
                <td class="text-fg-muted px-3 py-2.5">{{ row.stream ?? '—' }}</td>
                <td class="px-3 py-2.5">
                  <div
                    role="radiogroup"
                    :aria-label="`Attendance for ${row.student.name}`"
                    class="border-line inline-flex overflow-hidden rounded-md border"
                  >
                    <button
                      v-for="option in STATUSES"
                      :key="option.value"
                      type="button"
                      role="radio"
                      :aria-checked="row.status === option.value"
                      :disabled="!canMark || isFuture"
                      class="border-line focus-visible:ring-primary/40 border-r px-3 py-1.5 text-xs font-medium transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
                      :class="
                        row.status === option.value
                          ? option.tone
                          : 'text-fg-muted hover:bg-surface-muted'
                      "
                      @click="setStatus(row.student.id, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </td>
                <td class="px-5 py-2.5">
                  <input
                    type="text"
                    class="form-control h-8 min-w-40"
                    maxlength="200"
                    :value="row.note"
                    :aria-label="`Note for ${row.student.name}`"
                    :disabled="!canMark || !row.status || isFuture"
                    placeholder="Optional"
                    @change="setNote(row.student.id, ($event.target as HTMLInputElement).value)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </template>
  </div>
</template>
