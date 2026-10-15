<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { classesApi } from '@/features/classes/classes.service';
import { academicsApi } from '@/features/school-config/config.service';
import { EXAM_TYPES, examsApi } from './examinations.service';

const open = defineModel<boolean>('open', { required: true });

const name = ref('');
const type = ref('END_TERM');
const termId = ref('');
const startDate = ref('');
const endDate = ref('');
const maxMarks = ref('100');
const classIds = ref<string[]>([]);
const openNow = ref(true);
const problem = ref<string | null>(null);

const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
  enabled: open,
});
const classes = useQuery({
  queryKey: useSchoolQueryKey('classes'),
  queryFn: classesApi.list,
  enabled: open,
});

const terms = computed(() =>
  (years.data.value ?? []).flatMap((year) =>
    year.terms.map((term) => ({ ...term, label: `${year.name} — ${term.name}` })),
  ),
);
const termOptions = computed(() =>
  terms.value.map((term) => ({ value: term.id, label: term.label })),
);
const selectedTerm = computed(() => terms.value.find((term) => term.id === termId.value) ?? null);
// Only classes that have subjects can be examined.
const eligible = computed(() =>
  (classes.data.value ?? []).filter((entry) => entry.isActive && entry.subjects.length > 0),
);
const skipped = computed(() =>
  (classes.data.value ?? []).filter((entry) => entry.isActive && entry.subjects.length === 0),
);

const save = useSaveAction(async () => {
  const exam = await examsApi.create({
    name: name.value.trim(),
    type: type.value,
    termId: termId.value,
    startDate: startDate.value,
    endDate: endDate.value,
    classIds: classIds.value,
    maxMarks: Number(maxMarks.value),
  });
  if (openNow.value) await examsApi.act(exam.id, 'open');
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  problem.value = null;
  name.value = '';
  type.value = 'END_TERM';
  startDate.value = '';
  endDate.value = '';
  maxMarks.value = '100';
  classIds.value = [];
  openNow.value = true;
});
// Default to the current term once the terms have loaded.
watch(
  [open, terms],
  () => {
    if (open.value && !termId.value) {
      termId.value = terms.value.find((term) => term.isCurrent)?.id ?? terms.value[0]?.id ?? '';
    }
  },
  { immediate: true },
);

function toggle(id: string, checked: boolean): void {
  classIds.value = checked
    ? [...classIds.value, id]
    : classIds.value.filter((value) => value !== id);
}

async function submit(): Promise<void> {
  const term = selectedTerm.value;
  problem.value = null;
  if (name.value.trim().length < 2) problem.value = 'Enter the examination name.';
  else if (!term) problem.value = 'Choose a term.';
  else if (!startDate.value || !endDate.value) problem.value = 'Choose the start and end dates.';
  else if (startDate.value > endDate.value)
    problem.value = 'The end date cannot be before the start date.';
  else if (startDate.value < term.startDate || endDate.value > term.endDate) {
    problem.value = `The dates must fall within the term (${term.startDate} to ${term.endDate}).`;
  } else if (!/^\d{1,4}(\.\d{1,2})?$/.test(maxMarks.value) || Number(maxMarks.value) < 1) {
    problem.value = 'Enter the maximum marks as a number of at least 1.';
  } else if (classIds.value.length === 0) problem.value = 'Choose at least one class.';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}

const checked = (event: Event): boolean => (event.target as HTMLInputElement).checked;
</script>

<template>
  <AppModal v-model:open="open" title="Create exam" size="lg" :dismissible="!save.pending.value">
    <form id="exam-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="exam-form-error">
        {{ problem ?? save.error.value }}
      </AppAlert>
      <AppAlert v-else-if="years.isSuccess.value && terms.length === 0" tone="info">
        Add an academic year and a term in School Settings before creating an examination.
      </AppAlert>

      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="name"
          label="Examination name"
          placeholder="e.g. End Term Exam"
          autocomplete="off"
          data-autofocus
          required
        />
        <AppSelect v-model="type" :options="EXAM_TYPES" label="Examination type" required />
        <AppSelect
          v-model="termId"
          :options="termOptions"
          label="Academic year and term"
          placeholder="Select term"
          required
        />
        <AppInput
          v-model="maxMarks"
          label="Maximum marks"
          hint="For every subject. Adjust individual subjects afterwards."
          inputmode="decimal"
          autocomplete="off"
          required
        />
        <AppInput v-model="startDate" type="date" label="Start date" required />
        <AppInput v-model="endDate" type="date" label="End date" required />
      </div>

      <fieldset>
        <legend class="mb-1.5 text-sm font-medium">Applicable classes</legend>
        <p v-if="eligible.length === 0" class="text-fg-muted text-sm">
          No class has subjects yet. Assign subjects on the Classes page first.
        </p>
        <div v-else class="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <label
            v-for="entry in eligible"
            :key="entry.id"
            class="hover:bg-surface-muted rounded-control flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm"
          >
            <input
              type="checkbox"
              class="accent-primary size-4"
              :checked="classIds.includes(entry.id)"
              @change="toggle(entry.id, checked($event))"
            />
            <span class="font-medium">{{ entry.name }}</span>
            <span class="text-fg-muted text-xs">{{ entry.subjects.length }} subjects</span>
          </label>
        </div>
        <p v-if="skipped.length > 0" class="text-fg-muted mt-2 text-xs">
          Not listed because they have no subjects:
          {{ skipped.map((entry) => entry.name).join(', ') }}.
        </p>
      </fieldset>

      <label class="flex items-start gap-3 text-sm">
        <input v-model="openNow" type="checkbox" class="accent-primary mt-0.5 size-4" />
        <span>
          <span class="block font-medium">Open for marks entry straight away</span>
          <span class="text-fg-muted block text-xs">Otherwise it is saved as a draft.</span>
        </span>
      </label>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false"
        >Cancel</AppButton
      >
      <AppButton type="submit" form="exam-form" :loading="save.pending.value"
        >Create exam</AppButton
      >
    </template>
  </AppModal>
</template>
