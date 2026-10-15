<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
);

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark focus-visible:outline-primary',
  secondary: 'bg-primary-light text-primary hover:bg-primary/15 focus-visible:outline-primary',
  outline:
    'border border-line bg-surface text-fg hover:bg-surface-muted focus-visible:outline-primary',
  ghost: 'text-fg hover:bg-fg/5 focus-visible:outline-primary',
  danger: 'bg-danger text-white hover:bg-danger/90 focus-visible:outline-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
};
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading || undefined"
    class="rounded-control inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    :class="[VARIANT_CLASS[props.variant], SIZE_CLASS[props.size], { 'w-full': props.block }]"
  >
    <LoaderCircle v-if="props.loading" class="size-4 animate-spin" aria-hidden="true" />
    <slot v-else name="icon" />
    <slot />
  </button>
</template>
