import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../http';
import { createAppQueryClient } from '../query-client';

describe('createAppQueryClient', () => {
  const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: Error,
  ) => boolean;

  it('retries a failure to reach the server, twice at most', () => {
    const offline = new AxiosError('Network Error', 'ERR_NETWORK');

    expect(retry(0, offline)).toBe(true);
    expect(retry(1, offline)).toBe(true);
    expect(retry(2, offline)).toBe(false);
  });

  it('never retries a response from the server', () => {
    for (const status of [400, 401, 403, 404, 409, 500]) {
      const rejected = new ApiRequestError('Rejected', 'SOME_CODE', status);

      expect(retry(0, rejected), String(status)).toBe(false);
    }
  });
});
