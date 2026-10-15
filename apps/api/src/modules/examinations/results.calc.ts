/**
 * Pure result calculation. Totals, averages, grades and positions are always
 * derived here, on the server, from stored marks and the grading scheme —
 * never taken from a client.
 */
import { resolveGrade, type Boundary } from '../grading/grading.rules.js';

export interface SubjectSpec {
  id: string;
  maxMarks: number;
  isCompulsory: boolean;
}

export interface MarkValue {
  score: number | null;
  /** Performance level awarded directly, for level-based schemes. */
  level: string | null;
  isAbsent: boolean;
}

export interface SubjectResult {
  subjectId: string;
  score: number | null;
  /** Score as a percentage of the maximum; null for directly awarded levels. */
  percentage: number | null;
  grade: string | null;
  points: number | null;
  isAbsent: boolean;
}

export interface StudentResult {
  subjects: SubjectResult[];
  /** Sum of scores, or of points for a level-based scheme. */
  totalScore: number;
  /** The most that could have been earned in the subjects actually sat. */
  maxTotal: number;
  /** Mean subject percentage, or mean points for a level-based scheme. */
  average: number;
  grade: string | null;
  gradeDescriptor: string | null;
  points: number | null;
  subjectsSat: number;
  /** False when a compulsory subject has no mark. */
  isComplete: boolean;
}

export type RankingPolicy =
  /** Ties share a position and the next position is skipped: 1, 2, 2, 4. */
  | 'COMPETITION'
  /** Ties share a position and none is skipped: 1, 2, 2, 3. */
  | 'DENSE';

/** Rounds half up to two decimal places, as marks are conventionally shown. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * A scheme is level-based when its levels have no score ranges: the teacher
 * awards a level (e.g. "Meeting Expectation") instead of entering a score.
 */
export function isLevelBased(boundaries: readonly Boundary[]): boolean {
  return boundaries.length > 0 && boundaries.every((boundary) => boundary.minScore === null);
}

const findLevel = (boundaries: readonly Boundary[], label: string): Boundary | undefined =>
  boundaries.find((boundary) => boundary.label.toLowerCase() === label.trim().toLowerCase());

export function computeSubject(
  spec: SubjectSpec,
  mark: MarkValue | undefined,
  boundaries: readonly Boundary[],
): SubjectResult {
  const empty: SubjectResult = {
    subjectId: spec.id,
    score: null,
    percentage: null,
    grade: null,
    points: null,
    isAbsent: mark?.isAbsent ?? false,
  };
  if (!mark || mark.isAbsent) return empty;

  if (mark.level !== null) {
    const level = findLevel(boundaries, mark.level);
    return level ? { ...empty, grade: level.label, points: level.points } : empty;
  }
  if (mark.score === null) return empty;

  const percentage = round2((mark.score / spec.maxMarks) * 100);
  const grade = resolveGrade(boundaries, percentage);
  return {
    ...empty,
    score: mark.score,
    percentage,
    grade: grade?.label ?? null,
    points: grade?.points ?? null,
  };
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function computeStudent(
  specs: readonly SubjectSpec[],
  marks: ReadonlyMap<string, MarkValue>,
  boundaries: readonly Boundary[],
): StudentResult {
  const subjects = specs.map((spec) => computeSubject(spec, marks.get(spec.id), boundaries));
  const isComplete = specs.every(
    (spec, index) =>
      !spec.isCompulsory || subjects[index]?.grade != null || subjects[index]?.score != null,
  );

  if (isLevelBased(boundaries)) {
    const awarded = subjects.filter((subject) => subject.grade !== null);
    const points = awarded.map((subject) => subject.points ?? 0);
    const average = round2(mean(points));
    const highest = Math.max(0, ...boundaries.map((boundary) => boundary.points ?? 0));
    // The overall level is the one whose points are closest to the mean;
    // exactly halfway rounds up to the better level.
    const overall =
      awarded.length === 0
        ? null
        : [...boundaries]
            .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
            .reduce<Boundary | null>((best, boundary) => {
              if (best === null) return boundary;
              const distance = Math.abs((boundary.points ?? 0) - average);
              return distance < Math.abs((best.points ?? 0) - average) ? boundary : best;
            }, null);

    return {
      subjects,
      totalScore: round2(points.reduce((sum, value) => sum + value, 0)),
      maxTotal: round2(highest * awarded.length),
      average,
      grade: overall?.label ?? null,
      gradeDescriptor: overall?.descriptor ?? null,
      points: awarded.length === 0 ? null : average,
      subjectsSat: awarded.length,
      isComplete,
    };
  }

  const sat = subjects.filter((subject) => subject.score !== null);
  const average = round2(mean(sat.map((subject) => subject.percentage ?? 0)));
  const overall = sat.length === 0 ? null : resolveGrade(boundaries, average);
  const allHavePoints = sat.length > 0 && sat.every((subject) => subject.points !== null);

  return {
    subjects,
    totalScore: round2(sat.reduce((sum, subject) => sum + (subject.score ?? 0), 0)),
    maxTotal: round2(
      sat.reduce(
        (sum, subject) =>
          sum + (specs.find((spec) => spec.id === subject.subjectId)?.maxMarks ?? 0),
        0,
      ),
    ),
    average,
    grade: overall?.label ?? null,
    gradeDescriptor: overall?.descriptor ?? null,
    points: allHavePoints ? round2(mean(sat.map((subject) => subject.points ?? 0))) : null,
    subjectsSat: sat.length,
    isComplete,
  };
}

/**
 * Positions for a group, best average first. Learners with nothing to rank
 * (no subject sat) get no position. Equal averages share a position.
 */
export function rank<T extends { average: number; subjectsSat: number }>(
  entries: readonly T[],
  policy: RankingPolicy = 'COMPETITION',
): Map<T, number> {
  const ranked = entries
    .filter((entry) => entry.subjectsSat > 0)
    .sort((a, b) => b.average - a.average);
  const positions = new Map<T, number>();

  let position = 0;
  let previous: number | null = null;
  ranked.forEach((entry, index) => {
    if (previous === null || entry.average !== previous) {
      position = policy === 'DENSE' ? position + 1 : index + 1;
      previous = entry.average;
    }
    positions.set(entry, position);
  });
  return positions;
}

/**
 * Whether a result counts as a pass. For score-based schemes that is an
 * average at or above the school's pass mark. A level-based result has no
 * percentage to compare, so it passes when its overall level is in the upper
 * half of the scheme's levels (e.g. Exceeding or Meeting Expectation of four).
 * Returns null when the learner sat nothing.
 */
export function didPass(
  result: Pick<StudentResult, 'average' | 'grade' | 'subjectsSat'>,
  boundaries: readonly Boundary[],
  passMark: number,
): boolean | null {
  if (result.subjectsSat === 0) return null;
  if (!isLevelBased(boundaries)) return result.average >= passMark;

  const ordered = [...boundaries].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const index = ordered.findIndex((boundary) => boundary.label === result.grade);
  return index !== -1 && index < Math.ceil(ordered.length / 2);
}
