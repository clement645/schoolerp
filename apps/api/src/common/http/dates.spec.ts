import { formatCalendarDate, parseCalendarDate, rangeContains, rangesOverlap } from './dates.js';

const range = (start: string, end: string) => ({
  startDate: parseCalendarDate(start),
  endDate: parseCalendarDate(end),
});

describe('calendar dates', () => {
  it('round-trips a date without shifting it across time zones', () => {
    expect(formatCalendarDate(parseCalendarDate('2026-01-05'))).toBe('2026-01-05');
    expect(parseCalendarDate('2026-12-31').toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('detects overlapping ranges, counting shared end days', () => {
    const term1 = range('2026-01-05', '2026-04-03');

    expect(rangesOverlap(term1, range('2026-04-03', '2026-08-07'))).toBe(true);
    expect(rangesOverlap(term1, range('2026-03-01', '2026-03-10'))).toBe(true);
    expect(rangesOverlap(term1, range('2025-09-01', '2026-01-05'))).toBe(true);
    expect(rangesOverlap(term1, range('2026-04-04', '2026-08-07'))).toBe(false);
    expect(rangesOverlap(term1, range('2025-09-01', '2026-01-04'))).toBe(false);
  });

  it('checks that one range lies inside another', () => {
    const year = range('2026-01-05', '2026-11-20');

    expect(rangeContains(year, range('2026-01-05', '2026-11-20'))).toBe(true);
    expect(rangeContains(year, range('2026-05-04', '2026-08-07'))).toBe(true);
    expect(rangeContains(year, range('2026-01-04', '2026-04-03'))).toBe(false);
    expect(rangeContains(year, range('2026-08-31', '2026-11-21'))).toBe(false);
  });
});
