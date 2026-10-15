<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarClock, Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { teachersApi } from '@/features/teachers/teachers.service';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { byDay, timetableApi, WEEKDAYS, type Slot } from './timetable.service';

const ALL = 'all';
const MINE = 'mine';
const NONE = 'none';

const auth = useAuthStore();
const canManage = computed(() => auth.can('timetable:manage'));

const classId = ref('');
const streamId = ref(ALL);
const selectedClassId = computed(() => (classId.value === MINE ? '' : classId.value));
const {
  classes,
  classOptions: classList,
  selectedClass,
  streamOptions: streams,
} = useClassOptions(selectedClassId);
const classOptions = computed(() => [{ value: MINE, label: 'My lessons' }, ...classList.value]);
const streamOptions = computed(() => [{ value: ALL, label: 'Whole class' }, ...streams.value]);
watch(
  classList,
  (options) => {
    if (!classId.value && options[0]) classId.value = options[0].value;
  },
  { immediate: true },
);
watch(classId, () => {
  streamId.value = ALL;
});

const query = computed(() => ({
  classId: selectedClassId.value,
  streamId: streamId.value === ALL ? '' : streamId.value,
  mine: classId.value === MINE,
}));
const slots = useQuery({
  queryKey: useSchoolQueryKey('timetable', query),
  queryFn: () => timetableApi.list(query.value),
  enabled: computed(() => classId.value !== ''),
});
const days = computed(() => byDay(slots.data.value ?? []));
const isEmpty = computed(() => (slots.data.value?.length ?? 0) === 0);

// ── Editing ──────────────────────────────────────────────────────────────────
const teachers = useQuery({
  queryKey: useSchoolQueryKey('teachers', 'options'),
  queryFn: () => teachersApi.list({ page: 1, pageSize: 100, status: 'ACTIVE' }),
  enabled: canManage,
});
const teacherOptions = computed(() => [
  { value: NONE, label: 'No teacher assigned' },
  ...(teachers.data.value?.items ?? []).map((teacher) => ({
    value: teacher.id,
    label: `${teacher.firstName} ${teacher.lastName}`,
  })),
]);
const subjectOptions = computed(() =>
  (selectedClass.value?.subjects ?? []).map((subject) => ({
    value: subject.subjectId,
    label: subject.name,
  })),
);

const open = ref(false);
const editing = ref<Slot | null>(null);
const form = reactive({
  dayOfWeek: '1',
  startTime: '08:00',
  endTime: '08:40',
  subjectId: '',
  teacherId: NONE,
  streamId: ALL,
  room: '',
});
const problem = ref('');

function start(slot: Slot | null, day = 1): void {
  editing.value = slot;
  Object.assign(form, {
    dayOfWeek: String(slot?.dayOfWeek ?? day),
    startTime: slot?.startTime ?? '08:00',
    endTime: slot?.endTime ?? '08:40',
    subjectId: slot?.subject.id ?? '',
    teacherId: slot?.teacher?.id ?? NONE,
    streamId: slot?.stream?.id ?? (streamId.value === ALL ? ALL : streamId.value),
    room: slot?.room ?? '',
  });
  problem.value = '';
  save.reset();
  open.value = true;
}
const save = useSaveAction(() => {
  const data = {
    classId: selectedClassId.value,
    streamId: form.streamId === ALL ? null : form.streamId,
    dayOfWeek: Number(form.dayOfWeek),
    startTime: form.startTime,
    endTime: form.endTime,
    subjectId: form.subjectId,
    teacherId: form.teacherId === NONE ? null : form.teacherId,
    room: form.room.trim() || null,
  };
  return editing.value ? timetableApi.update(editing.value.id, data) : timetableApi.create(data);
});
async function submit(): Promise<void> {
  if (!form.subjectId) problem.value = 'Choose the subject.';
  else if (!form.startTime || !form.endTime) problem.value = 'Enter the start and end times.';
  else if (form.endTime <= form.startTime) problem.value = 'A lesson must end after it starts.';
  else problem.value = '';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}

