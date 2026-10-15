import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export interface DetectedType {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  extension: 'jpg' | 'png' | 'webp' | 'pdf';
}

const startsWith = (buffer: Buffer, bytes: readonly number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);

/**
 * Identifies a file from its leading bytes. The name and the type the client
 * claims are both attacker-controlled; the content is what would actually be
 * served back to other users, so that is what is checked.
 *
 * SVG is deliberately unsupported: it can carry scripts.
 */
export function detectFileType(buffer: Buffer): DetectedType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png' };
  }
  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  // %PDF-
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  return null;
}

export interface UploadPolicy {
  /** What the file is, for error messages: "photo", "document". */
  noun: string;
  maxBytes: number;
  allowed: readonly DetectedType['contentType'][];
}

const MB = 1024 * 1024;

export const IMAGE_POLICY: UploadPolicy = {
  noun: 'image',
  maxBytes: 2 * MB,
  allowed: ['image/jpeg', 'image/png', 'image/webp'],
};

export const DOCUMENT_POLICY: UploadPolicy = {
  noun: 'document',
  maxBytes: 5 * MB,
  allowed: ['application/pdf', 'image/jpeg', 'image/png'],
};

const LABELS: Record<DetectedType['contentType'], string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

/** The part of an uploaded file the API relies on. */
export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** Validates an upload against a policy and returns its real type. */
export function validateUpload(file: UploadedFile | undefined, policy: UploadPolicy): DetectedType {
  if (!file || file.size === 0) {
    throw new BadRequestException({ code: 'FILE_REQUIRED', message: `Choose a file to upload.` });
  }
  if (file.size > policy.maxBytes) {
    throw new PayloadTooLargeException({
      code: 'FILE_TOO_LARGE',
      message: `The ${policy.noun} must be ${policy.maxBytes / MB} MB or smaller.`,
    });
  }
  const detected = detectFileType(file.buffer);
  if (!detected || !policy.allowed.includes(detected.contentType)) {
    const accepted = policy.allowed.map((type) => LABELS[type]).join(', ');
    throw new BadRequestException({
      code: 'UNSUPPORTED_FILE',
      message: `This file type is not supported. Upload a ${policy.noun} as ${accepted}.`,
    });
  }
  return detected;
}

/**
 * Reduces a client-supplied file name to something safe to store and to send
 * back in a download header: no path, no control characters, bounded length,
 * and an extension that matches the real content.
 */
export function sanitizeFileName(name: string, extension: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, 80);
  return `${base || 'file'}.${extension}`;
}

/** A Content-Disposition value that is safe for any file name. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
