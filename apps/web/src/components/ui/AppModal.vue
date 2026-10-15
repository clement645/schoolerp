<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { X } from '@lucide/vue';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    size?: ModalSize;
    /** When false, Escape and backdrop clicks do not close the dialog. */
    dismissible?: boolean;
  }>(),
  { size: 'md', dismissible: true },
);

const open = defineModel<boolean>('open', { required: true });

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const titleId = useId();
const descriptionId = useId();
const panel = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;
let previousOverflow = '';

function close(): void {
  open.value = false;
}

function dismiss(): void {
  if (props.dismissible) close();
}

/** Keeps Tab / Shift+Tab cycling inside the dialog. */
function trapFocus(event: KeyboardEvent): void {
  const focusable = panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE);
  if (!focusable || focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

function restore(): void {
  document.body.style.overflow = previousOverflow;
  const opener = previouslyFocused;
  // Captured now: this dialog's element lingers in the page while it fades
  // out, after the reference to it has already been cleared.
  const closing = panel.value;
  previouslyFocused = null;
  opener?.focus();
  // The control that opened this dialog may be gone by now — the action it
  // offered has been carried out. Focus then moves to the dialog underneath,
  // so the keyboard (Escape included) keeps working there.
  void nextTick(() => {
    if (opener && document.activeElement === opener) return;
    const others = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
    ].filter((dialog) => dialog !== closing);
    others[others.length - 1]?.focus();
  });
}

watch(
  open,
  async (isOpen, wasOpen) => {
    if (isOpen) {
      previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      await nextTick();
      // Content can nominate its starting point with `data-autofocus`;
      // otherwise the dialog itself takes focus so nothing is pre-activated.
      (panel.value?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.value)?.focus();
    } else if (wasOpen) {
      restore();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (open.value) restore();
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4"
        data-testid="modal-backdrop"
        @click.self="dismiss"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="props.description ? descriptionId : undefined"
          tabindex="-1"
          class="bg-surface shadow-overlay rounded-t-card sm:rounded-card flex max-h-[90vh] w-full flex-col outline-none"
          :class="SIZE_CLASS[props.size]"
          @keydown.esc.stop="dismiss"
          @keydown.tab="trapFocus"
        >
          <header class="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <h2 :id="titleId" class="text-base leading-tight font-semibold">{{ props.title }}</h2>
              <p v-if="props.description" :id="descriptionId" class="text-fg-muted mt-1 text-sm">
                {{ props.description }}
              </p>
            </div>
            <button
              v-if="props.dismissible"
              type="button"
              class="text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:outline-primary -m-1 rounded-md p-1 focus-visible:outline-2"
              aria-label="Close dialog"
              @click="close"
            >
              <X class="size-5" aria-hidden="true" />
            </button>
          </header>

          <div class="relative overflow-y-auto px-5 py-4">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="border-line flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end"
          >
            <slot name="footer" :close="close" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
