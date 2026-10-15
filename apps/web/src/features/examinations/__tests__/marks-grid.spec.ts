import { describe, expect, it } from 'vitest';
import { cellText, isUnchanged, parseCell, toEntry } from '../marks-grid';

const SCORES = { maxMarks: 50, levelBased: false, levels: [] };
const LEVELS = { maxMarks: 100, levelBased: true, levels: ['EE', 'ME', 'AE', 'BE'] };
const stored = (score: number | null, extra = {}) => ({
  score,
  level: null,
  isAbsent: false,
  version: 3,
  ...extra,
});

describe('parseCell', () => {
  it('reads scores, with up to two decimals', () => {
    expect(parseCell('42', SCORES)).toEqual({ kind: 'score', score: 42 });
    expect(parseCell(' 37.5 ', SCORES)).toEqual({ kind: 'score', score: 37.5 });
    expect(parseCell('0', SCORES)).toEqual({ kind: 'score', score: 0 });
    expect(parseCell('50', SCORES)).toEqual({ kind: 'score', score: 50 });
  });

  it('rejects scores above the subject maximum and malformed numbers', () => {
    expect(parseCell('50.01', SCORES)).toEqual({ kind: 'invalid', reason: 'The maximum is 50.' });
    for (const input of ['-1', '4.555', 'forty', '1e2', '12abc', '4,5']) {
      expect(parseCell(input, SCORES).kind, input).toBe('invalid');
    }
  });

  it('treats blank as empty and ABS as absent', () => {
    expect(parseCell('', SCORES)).toEqual({ kind: 'empty' });
    expect(parseCell('   ', SCORES)).toEqual({ kind: 'empty' });
    for (const input of ['ABS', 'abs', 'Absent', 'x']) {
      expect(parseCell(input, SCORES), input).toEqual({ kind: 'absent' });
      expect(parseCell(input, LEVELS), input).toEqual({ kind: 'absent' });
    }
  });

  it('accepts only the scheme’s levels for level-based classes', () => {
    expect(parseCell('me', LEVELS)).toEqual({ kind: 'level', level: 'ME' });
    expect(parseCell('EE', LEVELS)).toEqual({ kind: 'level', level: 'EE' });
    expect(parseCell('80', LEVELS)).toEqual({
      kind: 'invalid',
      reason: 'Enter one of EE, ME, AE, BE, or ABS.',
    });
    expect(parseCell('ZZ', LEVELS).kind).toBe('invalid');
  });
});

describe('cellText', () => {
  it('shows what is stored', () => {
    expect(cellText(undefined)).toBe('');
    expect(cellText(stored(78))).toBe('78');
    expect(cellText(stored(0))).toBe('0');
    expect(cellText(stored(null))).toBe('');
    expect(cellText(stored(null, { isAbsent: true }))).toBe('ABS');
    expect(cellText(stored(null, { level: 'ME' }))).toBe('ME');
  });
});

describe('isUnchanged', () => {
  it('recognises input that matches the stored mark', () => {
    expect(
      isUnchanged(
        parseCell('78', SCORES.maxMarks ? { ...SCORES, maxMarks: 100 } : SCORES),
        stored(78),
      ),
    ).toBe(true);
    expect(isUnchanged(parseCell('78.0', { ...SCORES, maxMarks: 100 }), stored(78))).toBe(true);
    expect(isUnchanged(parseCell('', SCORES), undefined)).toBe(true);
    expect(isUnchanged(parseCell('', SCORES), stored(null))).toBe(true);
    expect(isUnchanged(parseCell('abs', SCORES), stored(null, { isAbsent: true }))).toBe(true);
    expect(isUnchanged(parseCell('me', LEVELS), stored(null, { level: 'ME' }))).toBe(true);
  });

  it('recognises a real change, including clearing and a real zero', () => {
    expect(isUnchanged(parseCell('40', SCORES), stored(41))).toBe(false);
    expect(isUnchanged(parseCell('', SCORES), stored(41))).toBe(false);
    expect(isUnchanged(parseCell('0', SCORES), undefined)).toBe(false);
    expect(isUnchanged(parseCell('0', SCORES), stored(null))).toBe(false);
    expect(isUnchanged(parseCell('abs', SCORES), stored(41))).toBe(false);
    expect(isUnchanged(parseCell('12', SCORES), stored(null, { isAbsent: true }))).toBe(false);
  });
});

describe('toEntry', () => {
  it('quotes the version the change is based on', () => {
    expect(toEntry('s1', 'mat', { kind: 'score', score: 40 }, stored(41))).toEqual({
      studentId: 's1',
      subjectId: 'mat',
      version: 3,
      score: 40,
    });
  });

  it('uses version 0 for a mark that does not exist yet', () => {
    expect(toEntry('s1', 'mat', { kind: 'absent' }, undefined)).toEqual({
      studentId: 's1',
      subjectId: 'mat',
      version: 0,
      isAbsent: true,
    });
  });

  it('clears a mark with a null score', () => {
    expect(toEntry('s1', 'mat', { kind: 'empty' }, stored(41))).toMatchObject({
      score: null,
      version: 3,
    });
    expect(toEntry('s1', 'mat', { kind: 'level', level: 'AE' }, undefined)).toMatchObject({
      level: 'AE',
      version: 0,
    });
  });
});
