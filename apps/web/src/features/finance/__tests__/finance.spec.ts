import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi } from '@/services/__tests__/fake-api';
import { todayIso } from '@/utils/format';
import InvoiceDetailModal from '../InvoiceDetailModal.vue';
import MpesaPushModal from '../MpesaPushModal.vue';
import RecordPaymentModal from '../RecordPaymentModal.vue';
import { formatMoney, parseAmount } from '../finance.service';

const POLICIES = {
  passMark: 50,
  rankingPolicy: 'COMPETITION',
  showClassPosition: true,
  showStreamPosition: true,
  currency: 'KES',
};
const STUDENT = { id: 's1', name: 'Amina Otieno', admissionNumber: 'ADM-0001', class: 'Grade 7' };
const INVOICE = {
  id: 'inv-1',
  number: 'INV-2026-000001',
  student: { id: 's1', name: 'Amina Otieno', admissionNumber: 'ADM-0001' },
  class: 'Grade 7',
  term: 'Term 3',
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  status: 'PARTIALLY_PAID',
  isOverdue: false,
  total: 36000,
  paid: 10000,
  credited: 0,
  balance: 26000,
  subtotal: 36000,
  discountTotal: 0,
  notes: null,
  voidReason: null,
  lines: [{ kind: 'CHARGE', description: 'Tuition', amount: 36000 }],
  payments: [
    {
      paymentId: 'p1',
      receiptNumber: 'RCT-2026-000001',
      paidOn: '2026-10-05',
      method: 'CASH',
      amount: 10000,
    },
  ],
  creditNotes: [],
};
const PAYMENT = {
  id: 'p2',
  receiptNumber: 'RCT-2026-000002',
  student: INVOICE.student,
  amount: 30000,
  method: 'BANK_TRANSFER',
  reference: 'BNK-123',
  paidOn: todayIso(),
  status: 'COMPLETED',
  allocated: 26000,
  refunded: 0,
  unallocated: 4000,
  notes: null,
  reversalReason: null,
  reversedAt: null,
  createdAt: '2026-10-13T08:00:00.000Z',
  allocations: [{ invoiceId: 'inv-1', invoiceNumber: 'INV-2026-000001', amount: 26000 }],
  refunds: [],
};

