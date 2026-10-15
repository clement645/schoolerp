<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    /** Remove body padding, e.g. when the card wraps a full-bleed table. */
    flush?: boolean;
  }>(),
  { flush: false },
);
</script>

<template>
  <section class="bg-surface border-line rounded-card shadow-card border">
    <header
      v-if="props.title || $slots.header || $slots.actions"
      class="border-line flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
    >
      <slot name="header">
        <div>
          <h3 class="text-base leading-tight font-semibold">{{ props.title }}</h3>
          <p v-if="props.subtitle" class="text-fg-muted mt-0.5 text-sm">{{ props.subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>

    <div :class="{ 'p-5': !props.flush }">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-line border-t px-5 py-3">
      <slot name="footer" />
    </footer>
  </section>
</template>
