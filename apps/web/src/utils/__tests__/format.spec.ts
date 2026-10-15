import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatDateTime, safeRedirectPath } from '../format';
import { zodForm } from '../zod-form';

describe('safeRedirectPath', () => {
  it('accepts same-site paths', () => {
    expect(safeRedirectPath('/users')).toBe('/users');
    expect(safeRedirectPath('/users?page=2#top')).toBe('/users?page=2#top');
  });

  it('rejects anything that could leave the site', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'users',
      '',
      undefined,
      null,
      ['/users'],
    ]) {
      expect(safeRedirectPath(value), String(value)).toBeNull();
    }
  });
});

describe('formatDateTime', () => {
  it('shows a dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('formats ISO timestamps', () => {
    expect(formatDateTime('2026-10-13T09:30:00.000Z')).toMatch(/2026/);
  });
});

describe('zodForm', () => {
  const schema = zodForm(
    z
      .object({
        email: z.email('Enter a valid email address.'),
        password: z.string().min(12, 'Too short.').regex(/\d/, 'Needs a digit.'),
        confirm: z.string(),
      })
      .refine((values) => values.password === values.confirm, {
        path: ['confirm'],
        message: 'Does not match.',
      }),
  );

  it('returns the parsed value when valid', async () => {
    const values = {
      email: 'a@b.example',
      password: 'long-enough-1234',
      confirm: 'long-enough-1234',
    };

    expect(await schema.parse(values)).toEqual({ value: values, errors: [] });
  });

  it('groups every message under its field path', async () => {
    const result = await schema.parse({ email: 'nope', password: 'short', confirm: 'x' });

    expect(result.value).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { path: 'email', errors: ['Enter a valid email address.'] },
        { path: 'password', errors: ['Too short.', 'Needs a digit.'] },
      ]),
    );
  });

  it('reports cross-field errors on the field they belong to', async () => {
    const result = await schema.parse({
      email: 'a@b.example',
      password: 'long-enough-1234',
      confirm: 'different',
    });

    expect(result.errors).toEqual([{ path: 'confirm', errors: ['Does not match.'] }]);
  });
});
