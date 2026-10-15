<script setup lang="ts">
import type { Component } from 'vue';

export type ServiceState = 'up' | 'down' | 'unknown';

const props = defineProps<{
  name: string;
  description: string;
  icon: Component;
  state: ServiceState;
  latencyMs?: number | null;
}>();

const STATE_LABEL: Record<ServiceState, string> = {
  up: 'Operational',
  down: 'Unavailable',
  unknown: 'Unknown',
};

const STATE_CLASS: Record<ServiceState, string> = {
  up: 'bg-success/10 text-success',
  down: 'bg-danger/10 text-danger',
  unknown: 'bg-line text-fg-muted',
};

const DOT_CLASS: Record<ServiceState, string> = {
  up: 'bg-success',
  down: 'bg-danger',
  unknown: 'bg-fg-muted',
};
</script>

<template>
  <article
    class="bg-surface border-line rounded-xl border p-5 shadow-sm"
    :data-testid="`service-${props.name.toLowerCase()}`"
  >
    <div class="flex items-start justify-between gap-3">
      <span
        class="bg-primary-light text-primary flex size-10 shrink-0 items-center justify-center rounded-lg"
      >
        <component :is="props.icon" class="size-5" aria-hidden="true" />
      </span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        :class="STATE_CLASS[props.state]"
        data-testid="service-state"
      >
        <span class="size-1.5 rounded-full" :class="DOT_CLASS[props.state]" aria-hidden="true" />
        {{ STATE_LABEL[props.state] }}
      </span>
    </div>

    <h3 class="mt-4 text-sm font-semibold">{{ props.name }}</h3>
    <p class="text-fg-muted mt-1 text-sm">{{ props.description }}</p>
    <p class="text-fg-muted mt-3 text-xs tabular-nums">
      <template v-if="props.latencyMs != null">Responded in {{ props.latencyMs }} ms</template>
      <template v-else>No response time available</template>
    </p>
  </article>
</template>
