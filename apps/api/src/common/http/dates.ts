import { applyDecorators } from '@nestjs/common';
import { IsDateString, Matches } from 'class-validator';

/** Validates a calendar date in `YYYY-MM-DD` form (no time, no zone). */
export const IsCalendarDate = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '$property must be a date in YYYY-MM-DD format' }),
    IsDateString({ strict: true }, { message: '$property must be a real calendar date' }),
  );

/** Calendar dates are stored and compared as UTC midnight. */
export const parseCalendarDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

export const formatCalendarDate = (value: Date): string => value.toISOString().slice(0, 10);

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Inclusive ranges overlap when each starts on or before the other ends. */
export const rangesOverlap = (a: DateRange, b: DateRange): boolean =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

export const rangeContains = (outer: DateRange, inner: DateRange): boolean =>
  outer.startDate <= inner.startDate && inner.endDate <= outer.endDate;
