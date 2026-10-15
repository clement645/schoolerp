import {
  contentDisposition,
  detectFileType,
  DOCUMENT_POLICY,
  IMAGE_POLICY,
  sanitizeFileName,
  validateUpload,
} from './file-types.js';

const bytes = (...values: number[]) => Buffer.concat([Buffer.from(values), Buffer.alloc(32)]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(16),
]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const file = (buffer: Buffer, originalname = 'upload.bin') => ({
  buffer,
  originalname,
  size: buffer.length,
});

describe('detectFileType', () => {
  it('recognises supported formats by their content', () => {
    expect(detectFileType(JPEG)?.contentType).toBe('image/jpeg');
    expect(detectFileType(PNG)?.contentType).toBe('image/png');
    expect(detectFileType(WEBP)?.contentType).toBe('image/webp');
    expect(detectFileType(PDF)).toEqual({ contentType: 'application/pdf', extension: 'pdf' });
  });

  it('rejects everything else, including formats that can carry scripts', () => {
    const others = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<!doctype html><script>alert(1)</script>',
      'GIF89a',
      'PK\u0003\u0004',
      'MZ\u0090\u0000',
      '',
      'RIFF....WAVE',
    ];
    for (const content of others) {
      expect(detectFileType(Buffer.from(content)), content.slice(0, 12)).toBeNull();
    }
  });
});

describe('validateUpload', () => {
  it('returns the real type regardless of the claimed name', () => {
    expect(validateUpload(file(PNG, 'photo.jpg'), IMAGE_POLICY)).toEqual({
      contentType: 'image/png',
      extension: 'png',
    });
  });

  it('rejects a script disguised with an image extension', () => {
    const disguised = file(Buffer.from('<script>alert(1)</script>'), 'photo.png');

    expect(() => validateUpload(disguised, IMAGE_POLICY)).toThrow(/not supported/);
  });

  it('applies each policy’s allowed types', () => {
    expect(() => validateUpload(file(PDF), IMAGE_POLICY)).toThrow(/JPEG, PNG, WebP/);
    expect(validateUpload(file(PDF), DOCUMENT_POLICY).extension).toBe('pdf');
    expect(() => validateUpload(file(WEBP), DOCUMENT_POLICY)).toThrow(/PDF, JPEG, PNG/);
  });

  it('rejects missing, empty and oversized files', () => {
    expect(() => validateUpload(undefined, IMAGE_POLICY)).toThrow(/Choose a file/);
    expect(() => validateUpload(file(Buffer.alloc(0)), IMAGE_POLICY)).toThrow(/Choose a file/);
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    expect(() => validateUpload(file(big), IMAGE_POLICY)).toThrow(/2 MB or smaller/);
  });
});

describe('sanitizeFileName', () => {
  it('keeps a readable name and replaces the extension with the real one', () => {
    expect(sanitizeFileName('Birth Certificate.PDF', 'pdf')).toBe('Birth Certificate.pdf');
    expect(sanitizeFileName('photo.png', 'jpg')).toBe('photo.jpg');
    expect(sanitizeFileName('Cheti cha kuzaliwa — Amina.pdf', 'pdf')).toBe(
      'Cheti cha kuzaliwa Amina.pdf',
    );
  });

  it('removes paths, control characters and markup', () => {
    expect(sanitizeFileName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\me\\scan.pdf', 'pdf')).toBe('scan.pdf');
    expect(sanitizeFileName('a\r\nSet-Cookie: x=1.pdf', 'pdf')).toBe(
      'aSet-Cookie x=1'.replace('=', '') + '.pdf',
    );
    expect(sanitizeFileName('<img src=x onerror=alert(1)>.png', 'png')).toBe(
      'img src=x onerror=alert1'.replaceAll('=', '') + '.png',
    );
  });

  it('falls back to a generic name and bounds the length', () => {
    expect(sanitizeFileName('....', 'pdf')).toBe('file.pdf');
    expect(sanitizeFileName('', 'jpg')).toBe('file.jpg');
    expect(sanitizeFileName(`${'x'.repeat(300)}.pdf`, 'pdf')).toHaveLength(84);
  });
});

describe('contentDisposition', () => {
  it('produces a header that cannot be broken out of', () => {
    const header = contentDisposition('attachment', 'report "final"\\.pdf');

    expect(header).toBe(
      `attachment; filename="report _final__.pdf"; filename*=UTF-8''report%20%22final%22%5C.pdf`,
    );
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('carries non-ASCII names in the encoded form', () => {
    expect(contentDisposition('inline', 'Élève.pdf')).toBe(
      `inline; filename="_l_ve.pdf"; filename*=UTF-8''%C3%89l%C3%A8ve.pdf`,
    );
  });
});
