import { Prisma } from '../../generated/prisma/client.js';

export type Decimal = Prisma.Decimal;
type Amount = Prisma.Decimal | number | string;

export const ZERO = new Prisma.Decimal(0);

/** A monetary amount, rounded half-up to cents. */
export const money = (value: Amount): Decimal =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: readonly Amount[]): Decimal =>
  values.reduce<Decimal>((total, value) => total.plus(value), ZERO);

export const minOf = (a: Decimal, b: Decimal): Decimal => (a.lessThan(b) ? a : b);

export interface ChargeLine {
  feeItemId: string | null;
  description: string;
  amount: Decimal;
}

export interface DiscountRule {
  name: string;
  category: 'DISCOUNT' | 'SCHOLARSHIP';
  kind: 'PERCENTAGE' | 'FIXED';
  value: Decimal;
  /** Null applies to the whole invoice; otherwise to that fee item's charges. */
  feeItemId: string | null;
}

export interface DiscountLine {
  description: string;
  feeItemId: string | null;
  amount: Decimal;
}

/**
 * Works out the discount lines for a set of charges. Each rule is applied to
 * the original charges (not compounded on the others), and the total discount
 * is capped so an invoice can never go below zero.
 */
export function applyDiscounts(
  charges: readonly ChargeLine[],
  rules: readonly DiscountRule[],
): DiscountLine[] {
  const subtotal = sum(charges.map((charge) => charge.amount));
  let remaining = subtotal;
  const lines: DiscountLine[] = [];

  for (const rule of rules) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const base = rule.feeItemId
      ? sum(charges.filter((c) => c.feeItemId === rule.feeItemId).map((c) => c.amount))
      : subtotal;
    if (base.lessThanOrEqualTo(0)) continue;

    const wanted =
      rule.kind === 'PERCENTAGE'
        ? money(base.times(rule.value).dividedBy(100))
        : minOf(money(rule.value), base);
    const amount = minOf(wanted, remaining);
    if (amount.lessThanOrEqualTo(0)) continue;

    remaining = remaining.minus(amount);
    lines.push({
      description:
        rule.kind === 'PERCENTAGE'
          ? `${rule.name} (${rule.value.toDecimalPlaces(2).toString()}%)`
          : rule.name,
      feeItemId: rule.feeItemId,
      amount,
    });
  }
  return lines;
}

export type InvoiceState = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID';

/** Where an invoice stands, from what has been paid and credited against it. */
export function invoiceState(total: Decimal, paid: Decimal, credited: Decimal): InvoiceState {
  const settled = paid.plus(credited);
  if (settled.greaterThanOrEqualTo(total)) return 'PAID';
  return settled.greaterThan(0) ? 'PARTIALLY_PAID' : 'ISSUED';
}

export interface Allocation {
  paymentId: string;
  invoiceId: string;
  amount: Decimal;
}

/**
 * Matches money that settles nothing yet to invoices that are still owed.
 * Both lists are taken in the order given: oldest payment to oldest invoice.
 */
export function allocate(
  payments: readonly { id: string; available: Decimal }[],
  invoices: readonly { id: string; balance: Decimal }[],
): Allocation[] {
  const allocations: Allocation[] = [];
  const owed = invoices.map((invoice) => ({ ...invoice }));

  for (const payment of payments) {
    let available = payment.available;
    for (const invoice of owed) {
      if (available.lessThanOrEqualTo(0)) break;
      if (invoice.balance.lessThanOrEqualTo(0)) continue;
      const amount = minOf(available, invoice.balance);
      allocations.push({ paymentId: payment.id, invoiceId: invoice.id, amount });
      available = available.minus(amount);
      invoice.balance = invoice.balance.minus(amount);
    }
  }
  return allocations;
}

export type StatementKind =
  'INVOICE' | 'INVOICE_VOIDED' | 'CREDIT_NOTE' | 'PAYMENT' | 'PAYMENT_REVERSED' | 'REFUND';

export interface StatementEvent {
  at: Date;
  kind: StatementKind;
  reference: string;
  description: string;
  /** Increases what the learner owes. */
  debit: Decimal;
  /** Reduces what the learner owes. */
  credit: Decimal;
}

export interface StatementLine extends StatementEvent {
  /** Amount owed after this entry; negative when the account is in credit. */
  balance: Decimal;
}

/** Orders events by time and carries a running balance through them. */
export function runStatement(
  events: readonly StatementEvent[],
  opening: Decimal = ZERO,
): StatementLine[] {
  let balance = opening;
  return [...events]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((event) => {
      balance = balance.plus(event.debit).minus(event.credit);
      return { ...event, balance };
    });
}
