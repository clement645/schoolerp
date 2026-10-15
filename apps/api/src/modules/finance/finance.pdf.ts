import {
  COLORS,
  createDocument,
  drawDetails,
  drawFooter,
  drawLetterhead,
  drawTable,
  drawTitle,
  MARGIN,
  printable,
  toBuffer,
  type Letterhead,
} from '../../common/pdf/pdf.js';
import type { Statement } from './finance-reports.service.js';
import type { InvoiceDetail } from './invoices.service.js';
import type { PaymentDetail } from './payments.service.js';

export interface Branding {
  letterhead: Letterhead;
  logo: Buffer | null;
}

const formatters = new Map<string, Intl.NumberFormat>();
/** `KES 36,000.00`; a plain number for an unrecognised currency code. */
export function money(amount: number, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
      });
    } catch {
      formatter = new Intl.NumberFormat('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    formatters.set(currency, formatter);
  }
  return formatter.format(amount).replace(/\u00a0/g, ' ');
}

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** `13 Oct 2026` from `YYYY-MM-DD` or an ISO timestamp. */
export const date = (value: string): string =>
  day.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));

const METHOD: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  MPESA: 'M-Pesa',
  CARD: 'Card',
};
export const methodLabel = (method: string): string => METHOD[method] ?? method;

const STATUS: Record<InvoiceDetail['status'], string> = {
  ISSUED: 'Unpaid',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  VOID: 'Void',
};

const generated = () =>
  `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by EduMaster Pro.`;

/** Right-aligned label/value lines, e.g. totals under a table. Returns the y below. */
function drawTotals(
  doc: PDFKit.PDFDocument,
  lines: [string, string, boolean?][],
  y: number,
): number {
  const width = doc.page.width - MARGIN * 2;
  for (const [label, value, strong] of lines) {
    doc
      .font(strong ? 'Bold' : 'Body')
      .fontSize(strong ? 10.5 : 9.5)
      .fillColor(COLORS.ink);
    doc.text(printable(label), MARGIN + width * 0.45, y, {
      width: width * 0.3,
      align: 'right',
      lineBreak: false,
    });
    doc.text(printable(value), MARGIN + width * 0.75, y, {
      width: width * 0.25 - 6,
      align: 'right',
      lineBreak: false,
    });
    y += strong ? 18 : 15;
  }
  return y + 6;
}

/** A large, faint word across the page: VOID, REVERSED. */
function stamp(doc: PDFKit.PDFDocument, word: string): void {
  doc.save();
  doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Bold').fontSize(80).fillColor(COLORS.danger).opacity(0.1);
  doc.text(word, 0, doc.page.height / 2 - 40, {
    width: doc.page.width,
    align: 'center',
    lineBreak: false,
  });
  doc.restore();
}

function newPage(doc: PDFKit.PDFDocument, branding: Branding, continued: string): number {
  doc.addPage();
  const y = drawLetterhead(doc, branding.letterhead, branding.logo);
  doc.font('Italic').fontSize(8.5).fillColor(COLORS.muted).text(printable(continued), MARGIN, y);
  return doc.y + 8;
}

