<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AuthLayout from '@/components/layout/AuthLayout.vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { safeRedirectPath } from '@/utils/format';
import { zodForm } from '@/utils/zod-form';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const schema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const { defineField, handleSubmit, errors, isSubmitting } = useForm({
  validationSchema: zodForm(schema),
  initialValues: { email: '', password: '' },
});
// Validate when leaving a field or submitting, not on every keystroke.
const onBlurOnly = { validateOnModelUpdate: false };
const [email, emailAttrs] = defineField('email', onBlurOnly);
const [password, passwordAttrs] = defineField('password', onBlurOnly);

const failure = ref<string | null>(null);

const submit = handleSubmit(async (values) => {
  failure.value = null;
  try {
    await auth.login(values.email, values.password);
    await router.replace(safeRedirectPath(route.query.redirect) ?? { name: 'home' });
  } catch (error) {
    failure.value = errorMessage(error);
  }
});
</script>

<template>
  <AuthLayout title="Sign in" subtitle="Welcome back. Enter your details to continue.">
    <form class="space-y-5" novalidate @submit="submit">
      <AppAlert v-if="failure" data-testid="login-error">{{ failure }}</AppAlert>
      <AppAlert v-else-if="route.query.reason === 'expired'" tone="info">
        Your session has expired. Please sign in again.
      </AppAlert>

      <AppInput
        v-model="email"
        v-bind="emailAttrs"
        type="email"
        label="Email address"
        placeholder="you@school.example"
        autocomplete="username"
        required
        :error="errors.email"
      />
      <AppInput
        v-model="password"
        v-bind="passwordAttrs"
        type="password"
        label="Password"
        autocomplete="current-password"
        required
        :error="errors.password"
      />

      <AppButton type="submit" block size="lg" :loading="isSubmitting">Sign in</AppButton>

      <p class="text-fg-muted text-center text-xs">
        Forgotten your password? Ask your school administrator to reset it.
      </p>
    </form>
  </AuthLayout>
</template>
