import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import type { ApiSuccessResponse } from '../http/api-response.js';
import { getRequestId } from '../http/request-id.js';

/** Wraps every successful handler result in the standard success envelope. */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T>> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId: getRequestId(response),
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
