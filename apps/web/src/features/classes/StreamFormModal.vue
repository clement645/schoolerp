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
import { classesApi, type SchoolClass, type Stream } from './classes.service';

const props = defineProps<{
  /** The class the stream belongs to. */
  schoolClass: SchoolClass | null;
  /** The stream being edited, or `null` to add one. */
  stream: Stream | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the stream name.').max(50),
  capacity: z
    .string()
    .trim()
    .regex(/^([1-9]\d{0,3})?$/, 'Enter a whole number, or leave blank.'),
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { name: '', capacity: '' },
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [capacity, capacityAttrs] = defineField('capacity', onBlurOnly);

const editing = computed(() => props.stream !== null);
const save = useSaveAction(async (values: z.output<typeof schema>) => {
  const input = { name: values.name, capacity: values.capacity ? Number(values.capacity) : null };
  if (props.stream) return classesApi.updateStream(props.stream.id, input);
  if (props.schoolClass) return classesApi.createStream(props.schoolClass.id, input);
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  resetForm({
    values: {
      name: props.stream?.name ?? '',
      capacity: props.stream?.capacity ? String(props.stream.capacity) : '',
    },
  });
});

const submit = handleSubmit(async (values) => {
  if (await save.run(values)) open.value = false;
});
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="editing ? 'Edit stream' : 'Add stream'"
    :description="props.schoolClass?.name"
    size="sm"
  >
    <form id="stream-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="stream-form-error">
        {{ save.error.value }}
      </AppAlert>
      <AppInput
        v-model="name"
        v-bind="nameAttrs"
        label="Stream name"
        placeholder="e.g. East"
        autocomplete="off"
        data-autofocus
        required
        :error="errors.name"
      />
      <AppInput
        v-model="capacity"
        v-bind="capacityAttrs"
        label="Capacity"
        hint="Optional. The number of learners the stream can hold."
        inputmode="numeric"
        autocomplete="off"
        :error="errors.capacity"
      />
    </form>
    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="stream-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add stream' }}
      </AppButton>
    </template>
  </AppModal>
</template>
