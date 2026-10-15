import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Assigns a server-generated correlation id to every request. Client-supplied
 * ids are ignored so log entries cannot be spoofed or polluted.
 */
export function requestIdMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(REQUEST_ID_HEADER, randomUUID());
  next();
}

export function getRequestId(res: Response): string | null {
  const value = res.getHeader(REQUEST_ID_HEADER);
  return typeof value === 'string' ? value : null;
}
