export interface Lesson {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Whether two lessons share any time. `HH:MM` strings compare correctly as
 * text, and a lesson that ends as another begins does not clash with it.
 */
export function lessonsOverlap(a: Lesson, b: Lesson): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime;
}

/**
 * Whether two lessons are for some of the same learners: the same class, and
 * either the same stream or at least one of them for the whole class.
 */
export function shareLearners(
  a: { classId: string; streamId: string | null },
  b: { classId: string; streamId: string | null },
): boolean {
  return (
    a.classId === b.classId &&
    (a.streamId === null || b.streamId === null || a.streamId === b.streamId)
  );
}
