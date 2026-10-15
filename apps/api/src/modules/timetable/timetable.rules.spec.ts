import { lessonsOverlap, shareLearners } from './timetable.rules.js';

const lesson = (dayOfWeek: number, startTime: string, endTime: string) => ({
  dayOfWeek,
  startTime,
  endTime,
});

describe('lessonsOverlap', () => {
  it('detects any shared time on the same day', () => {
    expect(lessonsOverlap(lesson(1, '08:00', '08:40'), lesson(1, '08:20', '09:00'))).toBe(true);
    expect(lessonsOverlap(lesson(1, '08:00', '10:00'), lesson(1, '08:30', '09:00'))).toBe(true);
    expect(lessonsOverlap(lesson(1, '08:30', '09:00'), lesson(1, '08:00', '10:00'))).toBe(true);
  });

  it('allows back-to-back lessons and the same time on different days', () => {
    expect(lessonsOverlap(lesson(1, '08:00', '08:40'), lesson(1, '08:40', '09:20'))).toBe(false);
    expect(lessonsOverlap(lesson(1, '08:00', '08:40'), lesson(2, '08:00', '08:40'))).toBe(false);
  });
});

describe('shareLearners', () => {
  const of = (classId: string, streamId: string | null) => ({ classId, streamId });

  it('treats a whole-class lesson as involving every stream', () => {
    expect(shareLearners(of('c7', null), of('c7', 'east'))).toBe(true);
    expect(shareLearners(of('c7', 'east'), of('c7', null))).toBe(true);
    expect(shareLearners(of('c7', 'east'), of('c7', 'east'))).toBe(true);
  });

  it('lets different streams, and different classes, run in parallel', () => {
    expect(shareLearners(of('c7', 'east'), of('c7', 'west'))).toBe(false);
    expect(shareLearners(of('c7', null), of('c8', null))).toBe(false);
  });
});