const removing = ref<Slot | null>(null);
const remove = useSaveAction(() => timetableApi.remove(removing.value?.id ?? ''));
async function confirmRemove(): Promise<void> {
  if (await remove.run()) {
    removing.value = null;
    open.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Timetable</h1>
        <p class="text-fg-muted mt-1 text-sm">
          The weekly lessons of each class, stream and teacher.
        </p>
      </div>
      <AppButton v-if="canManage && selectedClassId" @click="start(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add lesson
      </AppButton>
    </header>

    <AppCard>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-model="classId"
          label="Timetable for"
          :options="classOptions"
          placeholder="Choose a class"
        />
        <AppSelect
          v-model="streamId"
          label="Stream"
          :options="streamOptions"
          :disabled="classId === MINE || streamOptions.length <= 1"
        />
      </div>
    </AppCard>

    <AppEmptyState
      v-if="classes.isError.value || slots.isError.value"
      tone="danger"
      title="The timetable could not be loaded"
      :description="errorMessage(classes.error.value ?? slots.error.value)"
    />
    <div
      v-else-if="slots.isPending.value && classId"
      class="grid gap-4 md:grid-cols-5"
      aria-busy="true"
    >
      <AppSkeleton v-for="n in 5" :key="n" height="10rem" />
    </div>
    <AppEmptyState
      v-else-if="isEmpty"
      :icon="CalendarClock"
      :title="classId === MINE ? 'You have no lessons on the timetable' : 'No lessons yet'"
      :description="
        canManage && selectedClassId ? 'Add the first lesson for this class.' : undefined
      "
    />

    <div v-else class="grid gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="timetable">
      <section
        v-for="column in days"
        :key="column.day"
        class="bg-surface border-line rounded-card shadow-card border"
        :aria-label="column.label"
      >
        <header class="border-line flex items-center justify-between border-b px-4 py-2.5">
          <h2 class="text-sm font-semibold">{{ column.label }}</h2>
          <button
            v-if="canManage && selectedClassId"
            type="button"
            class="text-fg-muted hover:text-primary"
            :aria-label="`Add a lesson on ${column.label}`"
            @click="start(null, column.day)"
          >
            <Plus class="size-4" aria-hidden="true" />
          </button>
        </header>
        <p v-if="column.slots.length === 0" class="text-fg-muted px-4 py-6 text-center text-sm">
          No lessons
        </p>
        <ul v-else class="space-y-2 p-3">
          <li v-for="slot in column.slots" :key="slot.id">
            <component
              :is="canManage && selectedClassId ? 'button' : 'div'"
              :type="canManage && selectedClassId ? 'button' : undefined"
              class="bg-primary-light w-full rounded-lg px-3 py-2 text-left text-sm"
              :class="{
                'hover:ring-primary focus-visible:ring-primary hover:ring-1 focus-visible:ring-2 focus-visible:outline-none':
                  canManage && selectedClassId,
              }"
              :aria-label="
                canManage && selectedClassId
                  ? `Edit ${slot.subject.name}, ${column.label} ${slot.startTime}`
                  : undefined
              "
              @click="canManage && selectedClassId ? start(slot) : undefined"
            >
              <span class="text-primary block text-xs font-semibold tabular-nums">
                {{ slot.startTime }} – {{ slot.endTime }}
              </span>
              <span class="block font-medium">{{ slot.subject.name }}</span>
              <span class="text-fg-muted block text-xs">
                <template v-if="classId === MINE">
                  {{ slot.class.name
                  }}<template v-if="slot.stream"> {{ slot.stream.name }}</template>
                </template>
                <template v-else>
                  {{ slot.teacher?.name ?? 'No teacher'
                  }}<template v-if="slot.stream"> · {{ slot.stream.name }}</template>
                </template>
                <template v-if="slot.room"> · {{ slot.room }}</template>
              </span>
            </component>
          </li>
        </ul>
      </section>
    </div>

    <AppModal
      v-model:open="open"
      :title="editing ? 'Edit lesson' : 'Add lesson'"
      :description="selectedClass?.name"
    >
      <form id="slot-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="problem || save.error.value" data-testid="slot-error">
          {{ problem || save.error.value }}
        </AppAlert>
        <div class="grid gap-4 sm:grid-cols-3">
          <AppSelect
            v-model="form.dayOfWeek"
            label="Day"
            :options="WEEKDAYS.map((day) => ({ value: String(day.value), label: day.label }))"
          />
          <div>
            <label for="slot-start" class="mb-1.5 block text-sm font-medium">Starts</label>
            <input
              id="slot-start"
              v-model="form.startTime"
              type="time"
              class="form-control"
              required
            />
          </div>
          <div>
            <label for="slot-end" class="mb-1.5 block text-sm font-medium">Ends</label>
            <input id="slot-end" v-model="form.endTime" type="time" class="form-control" required />
          </div>
        </div>
        <AppSelect
          v-model="form.subjectId"
          label="Subject"
          :options="subjectOptions"
          placeholder="Choose a subject"
          :hint="
            subjectOptions.length === 0
              ? 'This class has no subjects yet. Add them on the Classes page.'
              : undefined
          "
          required
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect v-model="form.teacherId" label="Teacher" :options="teacherOptions" />
          <AppSelect
            v-model="form.streamId"
            label="For"
            :options="streamOptions"
            :disabled="streamOptions.length <= 1"
          />
        </div>
        <AppInput v-model="form.room" label="Room" placeholder="Optional" />
      </form>
      <template #footer>
        <AppButton
          v-if="editing"
          variant="danger"
          @click="
            remove.reset();
            removing = editing;
          "
        >
          Delete
        </AppButton>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="slot-form" :loading="save.pending.value"
          >Save lesson</AppButton
        >
      </template>
    </AppModal>

    <AppConfirmDialog
      :open="removing !== null"
      title="Delete this lesson?"
      confirm-label="Delete"
      tone="danger"
      :loading="remove.pending.value"
      :error="remove.error.value"
      @confirm="confirmRemove"
      @cancel="removing = null"
    >
      {{ removing?.subject.name }} on
      {{ WEEKDAYS.find((day) => day.value === removing?.dayOfWeek)?.label }} at
      {{ removing?.startTime }} will be removed from the timetable.
    </AppConfirmDialog>
  </div>
</template>
