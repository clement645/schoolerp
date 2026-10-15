<script setup lang="ts">
import { ref } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppCard from '@/components/ui/AppCard.vue';
import { useAuthStore } from '@/stores/auth';
import ChangePasswordForm from './ChangePasswordForm.vue';

const auth = useAuthStore();
const changed = ref(false);
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>My account</h1>
      <p class="text-fg-muted mt-1 text-sm">Your profile and sign-in details.</p>
    </header>

    <AppCard title="Profile">
      <dl class="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-fg-muted">Name</dt>
          <dd class="mt-0.5 font-medium">{{ auth.displayName }}</dd>
        </div>
        <div>
          <dt class="text-fg-muted">Email</dt>
          <dd class="mt-0.5 font-medium break-all">{{ auth.user?.email }}</dd>
        </div>
        <div>
          <dt class="text-fg-muted">Role</dt>
          <dd class="mt-0.5 font-medium">{{ auth.roleLabel }}</dd>
        </div>
        <div v-if="auth.user?.tenant">
          <dt class="text-fg-muted">School account</dt>
          <dd class="mt-0.5 font-medium">{{ auth.user.tenant.name }}</dd>
        </div>
      </dl>
    </AppCard>

    <AppCard
      title="Change password"
      subtitle="Changing your password signs you out on every other device."
    >
      <div class="max-w-md space-y-5">
        <AppAlert v-if="changed" tone="success" data-testid="password-changed">
          Your password has been changed.
        </AppAlert>
        <ChangePasswordForm @changed="changed = true" />
      </div>
    </AppCard>
  </div>
</template>
