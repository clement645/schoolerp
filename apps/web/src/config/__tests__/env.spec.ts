import { describe, expect, it } from 'vitest';
import { parseClientEnv } from '../env';

describe('parseClientEnv', () => {
  it('defaults to the same-origin versioned API path', () => {
    expect(parseClientEnv({})).toEqual({ apiBaseUrl: '/api/v1' });
  });

  it('accepts an absolute URL and strips trailing slashes', () => {
    expect(parseClientEnv({ VITE_API_BASE_URL: 'https://api.example.com/api/v1/' })).toEqual({
      apiBaseUrl: 'https://api.example.com/api/v1',
    });
  });

  it('rejects values that are neither a path nor an http(s) URL', () => {
    expect(() => parseClientEnv({ VITE_API_BASE_URL: 'api/v1' })).toThrow(/VITE_API_BASE_URL/);
    expect(() => parseClientEnv({ VITE_API_BASE_URL: 'ftp://example.com' })).toThrow(
      /VITE_API_BASE_URL/,
    );
  });
});
