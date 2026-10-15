import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '../http/api-response.js';
import { getRequestId } from '../http/request-id.js';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const INTERNAL_ERROR: NormalizedError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_SERVER_ERROR',
  message: 'An unexpected error occurred. Please try again later.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeException(exception: unknown): NormalizedError {
  if (!(exception instanceof HttpException)) {
    return INTERNAL_ERROR;
  }

  const status = exception.getStatus();
  const code = HttpStatus[status] ?? 'ERROR';
  const body = exception.getResponse();

  if (typeof body === 'string') {
    return { status, code, message: body };
  }
  if (!isRecord(body)) {
    return { status, code, message: exception.message };
  }

  // ValidationPipe reports one message per failed constraint.
  if (Array.isArray(body['message'])) {
    return { status, code, message: 'Validation failed', details: body['message'] };
  }

  return {
    status,
    code: typeof body['code'] === 'string' ? body['code'] : code,
    message: typeof body['message'] === 'string' ? body['message'] : exception.message,
    ...(body['details'] !== undefined ? { details: body['details'] } : {}),
  };
}

/**
 * Converts every thrown error into the standard error envelope. Unknown
 * errors are logged with their stack and reported to the client with a
 * generic message so internal details never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(response);
    // `request.path` is relative to the router mount point and would drop the
    // global prefix; the query string is omitted as it may carry user data.
    const path = request.originalUrl.split('?')[0] ?? request.originalUrl;
    const error = normalizeException(exception);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled error on ${request.method} ${path} [${requestId ?? 'no-request-id'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        path,
      },
    };

    response.status(error.status).json(body);
  }
}
