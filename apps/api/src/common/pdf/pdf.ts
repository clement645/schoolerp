import { fileURLToPath } from 'node:url';
import { openSync, type Font } from 'fontkit';
import PDFDocument from 'pdfkit';

/**
 * Shared building blocks for the PDFs the API produces: report cards,
 * invoices, receipts and statements.
 *
 * Text is set in Noto Sans (SIL Open Font License, bundled in
 * `assets/fonts`), which covers Latin with its accented and extended letters,
 * Greek and Cyrillic. Characters it has no glyph for are replaced with `?`
 * rather than drawn as empty boxes; see ADR 0007.
 */

// `src/common/pdf` and `dist/common/pdf` are both three levels below the app.
const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
export const FONT_FILES = {
  Body: `${FONT_DIR}NotoSans-Regular.ttf`,
  Bold: `${FONT_DIR}NotoSans-Bold.ttf`,
  Italic: `${FONT_DIR}NotoSans-Italic.ttf`,
} as const;
export type FontName = keyof typeof FONT_FILES;

export const COLORS = {
  green: '#0b6b3a',
  ink: '#172b26',
  muted: '#64748b',
  line: '#d7dde3',
  stripe: '#f5f7f9',
  warning: '#b45309',
  danger: '#dc2626',
} as const;
export const MARGIN = 40;

let coverage: Font | null = null;

/**
 * Makes text safe to draw: typographic punctuation is kept (the font has it),
 * and any character the font cannot draw becomes `?`.
 */
export function printable(value: string): string {
  coverage ??= openSync(FONT_FILES.Body);
  const font = coverage;
  return [...value.normalize('NFC')]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code === 0x09 || code === 0x0a) return ' ';
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return '';
      return font.hasGlyphForCodePoint(code) ? character : '?';
    })
    .join('');
}

/** A new A4 document with the bundled fonts registered. Pages are added by the caller. */
export function createDocument(title: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    // Margins are handled by hand so nothing spills onto an extra page.
    margin: 0,
    autoFirstPage: false,
    info: { Title: printable(title), Creator: 'EduMaster Pro' },
  });
  for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, file);
  return doc;
}

/** Ends the document and collects it into a buffer. */
export function toBuffer(doc: PDFKit.PDFDocument, draw: () => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw();
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export interface Letterhead {
  name: string;
  motto: string | null;
  address: string | null;
  contact: string | null;
}

/**
 * The school's name, motto, address and logo across the top of a page.
 * Returns the y position below it.
 */
export function drawLetterhead(
  doc: PDFKit.PDFDocument,
  school: Letterhead,
  logo: Buffer | null,
): number {
  const width = doc.page.width - MARGIN * 2;
  let textLeft = MARGIN;
  let y = MARGIN;
  if (logo) {
    try {
      doc.image(logo, MARGIN, y, { fit: [64, 64] });
      textLeft = MARGIN + 78;
    } catch {
      // An unreadable logo must not stop a document being produced.
    }
  }
  doc.fillColor(COLORS.green).font('Bold').fontSize(17);
  doc.text(printable(school.name), textLeft, y, { width: width - (textLeft - MARGIN) });
  doc.fillColor(COLORS.muted).fontSize(8.5);
  if (school.motto) doc.font('Italic').text(printable(school.motto));
  doc.font('Body');
  if (school.address) doc.text(printable(school.address));
  if (school.contact) doc.text(printable(school.contact));
  y = Math.max(doc.y, MARGIN + (logo && textLeft > MARGIN ? 64 : 0)) + 8;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + width, y)
    .lineWidth(2)
    .strokeColor(COLORS.green)
    .stroke();
  return y + 12;
}

/** A centred document title with an optional line beneath. Returns the y below. */
export function drawTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  subtitle: string | null,
  y: number,
): number {
  const width = doc.page.width - MARGIN * 2;
  doc.fillColor(COLORS.ink).font('Bold').fontSize(13);
  doc.text(printable(title), MARGIN, y, { width, align: 'center' });
  if (subtitle) {
    doc.font('Body').fontSize(9.5).fillColor(COLORS.muted);
    doc.text(printable(subtitle), { width, align: 'center' });
  }
  return doc.y + 12;
}

/** Labelled values in two columns, e.g. "Name: Amina". Returns the y below. */
export function drawDetails(
  doc: PDFKit.PDFDocument,
  pairs: readonly [string, string][],
  y: number,
): number {
  const width = doc.page.width - MARGIN * 2;
  const half = width / 2;
  pairs.forEach(([label, value], index) => {
    const x = MARGIN + (index % 2) * half;
    const rowY = y + Math.floor(index / 2) * 17;
    doc
      .font('Body')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(`${label}:`, x, rowY + 1, { width: 88, lineBreak: false });
    doc.font('Bold').fontSize(9.5).fillColor(COLORS.ink);
    doc.text(printable(value), x + 90, rowY, {
      width: half - 96,
      ellipsis: true,
      lineBreak: false,
    });
  });
  return y + Math.ceil(pairs.length / 2) * 17 + 8;
}

export interface Column {
  label: string;
  /** Share of the page width, 0–1. */
  width: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * A table that continues onto new pages, repeating its header. `onNewPage`
 * draws whatever each continuation page starts with and returns the y to
 * resume from. Returns the y below the last row.
 */
export function drawTable(
  doc: PDFKit.PDFDocument,
  columns: readonly Column[],
  rows: readonly { cells: string[]; bold?: boolean }[],
  startY: number,
  onNewPage: () => number,
  rowHeight = 19,
): number {
  const width = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - MARGIN - 30;

  const drawRow = (
    cells: readonly string[],
    y: number,
    style: 'header' | 'stripe' | 'plain',
    bold = false,
  ) => {
    if (style === 'header') doc.rect(MARGIN, y, width, rowHeight).fill(COLORS.green);
    if (style === 'stripe') doc.rect(MARGIN, y, width, rowHeight).fill(COLORS.stripe);
    let x = MARGIN;
    doc.font(style === 'header' || bold ? 'Bold' : 'Body').fontSize(9);
    columns.forEach((column, index) => {
      const cellWidth = column.width * width;
      doc.fillColor(style === 'header' ? '#ffffff' : COLORS.ink);
      doc.text(printable(cells[index] ?? ''), x + 6, y + (rowHeight - 11) / 2, {
        width: cellWidth - 12,
        align: column.align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += cellWidth;
    });
    doc
      .moveTo(MARGIN, y + rowHeight)
      .lineTo(MARGIN + width, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke();
  };

  const header = columns.map((column) => column.label);
  let y = startY;
  drawRow(header, y, 'header');
  y += rowHeight;
  rows.forEach((row, index) => {
    if (y + rowHeight > bottom) {
      y = onNewPage();
      drawRow(header, y, 'header');
      y += rowHeight;
    }
    drawRow(row.cells, y, index % 2 === 1 ? 'stripe' : 'plain', row.bold);
    y += rowHeight;
  });
  return y;
}

/** Small print at the foot of the current page. */
export function drawFooter(doc: PDFKit.PDFDocument, text: string): void {
  const width = doc.page.width - MARGIN * 2;
  doc.font('Body').fontSize(7.5).fillColor(COLORS.muted);
  doc.text(printable(text), MARGIN, doc.page.height - MARGIN - 10, {
    width,
    align: 'center',
    lineBreak: false,
  });
}
