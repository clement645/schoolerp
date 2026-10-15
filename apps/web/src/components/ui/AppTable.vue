<script setup lang="ts" generic="T extends object">
import { ArrowDown, ArrowUp, ChevronsUpDown, TriangleAlert } from '@lucide/vue';
import AppEmptyState from './AppEmptyState.vue';
import AppSkeleton from './AppSkeleton.vue';
import { nextSort, type TableColumn, type TableSort } from './table';

const props = withDefaults(
  defineProps<{
    columns: readonly TableColumn[];
    rows: readonly T[];
    /** Returns a stable unique key for a row. */
    rowKey: (row: T) => string | number;
    /** Accessible name announced for the table. */
    caption: string;
    loading?: boolean;
    /** Message for a failed load; replaces the rows with an error state. */
    error?: string | null;
    emptyTitle?: string;
    emptyDescription?: string;
    skeletonRows?: number;
  }>(),
  { emptyTitle: 'Nothing to show yet', skeletonRows: 5 },
);

/**
 * Sorting is controlled: the table reports the requested sort and the owner
 * (usually a server-side query) supplies rows in that order.
 */
const sort = defineModel<TableSort | null>('sort', { default: null });

defineSlots<
  {
    /** Shown in place of the default empty state. */
    empty?: () => unknown;
    /** Shown inside the default error state, e.g. a retry button. */
    'error-action'?: () => unknown;
  } & {
    [K in `cell-${string}`]?: (props: { row: T; value: unknown }) => unknown;
  }
>();

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function valueOf(row: T, key: string): unknown {
  return Reflect.get(row, key);
}

function display(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function ariaSort(column: TableColumn): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable) return undefined;
  if (sort.value?.key !== column.key) return 'none';
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}
</script>

<template>
  <!-- Wide tables scroll horizontally inside their container on small screens. -->
  <div class="relative overflow-x-auto" :aria-busy="props.loading || undefined">
    <table class="w-full min-w-max border-collapse text-sm">
      <caption class="sr-only">
        {{
          props.caption
        }}
      </caption>
      <thead>
        <tr class="border-line bg-surface-muted border-b">
          <th
            v-for="column in props.columns"
            :key="column.key"
            scope="col"
            class="text-fg-muted px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap uppercase"
            :class="ALIGN_CLASS[column.align ?? 'left']"
            :style="column.width ? { width: column.width } : undefined"
            :aria-sort="ariaSort(column)"
          >
            <button
              v-if="column.sortable"
              type="button"
              class="hover:text-fg focus-visible:outline-primary inline-flex items-center gap-1 rounded uppercase focus-visible:outline-2 focus-visible:outline-offset-2"
              @click="sort = nextSort(sort, column.key)"
            >
              {{ column.label }}
              <ArrowUp
                v-if="sort?.key === column.key && sort.direction === 'asc'"
                class="size-3.5"
                aria-hidden="true"
              />
              <ArrowDown v-else-if="sort?.key === column.key" class="size-3.5" aria-hidden="true" />
              <ChevronsUpDown v-else class="size-3.5 opacity-50" aria-hidden="true" />
            </button>
            <template v-else>{{ column.label }}</template>
          </th>
        </tr>
      </thead>

      <tbody v-if="props.loading" data-testid="table-loading">
        <tr v-for="n in props.skeletonRows" :key="n" class="border-line border-b last:border-b-0">
          <td v-for="column in props.columns" :key="column.key" class="px-4 py-3.5">
            <AppSkeleton :width="n % 2 === 0 ? '60%' : '80%'" />
          </td>
        </tr>
      </tbody>

      <tbody v-else-if="props.error">
        <tr>
          <td :colspan="props.columns.length">
            <AppEmptyState
              tone="danger"
              :icon="TriangleAlert"
              title="Unable to load data"
              :description="props.error"
              role="alert"
            >
              <slot name="error-action" />
            </AppEmptyState>
          </td>
        </tr>
      </tbody>

      <tbody v-else-if="props.rows.length === 0">
        <tr>
          <td :colspan="props.columns.length">
            <slot name="empty">
              <AppEmptyState :title="props.emptyTitle" :description="props.emptyDescription" />
            </slot>
          </td>
        </tr>
      </tbody>

      <tbody v-else>
        <tr
          v-for="row in props.rows"
          :key="props.rowKey(row)"
          class="border-line hover:bg-surface-muted/60 border-b transition-colors last:border-b-0"
        >
          <td
            v-for="column in props.columns"
            :key="column.key"
            class="px-4 py-3"
            :class="ALIGN_CLASS[column.align ?? 'left']"
          >
            <slot :name="`cell-${column.key}`" :row="row" :value="valueOf(row, column.key)">
              {{ display(valueOf(row, column.key)) }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
