<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { buildPageItems, pageRange, totalPages } from '@/utils/pagination';

const props = defineProps<{
  /** Total number of rows across all pages. */
  total: number;
  pageSize: number;
  disabled?: boolean;
}>();

/** Current page, 1-based. */
const page = defineModel<number>('page', { required: true });

const pages = computed(() => totalPages(props.total, props.pageSize));
const items = computed(() => buildPageItems(page.value, pages.value));
const range = computed(() => pageRange(page.value, props.pageSize, props.total));

function go(target: number): void {
  const next = Math.min(Math.max(target, 1), pages.value);
  if (next !== page.value) page.value = next;
}

// Colours are kept out of the shared base: two background utilities on one
// element resolve by stylesheet order, not by the order in the class list.
const NAV_BUTTON =
  'focus-visible:outline-primary inline-flex size-9 items-center justify-center rounded-control border text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const IDLE = 'border-line bg-surface hover:bg-surface-muted';
const CURRENT = 'border-primary bg-primary font-medium text-white';
</script>

<template>
  <nav class="flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
    <p class="text-fg-muted text-sm tabular-nums" data-testid="pagination-summary">
      <template v-if="range">
        Showing <span class="text-fg font-medium">{{ range.from }}–{{ range.to }}</span> of
        <span class="text-fg font-medium">{{ props.total }}</span>
      </template>
      <template v-else>No results</template>
    </p>

    <ul class="flex items-center gap-1">
      <li>
        <button
          type="button"
          :class="[NAV_BUTTON, IDLE]"
          :disabled="props.disabled || page <= 1"
          aria-label="Previous page"
          @click="go(page - 1)"
        >
          <ChevronLeft class="size-4" aria-hidden="true" />
        </button>
      </li>

      <li v-for="(item, index) in items" :key="`${item}-${index}`" class="hidden sm:block">
        <span v-if="item === 'ellipsis'" class="text-fg-muted px-2 text-sm" aria-hidden="true">
          …
        </span>
        <button
          v-else
          type="button"
          :class="[NAV_BUTTON, item === page ? CURRENT : IDLE]"
          :disabled="props.disabled"
          :aria-current="item === page ? 'page' : undefined"
          :aria-label="`Page ${item}`"
          @click="go(item)"
        >
          {{ item }}
        </button>
      </li>

      <li class="text-fg-muted px-2 text-sm tabular-nums sm:hidden">{{ page }} / {{ pages }}</li>

      <li>
        <button
          type="button"
          :class="[NAV_BUTTON, IDLE]"
          :disabled="props.disabled || page >= pages"
          aria-label="Next page"
          @click="go(page + 1)"
        >
          <ChevronRight class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </nav>
</template>
