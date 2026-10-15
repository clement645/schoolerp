/**
 * Pure grading rules: validating a scheme and turning a score into a grade.
 * Results are always computed here, on the server, from stored boundaries.
 */

export type SchemeType = 'PERCENTAGE' | 'COMPETENCY';

export interface BoundaryInput {
  label: string;
  descriptor?: string | null;
  /** Lowest percentage that earns the grade. */
  minScore?: number | null;
  points?: number | null;
}

export interface Boundary {
  label: string;
  descriptor: string | null;
  minScore: number | null;
  points: number | null;
}

export const MIN_BOUNDARIES = 2;
export const MAX_BOUNDARIES = 30;

const hasScore = (boundary: BoundaryInput): boolean =>
  boundary.minScore !== null && boundary.minScore !== undefined;

/**
 * Returns every problem with a proposed scheme, or an empty list if it is
 * sound. Because each grade stores only its lowest score, a valid scheme
 * covers 0–100 with no gaps and no overlaps by construction.
 */
export function validateBoundaries(
  type: SchemeType,
  boundaries: readonly BoundaryInput[],
): string[] {
  const problems: string[] = [];

  if (boundaries.length < MIN_BOUNDARIES) {
    problems.push(`A grading scheme needs at least ${MIN_BOUNDARIES} grades.`);
  }
  if (boundaries.length > MAX_BOUNDARIES) {
    problems.push(`A grading scheme can have at most ${MAX_BOUNDARIES} grades.`);
  }

  const labels = boundaries.map((boundary) => boundary.label.trim().toLowerCase());
  const repeatedLabel = labels.find((label, index) => labels.indexOf(label) !== index);
  if (repeatedLabel !== undefined) {
    problems.push('Each grade label must be unique.');
  }

  const scored = boundaries.filter(hasScore);
  if (type === 'PERCENTAGE' && scored.length !== boundaries.length) {
    problems.push('Every grade in a percentage scheme needs a minimum score.');
  }
  if (type === 'COMPETENCY' && scored.length > 0 && scored.length !== boundaries.length) {
    problems.push('Give every level a minimum score, or none of them.');
  }

  if (scored.length > 0 && scored.length === boundaries.length) {
    const scores = scored.map((boundary) => boundary.minScore as number);
    if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 100)) {
      problems.push('Minimum scores must be between 0 and 100.');
    }
    if (new Set(scores).size !== scores.length) {
      problems.push('Two grades cannot start at the same minimum score.');
    }
    if (!scores.includes(0)) {
      problems.push('The lowest grade must start at 0 so that every score has a grade.');
    }
  }

  if (boundaries.some((b) => b.points != null && (!Number.isFinite(b.points) || b.points < 0))) {
    problems.push('Grade points cannot be negative.');
  }

  return problems;
}

/** Orders grades from best to worst: by minimum score, else by points. */
export function sortBoundaries<T extends Pick<Boundary, 'minScore' | 'points'>>(
  boundaries: readonly T[],
): T[] {
  return [...boundaries].sort(
    (a, b) => (b.minScore ?? -1) - (a.minScore ?? -1) || (b.points ?? -1) - (a.points ?? -1),
  );
}

/**
 * The grade earned by a percentage score: the highest grade whose minimum the
 * score reaches. Returns `null` when the scheme has no score ranges (levels
 * awarded directly) or the score is not a valid percentage.
 */
export function resolveGrade<T extends Pick<Boundary, 'minScore'>>(
  boundaries: readonly T[],
  score: number,
): T | null {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;

  let best: T | null = null;
  for (const boundary of boundaries) {
    if (boundary.minScore === null || boundary.minScore > score) continue;
    if (best === null || boundary.minScore > (best.minScore as number)) best = boundary;
  }
  return best;
}

/**
 * The score at which the next grade up begins, i.e. the exclusive upper limit
 * of this one. `null` for the top grade (which runs to 100 inclusive) and for
 * levels without a score range.
 */
export function upperLimitOf<T extends Pick<Boundary, 'minScore'>>(
  boundaries: readonly T[],
  boundary: T,
): number | null {
  if (boundary.minScore === null) return null;
  const higher = boundaries
    .map((other) => other.minScore)
    .filter((score): score is number => score !== null && score > (boundary.minScore as number));
  return higher.length > 0 ? Math.min(...higher) : null;
}
