import { z } from 'zod';
import { apiDownload, apiRequest, type DownloadedFile } from '@/services/http';
import { paginatedSchema, type Paginated } from '@/types/api';

const studentRef = z.object({ id: z.string(), name: z.string(), admissionNumber: z.string() });

// ── Fees ─────────────────────────────────────────────────────────────────────

export const feeItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
});
export const feeStructureSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  term: z.object({ id: z.string(), name: z.string(), academicYear: z.string() }),
  class: z.object({ id: z.string(), name: z.string() }).nullable(),
  lines: z.array(z.object({ feeItemId: z.string(), feeItem: z.string(), amount: z.number() })),
  total: z.number(),
  invoiceCount: z.number(),
});
export const discountSchema = z.object({
  id: z.string(),
  student: studentRef,
  name: z.string(),
  category: z.enum(['DISCOUNT', 'SCHOLARSHIP']),
  kind: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number(),
  feeItem: z.object({ id: z.string(), name: z.string() }).nullable(),
  isActive: z.boolean(),
});

export type FeeItem = z.infer<typeof feeItemSchema>;
export type FeeStructure = z.infer<typeof feeStructureSchema>;
export type Discount = z.infer<typeof discountSchema>;

export interface FeeStructureInput {
  name: string;
  termId: string;
  classId: string | null;
  isActive?: boolean;
  lines: { feeItemId: string; amount: number }[];
}
export interface DiscountInput {
  studentId: string;
  name: string;
  category: Discount['category'];
  kind: Discount['kind'];
  value: number;
  feeItemId: string | null;
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export const invoiceStatusSchema = z.enum(['ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']);
export const invoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  student: studentRef,
  class: z.string().nullable(),
  term: z.string().nullable(),
  issueDate: z.string(),
  dueDate: z.string(),
  status: invoiceStatusSchema,
  isOverdue: z.boolean(),
  total: z.number(),
  paid: z.number(),
  credited: z.number(),
  balance: z.number(),
});
export const invoiceDetailSchema = invoiceSummarySchema.extend({
  subtotal: z.number(),
  discountTotal: z.number(),
  notes: z.string().nullable(),
  voidReason: z.string().nullable(),
  lines: z.array(
    z.object({ kind: z.enum(['CHARGE', 'DISCOUNT']), description: z.string(), amount: z.number() }),
  ),
  payments: z.array(
    z.object({
      paymentId: z.string(),
      receiptNumber: z.string(),
      paidOn: z.string(),
      method: z.string(),
      amount: z.number(),
    }),
  ),
  creditNotes: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      amount: z.number(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export const generationResultSchema = z.object({
  created: z.number(),
  skipped: z.number(),
  totalInvoiced: z.number(),
});

export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type GenerationResult = z.infer<typeof generationResultSchema>;
export type InvoiceFilter = InvoiceStatus | 'OUTSTANDING' | 'OVERDUE' | '';

export interface InvoiceListParams {
  page: number;
  pageSize: number;
  status?: InvoiceFilter;
  studentId?: string;
  classId?: string;
  termId?: string;
  search?: string;
}
export interface InvoiceInput {
  studentId: string;
  termId?: string | null;
  dueDate: string;
  notes?: string | null;
  lines: { feeItemId?: string | null; description: string; amount: number }[];
}

// ── Payments ─────────────────────────────────────────────────────────────────

export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentSummarySchema = z.object({
  id: z.string(),
  receiptNumber: z.string(),
  student: studentRef,
  amount: z.number(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  paidOn: z.string(),
  status: z.enum(['COMPLETED', 'REVERSED']),
  allocated: z.number(),
  refunded: z.number(),
  unallocated: z.number(),
});
export const paymentDetailSchema = paymentSummarySchema.extend({
  notes: z.string().nullable(),
  reversalReason: z.string().nullable(),
  reversedAt: z.string().nullable(),
  createdAt: z.string(),
  allocations: z.array(
    z.object({ invoiceId: z.string(), invoiceNumber: z.string(), amount: z.number() }),
  ),
  refunds: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      amount: z.number(),
      method: z.string(),
      reason: z.string(),
      refundedOn: z.string(),
    }),
  ),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

export interface PaymentListParams {
  page: number;
  pageSize: number;
  studentId?: string;
  method?: PaymentMethod | '';
  status?: 'COMPLETED' | 'REVERSED' | '';
  from?: string;
  to?: string;
  search?: string;
}
export interface PaymentInput {
  studentId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidOn?: string;
  invoiceId?: string;
  notes?: string | null;
}
export interface RefundInput {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  reason: string;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export const statementSchema = z.object({
  student: studentRef.extend({ class: z.string().nullable() }),
  currency: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  openingBalance: z.number(),
  closingBalance: z.number(),
  totals: z.object({
    invoiced: z.number(),
    paid: z.number(),
    credited: z.number(),
    refunded: z.number(),
  }),
  lines: z.array(
    z.object({
      date: z.string(),
      kind: z.enum([
        'INVOICE',
        'INVOICE_VOIDED',
        'CREDIT_NOTE',
        'PAYMENT',
        'PAYMENT_REVERSED',
        'REFUND',
      ]),
      reference: z.string(),
      description: z.string(),
      debit: z.number(),
      credit: z.number(),
      balance: z.number(),
    }),
  ),
});
export const financeSummarySchema = z.object({
  currency: z.string(),
  totals: z.object({
    invoiced: z.number(),
    credited: z.number(),
    collected: z.number(),
    outstanding: z.number(),
    overdue: z.number(),
    overdueInvoices: z.number(),
    collectionRate: z.number(),
    unallocated: z.number(),
  }),
  byMethod: z.array(z.object({ method: z.string(), amount: z.number(), payments: z.number() })),
  monthly: z.array(z.object({ month: z.string(), amount: z.number() })),
  byClass: z.array(z.object({ class: z.string(), invoiced: z.number(), outstanding: z.number() })),
  topBalances: z.array(
    z.object({ student: studentRef, class: z.string().nullable(), balance: z.number() }),
  ),
  recentPayments: z.array(paymentSummarySchema),
});
export type Statement = z.infer<typeof statementSchema>;
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

// ── M-Pesa ───────────────────────────────────────────────────────────────────

export const mpesaStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT']);
export const mpesaTransactionSchema = z.object({
  id: z.string(),
  student: studentRef,
  invoiceNumber: z.string().nullable(),
  phone: z.string(),
  amount: z.number(),
  status: mpesaStatusSchema,
  resultDescription: z.string().nullable(),
  mpesaReceiptNumber: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export const mpesaConfigSchema = z.object({
  configured: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
});
export type MpesaTransaction = z.infer<typeof mpesaTransactionSchema>;
export type MpesaConfig = z.infer<typeof mpesaConfigSchema>;
export interface StkPushInput {
  studentId: string;
  invoiceId?: string;
  phone: string;
  amount: number;
}

// ── API ──────────────────────────────────────────────────────────────────────

const clean = <T extends object>(params: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== '' && value !== undefined),
  ) as Partial<T>;
const get = <T extends z.ZodType>(url: string, schema: T, params?: object) =>
  apiRequest({ method: 'GET', url: `/finance${url}`, params: params && clean(params) }, schema);
const send = <T extends z.ZodType>(
  method: 'POST' | 'PUT' | 'PATCH',
  url: string,
  data: unknown,
  schema: T,
) => apiRequest({ method, url: `/finance${url}`, data }, schema);

export const financeApi = {
  feeItems: (): Promise<FeeItem[]> => get('/fee-items', z.array(feeItemSchema)),
  createFeeItem: (data: { name: string; description?: string | null }): Promise<FeeItem> =>
    send('POST', '/fee-items', data, feeItemSchema),
  updateFeeItem: (id: string, data: Partial<Omit<FeeItem, 'id'>>): Promise<FeeItem> =>
    send('PATCH', `/fee-items/${id}`, data, feeItemSchema),

  feeStructures: (): Promise<FeeStructure[]> => get('/fee-structures', z.array(feeStructureSchema)),
  createFeeStructure: (data: FeeStructureInput): Promise<FeeStructure> =>
    send('POST', '/fee-structures', data, feeStructureSchema),
  updateFeeStructure: (id: string, data: FeeStructureInput): Promise<FeeStructure> =>
    send('PUT', `/fee-structures/${id}`, data, feeStructureSchema),

  discounts: (studentId?: string): Promise<Discount[]> =>
    get('/discounts', z.array(discountSchema), { studentId }),
  createDiscount: (data: DiscountInput): Promise<Discount> =>
    send('POST', '/discounts', data, discountSchema),
  setDiscountActive: (id: string, isActive: boolean): Promise<Discount> =>
    send('PATCH', `/discounts/${id}`, { isActive }, discountSchema),

  invoices: (params: InvoiceListParams): Promise<Paginated<InvoiceSummary>> =>
    get('/invoices', paginatedSchema(invoiceSummarySchema), params),
  invoice: (id: string): Promise<InvoiceDetail> => get(`/invoices/${id}`, invoiceDetailSchema),
  createInvoice: (data: InvoiceInput): Promise<InvoiceDetail> =>
    send('POST', '/invoices', data, invoiceDetailSchema),
  generateInvoices: (feeStructureId: string, dueDate: string): Promise<GenerationResult> =>
    send('POST', '/invoices/generate', { feeStructureId, dueDate }, generationResultSchema),
  voidInvoice: (id: string, reason: string): Promise<InvoiceDetail> =>
    send('POST', `/invoices/${id}/void`, { reason }, invoiceDetailSchema),
  creditInvoice: (id: string, amount: number, reason: string): Promise<InvoiceDetail> =>
    send('POST', `/invoices/${id}/credit-notes`, { amount, reason }, invoiceDetailSchema),

  payments: (params: PaymentListParams): Promise<Paginated<PaymentSummary>> =>
    get('/payments', paginatedSchema(paymentSummarySchema), params),
  payment: (id: string): Promise<PaymentDetail> => get(`/payments/${id}`, paymentDetailSchema),
  recordPayment: (data: PaymentInput): Promise<PaymentDetail> =>
    send('POST', '/payments', clean(data), paymentDetailSchema),
  reversePayment: (id: string, reason: string): Promise<PaymentDetail> =>
    send('POST', `/payments/${id}/reverse`, { reason }, paymentDetailSchema),
  refundPayment: (id: string, data: RefundInput): Promise<PaymentDetail> =>
    send('POST', `/payments/${id}/refunds`, clean(data), paymentDetailSchema),

  summary: (termId?: string): Promise<FinanceSummary> =>
    get('/summary', financeSummarySchema, { termId }),
  statement: (studentId: string, from?: string, to?: string): Promise<Statement> =>
    get(`/students/${studentId}/statement`, statementSchema, { from, to }),

  invoicePdf: (id: string): Promise<DownloadedFile> =>
    apiDownload({ url: `/finance/invoices/${id}/pdf` }, 'invoice.pdf'),
  receiptPdf: (paymentId: string): Promise<DownloadedFile> =>
    apiDownload({ url: `/finance/payments/${paymentId}/pdf` }, 'receipt.pdf'),
  statementPdf: (studentId: string, from?: string, to?: string): Promise<DownloadedFile> =>
    apiDownload(
      { url: `/finance/students/${studentId}/statement/pdf`, params: clean({ from, to }) },
      'statement.pdf',
    ),
  statementCsv: (studentId: string, from?: string, to?: string): Promise<DownloadedFile> =>
    apiDownload(
      { url: `/finance/students/${studentId}/statement/csv`, params: clean({ from, to }) },
      'statement.csv',
    ),
  exportInvoices: (params: Omit<InvoiceListParams, 'page' | 'pageSize'>): Promise<DownloadedFile> =>
    apiDownload({ url: '/finance/exports/invoices.csv', params: clean(params) }, 'invoices.csv'),
  exportPayments: (params: Omit<PaymentListParams, 'page' | 'pageSize'>): Promise<DownloadedFile> =>
    apiDownload({ url: '/finance/exports/payments.csv', params: clean(params) }, 'payments.csv'),

  mpesaConfig: (): Promise<MpesaConfig> => get('/mpesa/config', mpesaConfigSchema),
  mpesaTransactions: (params: {
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<Paginated<MpesaTransaction>> =>
    get('/mpesa/transactions', paginatedSchema(mpesaTransactionSchema), params),
  stkPush: (data: StkPushInput): Promise<MpesaTransaction> =>
    send('POST', '/mpesa/stk-push', clean(data), mpesaTransactionSchema),
  verifyMpesa: (id: string): Promise<MpesaTransaction> =>
    send('POST', `/mpesa/transactions/${id}/verify`, undefined, mpesaTransactionSchema),
};

// ── Presentation ─────────────────────────────────────────────────────────────

type Variant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; variant: Variant }> = {
  ISSUED: { label: 'Unpaid', variant: 'warning' },
  PARTIALLY_PAID: { label: 'Part paid', variant: 'info' },
  PAID: { label: 'Paid', variant: 'success' },
  VOID: { label: 'Void', variant: 'neutral' },
};

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'MPESA', label: 'M-Pesa' },
];
/** Methods a person may record by hand; M-Pesa is confirmed by Safaricom only. */
export const MANUAL_METHODS = PAYMENT_METHODS.filter((method) => method.value !== 'MPESA');

export const methodLabel = (method: string): string =>
  PAYMENT_METHODS.find((entry) => entry.value === method)?.label ?? method;

export const MPESA_STATUS: Record<MpesaTransaction['status'], { label: string; variant: Variant }> =
  {
    PENDING: { label: 'Awaiting payer', variant: 'warning' },
    SUCCESS: { label: 'Paid', variant: 'success' },
    FAILED: { label: 'Failed', variant: 'danger' },
    CANCELLED: { label: 'Cancelled', variant: 'neutral' },
    TIMEOUT: { label: 'Timed out', variant: 'neutral' },
  };

export const STATEMENT_KIND: Record<Statement['lines'][number]['kind'], string> = {
  INVOICE: 'Invoice',
  INVOICE_VOIDED: 'Invoice voided',
  CREDIT_NOTE: 'Credit note',
  PAYMENT: 'Payment',
  PAYMENT_REVERSED: 'Payment reversed',
  REFUND: 'Refund',
};

const formatters = new Map<string, Intl.NumberFormat>();

/** `KES 36,000.00`. Falls back to a plain number for an unknown currency code. */
export function formatMoney(amount: number, currency = 'KES'): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
      });
    } catch {
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 });
    }
    formatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

/**
 * Reads an amount typed by a person. Returns null unless it is a positive
 * number with at most two decimal places — money is never rounded silently.
 */
export function parseAmount(text: string | number): number | null {
  const cleaned = String(text).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 && value <= 999_999_999 ? value : null;
}
