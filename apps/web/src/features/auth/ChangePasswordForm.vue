<script setup lang="ts">
import { ref } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { zodForm } from '@/utils/zod-form';

const emit = defineEmits<{ changed: [] }>();

const auth = useAuthStore();

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string().min(1, 'Re-enter your new password.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  });

const { defineField, handleSubmit, errors, isSubmitting, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
});
const onBlurOnly = { validateOnModelUpdate: false };
const [currentPassword, currentAttrs] = defineField('currentPassword', onBlurOnly);
const [newPassword, newAttrs] = defineField('newPassword', onBlurOnly);
const [confirmPassword, confirmAttrs] = defineField('confirmPassword', onBlurOnly);

const failure = ref<string | null>(null);

const submit = handleSubmit(async (values) => {
  failure.value = null;
  try {
    await auth.changePassword(values.currentPassword, values.newPassword);
    resetForm();
    emit('changed');
  } catch (error) {
    failure.value = errorMessage(error);
  }
});
</script>

<template>
  <form class="space-y-5" novalidate @submit="submit">
    <AppAlert v-if="failure" data-testid="change-password-error">{{ failure }}</AppAlert>

    <!-- Lets password managers associate the new password with the account. -->
    <input
      type="text"
      class="sr-only"
      autocomplete="username"
      :value="auth.user?.email"
      tabindex="-1"
      aria-hidden="true"
      readonly
    />

    <AppInput
      v-model="currentPassword"
      v-bind="currentAttrs"
      type="password"
      label="Current password"
      autocomplete="current-password"
      required
      :error="errors.currentPassword"
    />
    <AppInput
      v-model="newPassword"
      v-bind="newAttrs"
      type="password"
      label="New password"
      autocomplete="new-password"
      hint="At least 12 characters. A phrase of several words works well."
      required
      :error="errors.newPassword"
    />
    <AppInput
      v-model="confirmPassword"
      v-bind="confirmAttrs"
      type="password"
      label="Confirm new password"
      autocomplete="new-password"
      required
      :error="errors.confirmPassword"
    />

    <AppButton type="submit" :loading="isSubmitting">Change password</AppButton>
  </form>
</template>
