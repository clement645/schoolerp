<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { errorMessage } from '@/services/http';
import { zodForm } from '@/utils/zod-form';
import { TENANT_PLANS, tenantsApi } from './tenants.service';

const open = defineModel<boolean>('open', { required: true });

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the account name.').max(150),
  schoolName: z.string().trim().min(2, 'Enter the school name.').max(150),
  plan: z.string().min(1),
  adminFirstName: z.string().trim().min(1, 'Enter a first name.').max(100),
  adminLastName: z.string().trim().min(1, 'Enter a last name.').max(100),
  adminEmail: z.email('Enter a valid email address.'),
  temporaryPassword: z
    .string()
    .min(12, 'Use at least 12 characters.')
    .max(128, 'Use at most 128 characters.'),
});

const empty = () => ({
  name: '',
  schoolName: '',
  plan: 'STANDARD',
  adminFirstName: '',
  adminLastName: '',
  adminEmail: '',
  temporaryPassword: '',
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: empty(),
});
const onBlurOnly = { validateOnModelUpdate: false };
const [name, nameAttrs] = defineField('name', onBlurOnly);
const [schoolName, schoolNameAttrs] = defineField('schoolName', onBlurOnly);
const [plan] = defineField('plan');
const [adminFirstName, adminFirstNameAttrs] = defineField('adminFirstName', onBlurOnly);
const [adminLastName, adminLastNameAttrs] = defineField('adminLastName', onBlurOnly);
const [adminEmail, adminEmailAttrs] = defineField('adminEmail', onBlurOnly);
const [temporaryPassword, passwordAttrs] = defineField('temporaryPassword', onBlurOnly);

const queryClient = useQueryClient();
const failure = ref<string | null>(null);

const { mutateAsync, isPending } = useMutation({
  mutationFn: tenantsApi.create,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
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
    await mutateAsync({
      name: values.name,
      schoolName: values.schoolName,
      plan: values.plan,
      admin: {
        firstName: values.adminFirstName,
        lastName: values.adminLastName,
        email: values.adminEmail,
        temporaryPassword: values.temporaryPassword,
      },
    });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(error);
  }
});
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Add tenant"
    description="Creates the account, its first school and its school administrator."
    size="lg"
  >
    <form id="create-tenant-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="failure" data-testid="create-tenant-error">{{ failure }}</AppAlert>

      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="name"
          v-bind="nameAttrs"
          label="Account name"
          hint="The organisation that holds the subscription."
          autocomplete="off"
          data-autofocus
          required
          :error="errors.name"
        />
        <AppInput
          v-model="schoolName"
          v-bind="schoolNameAttrs"
          label="First school"
          autocomplete="off"
          required
          :error="errors.schoolName"
        />
      </div>
      <div class="sm:max-w-[calc(50%-0.5rem)]">
        <AppSelect v-model="plan" :options="TENANT_PLANS" label="Plan" required />
      </div>

      <fieldset class="border-line space-y-4 border-t pt-4">
        <legend class="text-sm font-semibold">School administrator</legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput
            v-model="adminFirstName"
            v-bind="adminFirstNameAttrs"
            label="First name"
            autocomplete="off"
            required
            :error="errors.adminFirstName"
          />
          <AppInput
            v-model="adminLastName"
            v-bind="adminLastNameAttrs"
            label="Last name"
            autocomplete="off"
            required
            :error="errors.adminLastName"
          />
        </div>
        <AppInput
          v-model="adminEmail"
          v-bind="adminEmailAttrs"
          type="email"
          label="Email address"
          autocomplete="off"
          required
          :error="errors.adminEmail"
        />
        <AppInput
          v-model="temporaryPassword"
          v-bind="passwordAttrs"
          label="Temporary password"
          hint="At least 12 characters. They must replace it at first sign-in."
          autocomplete="off"
          required
          :error="errors.temporaryPassword"
        />
      </fieldset>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="isPending" @click="open = false">Cancel</AppButton>
      <AppButton type="submit" form="create-tenant-form" :loading="isPending">
        Add tenant
      </AppButton>
    </template>
  </AppModal>
</template>
