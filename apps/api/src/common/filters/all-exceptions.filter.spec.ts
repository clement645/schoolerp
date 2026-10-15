import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { normalizeException } from './all-exceptions.filter.js';

describe('normalizeException', () => {
  it('hides the details of unknown errors', () => {
    const result = normalizeException(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    expect(result.status).toBe(500);
    expect(result.code).toBe('INTERNAL_SERVER_ERROR');
    expect(result.message).not.toContain('ECONNREFUSED');
    expect(result.details).toBeUndefined();
  });

  it('maps HTTP exceptions to a status-derived code', () => {
    expect(normalizeException(new NotFoundException('Student not found'))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Student not found',
    });
  });

  it('reports validation failures as details', () => {
    const result = normalizeException(
      new BadRequestException({ message: ['name must be a string'], error: 'Bad Request' }),
    );

    expect(result).toEqual({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Validation failed',
      details: ['name must be a string'],
    });
  });

  it('passes through explicit codes and details', () => {
    const result = normalizeException(
      new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Unavailable',
        details: { database: 'down' },
      }),
    );

    expect(result).toEqual({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Unavailable',
      details: { database: 'down' },
    });
  });
});