const plugins = () =>
  [
    [
      VueQueryPlugin,
      { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    ],
  ] as never;
const body = () => document.body;
const field = (label: string) =>
  Array.from(body().querySelectorAll('label'))
    .find((entry) => entry.textContent?.trim().startsWith(label))
    ?.parentElement?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
function type(label: string, value: string): void {
  const input = field(label);
  if (!input) throw new Error(`no field labelled ${label}`);
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}
const submit = (id: string) =>
  body().querySelector<HTMLFormElement>(`#${id}`)?.dispatchEvent(new Event('submit'));
const buttons = () =>
  Array.from(body().querySelectorAll('button')).map((button) => button.textContent?.trim());

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('money helpers', () => {
  it('accepts only positive amounts with at most two decimals', () => {
    expect(parseAmount('36,000')).toBe(36000);
    expect(parseAmount(' 1250.50 ')).toBe(1250.5);
    expect(parseAmount(99)).toBe(99);
    for (const bad of ['', '0', '-5', '10.005', 'abc', '1e3', '12.', '1000000000']) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });

  it('formats amounts with the currency code', () => {
    expect(formatMoney(36000, 'KES')).toMatch(/KES\s?36,000\.00/);
    // An unrecognised code does not break the page.
    expect(formatMoney(5, '???')).toContain('5.00');
  });
});

describe('RecordPaymentModal', () => {
  const mountModal = () =>
    mount(RecordPaymentModal, {
      props: {
        open: false,
        student: STUDENT,
        invoice: { id: 'inv-1', number: 'INV-2026-000001', balance: 26000 },
      },
      global: { plugins: plugins() },
      attachTo: document.body,
    });

  it('requires a reference for anything but cash, then shows where the money went', async () => {
    const api = fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'POST /finance/payments': () => ok(PAYMENT, 201),
    });
    const modal = mountModal();
    await modal.setProps({ open: true });
    await vi.waitFor(() => expect(field('Amount')?.value).toBe('26000'));

    type('Amount', '30000');
    type('Method', 'BANK_TRANSFER');
    await vi.waitFor(() => expect(field('Reference')).toBeTruthy());
    submit('payment-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="payment-error"]')?.textContent).toContain(
        'Enter the transaction reference',
      ),
    );
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);

    type('Reference', 'bnk-123');
    submit('payment-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="payment-receipt"]')).toBeTruthy(),
    );
    expect(api.calls.find((call) => call.method === 'POST')?.data).toEqual({
      studentId: 's1',
      amount: 30000,
      method: 'BANK_TRANSFER',
      reference: 'bnk-123',
      paidOn: todayIso(),
      invoiceId: 'inv-1',
      notes: null,
    });
    const receipt = body().querySelector('[data-testid="payment-receipt"]')?.textContent ?? '';
    expect(receipt).toContain('RCT-2026-000002');
    expect(receipt).toContain('Applied to INV-2026-000001');
    expect(receipt).toContain('Held as credit');
    modal.unmount();
  });

  it('rejects an amount that is not money, and shows a refusal from the server', async () => {
    fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'POST /finance/payments': () =>
        fail(
          409,
          'DUPLICATE_PAYMENT',
          'This transaction has already been recorded as receipt RCT-1.',
        ),
    });
    const modal = mountModal();
    await modal.setProps({ open: true });
    await vi.waitFor(() => expect(field('Amount')).toBeTruthy());

    type('Amount', '10.005');
    submit('payment-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="payment-error"]')?.textContent).toContain(
        'at most 2 decimal places',
      ),
    );

    type('Amount', '500');
    submit('payment-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="payment-error"]')?.textContent).toContain(
        'already been recorded',
      ),
    );
    expect(body().querySelector('[data-testid="payment-receipt"]')).toBeNull();
    modal.unmount();
  });

  it('does not offer M-Pesa as a method to enter by hand', async () => {
    fakeApi({ 'GET /school/settings': () => ok(POLICIES) });
    const modal = mountModal();
    await modal.setProps({ open: true });
    await vi.waitFor(() => expect(field('Method')).toBeTruthy());
    const options = Array.from(field('Method')?.querySelectorAll('option') ?? []).map(
      (o) => o.value,
    );
    expect(options).toEqual(expect.arrayContaining(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD']));
    expect(options).not.toContain('MPESA');
    modal.unmount();
  });
});

describe('MpesaPushModal', () => {
  it('sends a request and makes clear nothing is credited until confirmed', async () => {
    const pending = {
      id: 'm1',
      student: INVOICE.student,
      invoiceNumber: 'INV-2026-000001',
      phone: '*********678',
      amount: 26000,
      status: 'PENDING',
      resultDescription: null,
      mpesaReceiptNumber: null,
      receiptNumber: null,
      createdAt: '2026-10-13T08:00:00.000Z',
      completedAt: null,
    };
    const api = fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'POST /finance/mpesa/stk-push': () => ok(pending, 201),
      'POST /finance/mpesa/transactions/m1/verify': () =>
        ok({ ...pending, status: 'SUCCESS', receiptNumber: 'RCT-2026-000009' }),
    });
    const modal = mount(MpesaPushModal, {
      props: {
        open: false,
        student: STUDENT,
        invoice: { id: 'inv-1', number: 'INV-2026-000001', balance: 25999.5 },
      },
      global: { plugins: plugins() },
      attachTo: document.body,
    });
    await modal.setProps({ open: true });
    // A part-shilling balance is rounded up to whole shillings.
    await vi.waitFor(() => expect(field('Amount (whole shillings)')?.value).toBe('26000'));

    type('Phone to prompt', '12345');
    submit('mpesa-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="mpesa-error"]')?.textContent).toContain(
        'Safaricom number',
      ),
    );
    type('Phone to prompt', '0712345678');
    submit('mpesa-form');
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="mpesa-request"]')).toBeTruthy(),
    );
    expect(api.calls.find((call) => call.url === '/finance/mpesa/stk-push')?.data).toEqual({
      studentId: 's1',
      invoiceId: 'inv-1',
      phone: '0712345678',
      amount: 26000,
    });
    expect(body().textContent).toContain('nothing has been credited yet');

    Array.from(body().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Check status'))
      ?.click();
    await vi.waitFor(() =>
      expect(body().textContent).toContain('recorded as receipt RCT-2026-000009'),
    );
    modal.unmount();
  });
});

