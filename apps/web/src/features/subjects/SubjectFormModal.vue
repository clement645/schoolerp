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
import { subjectsApi, type Subject } from './subjects.service';

const props = defineProps<{
  /** The subject being edited, or `null` to create one. */
  subject: Subject | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the subject name.').max(100),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/-]{0,11}$/, 'Use 1–12 letters, digits, "-" or "/".'),
  isActive: z.boolean(),
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { name: '', code: '', isActive: true },
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [code, codeAttrs] = defineField('code', onBlurOnly);
const [isActive] = defineField('isActive');

const editing = computed(() => props.subject !== null);
const save = useSaveAction((values: z.output<typeof schema>) =>
  props.subject
    ? subjectsApi.update(props.subject.id, values)
    : subjectsApi.create({ name: values.name, code: values.code }),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  resetForm({
    values: {
      name: props.subject?.name ?? '',
      code: props.subject?.code ?? '',
      isActive: props.subject?.isActive ?? true,
    },
  });
});

const submit = handleSubmit(async (values) => {
  if (await save.run(values)) open.value = false;
});
</script>

<template>
  <AppModal v-model:open="open" :title="editing ? 'Edit subject' : 'Add subject'">
    <form id="subject-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="subject-form-error">
        {{ save.error.value }}
      </AppAlert>
      <AppInput
        v-model="name"
        v-bind="nameAttrs"
        label="Subject name"
        placeholder="e.g. Mathematics"
        autocomplete="off"
        data-autofocus
        required
        :error="errors.name"
      />
      <AppInput
        v-model="code"
        v-bind="codeAttrs"
        label="Code"
        placeholder="e.g. MAT"
        hint="A short code printed on mark sheets and reports."
        autocomplete="off"
        required
        :error="errors.code"
      />
      <label v-if="editing" class="flex items-start gap-3 text-sm">
        <input v-model="isActive" type="checkbox" class="accent-primary mt-0.5 size-4" />
        <span>
          <span class="block font-medium">Active</span>
          <span class="text-fg-muted block text-xs">
            Inactive subjects stay on existing records but cannot be added to classes.
          </span>
        </span>
      </label>
    </form>
    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="subject-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add subject' }}
      </AppButton>
    </template>
  </AppModal>
</template>
