<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTextarea from '@/components/ui/AppTextarea.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { EVENT_CATEGORY, type CalendarEvent } from '@/features/dashboard/dashboard.service';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDayMonth, todayIso } from '@/utils/format';
import { calendarApi, monthGrid, monthRange, shiftMonth } from './calendar.service';

const auth = useAuthStore();
const canManage = computed(() => auth.can('calendar:manage'));

const month = ref(todayIso().slice(0, 7));
const range = computed(() => monthRange(month.value));
const title = computed(() =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.value}-01T00:00:00Z`),
  ),
);

const events = useQuery({
  queryKey: useSchoolQueryKey('calendar', month),
  queryFn: () => calendarApi.list(range.value.from, range.value.to),
});
const weeks = computed(() => monthGrid(month.value, events.data.value ?? [], todayIso()));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const when = (event: CalendarEvent): string => {
  const days =
    event.endDate === event.startDate
      ? formatDate(event.startDate)
      : `${formatDayMonth(event.startDate)} – ${formatDate(event.endDate)}`;
  const time = event.startTime
    ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}`
    : '';
  return days + time;
};

// ── Editing ──────────────────────────────────────────────────────────────────
const CATEGORIES = Object.entries(EVENT_CATEGORY).map(([value, { label }]) => ({ value, label }));
const open = ref(false);
const editing = ref<CalendarEvent | null>(null);
const form = reactive({
  title: '',
  description: '',
  category: 'ACADEMIC',
  visibility: 'EVERYONE',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  location: '',
});
const problem = ref('');

function start(event: CalendarEvent | null, date = todayIso()): void {
  if (!canManage.value) return;
  editing.value = event;
  Object.assign(form, {
    title: event?.title ?? '',
    description: event?.description ?? '',
    category: event?.category ?? 'ACADEMIC',
    visibility: event?.visibility ?? 'EVERYONE',
    startDate: event?.startDate ?? date,
    endDate: event?.endDate ?? date,
    startTime: event?.startTime ?? '',
    endTime: event?.endTime ?? '',
    location: event?.location ?? '',
  });
  problem.value = '';
  save.reset();
  open.value = true;
}
const save = useSaveAction(() => {
  const data = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    category: form.category as CalendarEvent['category'],
    visibility: form.visibility as CalendarEvent['visibility'],
    startDate: form.startDate,
    endDate: form.endDate || form.startDate,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
    location: form.location.trim() || null,
  };
  return editing.value ? calendarApi.update(editing.value.id, data) : calendarApi.create(data);
});
async function submit(): Promise<void> {
  if (form.title.trim().length < 2) problem.value = 'Enter a title.';
  else if (!form.startDate) problem.value = 'Choose the date.';
  else if (form.endDate && form.endDate < form.startDate)
    problem.value = 'An event cannot end before it starts.';
  else if (form.endTime && !form.startTime)
    problem.value = 'Give a start time as well as an end time.';
  else problem.value = '';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}

