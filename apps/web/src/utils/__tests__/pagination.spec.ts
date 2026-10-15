import { describe, expect, it } from 'vitest';
import { buildPageItems, pageRange, totalPages } from '../pagination';

describe('totalPages', () => {
  it('rounds up partial pages', () => {
    expect(totalPages(101, 25)).toBe(5);
    expect(totalPages(100, 25)).toBe(4);
  });

  it('always reports at least one page', () => {
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(10, 0)).toBe(1);
  });
});

describe('buildPageItems', () => {
  it('lists every page when there are few', () => {
    expect(buildPageItems(1, 1)).toEqual([1]);
    expect(buildPageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('collapses both sides around a middle page', () => {
    expect(buildPageItems(10, 20)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  });

  it('collapses only the far side near the start and the end', () => {
    expect(buildPageItems(1, 20)).toEqual([1, 2, 'ellipsis', 20]);
    expect(buildPageItems(20, 20)).toEqual([1, 'ellipsis', 19, 20]);
  });

  it('shows a single hidden page instead of an ellipsis', () => {
    expect(buildPageItems(4, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20]);
    expect(buildPageItems(17, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20]);
  });

  it('clamps an out-of-range current page', () => {
    expect(buildPageItems(99, 3)).toEqual([1, 2, 3]);
    expect(buildPageItems(-4, 3)).toEqual([1, 2, 3]);
  });

  it('never repeats a page', () => {
    for (let pages = 1; pages <= 12; pages += 1) {
      for (let current = 1; current <= pages; current += 1) {
        const numbers = buildPageItems(current, pages).filter((item) => item !== 'ellipsis');
        expect(new Set(numbers).size).toBe(numbers.length);
        expect(numbers).toContain(current);
      }
    }
  });
});

describe('pageRange', () => {
  it('returns the inclusive row range of a page', () => {
    expect(pageRange(1, 25, 101)).toEqual({ from: 1, to: 25 });
    expect(pageRange(5, 25, 101)).toEqual({ from: 101, to: 101 });
  });

  it('returns null when there is nothing on the page', () => {
    expect(pageRange(1, 25, 0)).toBeNull();
    expect(pageRange(6, 25, 101)).toBeNull();
  });
});
