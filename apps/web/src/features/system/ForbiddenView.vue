<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ShieldAlert } from '@lucide/vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';

const router = useRouter();
</script>

<template>
  <AppCard>
    <AppEmptyState
      :icon="ShieldAlert"
      tone="danger"
      title="You don't have access to this page"
      description="Your role does not include this section. Ask your school administrator if you need it."
    >
      <AppButton @click="router.push({ name: 'home' })">Back to home</AppButton>
    </AppEmptyState>
  </AppCard>
</template>
