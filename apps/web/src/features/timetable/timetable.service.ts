import { z } from 'zod';
import { apiRequest, apiSend } from '@/services/http';

const ref = z.object({ id: z.string(), name: z.string() });
export const slotSchema = z.object({
  id: z.string(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  class: ref,
  stream: ref.nullable(),
  subject: ref.extend({ code: z.string() }),
  teacher: ref.nullable(),
  room: z.string().nullable(),
});
export type Slot = z.infer<typeof slotSchema>;

export interface SlotInput {
  classId: string;
  streamId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subjectId: string;
  teacherId: string | null;
  room: string | null;
}

export const timetableApi = {
  list: (query: { classId?: string; streamId?: string; mine?: boolean }): Promise<Slot[]> =>
    apiRequest(
      {
        method: 'GET',
        url: '/timetable',
        params: {
          classId: query.classId || undefined,
          streamId: query.streamId || undefined,
          mine: query.mine ? 'true' : undefined,
        },
      },
      z.array(slotSchema),
    ),
  create: (data: SlotInput): Promise<Slot> =>
    apiRequest({ method: 'POST', url: '/timetable', data }, slotSchema),
  update: (id: string, data: SlotInput): Promise<Slot> =>
    apiRequest({ method: 'PUT', url: `/timetable/${id}`, data }, slotSchema),
  remove: (id: string): Promise<void> => apiSend({ method: 'DELETE', url: `/timetable/${id}` }),
};

export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

export interface DayColumn {
  day: number;
  label: string;
  slots: Slot[];
}

/**
 * Groups lessons by day, in time order. Monday to Friday always appear;
 * Saturday and Sunday only when something is taught on them.
 */
export function byDay(slots: readonly Slot[]): DayColumn[] {
  return WEEKDAYS.filter(
    ({ value }) => value <= 5 || slots.some((slot) => slot.dayOfWeek === value),
  ).map(({ value, label }) => ({
    day: value,
    label,
    slots: slots
      .filter((slot) => slot.dayOfWeek === value)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));
}
