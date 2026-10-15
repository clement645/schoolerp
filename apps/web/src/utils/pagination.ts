export type PageItem = number | 'ellipsis';

export function totalPages(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/**
 * Builds a compact page list such as `1 … 4 5 6 … 20`: the first and last
 * page, `siblings` pages on either side of the current one, and ellipses for
 * the gaps. A gap of exactly one page is shown as that page, not an ellipsis.
 */
export function buildPageItems(current: number, pages: number, siblings = 1): PageItem[] {
  if (pages <= 1) return [1];

  const page = Math.min(Math.max(current, 1), pages);
  const start = Math.max(2, page - siblings);
  const end = Math.min(pages - 1, page + siblings);
  const items: PageItem[] = [1];

  if (start === 3) items.push(2);
  else if (start > 3) items.push('ellipsis');

  for (let p = start; p <= end; p += 1) items.push(p);

  if (end === pages - 2) items.push(pages - 1);
  else if (end < pages - 2) items.push('ellipsis');

  items.push(pages);
  return items;
}

/** 1-based inclusive range of the rows on `page`, or `null` when empty. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } | null {
  if (total <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  if (from > total) return null;
  return { from, to: Math.min(page * pageSize, total) };
}
