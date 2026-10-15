<!-- One form for both academic years and terms: a name and a date range,
     plus a position within the year for terms. -->
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { zodForm } from '@/utils/zod-form';
import { academicsApi, type AcademicYear, type Term } from './config.service';

export type PeriodTarget =
  | { kind: 'year'; year: AcademicYear | null }
  | { kind: 'term'; year: AcademicYear; term: Term | null };

const props = defineProps<{ target: PeriodTarget | null }>();
const open = defineModel<boolean>('open', { required: true });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(50),
    sequence: z.string().trim(),
    startDate: z.string().regex(DATE, 'Choose a start date.'),
    endDate: z.string().regex(DATE, 'Choose an end date.'),
  })
  .refine((values) => !values.startDate || !values.endDate || values.startDate < values.endDate, {
    path: ['endDate'],
    message: 'The end date must be after the start date.',
  });

const { defineField, handleSubmit, errors, resetForm, setFieldError } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { name: '', sequence: '', startDate: '', endDate: '' },
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [sequence, sequenceAttrs] = defineField('sequence', onBlurOnly);
const [startDate, startDateAttrs] = defineField('startDate', onBlurOnly);
const [endDate, endDateAttrs] = defineField('endDate', onBlurOnly);

const isTerm = computed(() => props.target?.kind === 'term');
const existing = computed(() => {
  const target = props.target;
  if (!target) return null;
  return target.kind === 'year' ? target.year : target.term;
});
const title = computed(() => {
  const noun = isTerm.value ? 'term' : 'academic year';
  return existing.value ? `Edit ${noun}` : `Add ${noun}`;
});

const save = useSaveAction(async (values: z.output<typeof schema>) => {
  const target = props.target;
  if (!target) return;
  const period = { name: values.name, startDate: values.startDate, endDate: values.endDate };

  if (target.kind === 'year') {
    return target.year
      ? academicsApi.updateYear(target.year.id, period)
      : academicsApi.createYear(period);
  }
  const term = { ...period, sequence: Number(values.sequence) };
  return target.term
    ? academicsApi.updateTerm(target.term.id, term)
    : academicsApi.createTerm(target.year.id, term);
});

watch(open, (isOpen) => {
  const target = props.target;
  if (!isOpen || !target) return;
  save.reset();

  const term = target.kind === 'term' ? target.term : null;
  const nextSequence =
    target.kind === 'term' ? Math.max(0, ...target.year.terms.map((t) => t.sequence)) + 1 : 0;
  resetForm({
    values: {
      name: existing.value?.name ?? (target.kind === 'term' ? `Term ${nextSequence}` : ''),
      sequence: target.kind === 'term' ? String(term?.sequence ?? nextSequence) : '',
      startDate: existing.value?.startDate ?? '',
      endDate: existing.value?.endDate ?? '',
    },
  });
});

const submit = handleSubmit(async (values) => {
  if (isTerm.value && !/^([1-9]|1[0-2])$/.test(values.sequence)) {
    setFieldError('sequence', 'Enter a number from 1 to 12.');
    return;
  }
  if (await save.run(values)) open.value = false;
});
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="title"
    :description="
      props.target?.kind === 'term'
        ? `${props.target.year.name}: ${props.target.year.startDate} to ${props.target.year.endDate}`
        : undefined
    "
  >
    <form id="period-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="period-form-error">
        {{ save.error.value }}
      </AppAlert>
      <div class="grid gap-4" :class="{ 'sm:grid-cols-[1fr_7rem]': isTerm }">
        <AppInput
          v-model="name"
          v-bind="nameAttrs"
          label="Name"
          :placeholder="isTerm ? 'e.g. Term 1' : 'e.g. 2026'"
          autocomplete="off"
          data-autofocus
          required
          :error="errors.name"
        />
        <AppInput
          v-if="isTerm"
          v-model="sequence"
          v-bind="sequenceAttrs"
          label="Position"
          inputmode="numeric"
          autocomplete="off"
          required
          :error="errors.sequence"
        />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="startDate"
          v-bind="startDateAttrs"
          type="date"
          label="Start date"
          required
          :error="errors.startDate"
        />
        <AppInput
          v-model="endDate"
          v-bind="endDateAttrs"
          type="date"
          label="End date"
          required
          :error="errors.endDate"
        />
      </div>
    </form>
    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="period-form" :loading="save.pending.value">
        {{ existing ? 'Save changes' : isTerm ? 'Add term' : 'Add academic year' }}
      </AppButton>
    </template>
  </AppModal>
</template>