export function renderInvoice(
  invoice: InvoiceDetail,
  branding: Branding,
  currency: string,
): Promise<Buffer> {
  const doc = createDocument(`Invoice ${invoice.number}`);
  const m = (amount: number) => money(amount, currency);
  return toBuffer(doc, () => {
    doc.addPage();
    let y = drawLetterhead(doc, branding.letterhead, branding.logo);
    y = drawTitle(doc, 'INVOICE', invoice.number, y);
    y = drawDetails(
      doc,
      [
        ['Learner', invoice.student.name],
        ['Admission No.', invoice.student.admissionNumber],
        ['Class', invoice.class ?? '-'],
        ['Term', invoice.term ?? 'One-off charge'],
        ['Issued', date(invoice.issueDate)],
        ['Due', date(invoice.dueDate)],
        ['Status', `${STATUS[invoice.status]}${invoice.isOverdue ? ' (overdue)' : ''}`],
      ],
      y,
    );
    y = drawTable(
      doc,
      [
        { label: 'Description', width: 0.7 },
        { label: 'Amount', width: 0.3, align: 'right' },
      ],
      invoice.lines.map((line) => ({
        cells: [
          line.kind === 'DISCOUNT' ? `Less: ${line.description}` : line.description,
          `${line.kind === 'DISCOUNT' ? '-' : ''}${m(line.amount)}`,
        ],
      })),
      y,
      () => newPage(doc, branding, `Invoice ${invoice.number}, continued`),
    );
    y = drawTotals(
      doc,
      [
        ['Total', m(invoice.total), true],
        ...(invoice.paid > 0 ? ([['Paid', `-${m(invoice.paid)}`]] as [string, string][]) : []),
        ...(invoice.credited > 0
          ? ([['Credited', `-${m(invoice.credited)}`]] as [string, string][])
          : []),
        ['Balance due', m(invoice.balance), true],
      ],
      y + 10,
    );

    if (invoice.payments.length > 0 || invoice.creditNotes.length > 0) {
      doc.font('Bold').fontSize(9.5).fillColor(COLORS.ink).text('Payments and credits', MARGIN, y);
      y = doc.y + 4;
      y = drawTable(
        doc,
        [
          { label: 'Date', width: 0.2 },
          { label: 'Reference', width: 0.25 },
          { label: 'Details', width: 0.33 },
          { label: 'Amount', width: 0.22, align: 'right' },
        ],
        [
          ...invoice.payments.map((payment) => ({
            cells: [
              date(payment.paidOn),
              payment.receiptNumber,
              methodLabel(payment.method),
              m(payment.amount),
            ],
          })),
          ...invoice.creditNotes.map((note) => ({
            cells: [date(note.createdAt), note.number, `Credit: ${note.reason}`, m(note.amount)],
          })),
        ],
        y,
        () => newPage(doc, branding, `Invoice ${invoice.number}, continued`),
        17,
      );
    }
    if (invoice.notes) {
      doc
        .font('Italic')
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(printable(invoice.notes), MARGIN, y + 10, {
          width: doc.page.width - MARGIN * 2,
        });
    }
    if (invoice.status === 'VOID') {
      stamp(doc, 'VOID');
      if (invoice.voidReason) {
        doc
          .font('Bold')
          .fontSize(9)
          .fillColor(COLORS.danger)
          .text(printable(`Voided: ${invoice.voidReason}`), MARGIN, doc.y + 12);
      }
    }
    drawFooter(doc, generated());
  });
}

export function renderReceipt(
  payment: PaymentDetail,
  branding: Branding,
  currency: string,
): Promise<Buffer> {
  const doc = createDocument(`Receipt ${payment.receiptNumber}`);
  const m = (amount: number) => money(amount, currency);
  return toBuffer(doc, () => {
    doc.addPage();
    let y = drawLetterhead(doc, branding.letterhead, branding.logo);
    y = drawTitle(doc, 'RECEIPT', payment.receiptNumber, y);
    y = drawDetails(
      doc,
      [
        ['Received from', payment.student.name],
        ['Admission No.', payment.student.admissionNumber],
        ['Date', date(payment.paidOn)],
        ['Method', methodLabel(payment.method)],
        ['Reference', payment.reference ?? '-'],
        ['Status', payment.status === 'COMPLETED' ? 'Completed' : 'Reversed'],
      ],
      y,
    );
    const width = doc.page.width - MARGIN * 2;
    doc.roundedRect(MARGIN, y, width, 46, 6).fillAndStroke('#e8f5ed', COLORS.green);
    doc
      .font('Body')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text('AMOUNT RECEIVED', MARGIN, y + 8, { width, align: 'center' });
    doc
      .font('Bold')
      .fontSize(16)
      .fillColor(COLORS.green)
      .text(m(payment.amount), MARGIN, y + 21, { width, align: 'center' });
    y += 60;

    if (payment.allocations.length > 0) {
      doc.font('Bold').fontSize(9.5).fillColor(COLORS.ink).text('Applied to', MARGIN, y);
      y = drawTable(
        doc,
        [
          { label: 'Invoice', width: 0.7 },
          { label: 'Amount', width: 0.3, align: 'right' },
        ],
        payment.allocations.map((line) => ({ cells: [line.invoiceNumber, m(line.amount)] })),
        doc.y + 4,
        () => newPage(doc, branding, `Receipt ${payment.receiptNumber}, continued`),
        17,
      );
    }
    const extra: [string, string][] = [];
    if (payment.refunded > 0) extra.push(['Refunded', m(payment.refunded)]);
    if (payment.unallocated > 0) extra.push(['Held as credit', m(payment.unallocated)]);
    if (extra.length) y = drawTotals(doc, extra, y + 10);
    if (payment.status === 'REVERSED') {
      stamp(doc, 'REVERSED');
      doc.font('Bold').fontSize(9).fillColor(COLORS.danger);
      doc.text(printable(`Reversed: ${payment.reversalReason ?? ''}`), MARGIN, y + 10);
    }
    drawFooter(doc, `${generated()} This receipt is not valid if reversed.`);
  });
}

