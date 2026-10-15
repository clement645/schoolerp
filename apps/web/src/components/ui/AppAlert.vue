<script setup lang="ts">
import { CircleCheck, Info, TriangleAlert } from '@lucide/vue';

export type AlertTone = 'danger' | 'success' | 'info';

const props = withDefaults(defineProps<{ tone?: AlertTone; title?: string }>(), {
  tone: 'danger',
});

const TONE_CLASS: Record<AlertTone, string> = {
  danger: 'border-danger/30 bg-danger/5 text-danger',
  success: 'border-success/30 bg-success/5 text-success',
  info: 'border-info/30 bg-info/5 text-info',
};

const ICON = { danger: TriangleAlert, success: CircleCheck, info: Info } as const;
</script>

<template>
  <div
    class="rounded-control flex items-start gap-2.5 border px-3.5 py-3 text-sm"
    :class="TONE_CLASS[props.tone]"
    :role="props.tone === 'danger' ? 'alert' : 'status'"
  >
    <component :is="ICON[props.tone]" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div class="text-fg min-w-0">
      <p v-if="props.title" class="font-medium">{{ props.title }}</p>
      <slot />
    </div>
  </div>
</template>
