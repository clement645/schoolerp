import type { Boundary } from '../grading/grading.rules.js';
import {
  computeStudent,
  computeSubject,
  didPass,
  isLevelBased,
  rank,
  round2,
  type MarkValue,
  type SubjectSpec,
} from './results.calc.js';

const grade = (
  label: string,
  minScore: number | null,
  points: number | null,
  descriptor: string | null = null,
): Boundary => ({
  label,
  descriptor,
  minScore,
  points,
});

const PERCENTAGE: Boundary[] = [
  grade('A', 80, 12, 'Excellent'),
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
  grade('E', 0, 1, 'Poor'),
];
const LEVELS: Boundary[] = [
  grade('EE', null, 4, 'Exceeding Expectation'),
  grade('ME', null, 3, 'Meeting Expectation'),
  grade('AE', null, 2, 'Approaching Expectation'),
  grade('BE', null, 1, 'Below Expectation'),
];

const subject = (id: string, maxMarks = 100, isCompulsory = true): SubjectSpec => ({
  id,
  maxMarks,
  isCompulsory,
});
const score = (value: number): MarkValue => ({ score: value, level: null, isAbsent: false });
const level = (label: string): MarkValue => ({ score: null, level: label, isAbsent: false });
const ABSENT: MarkValue = { score: null, level: null, isAbsent: true };
const marks = (entries: Record<string, MarkValue>) => new Map(Object.entries(entries));

const FIVE = ['eng', 'kis', 'mat', 'sci', 'sst'].map((id) => subject(id));

