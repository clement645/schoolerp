# ADR 0009 — School finance and M-Pesa

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 12 (School finance)

## Context

Money needs stricter rules than any other data: amounts must be exact, records
must never disappear, and the same payment must never be credited twice.

## Decisions

### Money is DECIMAL end to end on the server

Amounts are `DECIMAL(14,2)` in PostgreSQL and `Prisma.Decimal` in code
(`finance.calc.ts`), rounded half-up to cents. The API accepts amounts with at
most two decimal places and rejects anything else; nothing is rounded
silently. The web application validates the same way before sending.

### Financial records are never edited or deleted

The application's database role has no `DELETE` on invoices, invoice lines,
payments, credit notes, refunds or M-Pesa transactions, and the tests assert
that a delete attempt fails with "permission denied". Corrections are records
of their own:

| Mistake                              | Correction                                    |
| ------------------------------------ | --------------------------------------------- |
| Invoice raised wrongly, nothing paid | **Void** (kept, marked void, reason recorded) |
| Invoice too high, or a fee waived    | **Credit note**                               |
| Payment recorded in error            | **Reversal** (receipt kept, marked reversed)  |
| Money owed back                      | **Refund** of a payment's unallocated part    |

Every one requires a reason and is audited. `CHECK` constraints keep derived
totals consistent (`balance = total − paid − credited`, never negative).

### Payments are applied oldest-first; excess is credit

A payment is allocated to the learner's unpaid invoices, soonest due first
(or first to an invoice the payer named). What is left over stays on the
payment as unallocated credit, is applied automatically to the learner's next
invoice, and can be refunded. Allocations are a mapping, not transactions:
they are rewritten by reversals and credit notes while the payment and invoice
records themselves stand.

### One learner's money moves one operation at a time

Every operation that moves money first locks the learner's row (`SELECT … FOR
UPDATE`). Two cashiers paying the same invoice at once are serialised and can
never both spend the same balance; a test submits simultaneous payments and
checks the totals. Document numbers come from a per-school counter row whose
update takes a lock, so receipt numbers are never issued twice.

### Duplicate prevention

A payment's reference is unique per school and method (bank transfers,
cheques, card and M-Pesa receipts), enforced by a unique index. Submitting the
same bank reference three times concurrently records it once.

### Fee structures, discounts and scholarships

A fee structure prices a term for a class. Generating invoices from it skips
learners who already hold one (a partial unique index allows re-invoicing only
after a void). Standing discounts and scholarships are applied when an invoice
is raised, each against the original charges, capped so an invoice cannot go
below zero. Issued invoices are unaffected by later changes to either.

### M-Pesa: credited only on Safaricom's word

STK push is implemented against Safaricom's Daraja API behind an abstract
`MpesaGateway`.

- **Nothing is simulated.** There is no code path that credits an M-Pesa
  payment without Safaricom's confirmation, and M-Pesa cannot be chosen when
  recording a payment by hand.
- Requesting a payment records a `PENDING` transaction and credits nothing.
- The callback URL contains an unguessable secret, compared in constant time;
  the body is schema-validated before use. Safaricom does not sign callbacks,
  so this secret is the credential.
- Settlement is idempotent: the transaction row is locked, a payment is
  created at most once, and the M-Pesa receipt number is unique across all
  transactions.
- If the callback never arrives, staff (or the paying parent) can ask
  Safaricom for the outcome with a status query.
- Without credentials, M-Pesa reports itself as not configured and every
  request is refused with `503 MPESA_NOT_CONFIGURED`.
- Start-up is refused if production is pointed at Safaricom's sandbox.

### Documents and exports

Invoices, receipts and statements are produced as PDFs by the API (one
document each; a long statement continues over pages with the header
repeated). Statements, the invoice list and the payment list can also be
exported as CSV, using the same filters as the screen and capped at 5,000
rows. Voided invoices and reversed receipts carry a large VOID or REVERSED
stamp. Every download is audited (`finance.document.exported`) and sent with
`Cache-Control: no-store`. Parents and students can download their own
statement, invoices and receipts from the portal; another family's documents
answer `404`.

CSV cells that a spreadsheet would treat as formulas are neutralised; numbers
are left as numbers, so negative balances stay negative.

## Verification status — read this

The M-Pesa flow is covered by end-to-end tests using a **stand-in gateway**
that plays Safaricom's part (accepted request, callback, cancellation, late
callback, replayed callback, duplicate receipt). It has **not** been run
against Safaricom's sandbox or production: that needs Daraja credentials and
a public HTTPS callback address, which were not available. Treat the Daraja
client (`mpesa.gateway.ts`) as untested against the real service until that
is done.

## Not done

- No scheduled job chases pending M-Pesa requests; they are settled by the
  callback or by a person pressing "Check status".
- One currency per school (`school_settings.currency`, default KES); no
  multi-currency accounts.
