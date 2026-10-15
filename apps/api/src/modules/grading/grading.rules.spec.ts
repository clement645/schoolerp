import {
  resolveGrade,
  sortBoundaries,
  upperLimitOf,
  validateBoundaries,
  type Boundary,
} from './grading.rules.js';

const grade = (label: string, minScore: number | null, points: number | null = null): Boundary => ({
  label,
  descriptor: null,
  minScore,
  points,
});

/** The example percentage scheme from the product brief. */
const KCSE_STYLE: Boundary[] = [
  grade('A', 80, 12),
  grade('A-', 75, 11),
  grade('B+', 70, 10),
  grade('B', 65, 9),
  grade('B-', 60, 8),
  grade('C+', 55, 7),
  grade('C', 50, 6),
  grade('C-', 45, 5),
  grade('D+', 40, 4),
  grade('D', 35, 3),
  grade('D-', 30, 2),
  grade('E', 0, 1),
];

const CBC_LEVELS: Boundary[] = [
  grade('EE', null, 4),
  grade('ME', null, 3),
  grade('AE', null, 2),
  grade('BE', null, 1),
];

describe('validateBoundaries', () => {
  it('accepts the example percentage scheme', () => {
    expect(validateBoundaries('PERCENTAGE', KCSE_STYLE)).toEqual([]);
  });

  it('accepts competency levels with no score ranges at all', () => {
    expect(validateBoundaries('COMPETENCY', CBC_LEVELS)).toEqual([]);
  });

  it('accepts competency levels that do map to score ranges', () => {
    const mapped = [grade('EE', 80), grade('ME', 50), grade('AE', 30), grade('BE', 0)];

    expect(validateBoundaries('COMPETENCY', mapped)).toEqual([]);
  });

  it('requires a minimum score for every grade of a percentage scheme', () => {
    expect(validateBoundaries('PERCENTAGE', [grade('A', 50), grade('B', null)])).toContain(
      'Every grade in a percentage scheme needs a minimum score.',
    );
  });

  it('rejects competency schemes with only some levels scored', () => {
    expect(validateBoundaries('COMPETENCY', [grade('EE', 80), grade('ME', null)])).toContain(
      'Give every level a minimum score, or none of them.',
    );
  });

  it('requires the lowest grade to start at zero', () => {
    expect(validateBoundaries('PERCENTAGE', [grade('A', 80), grade('B', 40)])).toContain(
      'The lowest grade must start at 0 so that every score has a grade.',
    );
  });

  it('rejects duplicate minimum scores and duplicate labels', () => {
    const problems = validateBoundaries('PERCENTAGE', [
      grade('A', 50),
      grade('a ', 50),
      grade('E', 0),
    ]);

    expect(problems).toContain('Two grades cannot start at the same minimum score.');
    expect(problems).toContain('Each grade label must be unique.');
  });

  it('rejects out-of-range scores, negative points and too few grades', () => {
    expect(validateBoundaries('PERCENTAGE', [grade('A', 101), grade('E', 0)])).toContain(
      'Minimum scores must be between 0 and 100.',
    );
    expect(validateBoundaries('PERCENTAGE', [grade('A', 50, -1), grade('E', 0)])).toContain(
      'Grade points cannot be negative.',
    );
    expect(validateBoundaries('PERCENTAGE', [grade('P', 0)])).toContain(
      'A grading scheme needs at least 2 grades.',
    );
  });
});

describe('resolveGrade', () => {
  const labelFor = (score: number) => resolveGrade(KCSE_STYLE, score)?.label ?? null;

  it('awards the grade whose range contains the score', () => {
    expect(labelFor(100)).toBe('A');
    expect(labelFor(82.4)).toBe('A');
    expect(labelFor(72)).toBe('B+');
    expect(labelFor(0)).toBe('E');
    expect(labelFor(29)).toBe('E');
  });

  it('treats each minimum as inclusive and leaves no gap below it', () => {
    expect(labelFor(80)).toBe('A');
    expect(labelFor(79.99)).toBe('A-');
    expect(labelFor(75)).toBe('A-');
    expect(labelFor(74.99)).toBe('B+');
    expect(labelFor(30)).toBe('D-');
    expect(labelFor(29.99)).toBe('E');
  });

  it('grades every score from 0 to 100 exactly once', () => {
    for (let score = 0; score <= 100; score += 0.25) {
      expect(labelFor(score), String(score)).not.toBeNull();
    }
  });

  it('does not depend on the order boundaries are stored in', () => {
    const shuffled = [...KCSE_STYLE].reverse();

    expect(resolveGrade(shuffled, 67)?.label).toBe('B');
  });

  it('returns null for invalid scores', () => {
    for (const score of [-1, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveGrade(KCSE_STYLE, score)).toBeNull();
    }
  });

  it('returns null when levels are awarded directly rather than by score', () => {
    expect(resolveGrade(CBC_LEVELS, 85)).toBeNull();
  });
});

describe('sortBoundaries and upperLimitOf', () => {
  it('orders grades from best to worst', () => {
    const shuffled = [KCSE_STYLE[5], KCSE_STYLE[0], KCSE_STYLE[11], KCSE_STYLE[3]] as Boundary[];

    expect(sortBoundaries(shuffled).map((b) => b.label)).toEqual(['A', 'B', 'C+', 'E']);
    expect(sortBoundaries([...CBC_LEVELS].reverse()).map((b) => b.label)).toEqual([
      'EE',
      'ME',
      'AE',
      'BE',
    ]);
  });

  it('reports where the next grade begins', () => {
    const [a, aMinus] = KCSE_STYLE as [Boundary, Boundary];
    const e = KCSE_STYLE[11] as Boundary;

    expect(upperLimitOf(KCSE_STYLE, a)).toBeNull();
    expect(upperLimitOf(KCSE_STYLE, aMinus)).toBe(80);
    expect(upperLimitOf(KCSE_STYLE, e)).toBe(30);
    expect(upperLimitOf(CBC_LEVELS, CBC_LEVELS[0] as Boundary)).toBeNull();
  });
});
