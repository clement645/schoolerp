<script setup lang="ts">
export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const props = withDefaults(
  defineProps<{
    variant?: BadgeVariant;
    /** Show a leading status dot. */
    dot?: boolean;
  }>(),
  { variant: 'neutral', dot: false },
);

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: 'bg-fg/5 text-fg-muted',
  primary: 'bg-primary-light text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
    :class="VARIANT_CLASS[props.variant]"
  >
    <span v-if="props.dot" class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    <slot />
  </span>
</template>
