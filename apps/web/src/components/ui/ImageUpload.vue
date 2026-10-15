<script setup lang="ts">
import { ref, type Component } from 'vue';
import { ImagePlus } from '@lucide/vue';
import AppButton from './AppButton.vue';

const props = withDefaults(
  defineProps<{
    /** Object URL of the current image, or `null` to show the placeholder. */
    src: string | null;
    /** What the image is, e.g. "photo" or "logo". Used in labels. */
    noun: string;
    /** Icon shown when there is no image. */
    placeholder?: Component;
    shape?: 'circle' | 'square';
    canManage?: boolean;
    busy?: boolean;
    /** Tailwind size utility for the preview. */
    sizeClass?: string;
  }>(),
  { shape: 'circle', canManage: false, busy: false, sizeClass: 'size-14' },
);

const emit = defineEmits<{ select: [file: File]; remove: [] }>();

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

const problem = ref<string | null>(null);

function choose(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Allow choosing the same file again after an error.
  input.value = '';
  problem.value = null;
  if (!file) return;
  if (!ACCEPTED.includes(file.type)) {
    problem.value = 'Choose a JPEG, PNG or WebP image.';
  } else if (file.size > MAX_BYTES) {
    problem.value = 'The image must be 2 MB or smaller.';
  } else {
    emit('select', file);
  }
}
</script>

<template>
  <div class="flex items-center gap-4">
    <span
      class="bg-primary-light text-primary flex shrink-0 items-center justify-center overflow-hidden"
      :class="[props.sizeClass, props.shape === 'circle' ? 'rounded-full' : 'rounded-control']"
    >
      <img
        v-if="props.src"
        :src="props.src"
        :alt="`Current ${props.noun}`"
        class="size-full object-cover"
        data-testid="image-preview"
      />
      <component :is="props.placeholder ?? ImagePlus" v-else class="size-1/2" aria-hidden="true" />
    </span>

    <div v-if="props.canManage" class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <label
          class="border-line bg-surface hover:bg-surface-muted rounded-control focus-within:outline-primary inline-flex h-8 cursor-pointer items-center px-3 text-xs font-medium focus-within:outline-2 focus-within:outline-offset-2"
          :class="[{ 'pointer-events-none opacity-60': props.busy }, 'border']"
        >
          {{ props.src ? `Change ${props.noun}` : `Upload ${props.noun}` }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="sr-only"
            :aria-label="`Choose a ${props.noun}`"
            :disabled="props.busy"
            data-testid="image-input"
            @change="choose"
          />
        </label>
        <AppButton
          v-if="props.src"
          variant="ghost"
          size="sm"
          :disabled="props.busy"
          @click="emit('remove')"
        >
          Remove
        </AppButton>
      </div>
      <p v-if="problem" class="text-danger mt-1.5 text-xs" role="alert">{{ problem }}</p>
      <p v-else class="text-fg-muted mt-1.5 text-xs">JPEG, PNG or WebP, up to 2 MB.</p>
    </div>
  </div>
</template>
