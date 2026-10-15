<script setup lang="ts">
import type { Component } from 'vue';
import { Inbox } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** Defaults to an inbox icon. */
    icon?: Component;
    /** `danger` presents the state as a failure rather than "nothing here". */
    tone?: 'neutral' | 'danger';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <div class="flex flex-col items-center px-6 py-10 text-center">
    <span
      class="flex size-12 items-center justify-center rounded-full"
      :class="
        props.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary-light text-primary'
      "
    >
      <component :is="props.icon ?? Inbox" class="size-6" aria-hidden="true" />
    </span>
    <p class="mt-4 text-sm font-semibold">{{ props.title }}</p>
    <p v-if="props.description" class="text-fg-muted mt-1 max-w-sm text-sm">
      {{ props.description }}
    </p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </div>
</template>
