<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { academicsApi } from '@/features/school-config/config.service';
import { errorMessage } from '@/services/http';
import { fullName, hasLeft, studentsApi, type PromotionResult } from './students.service';

const open = defineModel<boolean>('open', { required: true });

/** Sentinel select values for the two outcomes that are not "another class". */
const GRADUATE = 'graduate';

const fromClassId = ref('');
const toYearId = ref('');
const destination = ref('');
const selected = ref(new Set<string>());
const result = ref<PromotionResult | null>(null);

const { classOptions } = useClassOptions(fromClassId);

const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
  enabled: open,
});
// Promotion moves learners out of the current year, so it is not a target.
const yearOptions = computed(() =>
  (years.data.value ?? [])
    .filter((year) => !year.isCurrent)
    .map((year) => ({ value: year.id, label: year.name })),
);

const destinationOptions = computed(() => [
  ...classOptions.value.map((option) => ({
    value: option.value,
    label: option.value === fromClassId.value ? `${option.label} (repeat the class)` : option.label,
  })),
  { value: GRADUATE, label: 'Graduate — they leave the school' },
]);

const students = useQuery({
  queryKey: useSchoolQueryKey('students', 'promotion', fromClassId),
  queryFn: () => studentsApi.listAll({ classId: fromClassId.value, sort: 'name' }),
  enabled: computed(() => open.value && fromClassId.value !== ''),
  staleTime: 0,
});
const eligible = computed(() =>
  (students.data.value ?? []).filter((student) => !hasLeft(student.status)),
);

// Everyone in the class is selected by default; holding someone back is the exception.
watch(eligible, (list) => {
  selected.value = new Set(list.map((student) => student.id));
});

const allSelected = computed(
  () => eligible.value.length > 0 && selected.value.size === eligible.value.length,
);
function toggleAll(checked: boolean): void {
  selected.value = new Set(checked ? eligible.value.map((student) => student.id) : []);
}
function toggle(id: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

const save = useSaveAction(async () => {
  result.value = await studentsApi.promote({
    fromClassId: fromClassId.value,
    toAcademicYearId: toYearId.value,
    toClassId: destination.value === GRADUATE ? null : destination.value,
    studentIds: [...selected.value],
  });
});

const canSubmit = computed(
  () => fromClassId.value && toYearId.value && destination.value && selected.value.size > 0,
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  fromClassId.value = '';
  toYearId.value = '';
  destination.value = '';
  selected.value = new Set();
  result.value = null;
  save.reset();
});

const checked = (event: Event): boolean => (event.target as HTMLInputElement).checked;
const plural = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`;
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Promote students"
    description="Move a class into a new academic year. Their history is kept."
    size="lg"
    :dismissible="!save.pending.value"
  >
    <AppAlert v-if="result" tone="success" data-testid="promotion-done">
      <template v-if="result.promoted">{{ plural(result.promoted) }} promoted. </template>
      <template v-if="result.repeated"
        >{{ plural(result.repeated) }} will repeat the class.
      </template>
      <template v-if="result.graduated">{{ plural(result.graduated) }} graduated.</template>
    </AppAlert>

    <div v-else class="space-y-5">
      <AppAlert v-if="save.error.value" data-testid="promotion-error">{{
        save.error.value
      }}</AppAlert>
      <AppAlert v-else-if="years.isSuccess.value && yearOptions.length === 0" tone="info">
        Create the next academic year in School Settings first. Students are promoted into it.
      </AppAlert>

      <div class="grid gap-4 sm:grid-cols-3">
        <AppSelect
          v-model="fromClassId"
          :options="classOptions"
          label="From class"
          placeholder="Select class"
          required
        />
        <AppSelect
          v-model="toYearId"
          :options="yearOptions"
          label="Into academic year"
          placeholder="Select year"
          required
        />
        <AppSelect
          v-model="destination"
          :options="destinationOptions"
          label="Move to"
          placeholder="Select outcome"
          required
        />
      </div>

      <section v-if="fromClassId">
        <div v-if="students.isPending.value" class="space-y-2" aria-busy="true">
          <AppSkeleton v-for="n in 4" :key="n" height="2rem" />
        </div>
        <AppAlert v-else-if="students.isError.value">
          {{ errorMessage(students.error.value) }}
        </AppAlert>
        <p v-else-if="eligible.length === 0" class="text-fg-muted text-sm">
          There are no active students in this class.
        </p>
        <template v-else>
          <label class="flex items-center gap-3 px-3 pb-2 text-sm font-medium">
            <input
              type="checkbox"
              class="accent-primary size-4"
              :checked="allSelected"
              :indeterminate="selected.size > 0 && !allSelected"
              @change="toggleAll(checked($event))"
            />
            {{ selected.size }} of {{ eligible.length }} selected
          </label>
          <ul
            class="border-line divide-line rounded-control relative max-h-64 divide-y overflow-y-auto border"
          >
            <li v-for="student in eligible" :key="student.id">
              <label
                class="hover:bg-surface-muted flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  class="accent-primary size-4 shrink-0"
                  :checked="selected.has(student.id)"
                  @change="toggle(student.id, checked($event))"
                />
                <span class="min-w-0 flex-1 truncate">{{ fullName(student) }}</span>
                <span class="text-fg-muted text-xs">{{ student.stream?.name }}</span>
                <code class="text-fg-muted text-xs">{{ student.admissionNumber }}</code>
              </label>
            </li>
          </ul>
          <p class="text-fg-muted mt-2 text-xs">
            Untick anyone who should stay where they are for now. Students keep the stream of the
            same name where the next class has one.
          </p>
        </template>
      </section>
    </div>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        {{ result ? 'Close' : 'Cancel' }}
      </AppButton>
      <AppButton
        v-if="!result"
        :disabled="!canSubmit"
        :loading="save.pending.value"
        data-testid="promotion-confirm"
        @click="save.run()"
      >
        {{ destination === GRADUATE ? 'Graduate' : 'Move' }} {{ plural(selected.size) }}
      </AppButton>
    </template>
  </AppModal>
</template>
