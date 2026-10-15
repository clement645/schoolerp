<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** Any CSS length, e.g. `8rem` or `60%`. */
    width?: string;
    height?: string;
    circle?: boolean;
  }>(),
  { width: '100%', height: '1rem', circle: false },
);
</script>

<template>
  <span
    class="bg-fg/10 block animate-pulse"
    :class="props.circle ? 'rounded-full' : 'rounded-md'"
    :style="{ width: props.width, height: props.height }"
    aria-hidden="true"
  />
</template>
