import {
  allocate,
  applyDiscounts,
  invoiceState,
  money,
  runStatement,
  sum,
  ZERO,
  type ChargeLine,
  type DiscountRule,
} from './finance.calc.js';

const charge = (feeItemId: string, amount: number): ChargeLine => ({
  feeItemId,
  description: feeItemId,
  amount: money(amount),
});
const rule = (
  overrides: Partial<Omit<DiscountRule, 'value'>> & Pick<DiscountRule, 'kind'> & { value: number },
): DiscountRule => ({
  name: 'Sibling discount',
  category: 'DISCOUNT',
  feeItemId: null,
  ...overrides,
  value: money(overrides.value),
});
const amounts = (lines: { amount: { toString(): string } }[]) =>
  lines.map((line) => line.amount.toString());

describe('money', () => {
  it('rounds half-up to cents without floating-point drift', () => {
    expect(money('10.005').toString()).toBe('10.01');
    expect(money(0.1).plus(money(0.2)).toString()).toBe('0.3');
    expect(sum([money('0.10'), money('0.20'), money('0.30')]).toString()).toBe('0.6');
  });
});

describe('applyDiscounts', () => {
  const charges = [charge('tuition', 30000), charge('lunch', 6000), charge('transport', 4000)];

  it('applies a percentage to the whole invoice', () => {
    expect(amounts(applyDiscounts(charges, [rule({ kind: 'PERCENTAGE', value: 10 })]))).toEqual([
      '4000',
    ]);
  });

  it('applies a rule to one fee item only', () => {
    const lines = applyDiscounts(charges, [
      rule({ kind: 'PERCENTAGE', value: 50, feeItemId: 'tuition' }),
    ]);
    expect(lines).toMatchObject([{ feeItemId: 'tuition', description: 'Sibling discount (50%)' }]);
    expect(amounts(lines)).toEqual(['15000']);
  });

  it('limits a fixed discount to the charges it applies to', () => {
    expect(
      amounts(applyDiscounts(charges, [rule({ kind: 'FIXED', value: 9000, feeItemId: 'lunch' })])),
    ).toEqual(['6000']);
  });

  it('never discounts an invoice below zero', () => {
    const lines = applyDiscounts(charges, [
      rule({ kind: 'PERCENTAGE', value: 100, category: 'SCHOLARSHIP', name: 'Full scholarship' }),
      rule({ kind: 'FIXED', value: 5000 }),
    ]);
    expect(amounts(lines)).toEqual(['40000']);
  });

  it('caps the last rule at what is left', () => {
    const lines = applyDiscounts(charges, [
      rule({ kind: 'PERCENTAGE', value: 75 }),
      rule({ kind: 'PERCENTAGE', value: 50 }),
    ]);
    expect(amounts(lines)).toEqual(['30000', '10000']);
  });

  it('rounds a percentage to cents and skips rules with nothing to apply to', () => {
    const lines = applyDiscounts(
      [charge('tuition', 999.99)],
      [
        rule({ kind: 'PERCENTAGE', value: 12.5 }),
        rule({ kind: 'FIXED', value: 100, feeItemId: 'boarding' }),
      ],
    );
    expect(amounts(lines)).toEqual(['125']);
  });
});

describe('invoiceState', () => {
  it('follows what has been paid and credited', () => {
    const total = money(1000);
    expect(invoiceState(total, ZERO, ZERO)).toBe('ISSUED');
    expect(invoiceState(total, money(400), ZERO)).toBe('PARTIALLY_PAID');
    expect(invoiceState(total, money(400), money(600))).toBe('PAID');
    expect(invoiceState(total, ZERO, money(1000))).toBe('PAID');
  });
});

describe('allocate', () => {
  const flat = (allocations: ReturnType<typeof allocate>) =>
    allocations.map((a) => `${a.paymentId}>${a.invoiceId}:${a.amount.toString()}`);

  it('settles the oldest invoice first and spills into the next', () => {
    const result = allocate(
      [{ id: 'p1', available: money(1500) }],
      [
        { id: 'i1', balance: money(1000) },
        { id: 'i2', balance: money(1000) },
      ],
    );
    expect(flat(result)).toEqual(['p1>i1:1000', 'p1>i2:500']);
  });

  it('uses several payments and leaves any excess unallocated', () => {
    const result = allocate(
      [
        { id: 'p1', available: money(300) },
        { id: 'p2', available: money(900) },
      ],
      [{ id: 'i1', balance: money(1000) }],
    );
    expect(flat(result)).toEqual(['p1>i1:300', 'p2>i1:700']);
  });

  it('allocates nothing when nothing is owed or nothing is available', () => {
    expect(allocate([{ id: 'p1', available: money(100) }], [])).toEqual([]);
    expect(allocate([{ id: 'p1', available: ZERO }], [{ id: 'i1', balance: money(5) }])).toEqual(
      [],
    );
  });
});

describe('runStatement', () => {
  it('orders entries by time and carries the balance, including into credit', () => {
    const at = (day: number) => new Date(Date.UTC(2026, 8, day));
    const lines = runStatement([
      {
        at: at(10),
        kind: 'PAYMENT',
        reference: 'RCT-1',
        description: 'Cash',
        debit: ZERO,
        credit: money(1200),
      },
      {
        at: at(1),
        kind: 'INVOICE',
        reference: 'INV-1',
        description: 'Term 3 fees',
        debit: money(1000),
        credit: ZERO,
      },
      {
        at: at(12),
        kind: 'REFUND',
        reference: 'RF-1',
        description: 'Overpayment',
        debit: money(200),
        credit: ZERO,
      },
    ]);
    expect(lines.map((line) => [line.reference, line.balance.toString()])).toEqual([
      ['INV-1', '1000'],
      ['RCT-1', '-200'],
      ['RF-1', '0'],
    ]);
  });
});
