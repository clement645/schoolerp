<script setup lang="ts">
import type { Component } from 'vue';

export type StatTone = 'primary' | 'info' | 'success' | 'warning' | 'danger';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    icon: Component;
    tone?: StatTone;
    /** A short line under the value, e.g. what it is compared with. */
    hint?: string;
  }>(),
  { tone: 'primary' },
);

const TONE_CLASS: Record<StatTone, string> = {
  primary: 'bg-primary-light text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/10 text-danger',
};
</script>

<template>
  <div class="bg-surface border-line rounded-card shadow-card flex items-center gap-3 border p-4">
    <span
      class="flex size-10 shrink-0 items-center justify-center rounded-lg"
      :class="TONE_CLASS[props.tone]"
    >
      <component :is="props.icon" class="size-5" aria-hidden="true" />
    </span>
    <div class="min-w-0">
      <p class="text-fg-muted truncate text-xs font-medium">{{ props.label }}</p>
      <p class="text-fg text-xl leading-tight font-semibold tabular-nums">{{ props.value }}</p>
      <p v-if="props.hint" class="text-fg-muted truncate text-xs">{{ props.hint }}</p>
    </div>
  </div>
</template>
