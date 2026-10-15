<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { errorMessage } from '@/services/http';
import { zodForm } from '@/utils/zod-form';
import RolePicker from './RolePicker.vue';
import { usersApi, type Role } from './users.service';

const props = defineProps<{ availableRoles: readonly Role[] }>();

const open = defineModel<boolean>('open', { required: true });

const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name.').max(100),
  lastName: z.string().trim().min(1, 'Enter a last name.').max(100),
  email: z.email('Enter a valid email address.'),
  temporaryPassword: z
    .string()
    .min(12, 'Use at least 12 characters.')
    .max(128, 'Use at most 128 characters.'),
  roles: z.array(z.string()).min(1, 'Select at least one role.'),
});

const empty = () => ({
  firstName: '',
  lastName: '',
  email: '',
  temporaryPassword: '',
  roles: [] as string[],
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: empty(),
});
const onBlurOnly = { validateOnModelUpdate: false };
const [firstName, firstNameAttrs] = defineField('firstName', onBlurOnly);
const [lastName, lastNameAttrs] = defineField('lastName', onBlurOnly);
const [email, emailAttrs] = defineField('email', onBlurOnly);
const [temporaryPassword, passwordAttrs] = defineField('temporaryPassword', onBlurOnly);
const [roles] = defineField('roles');

const queryClient = useQueryClient();
const failure = ref<string | null>(null);

const { mutateAsync, isPending } = useMutation({
  mutationFn: usersApi.create,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
});

watch(open, (isOpen) => {
  if (isOpen) {
    failure.value = null;
    resetForm({ values: empty() });
  }
});

const submit = handleSubmit(async (values) => {
  failure.value = null;
  try {
    await mutateAsync(values);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(error);
  }
});
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Add user"
    description="The user signs in with the temporary password and must choose their own."
    size="lg"
  >
    <form id="create-user-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="failure" data-testid="create-user-error">{{ failure }}</AppAlert>

      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="firstName"
          v-bind="firstNameAttrs"
          label="First name"
          autocomplete="off"
          data-autofocus
          required
          :error="errors.firstName"
        />
        <AppInput
          v-model="lastName"
          v-bind="lastNameAttrs"
          label="Last name"
          autocomplete="off"
          required
          :error="errors.lastName"
        />
      </div>
      <AppInput
        v-model="email"
        v-bind="emailAttrs"
        type="email"
        label="Email address"
        autocomplete="off"
        required
        :error="errors.email"
      />
      <AppInput
        v-model="temporaryPassword"
        v-bind="passwordAttrs"
        label="Temporary password"
        hint="At least 12 characters. Share it with the user privately."
        autocomplete="off"
        required
        :error="errors.temporaryPassword"
      />
      <RolePicker v-model="roles" :roles="props.availableRoles" :error="errors.roles" />
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="isPending" @click="open = false">Cancel</AppButton>
      <AppButton type="submit" form="create-user-form" :loading="isPending">Add user</AppButton>
    </template>
  </AppModal>
</template>
