<!-- Shown on its own, outside the application shell, while a user still has
     the temporary password an administrator gave them. -->
<script setup lang="ts">
import { useRouter } from 'vue-router';
import AuthLayout from '@/components/layout/AuthLayout.vue';
import AppButton from '@/components/ui/AppButton.vue';
import { useAuthStore } from '@/stores/auth';
import ChangePasswordForm from './ChangePasswordForm.vue';

const auth = useAuthStore();
const router = useRouter();

async function signOut(): Promise<void> {
  await auth.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <AuthLayout
    title="Choose a new password"
    subtitle="You signed in with a temporary password. Replace it to continue."
  >
    <ChangePasswordForm @changed="router.replace({ name: 'home' })" />
    <div class="border-line mt-8 border-t pt-4">
      <AppButton variant="ghost" size="sm" @click="signOut">Sign out instead</AppButton>
    </div>
  </AuthLayout>
</template>