describe('round2', () => {
  it('rounds half up, without binary floating-point surprises', () => {
    expect(round2(82.4)).toBe(82.4);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(72.345)).toBe(72.35);
    expect(round2(66.6666)).toBe(66.67);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('computeSubject', () => {
  it('converts a score to a percentage of the subject maximum and grades it', () => {
    expect(computeSubject(subject('mat', 50), score(41), PERCENTAGE)).toEqual({
      subjectId: 'mat',
      score: 41,
      percentage: 82,
      grade: 'A',
      points: 12,
      isAbsent: false,
    });
    expect(computeSubject(subject('mat', 40), score(29.5), PERCENTAGE)).toMatchObject({
      percentage: 73.75,
      grade: 'B+',
    });
  });

  it('grades the boundaries exactly', () => {
    const gradeOf = (value: number) => computeSubject(subject('x'), score(value), PERCENTAGE).grade;

    expect([80, 79.99, 75, 74.99, 30, 29.99, 0, 100].map(gradeOf)).toEqual([
      'A',
      'A-',
      'A-',
      'B+',
      'D-',
      'E',
      'E',
      'A',
    ]);
  });

  it('returns nothing for a missing mark and flags an absence', () => {
    expect(computeSubject(subject('mat'), undefined, PERCENTAGE)).toMatchObject({
      score: null,
      grade: null,
      isAbsent: false,
    });
    expect(computeSubject(subject('mat'), ABSENT, PERCENTAGE)).toMatchObject({
      score: null,
      grade: null,
      isAbsent: true,
    });
  });

  it('takes a directly awarded level as the grade, case-insensitively', () => {
    expect(computeSubject(subject('mat'), level('me'), LEVELS)).toMatchObject({
      grade: 'ME',
      points: 3,
      percentage: null,
      score: null,
    });
    expect(computeSubject(subject('mat'), level('ZZ'), LEVELS).grade).toBeNull();
  });
});

describe('computeStudent with a percentage scheme', () => {
  it('reproduces the worked example from the product brief', () => {
    const result = computeStudent(
      FIVE,
      marks({ eng: score(78), kis: score(81), mat: score(92), sci: score(85), sst: score(76) }),
      PERCENTAGE,
    );

    expect(result).toMatchObject({
      totalScore: 412,
      maxTotal: 500,
      average: 82.4,
      grade: 'A',
      gradeDescriptor: 'Excellent',
      subjectsSat: 5,
      isComplete: true,
    });
    expect(result.points).toBe(11.6);
  });

  it('averages percentages, so subjects with different maximums weigh equally', () => {
    const result = computeStudent(
      [subject('paper1', 50), subject('paper2', 100)],
      marks({ paper1: score(40), paper2: score(50) }),
      PERCENTAGE,
    );

    // 80% and 50% average to 65%, not 90/150 = 60%.
    expect(result).toMatchObject({ totalScore: 90, maxTotal: 150, average: 65, grade: 'B' });
  });

  it('averages only the subjects sat, and marks the result incomplete', () => {
    const result = computeStudent(
      FIVE,
      marks({ eng: score(60), kis: score(70), mat: ABSENT }),
      PERCENTAGE,
    );

    expect(result).toMatchObject({
      totalScore: 130,
      maxTotal: 200,
      average: 65,
      subjectsSat: 2,
      isComplete: false,
    });
    expect(result.subjects.find((s) => s.subjectId === 'mat')?.isAbsent).toBe(true);
  });

  it('does not treat an elective nobody entered as missing', () => {
    const result = computeStudent(
      [subject('eng'), subject('fre', 100, false)],
      marks({ eng: score(55) }),
      PERCENTAGE,
    );

    expect(result).toMatchObject({ subjectsSat: 1, average: 55, isComplete: true });
  });

  it('handles a student with no marks at all', () => {
    expect(computeStudent(FIVE, marks({}), PERCENTAGE)).toMatchObject({
      totalScore: 0,
      maxTotal: 0,
      average: 0,
      grade: null,
      points: null,
      subjectsSat: 0,
      isComplete: false,
    });
  });

  it('counts a real zero as a mark', () => {
    const result = computeStudent([subject('mat')], marks({ mat: score(0) }), PERCENTAGE);

    expect(result).toMatchObject({ subjectsSat: 1, average: 0, grade: 'E', isComplete: true });
  });
});

describe('computeStudent with directly awarded levels', () => {
  it('recognises level-based schemes', () => {
    expect(isLevelBased(LEVELS)).toBe(true);
    expect(isLevelBased(PERCENTAGE)).toBe(false);
    expect(isLevelBased([])).toBe(false);
  });

  it('totals points and reports the level nearest the mean', () => {
    const result = computeStudent(
      FIVE,
      marks({
        eng: level('EE'),
        kis: level('ME'),
        mat: level('ME'),
        sci: level('AE'),
        sst: level('ME'),
      }),
      LEVELS,
    );

    expect(result).toMatchObject({
      totalScore: 15,
      maxTotal: 20,
      average: 3,
      grade: 'ME',
      gradeDescriptor: 'Meeting Expectation',
      points: 3,
      subjectsSat: 5,
      isComplete: true,
    });
    expect(result.subjects.every((s) => s.percentage === null)).toBe(true);
  });

  it('rounds a mean exactly between two levels up to the better one', () => {
    const result = computeStudent(
      [subject('a'), subject('b')],
      marks({ a: level('EE'), b: level('ME') }),
      LEVELS,
    );

    expect(result).toMatchObject({ average: 3.5, grade: 'EE' });
  });

  it('never invents a percentage for a level-based result', () => {
    const result = computeStudent([subject('a')], marks({ a: level('BE') }), LEVELS);

    expect(result).toMatchObject({ totalScore: 1, maxTotal: 4, average: 1, grade: 'BE' });
  });
});

describe('rank', () => {
  const entry = (name: string, average: number, subjectsSat = 5) => ({
    name,
    average,
    subjectsSat,
  });
  const positions = (entries: ReturnType<typeof entry>[], policy?: 'COMPETITION' | 'DENSE') => {
    const ranked = rank(entries, policy);
    return Object.fromEntries(entries.map((e) => [e.name, ranked.get(e) ?? null]));
  };

  it('orders by average, best first, whatever the input order', () => {
    expect(positions([entry('c', 60), entry('a', 90), entry('b', 75)])).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it('shares a position between ties and skips the next one by default', () => {
    expect(positions([entry('a', 90), entry('b', 80), entry('c', 80), entry('d', 70)])).toEqual({
      a: 1,
      b: 2,
      c: 2,
      d: 4,
    });
  });

  it('does not skip positions under dense ranking', () => {
    expect(
      positions([entry('a', 90), entry('b', 80), entry('c', 80), entry('d', 70)], 'DENSE'),
    ).toEqual({
      a: 1,
      b: 2,
      c: 2,
      d: 3,
    });
  });

  it('gives no position to a learner who sat nothing', () => {
    expect(positions([entry('a', 50), entry('none', 0, 0), entry('zero', 0, 1)])).toEqual({
      a: 1,
      none: null,
      zero: 2,
    });
  });

  it('handles an empty group and a single learner', () => {
    expect(rank([]).size).toBe(0);
    expect(positions([entry('only', 42)])).toEqual({ only: 1 });
  });
});

describe('didPass', () => {
  const result = (average: number, grade: string | null = null, subjectsSat = 5) => ({
    average,
    grade,
    subjectsSat,
  });

  it('compares the average with the pass mark for score-based schemes', () => {
    expect(didPass(result(50), PERCENTAGE, 50)).toBe(true);
    expect(didPass(result(49.99), PERCENTAGE, 50)).toBe(false);
    expect(didPass(result(40), PERCENTAGE, 40)).toBe(true);
  });

  it('passes the upper half of levels for level-based schemes', () => {
    expect(['EE', 'ME', 'AE', 'BE'].map((level) => didPass(result(0, level), LEVELS, 50))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // With three levels, the top two of three count.
    const three = LEVELS.slice(0, 3);
    expect(['EE', 'ME', 'AE'].map((level) => didPass(result(0, level), three, 50))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('is undecided for a learner who sat nothing', () => {
    expect(didPass(result(0, null, 0), PERCENTAGE, 50)).toBeNull();
  });
});