describe('InvoiceDetailModal', () => {
  const mountDetail = (canManage: boolean, mpesaReady = false) =>
    mount(InvoiceDetailModal, {
      props: { open: true, invoiceId: 'inv-1', canManage, mpesaReady },
      global: { plugins: plugins() },
      attachTo: document.body,
    });

  it('offers only the corrections that apply to the invoice', async () => {
    fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'GET /finance/invoices/inv-1': () => ok(INVOICE),
    });
    const modal = mountDetail(true);
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="invoice-balance"]')).toBeTruthy(),
    );

    expect(body().querySelector('[data-testid="invoice-balance"]')?.textContent).toMatch(
      /26,000\.00/,
    );
    // Something has been paid, so it can be credited but not voided.
    expect(buttons()).toEqual(expect.arrayContaining(['Credit note', 'Record payment']));
    expect(buttons()).not.toContain('Void');
    expect(buttons()).not.toContain('Pay by M-Pesa');
    modal.unmount();
  });

  it('offers M-Pesa only when it is set up, and nothing to someone who cannot manage finance', async () => {
    fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'GET /finance/invoices/inv-1': () =>
        ok({ ...INVOICE, paid: 0, balance: 36000, status: 'ISSUED', payments: [] }),
    });
    const manager = mountDetail(true, true);
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="invoice-balance"]')).toBeTruthy(),
    );
    expect(buttons()).toEqual(
      expect.arrayContaining(['Void', 'Credit note', 'Pay by M-Pesa', 'Record payment']),
    );
    manager.unmount();
    document.body.innerHTML = '';

    const viewer = mountDetail(false, true);
    await vi.waitFor(() =>
      expect(body().querySelector('[data-testid="invoice-balance"]')).toBeTruthy(),
    );
    for (const action of ['Void', 'Credit note', 'Pay by M-Pesa', 'Record payment']) {
      expect(buttons()).not.toContain(action);
    }
    // Anyone who can see an invoice can print it.
    expect(buttons()).toContain('PDF');
    viewer.unmount();
  });
});

describe('finance documents', () => {
  it('downloads the invoice list with the filters on screen', async () => {
    const api = fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'GET /classes': () => ok([]),
      'GET /finance/mpesa/config': () => ok({ configured: false, environment: 'sandbox' }),
      'GET /finance/invoices': () => ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      'GET /finance/exports/invoices.csv': () => ({
        status: 200,
        body: new Blob(['Invoice\r\n'], { type: 'text/csv' }),
      }),
    });
    const saved: string[] = [];
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      saved.push('blob');
      return 'blob:fake';
    });
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { default: InvoicesView } = await import('../InvoicesView.vue');
    const { createMemoryHistory, createRouter } = await import('vue-router');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: InvoicesView }],
    });
    await router.push('/?status=OVERDUE');
    const view = mount(InvoicesView, {
      global: { plugins: [router, plugins()[0] as never] },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(view.text()).toContain('Export CSV'));

    await view
      .findAll('button')
      .find((b) => b.text().includes('Export CSV'))
      ?.trigger('click');
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const request = api.calls.find((call) => call.url === '/finance/exports/invoices.csv');
    expect(request?.params).toEqual({ status: 'OVERDUE' });
    created.mockRestore();
    revoked.mockRestore();
    view.unmount();
  });
});
