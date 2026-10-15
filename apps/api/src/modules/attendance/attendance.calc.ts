import type { AttendanceStatus } from './attendance.dto.js';

export interface Tally {
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Days on which the learner was marked at all. */
  marked: number;
  /**
   * Share of marked days attended, 0–100. A late learner did attend; an
   * excused one did not, though the absence is not held against conduct.
   * Null when nothing was marked, which is different from 0%.
   */
  rate: number | null;
}

const FIELD: Record<AttendanceStatus, 'present' | 'absent' | 'late' | 'excused'> = {
  PRESENT: 'present',
  ABSENT: 'absent',
  LATE: 'late',
  EXCUSED: 'excused',
};

export const emptyTally = (): Tally => ({
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  marked: 0,
  rate: null,
});

/** Adds `count` marks of one status to a tally, keeping the rate current. */
export function addToTally(tally: Tally, status: AttendanceStatus, count = 1): Tally {
  tally[FIELD[status]] += count;
  tally.marked += count;
  tally.rate =
    tally.marked === 0
      ? null
      : Math.round(((tally.present + tally.late) / tally.marked) * 10000) / 100;
  return tally;
}

export function tallyOf(statuses: Iterable<AttendanceStatus>): Tally {
  const tally = emptyTally();
  for (const status of statuses) addToTally(tally, status);
  return tally;
}

/** Whole days from `from` to `to`, inclusive; negative when reversed. */
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

/** First and last day of a `YYYY-MM` month, as UTC midnights. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, monthNumber - 1, 1)),
    to: new Date(Date.UTC(year, monthNumber, 0)),
  };
}
