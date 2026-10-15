<script setup lang="ts">
import { computed, watch } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import type { GradingScheme } from '@/features/school-config/config.service';
import { zodForm } from '@/utils/zod-form';
import { classesApi, type SchoolClass } from './classes.service';

/** Select value meaning "follow the school's default scheme". */
const SCHOOL_DEFAULT = 'default';

const props = defineProps<{
  /** The class being edited, or `null` to create one. */
  schoolClass: SchoolClass | null;
  schemes: readonly GradingScheme[];
}>();
const open = defineModel<boolean>('open', { required: true });

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the class name.').max(50),
  level: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, 'Enter a whole number from 0 to 99.'),
  gradingSchemeId: z.string(),
  isActive: z.boolean(),
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { name: '', level: '', gradingSchemeId: SCHOOL_DEFAULT, isActive: true },
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [level, levelAttrs] = defineField('level', onBlurOnly);
const [gradingSchemeId] = defineField('gradingSchemeId');
const [isActive] = defineField('isActive');

const editing = computed(() => props.schoolClass !== null);
const schemeOptions = computed(() => {
  const fallback = props.schemes.find((scheme) => scheme.isDefault);
  return [
    {
      value: SCHOOL_DEFAULT,
      label: fallback ? `School default (${fallback.name})` : 'School default',
    },
    ...props.schemes.map((scheme) => ({ value: scheme.id, label: scheme.name })),
  ];
});

const save = useSaveAction((values: z.output<typeof schema>) => {
  const input = {
    name: values.name,
    level: Number(values.level),
    gradingSchemeId: values.gradingSchemeId === SCHOOL_DEFAULT ? null : values.gradingSchemeId,
  };
  return props.schoolClass
    ? classesApi.update(props.schoolClass.id, { ...input, isActive: values.isActive })
    : classesApi.create(input);
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  resetForm({
    values: {
      name: props.schoolClass?.name ?? '',
      level: props.schoolClass ? String(props.schoolClass.level) : '',
      gradingSchemeId: props.schoolClass?.gradingScheme?.id ?? SCHOOL_DEFAULT,
      isActive: props.schoolClass?.isActive ?? true,
    },
  });
});

const submit = handleSubmit(async (values) => {
  if (await save.run(values)) open.value = false;
});
</script>

<template>
  <AppModal v-model:open="open" :title="editing ? 'Edit class' : 'Add class'">
    <form id="class-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="class-form-error">
        {{ save.error.value }}
      </AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <AppInput
          v-model="name"
          v-bind="nameAttrs"
          label="Class name"
          placeholder="e.g. Grade 7"
          autocomplete="off"
          data-autofocus
          required
          :error="errors.name"
        />
        <AppInput
          v-model="level"
          v-bind="levelAttrs"
          label="Level"
          placeholder="7"
          inputmode="numeric"
          autocomplete="off"
          required
          :error="errors.level"
        />
      </div>
      <p class="text-fg-muted -mt-2 text-xs">
        The level orders classes from youngest to oldest, and is the order learners are promoted in.
      </p>
      <AppSelect
        v-model="gradingSchemeId"
        :options="schemeOptions"
        label="Grading scheme"
        hint="Classes can be graded differently, e.g. competency levels for junior grades."
      />
      <label v-if="editing" class="flex items-start gap-3 text-sm">
        <input v-model="isActive" type="checkbox" class="accent-primary mt-0.5 size-4" />
        <span>
          <span class="block font-medium">Active</span>
          <span class="text-fg-muted block text-xs">
            Inactive classes keep their history but are hidden from day-to-day work.
          </span>
        </span>
      </label>
    </form>
    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="class-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add class' }}
      </AppButton>
    </template>
  </AppModal>
</template>
