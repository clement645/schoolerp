<script setup lang="ts">
import { ref, useId } from 'vue';
import { onClickOutside } from '@vueuse/core';

const props = withDefaults(
  defineProps<{
    /** Accessible name of the trigger button. */
    label: string;
    align?: 'left' | 'right';
    /** Tailwind width utility for the panel. */
    widthClass?: string;
  }>(),
  { align: 'right', widthClass: 'w-56' },
);

const open = defineModel<boolean>('open', { default: false });

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panelId = useId();

function close(): void {
  open.value = false;
}

function closeAndRefocus(): void {
  if (!open.value) return;
  close();
  trigger.value?.focus();
}

onClickOutside(root, close);
</script>

<template>
  <div ref="root" class="relative" @keydown.esc="closeAndRefocus">
    <button
      ref="trigger"
      type="button"
      class="focus-visible:outline-primary rounded-control flex items-center focus-visible:outline-2 focus-visible:outline-offset-2"
      :aria-label="props.label"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      aria-haspopup="true"
      @click="open = !open"
    >
      <slot name="trigger" :open="open" />
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      leave-active-class="transition duration-75 ease-in"
      enter-from-class="scale-95 opacity-0"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="open"
        :id="panelId"
        class="bg-surface border-line shadow-overlay rounded-card absolute top-full z-40 mt-2 max-w-[calc(100vw-2rem)] origin-top border"
        :class="[props.widthClass, props.align === 'right' ? 'right-0' : 'left-0']"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>
