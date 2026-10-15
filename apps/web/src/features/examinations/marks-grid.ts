import type { MarkEntry, SheetCell } from './examinations.service';

/** What a teacher typed into a cell, interpreted. */
export type ParsedCell =
  | { kind: 'empty' }
  | { kind: 'score'; score: number }
  | { kind: 'level'; level: string }
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string };

export interface CellRules {
  maxMarks: number;
  /** True when the class is graded by performance level instead of score. */
  levelBased: boolean;
  /** Level labels of the grading scheme, e.g. EE, ME, AE, BE. */
  levels: readonly string[];
}

const ABSENT = new Set(['abs', 'absent', 'x']);

/**
 * Interprets cell input. This mirrors the server's rules so mistakes show as
 * the teacher types; the server validates every mark again when saving.
 */
export function parseCell(input: string, rules: CellRules): ParsedCell {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  if (ABSENT.has(text.toLowerCase())) return { kind: 'absent' };

  if (rules.levelBased) {
    const level = rules.levels.find((label) => label.toLowerCase() === text.toLowerCase());
    return level
      ? { kind: 'level', level }
      : { kind: 'invalid', reason: `Enter one of ${rules.levels.join(', ')}, or ABS.` };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { kind: 'invalid', reason: 'Enter a number (up to two decimals), or ABS.' };
  }
  const score = Number(text);
  if (score > rules.maxMarks) {
    return { kind: 'invalid', reason: `The maximum is ${rules.maxMarks}.` };
  }
  return { kind: 'score', score };
}

/** How a stored mark is shown in its cell. */
export function cellText(cell: SheetCell | undefined): string {
  if (!cell) return '';
  if (cell.isAbsent) return 'ABS';
  if (cell.level !== null) return cell.level;
  return cell.score === null ? '' : String(cell.score);
}

/** Whether typed input means the same as what is already stored. */
export function isUnchanged(parsed: ParsedCell, stored: SheetCell | undefined): boolean {
  switch (parsed.kind) {
    case 'empty':
      return cellText(stored) === '';
    case 'absent':
      return stored?.isAbsent === true;
    case 'score':
      return stored?.score === parsed.score && !stored.isAbsent;
    case 'level':
      return stored?.level?.toLowerCase() === parsed.level.toLowerCase();
    default:
      return false;
  }
}

/** The save request for one changed cell, quoting the version it was based on. */
export function toEntry(
  studentId: string,
  subjectId: string,
  parsed: Exclude<ParsedCell, { kind: 'invalid' }>,
  stored: SheetCell | undefined,
): MarkEntry {
  const base = { studentId, subjectId, version: stored?.version ?? 0 };
  switch (parsed.kind) {
    case 'score':
      return { ...base, score: parsed.score };
    case 'level':
      return { ...base, level: parsed.level };
    case 'absent':
      return { ...base, isAbsent: true };
    default:
      return { ...base, score: null };
  }
}

export const cellKey = (studentId: string, subjectId: string): string =>
  `${studentId}:${subjectId}`;
