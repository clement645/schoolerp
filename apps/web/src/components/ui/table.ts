export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  key: string;
  direction: SortDirection;
}

export interface TableColumn {
  /** Property of the row this column reads, and the `cell-<key>` slot name. */
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  /** Any CSS width, e.g. `12rem`. */
  width?: string;
}

/** Cycles a column through ascending → descending → unsorted. */
export function nextSort(current: TableSort | null, key: string): TableSort | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}