const KIND: Record<Statement['lines'][number]['kind'], string> = {
  INVOICE: 'Invoice',
  INVOICE_VOIDED: 'Invoice voided',
  CREDIT_NOTE: 'Credit note',
  PAYMENT: 'Payment',
  PAYMENT_REVERSED: 'Payment reversed',
  REFUND: 'Refund',
};

export function renderStatement(statement: Statement, branding: Branding): Promise<Buffer> {
  const doc = createDocument(`Statement - ${statement.student.name}`);
  const m = (amount: number) => money(amount, statement.currency);
  const period =
    statement.from || statement.to
      ? `${statement.from ? date(statement.from) : 'Opening'} to ${statement.to ? date(statement.to) : 'today'}`
      : 'All activity';
  return toBuffer(doc, () => {
    doc.addPage();
    let y = drawLetterhead(doc, branding.letterhead, branding.logo);
    y = drawTitle(doc, 'STATEMENT OF ACCOUNT', period, y);
    y = drawDetails(
      doc,
      [
        ['Learner', statement.student.name],
        ['Admission No.', statement.student.admissionNumber],
        ['Class', statement.student.class ?? '-'],
        ['Currency', statement.currency],
      ],
      y,
    );
    const rows = [
      ...(statement.openingBalance !== 0
        ? [{ cells: ['', '', 'Balance brought forward', '', '', m(statement.openingBalance)] }]
        : []),
      ...statement.lines.map((line) => ({
        cells: [
          date(line.date),
          line.reference,
          `${KIND[line.kind]}: ${line.description}`,
          line.debit ? m(line.debit) : '',
          line.credit ? m(line.credit) : '',
          m(line.balance),
        ],
      })),
    ];
    if (rows.length === 0)
      rows.push({ cells: ['', '', 'Nothing was posted in this period.', '', '', ''] });
    y = drawTable(
      doc,
      [
        { label: 'Date', width: 0.13 },
        { label: 'Reference', width: 0.17 },
        { label: 'Details', width: 0.28 },
        { label: 'Charged', width: 0.14, align: 'right' },
        { label: 'Paid', width: 0.14, align: 'right' },
        { label: 'Balance', width: 0.14, align: 'right' },
      ],
      rows,
      y,
      () => {
        drawFooter(doc, generated());
        return newPage(
          doc,
          branding,
          `Statement of account - ${statement.student.name}, continued`,
        );
      },
      17,
    );
    if (y > doc.page.height - MARGIN - 110)
      y = newPage(doc, branding, `Statement of account - ${statement.student.name}, continued`);
    const closing = statement.closingBalance;
    drawTotals(
      doc,
      [
        ['Invoiced', m(statement.totals.invoiced)],
        ['Paid', m(statement.totals.paid)],
        ...(statement.totals.credited
          ? ([['Credited', m(statement.totals.credited)]] as [string, string][])
          : []),
        ...(statement.totals.refunded
          ? ([['Refunded', m(statement.totals.refunded)]] as [string, string][])
          : []),
        [closing < 0 ? 'In credit' : 'Balance due', m(Math.abs(closing)), true],
      ],
      y + 10,
    );
    drawFooter(doc, generated());
  });
}
