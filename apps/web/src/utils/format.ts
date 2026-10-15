const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Formats an ISO timestamp for display, or a dash when there is none. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

/** Only same-site paths are valid post-sign-in destinations. */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // "//host" and "/\host" are protocol-relative URLs, i.e. other sites.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

const calendarDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

/** Formats a `YYYY-MM-DD` calendar date without shifting it across time zones. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : calendarDate.format(date);
}

/** Today as `YYYY-MM-DD` in the user's own time zone. */
export function todayIso(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Age in whole years on a given day (today by default). */
export function ageOn(dateOfBirth: string, on = todayIso()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const years = Number(on.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return on.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** Hands a generated file to the browser to save. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A `YYYY-MM-DD` date moved by a number of days (negative for earlier). */
export function addDaysIso(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

const dayAndMonth = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

/** `5 Oct` — a compact label for chart axes and table columns. */
export const formatDayMonth = (value: string): string =>
  dayAndMonth.format(new Date(`${value}T00:00:00Z`));

/** `Mon` — the weekday of a calendar date. */
export const formatWeekday = (value: string): string =>
  weekday.format(new Date(`${value}T00:00:00Z`));
