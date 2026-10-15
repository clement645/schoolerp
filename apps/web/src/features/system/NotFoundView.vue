<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Compass } from '@lucide/vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';

const router = useRouter();
</script>

<template>
  <AppCard>
    <AppEmptyState
      :icon="Compass"
      title="Page not found"
      description="The page you are looking for does not exist or has been moved."
    >
      <AppButton @click="router.push({ name: 'home' })">Back to home</AppButton>
    </AppEmptyState>
  </AppCard>
</template>
