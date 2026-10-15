import { addToTally, daysBetween, emptyTally, monthBounds, tallyOf } from './attendance.calc.js';

describe('attendance tallies', () => {
  it('counts a late learner as having attended and an excused one as not', () => {
    expect(tallyOf(['PRESENT', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toEqual({
      present: 2,
      absent: 1,
      late: 1,
      excused: 1,
      marked: 5,
      rate: 60,
    });
  });

  it('has no rate, rather than 0%, when nothing was marked', () => {
    expect(emptyTally().rate).toBeNull();
    expect(tallyOf(['ABSENT']).rate).toBe(0);
  });

  it('adds grouped counts and rounds the rate to two places', () => {
    const tally = addToTally(addToTally(emptyTally(), 'PRESENT', 2), 'ABSENT', 1);
    expect(tally).toMatchObject({ present: 2, absent: 1, marked: 3, rate: 66.67 });
  });
});

describe('date helpers', () => {
  it('counts days inclusively', () => {
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    expect(daysBetween(day('2026-10-01'), day('2026-10-01'))).toBe(1);
    expect(daysBetween(day('2026-10-01'), day('2026-10-31'))).toBe(31);
    expect(daysBetween(day('2026-10-02'), day('2026-10-01'))).toBe(0);
  });

  it('finds the bounds of a month, including leap Februaries', () => {
    const iso = ({ from, to }: { from: Date; to: Date }) => [
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ];
    expect(iso(monthBounds('2026-10'))).toEqual(['2026-10-01', '2026-10-31']);
    expect(iso(monthBounds('2028-02'))).toEqual(['2028-02-01', '2028-02-29']);
    expect(iso(monthBounds('2026-12'))).toEqual(['2026-12-01', '2026-12-31']);
  });
});
