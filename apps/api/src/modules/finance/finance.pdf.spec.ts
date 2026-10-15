import type { Statement } from './finance-reports.service.js';
import { date, money, renderInvoice, renderReceipt, renderStatement } from './finance.pdf.js';
import type { InvoiceDetail } from './invoices.service.js';
import type { PaymentDetail } from './payments.service.js';

const branding = {
  letterhead: {
    name: 'Summit Academy',
    motto: 'Learn to serve',
    address: 'Nairobi, Kenya',
    contact: null,
  },
  logo: null,
};
const student = { id: 's1', name: 'Ngʼangʼa Wanjikũ', admissionNumber: 'ADM-0001' };

const invoice = (overrides: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'i1',
  number: 'INV-2026-000001',
  student,
  class: 'Grade 7',
  term: 'Term 3',
  issueDate: '2026-09-01',
  dueDate: '2026-09-30',
  status: 'PARTIALLY_PAID',
  isOverdue: true,
  total: 32400,
  paid: 10000,
  credited: 0,
  balance: 22400,
  subtotal: 36000,
  discountTotal: 3600,
  notes: null,
  voidReason: null,
  lines: [
    { kind: 'CHARGE', description: 'Tuition', amount: 30000 },
    { kind: 'CHARGE', description: 'Lunch', amount: 6000 },
    { kind: 'DISCOUNT', description: 'Sibling discount (10%)', amount: 3600 },
  ],
  payments: [
    {
      paymentId: 'p1',
      receiptNumber: 'RCT-2026-000001',
      paidOn: '2026-09-05',
      method: 'CASH',
      amount: 10000,
    },
  ],
  creditNotes: [],
  ...overrides,
});

const payment = (overrides: Partial<PaymentDetail> = {}): PaymentDetail => ({
  id: 'p1',
  receiptNumber: 'RCT-2026-000001',
  student,
  amount: 12000,
  method: 'MPESA',
  reference: 'QGH7X1ABCD',
  paidOn: '2026-09-05',
  status: 'COMPLETED',
  allocated: 10000,
  refunded: 0,
  unallocated: 2000,
  notes: null,
  reversalReason: null,
  reversedAt: null,
  createdAt: '2026-09-05T08:00:00.000Z',
  allocations: [{ invoiceId: 'i1', invoiceNumber: 'INV-2026-000001', amount: 10000 }],
  refunds: [],
  ...overrides,
});

const statement = (lines: number): Statement => ({
  student: { ...student, class: 'Grade 7' },
  currency: 'KES',
  from: null,
  to: null,
  openingBalance: 0,
  closingBalance: 5000,
  totals: { invoiced: 30000, paid: 25000, credited: 0, refunded: 0 },
  lines: Array.from({ length: lines }, (_, index) => ({
    date: '2026-09-05',
    kind: index % 2 === 0 ? ('INVOICE' as const) : ('PAYMENT' as const),
    reference: `REF-${index}`,
    description: index % 2 === 0 ? 'Fees — Term 3' : 'Payment by cash',
    debit: index % 2 === 0 ? 1000 : 0,
    credit: index % 2 === 0 ? 0 : 500,
    balance: 500 * (index + 1),
  })),
});

const pages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const isPdf = (pdf: Buffer) => pdf.subarray(0, 5).toString() === '%PDF-';
const embedsNoto = (pdf: Buffer) =>
  /\/FontFile2/.test(pdf.toString('latin1')) && /NotoSans/.test(pdf.toString('latin1'));

describe('finance documents', () => {
  it('formats money with its currency and dates without time-zone shifts', () => {
    expect(money(36000, 'KES')).toBe('KES 36,000.00');
    expect(money(-6000.5, 'KES')).toBe('-KES 6,000.50');
    // A malformed code does not stop a document being produced.
    expect(money(5, '??')).toBe('5.00');
    expect(date('2026-01-01')).toBe('1 Jan 2026');
  });

  it('renders an invoice on one page in the bundled font', async () => {
    const pdf = await renderInvoice(invoice(), branding, 'KES');
    expect(isPdf(pdf)).toBe(true);
    expect(pages(pdf)).toBe(1);
    expect(embedsNoto(pdf)).toBe(true);
  });

  it('renders a voided invoice and a reversed receipt', async () => {
    const voided = await renderInvoice(
      invoice({ status: 'VOID', voidReason: 'Raised in error', paid: 0, payments: [] }),
      branding,
      'KES',
    );
    const reversed = await renderReceipt(
      payment({ status: 'REVERSED', reversalReason: 'Wrong learner' }),
      branding,
      'KES',
    );
    expect([pages(voided), pages(reversed)]).toEqual([1, 1]);
  });

  it('renders a receipt, and survives a logo that is not an image', async () => {
    const pdf = await renderReceipt(
      payment(),
      { ...branding, logo: Buffer.from('not an image') },
      'KES',
    );
    expect(isPdf(pdf)).toBe(true);
    expect(pages(pdf)).toBe(1);
  });

  it('continues a long statement onto further pages', async () => {
    expect(pages(await renderStatement(statement(5), branding))).toBe(1);
    const long = await renderStatement(statement(120), branding);
    expect(pages(long)).toBeGreaterThanOrEqual(4);
  });

  it('renders an empty statement', async () => {
    expect(pages(await renderStatement(statement(0), branding))).toBe(1);
  });
});
