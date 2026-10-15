<script setup lang="ts">
import { ref } from 'vue';

export interface TabItem {
  id: string;
  label: string;
  /** A tab that exists in the product but cannot be opened yet. */
  disabled?: boolean;
  /** Short note shown beside a disabled tab, e.g. "Not available". */
  note?: string;
}

const props = defineProps<{
  tabs: readonly TabItem[];
  /** Accessible name for the group of tabs. */
  label: string;
}>();

/** Id of the selected tab. The panel is rendered by the parent. */
const selected = defineModel<string>({ required: true });

const buttons = ref<HTMLButtonElement[]>([]);

function move(step: number): void {
  const count = props.tabs.length;
  let index = props.tabs.findIndex((tab) => tab.id === selected.value);
  // Skip over tabs that cannot be opened.
  for (let attempt = 0; attempt < count; attempt += 1) {
    index = (index + step + count) % count;
    const next = props.tabs[index];
    if (next && !next.disabled) {
      selected.value = next.id;
      buttons.value[index]?.focus();
      return;
    }
  }
}
</script>

<template>
  <div
    class="border-line relative flex gap-1 overflow-x-auto border-b"
    role="tablist"
    :aria-label="props.label"
    @keydown.right.prevent="move(1)"
    @keydown.left.prevent="move(-1)"
  >
    <button
      v-for="tab in props.tabs"
      :id="`tab-${tab.id}`"
      :key="tab.id"
      ref="buttons"
      type="button"
      role="tab"
      :aria-selected="tab.id === selected"
      :aria-controls="`panel-${tab.id}`"
      :tabindex="tab.id === selected ? 0 : -1"
      :disabled="tab.disabled"
      class="focus-visible:outline-primary -mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2"
      :class="
        tab.id === selected
          ? 'border-primary text-primary'
          : tab.disabled
            ? 'text-fg-muted/60 cursor-not-allowed border-transparent'
            : 'text-fg-muted hover:text-fg border-transparent'
      "
      @click="selected = tab.id"
    >
      {{ tab.label }}
      <span
        v-if="tab.note"
        class="bg-fg/5 text-fg-muted ml-1.5 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide uppercase"
      >
        {{ tab.note }}
      </span>
    </button>
  </div>
</template>
