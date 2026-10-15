import type { Response } from 'express';
import { contentDisposition } from './file-types.js';
import type { StoredObject } from './storage.service.js';

export interface FileHeaders {
  contentType: string;
  fileName: string;
  /** `inline` for images shown in the page, `attachment` to force a download. */
  disposition: 'inline' | 'attachment';
  /** Seconds the browser may reuse the file; 0 forbids storing it at all. */
  maxAgeSeconds: number;
}

/** Streams a stored file to the client with headers that keep it private. */
export function sendFile(response: Response, object: StoredObject, headers: FileHeaders): void {
  response.status(200).set({
    'Content-Type': headers.contentType,
    'Content-Disposition': contentDisposition(headers.disposition, headers.fileName),
    // Never `public`: these files are personal and must not reach shared caches.
    'Cache-Control':
      headers.maxAgeSeconds > 0 ? `private, max-age=${headers.maxAgeSeconds}` : 'no-store',
    ...(object.contentLength === undefined
      ? {}
      : { 'Content-Length': String(object.contentLength) }),
  });
  object.body.on('error', () => response.destroy());
  object.body.pipe(response);
}