const removing = ref(false);
const remove = useSaveAction(() => calendarApi.remove(editing.value?.id ?? ''));
async function confirmRemove(): Promise<void> {
  if (await remove.run()) {
    removing.value = false;
    open.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Academic Calendar</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Term dates, examinations, holidays and school events.
        </p>
      </div>
      <AppButton v-if="canManage" @click="start(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add event
      </AppButton>
    </header>

    <AppCard flush>
      <template #header>
        <div class="flex items-center gap-2">
          <AppButton
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            @click="month = shiftMonth(month, -1)"
          >
            <template #icon><ChevronLeft class="size-4" aria-hidden="true" /></template>
          </AppButton>
          <h2 class="w-40 text-center text-base font-semibold" aria-live="polite">{{ title }}</h2>
          <AppButton
            variant="ghost"
            size="sm"
            aria-label="Next month"
            @click="month = shiftMonth(month, 1)"
          >
            <template #icon><ChevronRight class="size-4" aria-hidden="true" /></template>
          </AppButton>
        </div>
      </template>
      <template #actions>
        <AppButton variant="secondary" size="sm" @click="month = todayIso().slice(0, 7)"
          >Today</AppButton
        >
      </template>

      <AppEmptyState
        v-if="events.isError.value"
        tone="danger"
        title="The calendar could not be loaded"
        :description="errorMessage(events.error.value)"
      />
      <!-- Month grid on wider screens -->
      <div v-else class="relative hidden overflow-x-auto md:block">
        <table class="w-full table-fixed border-collapse text-sm" data-testid="calendar-grid">
          <caption class="sr-only">
            {{
              title
            }}
          </caption>
          <thead>
            <tr>
              <th
                v-for="day in WEEKDAYS"
                :key="day"
                scope="col"
                class="text-fg-muted border-line border-b px-2 py-2 text-left text-xs font-medium uppercase"
              >
                {{ day }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(week, index) in weeks" :key="index">
              <td
                v-for="day in week"
                :key="day.date"
                class="border-line h-28 border-b border-l p-1.5 align-top first:border-l-0"
                :class="{ 'bg-surface-muted': !day.inMonth }"
              >
                <button
                  v-if="canManage"
                  type="button"
                  class="hover:bg-primary-light flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                  :class="
                    day.isToday
                      ? 'bg-primary font-semibold text-white hover:bg-primary'
                      : day.inMonth
                        ? ''
                        : 'text-fg-muted'
                  "
                  :aria-label="`Add an event on ${formatDate(day.date)}`"
                  @click="start(null, day.date)"
                >
                  {{ day.day }}
                </button>
                <span
                  v-else
                  class="flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                  :class="
                    day.isToday
                      ? 'bg-primary font-semibold text-white'
                      : day.inMonth
                        ? ''
                        : 'text-fg-muted'
                  "
                >
                  {{ day.day }}
                </span>
                <ul class="mt-1 space-y-1">
                  <li v-for="event in day.events" :key="event.id">
                    <component
                      :is="canManage ? 'button' : 'span'"
                      :type="canManage ? 'button' : undefined"
                      class="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium"
                      :class="EVENT_CATEGORY[event.category].tone"
                      :title="`${event.title} · ${when(event)}`"
                      @click="canManage ? start(event) : undefined"
                    >
                      {{ event.title }}
                    </component>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- The same events as a list: the only view on phones -->
      <div class="border-line md:border-t">
        <h3 class="px-5 pt-4 text-sm font-semibold">Events this month</h3>
        <AppEmptyState
          v-if="!events.isPending.value && (events.data.value?.length ?? 0) === 0"
          :icon="CalendarDays"
          title="Nothing scheduled"
          description="No events fall in this month."
        />
        <ul v-else class="divide-line divide-y" data-testid="calendar-list">
          <li
            v-for="event in events.data.value"
            :key="event.id"
            class="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm"
          >
            <div class="min-w-0">
              <p class="font-medium">
                {{ event.title }}
                <span
                  class="ml-1 rounded px-1.5 py-0.5 text-xs"
                  :class="EVENT_CATEGORY[event.category].tone"
                >
                  {{ EVENT_CATEGORY[event.category].label }}
                </span>
                <span v-if="event.visibility === 'STAFF'" class="text-fg-muted ml-1 text-xs"
                  >Staff only</span
                >
              </p>
              <p class="text-fg-muted">
                {{ when(event) }}<template v-if="event.location"> · {{ event.location }}</template>
              </p>
              <p v-if="event.description" class="text-fg-muted mt-0.5 whitespace-pre-line">
                {{ event.description }}
              </p>
            </div>
            <AppButton
              v-if="canManage"
              variant="ghost"
              size="sm"
              :aria-label="`Edit ${event.title}`"
              @click="start(event)"
            >
              Edit
            </AppButton>
          </li>
        </ul>
      </div>
    </AppCard>

    <AppModal v-model:open="open" size="lg" :title="editing ? 'Edit event' : 'Add event'">
      <form id="event-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="problem || save.error.value">{{ problem || save.error.value }}</AppAlert>
        <AppInput v-model="form.title" label="Title" required data-autofocus />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.startDate" label="Starts" type="date" required />
          <AppInput v-model="form.endDate" label="Ends" type="date" :min="form.startDate" />
          <div>
            <label for="event-start-time" class="mb-1.5 block text-sm font-medium"
              >Start time</label
            >
            <input
              id="event-start-time"
              v-model="form.startTime"
              type="time"
              class="form-control"
            />
            <p class="text-fg-muted mt-1.5 text-xs">Leave empty for an all-day event.</p>
          </div>
          <div>
            <label for="event-end-time" class="mb-1.5 block text-sm font-medium">End time</label>
            <input id="event-end-time" v-model="form.endTime" type="time" class="form-control" />
          </div>
          <AppSelect v-model="form.category" label="Kind" :options="CATEGORIES" />
          <AppSelect
            v-model="form.visibility"
            label="Shown to"
            :options="[
              { value: 'EVERYONE', label: 'Staff, parents and students' },
              { value: 'STAFF', label: 'Staff only' },
            ]"
          />
        </div>
        <AppInput v-model="form.location" label="Location" placeholder="Optional" />
        <AppTextarea v-model="form.description" label="Details" :max-length="1000" />
      </form>
      <template #footer>
        <AppButton
          v-if="editing"
          variant="danger"
          @click="
            remove.reset();
            removing = true;
          "
        >
          Delete
        </AppButton>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="event-form" :loading="save.pending.value"
          >Save event</AppButton
        >
      </template>
    </AppModal>

    <AppConfirmDialog
      :open="removing"
      title="Delete this event?"
      confirm-label="Delete"
      tone="danger"
      :loading="remove.pending.value"
      :error="remove.error.value"
      @confirm="confirmRemove"
      @cancel="removing = false"
    >
      “{{ editing?.title }}” will be removed from the calendar.
    </AppConfirmDialog>
  </div>
</template>
