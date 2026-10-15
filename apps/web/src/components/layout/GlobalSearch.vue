<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useEventListener } from '@vueuse/core';
import { CornerDownLeft, Search } from '@lucide/vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { searchNavigation, type ResolvedNavigationGroup } from '@/navigation/navigation';

const props = defineProps<{
  groups: readonly ResolvedNavigationGroup[];
}>();

const router = useRouter();
const open = ref(false);
const query = ref('');
const activeIndex = ref(0);

const results = computed(() => searchNavigation(props.groups, query.value));

watch(results, () => {
  activeIndex.value = 0;
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  query.value = '';
  activeIndex.value = 0;
});

// Ctrl+K / ⌘K opens search from anywhere in the application.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    open.value = true;
  }
});

function move(step: number): void {
  const count = results.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + step + count) % count;
}

async function go(routeName: string): Promise<void> {
  open.value = false;
  await router.push({ name: routeName });
}

function goToActive(): void {
  const target = results.value[activeIndex.value];
  if (target) void go(target.routeName);
}
</script>

<template>
  <button
    type="button"
    class="border-line bg-surface-muted text-fg-muted hover:border-primary/40 focus-visible:outline-primary rounded-control flex h-10 w-full max-w-md items-center gap-2 border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    aria-label="Search"
    aria-haspopup="dialog"
    data-testid="global-search-trigger"
    @click="open = true"
  >
    <Search class="size-4 shrink-0" aria-hidden="true" />
    <span class="truncate">Search…</span>
    <kbd
      class="border-line bg-surface ml-auto hidden rounded border px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium sm:inline"
    >
      Ctrl K
    </kbd>
  </button>

  <AppModal
    v-model:open="open"
    title="Search"
    description="Jump to any section of the application."
    size="lg"
  >
    <div class="relative">
      <Search
        class="text-fg-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        v-model="query"
        data-autofocus
        type="search"
        class="form-control pl-9"
        placeholder="Search sections…"
        aria-label="Search sections"
        role="combobox"
        aria-expanded="true"
        aria-controls="global-search-results"
        :aria-activedescendant="
          results.length > 0 ? `global-search-option-${activeIndex}` : undefined
        "
        autocomplete="off"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="goToActive"
      />
    </div>

    <ul
      v-if="results.length > 0"
      id="global-search-results"
      class="relative mt-3 max-h-72 space-y-0.5 overflow-y-auto"
      role="listbox"
      aria-label="Search results"
    >
      <li
        v-for="(result, index) in results"
        :id="`global-search-option-${index}`"
        :key="result.routeName"
        role="option"
        :aria-selected="index === activeIndex"
        class="rounded-control flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
        :class="index === activeIndex ? 'bg-primary-light text-primary' : 'hover:bg-surface-muted'"
        @mousemove="activeIndex = index"
        @click="go(result.routeName)"
      >
        <component :is="result.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span class="font-medium">{{ result.label }}</span>
        <span class="text-fg-muted text-xs">{{ result.groupLabel }}</span>
        <CornerDownLeft
          v-if="index === activeIndex"
          class="ml-auto size-3.5 opacity-60"
          aria-hidden="true"
        />
      </li>
    </ul>

    <AppEmptyState
      v-else
      id="global-search-results"
      :icon="Search"
      title="No matching sections"
      :description="`Nothing matches “${query}”. Try a different term.`"
    />
  </AppModal>
</template>
