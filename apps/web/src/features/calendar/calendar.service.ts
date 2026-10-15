import { z } from 'zod';
import { calendarEventSchema, type CalendarEvent } from '@/features/dashboard/dashboard.service';
import { apiRequest, apiSend } from '@/services/http';

export interface EventInput {
  title: string;
  description: string | null;
  category: CalendarEvent['category'];
  visibility: CalendarEvent['visibility'];
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
}

export const calendarApi = {
  list: (from: string, to: string): Promise<CalendarEvent[]> =>
    apiRequest(
      { method: 'GET', url: '/calendar/events', params: { from, to } },
      z.array(calendarEventSchema),
    ),
  create: (data: EventInput): Promise<CalendarEvent> =>
    apiRequest({ method: 'POST', url: '/calendar/events', data }, calendarEventSchema),
  update: (id: string, data: EventInput): Promise<CalendarEvent> =>
    apiRequest({ method: 'PUT', url: `/calendar/events/${id}`, data }, calendarEventSchema),
  remove: (id: string): Promise<void> =>
    apiSend({ method: 'DELETE', url: `/calendar/events/${id}` }),
};

export interface CalendarDay {
  date: string;
  day: number;
  /** False for the days of neighbouring months that pad the grid. */
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { from: string; to: string } {
  const [year = 0, index = 1] = month.split('-').map(Number);
  return {
    from: iso(new Date(Date.UTC(year, index - 1, 1))),
    to: iso(new Date(Date.UTC(year, index, 0))),
  };
}

/** `YYYY-MM` moved by a number of months. */
export function shiftMonth(month: string, by: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  return iso(new Date(Date.UTC(year, index - 1 + by, 1))).slice(0, 7);
}

/**
 * The weeks of a month as a Monday-first grid, padded with the neighbouring
 * months' days. An event appears on every day it spans.
 */
export function monthGrid(
  month: string,
  events: readonly CalendarEvent[],
  today: string,
): CalendarDay[][] {
  const { from, to } = monthRange(month);
  const first = new Date(`${from}T00:00:00Z`);
  const start = new Date(first);
  // getUTCDay: Sunday is 0. Step back to the Monday on or before the 1st.
  start.setUTCDate(start.getUTCDate() - ((first.getUTCDay() + 6) % 7));

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  while (iso(cursor) <= to || weeks.length === 0 || (weeks[weeks.length - 1]?.length ?? 7) < 7) {
    if (weeks.length === 0 || weeks[weeks.length - 1]?.length === 7) {
      if (weeks.length > 0 && iso(cursor) > to) break;
      weeks.push([]);
    }
    const date = iso(cursor);
    weeks[weeks.length - 1]?.push({
      date,
      day: cursor.getUTCDate(),
      inMonth: date >= from && date <= to,
      isToday: date === today,
      events: events.filter((event) => event.startDate <= date && event.endDate >= date),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return weeks;
}
